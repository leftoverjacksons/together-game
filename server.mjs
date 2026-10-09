import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createWorld, addPlayer, interact, toolAction, step, snapshot } from './shared/game.mjs';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const routes = { '/': 'public/index.html', '/game.js': 'public/overland.js', '/style.css': 'public/style.css', '/shared/game.mjs': 'shared/game.mjs', '/shared/physics.mjs': 'shared/physics.mjs' };
const code = () => randomBytes(5).toString('hex').toUpperCase();
export function createGameServer() {
  const rooms = new Map();
  const buckets = new Map();
  function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
  async function body(req) {
    let data = ''; for await (const chunk of req) { data += chunk; if (data.length > 4096) throw new Error('Request too large'); }
    return JSON.parse(data || '{}');
  }
  function authorize(room, token) { if (typeof token !== 'string') return null; return room?.sessions.find(v => v.token.length === token.length && timingSafeEqual(Buffer.from(v.token), Buffer.from(token))); }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/health') return json(res, 200, { ok: true });
      if (req.method === 'POST') {
        // Reject browser requests from other origins. Proxy host is used for hosted HTTPS.
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'Origin not allowed' });
        const b = await body(req);
        if (url.pathname === '/api/rooms' || url.pathname === '/api/join') {
          const ip = req.socket.remoteAddress;
          const bucket = buckets.get(ip) || { start: Date.now(), count: 0 };
          if (Date.now() - bucket.start > 60000) { bucket.start = Date.now(); bucket.count = 0; }
          buckets.set(ip, bucket);
          if (++bucket.count > 30) return json(res, 429, { error: 'Too many attempts. Try again in a minute.' });
          let roomCode = String(b.code || '').toUpperCase();
          let room;
          if (url.pathname === '/api/rooms') {
            if (rooms.size >= 100) return json(res, 503, { error: 'The campsite is full. Please try later.' });
            do { roomCode = code(); } while (rooms.has(roomCode));
            room = { state: createWorld(), sessions: [], touched: Date.now() }; rooms.set(roomCode, room);
          } else room = rooms.get(roomCode);
          if (!room) return json(res, 404, { error: 'That trip is not here. Check the code, or ask your partner to start a new trip.' });
          let session = authorize(room, b.token);
          if (!session) {
            if (room.sessions.length >= 2) return json(res, 409, { error: 'This home already has two travelers.' });
            const id = randomBytes(8).toString('hex');
            session = { id, token: randomBytes(24).toString('hex'), stream: null, lastAction: 0, lastSequence: -1 };
            room.sessions.push(session); addPlayer(room.state, id, b.name).connected = false;
          }
          room.touched = Date.now();
          return json(res, 200, { code: roomCode, id: session.id, token: session.token, sequence: session.lastSequence, state: snapshot(room.state) });
        }
        const room = rooms.get(String(b.code || '').toUpperCase());
        const session = authorize(room, b.token);
        if (!session) return json(res, 403, { error: 'Trip session expired. Start or join a trip.' });
        const p = room.state.players.find(p => p.id === session.id);
        if (url.pathname === '/api/input') {
          if (Number.isSafeInteger(b.sequence) && b.sequence > session.lastSequence) {
            session.lastSequence = b.sequence;
            p.input = { left: b.left === true, right: b.right === true, jump: b.jump === true, down: b.down === true, brake: b.brake === true, work: b.work === true, aimX: Number(b.aimX), aimY: Number(b.aimY) };
            p.lastInput = Date.now();
          }
        } else if (url.pathname === '/api/interact') {
          if (Date.now() - session.lastAction > 180) { interact(room.state, p); session.lastAction = Date.now(); }
        } else if (url.pathname === '/api/tool') {
          if (Date.now() - (session.lastTool || 0) > 90) { toolAction(room.state, p, b.action || {}); session.lastTool = Date.now(); }
        } else return json(res, 404, { error: 'Unknown action' });
        room.touched = Date.now(); return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        const room = rooms.get(url.searchParams.get('code'));
        const session = authorize(room, url.searchParams.get('token'));
        if (!session) return json(res, 403, { error: 'Invalid session' });
        if (session.stream) session.stream.end();
        session.stream = res;
        const p = room.state.players.find(p => p.id === session.id); p.connected = true;
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write('data: ' + JSON.stringify(snapshot(room.state)) + '\n\n');
        session.terrainVersion = room.state.terrainVersion;
        req.on('close', () => { if (session.stream === res) { session.stream = null; p.connected = false; p.input = {}; room.touched = Date.now(); } });
        return;
      }
      if (req.method !== 'GET' || !routes[url.pathname]) return json(res, 404, { error: 'Not found' });
      const path = routes[url.pathname];
      const ext = path.endsWith('.mjs') ? '.js' : path.slice(path.lastIndexOf('.'));
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'" });
      res.end(await readFile(new URL(path, import.meta.url)));
    } catch (e) { if (!res.headersSent) json(res, 400, { error: e.message === 'Request too large' ? e.message : 'Could not process the request' }); else res.end(); }
  });
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [key, room] of rooms) {
      if (!room.sessions.some(v => v.stream)) {
        if (now - room.touched > 2 * 60 * 60 * 1000) rooms.delete(key);
        continue;
      }
      for (const p of room.state.players) if (now - p.lastInput > 750) p.input = {};
      step(room.state);
      const data = 'data: ' + JSON.stringify(snapshot(room.state, false)) + '\n\n';
      for (const session of room.sessions) if (session.stream && !session.stream.writableNeedDrain) {
        const changed = session.terrainVersion !== room.state.terrainVersion;
        session.stream.write(changed ? 'data: ' + JSON.stringify(snapshot(room.state)) + '\n\n' : data);
        session.terrainVersion = room.state.terrainVersion;
      }
    }
    for (const [ip, b] of buckets) if (now - b.start > 120000) buckets.delete(ip);
  }, 50);
  timer.unref(); server.on('close', () => clearInterval(timer));
  return { server, rooms };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { server } = createGameServer();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`Together is ready at http://localhost:${port}`));
}
