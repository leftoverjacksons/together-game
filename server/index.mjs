import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { WebSocketServer } from 'ws';
import { Sim } from '../shared/sim.mjs';
import { TICK_HZ, SNAPSHOT_HZ, MAX_PLAYERS } from '../shared/constants.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.map': 'application/json', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const ASSET_FILE = /^\/assets\/[\w-]+(\/[\w-]+)*\.(png|webp|jpg|svg|json)$/;
const STATIC = { '/': 'public/index.html', '/style.css': 'public/style.css' };
const DIST_FILE = /^\/[\w-]+\.js(\.map)?$/;   // the bundle and its lazily loaded chunks
const MAX_ROOMS = 100;
const ROOM_IDLE_MS = 2 * 60 * 60 * 1000;
const DT = 1 / TICK_HZ;
const SNAP_EVERY = Math.round(TICK_HZ / SNAPSHOT_HZ);

const newCode = () => randomBytes(3).toString('hex').toUpperCase();
const tokenEq = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function createGameServer() {
  const rooms = new Map();     // code -> { sim, sessions: [{id, token, ws}], touched }
  const buckets = new Map();   // ip -> { start, count }
  const fileCache = new Map(); // path -> { data, gz }

  function limited(ip) {
    const now = Date.now();
    const b = buckets.get(ip) || { start: now, count: 0 };
    if (now - b.start > 60000) { b.start = now; b.count = 0; }
    buckets.set(ip, b);
    return ++b.count > 30;
  }

  function json(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true, rooms: rooms.size });
      if (req.method === 'POST' && url.pathname === '/api/rooms') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Origin not allowed' });
        if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
        if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'The campground is full. Try again later.' });
        let code; do code = newCode(); while (rooms.has(code));
        const seed = randomBytes(4).readUInt32LE(0);
        rooms.set(code, { sim: new Sim(seed), sessions: [], touched: Date.now(), acc: 0 });
        return json(res, 200, { code });
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/rooms/')) {
        const room = rooms.get(url.pathname.slice(11).toUpperCase());
        return room ? json(res, 200, { players: room.sessions.length }) : json(res, 404, { error: 'No trip with that code.' });
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const file = STATIC[url.pathname] || (DIST_FILE.test(url.pathname) ? 'dist' + url.pathname : null) || (ASSET_FILE.test(url.pathname) && !url.pathname.includes('..') ? 'public' + url.pathname : null);
        if (file) {
          const path = normalize(join(ROOT, file));
          let entry = fileCache.get(path);
          if (!entry) { const data = await readFile(path); entry = { data, gz: gzipSync(data) }; if (process.env.NODE_ENV === 'production') fileCache.set(path, entry); }
          const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
          res.writeHead(200, { 'Content-Type': MIME[extname(path)] || 'application/octet-stream', 'Cache-Control': url.pathname === '/' || url.pathname.endsWith('.json') ? 'no-cache' : 'public, max-age=300', 'Vary': 'Accept-Encoding', ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
          return res.end(req.method === 'HEAD' ? undefined : gz ? entry.gz : entry.data);
        }
      }
      json(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err.code === 'ENOENT') return json(res, 404, { error: 'Not built. Run npm run build.' });
      json(res, 500, { error: 'Server error' });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname !== '/ws' || (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host)) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, ws => onConnect(ws, url));
  });

  function send(ws, msg) { if (ws && ws.readyState === 1) ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); }

  function onConnect(ws, url) {
    const code = String(url.searchParams.get('room') || '').toUpperCase();
    const room = rooms.get(code);
    if (!room) { send(ws, { t: 'error', msg: 'That trip is not here. Check the code, or start a new trip.' }); ws.close(); return; }
    let session = room.sessions.find(s => tokenEq(s.token, url.searchParams.get('token')));
    if (!session) {
      if (room.sessions.length >= MAX_PLAYERS) { send(ws, { t: 'error', msg: 'This camper already has two travellers.' }); ws.close(); return; }
      session = { id: randomBytes(6).toString('hex'), token: randomBytes(18).toString('hex'), ws: null };
      room.sessions.push(session);
      room.sim.addPlayer(session.id, url.searchParams.get('name'));
    }
    if (session.ws) session.ws.close(4000, 'replaced');
    session.ws = ws;
    room.sim.setConnected(session.id, true);
    room.touched = Date.now();
    send(ws, { ...room.sim.welcome(session.id), token: session.token, code });

    let count = 0, windowStart = Date.now();
    ws.on('message', data => {
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > 120) return;                    // drop floods
      let msg; try { msg = JSON.parse(data); } catch { return; }
      room.sim.handle(session.id, msg);
      room.touched = now;
    });
    ws.on('close', () => {
      if (session.ws !== ws) return;
      session.ws = null;
      room.sim.setConnected(session.id, false);
      room.touched = Date.now();
    });
  }

  // One loop steps every active room at a fixed rate.
  let last = performance.now();
  const loop = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(0.25, (now - last) / 1000);
    last = now;
    for (const [code, room] of rooms) {
      const live = room.sessions.filter(s => s.ws);
      if (!live.length) {
        if (Date.now() - room.touched > ROOM_IDLE_MS) rooms.delete(code);
        continue;
      }
      room.acc += elapsed;
      while (room.acc >= DT) {
        room.acc -= DT;
        room.sim.step(DT);
        const out = room.sim.drain();
        if (room.sim.tick % SNAP_EVERY === 0) out.push(room.sim.snapshot());
        for (const msg of out) { const s = JSON.stringify(msg); for (const ses of live) send(ses.ws, s); }
      }
    }
  }, 1000 / TICK_HZ);
  server.on('close', () => { clearInterval(loop); wss.close(); });

  return { server, rooms };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT) || 3000;
  createGameServer().server.listen(port, () => console.log(`Together listening on http://localhost:${port}`));
}
