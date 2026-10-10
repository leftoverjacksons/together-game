import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { createGameServer } from '../server/index.mjs';

function listen() {
  const { server } = createGameServer();
  return new Promise(r => server.listen(0, () => r({ server, port: server.address().port })));
}

function client(port, room, name, token = '') {
  const ws = new WebSocket(`ws://localhost:${port}/ws?room=${room}&name=${name}&token=${token}`);
  const msgs = [];
  const waiters = [];
  ws.on('message', d => { const m = JSON.parse(d); msgs.push(m); for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m); } });
  const next = pred => { const m = msgs.find(pred); if (m) return Promise.resolve(m); return new Promise(res => waiters.push({ pred, res })); };
  return { ws, msgs, next, send: m => ws.send(JSON.stringify(m)) };
}

test('two travellers share a trip; a third is turned away', async () => {
  const { server, port } = await listen();
  try {
    const health = await fetch(`http://localhost:${port}/health`).then(r => r.json());
    assert.equal(health.ok, true);
    const { code } = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST' }).then(r => r.json());
    assert.match(code, /^[0-9A-F]{6}$/);

    const a = client(port, code, 'Ada');
    const wa = await a.next(m => m.t === 'welcome');
    assert.ok(wa.token && wa.seed >= 0);
    const b = client(port, code, 'Bo');
    const wb = await b.next(m => m.t === 'welcome');
    assert.equal(wb.seed, wa.seed);

    const snap = await a.next(m => m.t === 'snap' && m.players.length === 2);
    assert.deepEqual(snap.players.map(p => p.name).sort(), ['Ada', 'Bo']);

    const c = client(port, code, 'Cy');
    const err = await c.next(m => m.t === 'error');
    assert.match(err.msg, /two travellers/);

    // Reconnecting with a token resumes the same traveller.
    a.ws.close();
    const a2 = client(port, code, 'Ada', wa.token);
    const wa2 = await a2.next(m => m.t === 'welcome');
    assert.equal(wa2.id, wa.id);

    // Terrain edits reach the other traveller.
    const me = wa2.snap.players.find(p => p.id === wa.id);
    a2.send({ t: 'avatar', a: { mode: 'out', x: 30, y: 16, vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
    await new Promise(r => setTimeout(r, 50));
    for (let k = 0; k < 6; k++) { a2.send({ t: 'dig', x: 31, y: 15.6 - k * 0.2 }); await new Promise(r => setTimeout(r, 80)); }
    const edit = await b.next(m => m.t === 'terrain');
    assert.ok(edit.i.length > 0 && edit.i.length === edit.v.length);
    assert.ok(me);
    for (const x of [a2, b, c]) x.ws.close();
  } finally {
    server.close();
  }
});

test('unknown trip codes are rejected and static files are served', async () => {
  const { server, port } = await listen();
  try {
    const c = client(port, 'ZZZZZZ', 'Nobody');
    const err = await c.next(m => m.t === 'error');
    assert.match(err.msg, /not here/);
    const html = await fetch(`http://localhost:${port}/`).then(r => r.text());
    assert.match(html, /<title>Together<\/title>/);
    assert.equal((await fetch(`http://localhost:${port}/../package.json`)).status, 404);
    c.ws.close();
  } finally {
    server.close();
  }
});
