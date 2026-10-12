import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket from 'ws';
import { generateLaneWorld, makeTerrains, DIVIDER_TYPES, camperGapAt, footCrossing, segmentAt, laneZ } from '../shared/lanes/world.mjs';
import { LaneSim } from '../shared/lanes/laneSim.mjs';
import { INTERIOR } from '../shared/constants.mjs';
import { createGameServer } from '../server/index.mjs';

const gapsOf = (w, k) => w.dividers[k].filter(s => DIVIDER_TYPES[s.type].camper);

test('lane worlds are deterministic and dividers cover the whole route', () => {
  const a = generateLaneWorld(1234), b = generateLaneWorld(1234);
  assert.deepEqual(a.dividers, b.dividers);
  assert.deepEqual(a.walls, b.walls);
  assert.deepEqual(a.animals, b.animals);
  for (const segs of a.dividers) {
    assert.equal(segs[0].x0, 0);
    assert.ok(segs.at(-1).x1 >= a.length - 1e-6);
    for (let k = 1; k < segs.length; k++) assert.ok(Math.abs(segs[k].x0 - segs[k - 1].x1) < 1e-6, 'segments are contiguous');
  }
  assert.ok(laneZ(0) > laneZ(2), 'lane 0 is nearest the camera');
});

test('gaps are level, frequent, and every dead end has a way round', () => {
  for (const seed of [1, 42, 777, 9001]) {
    const w = generateLaneWorld(seed), T = makeTerrains(w);
    for (let k = 0; k < 2; k++) {
      const gaps = gapsOf(w, k);
      assert.ok(gaps.length >= 8, `divider ${k} has gaps (seed ${seed})`);
      for (const g of gaps) for (let x = g.x0; x <= g.x1; x += 0.5)
        assert.ok(Math.abs(T[k].groundY(x) - T[k + 1].groundY(x)) < 0.2, `level gap at ${x.toFixed(1)} (seed ${seed})`);
    }
    for (const wall of w.walls) {
      assert.notEqual(wall.lane, 1, 'the middle lane never dead-ends');
      const k = wall.lane === 0 ? 0 : 1;
      assert.ok(gapsOf(w, k).some(g => g.x1 < wall.x - 10 && g.x1 > wall.x - 45), `gap before the wall at ${wall.x.toFixed(0)}`);
      // The wall really blocks: tall rock.
      assert.ok(T[wall.lane].groundY(wall.x) - T[wall.lane].groundY(wall.x - 4) > 3);
    }
    assert.ok(w.animals.filter(a => a.lane !== 1).length > w.animals.length * 0.6, 'animals favour the harder lanes');
  }
});

test('on foot: deep creek and steep banks stop you; hedges and stones let you through', () => {
  const w = generateLaneWorld(42), T = makeTerrains(w);
  const tryAt = (k, type) => {
    const seg = w.dividers[k].find(s => s.type === type && s.x1 - s.x0 > 2);
    if (!seg) return null;
    const x = (seg.x0 + seg.x1) / 2;
    return footCrossing(w, T, k, k + 1, x, T[k].groundY(x));
  };
  const creek = tryAt(0, 'creek');
  assert.equal(creek.ok, false);
  assert.match(creek.why, /too deep/);
  const bank = tryAt(1, 'bank');
  if (bank) assert.equal(bank.ok, false);
  const stones = tryAt(0, 'stones');
  if (stones) assert.equal(stones.ok, true);
  const hedge = tryAt(1, 'hedge');
  if (hedge && hedge.ok) assert.ok(hedge.time > 1);
  assert.equal(footCrossing(w, T, 0, 2, 100, 16).ok, false, 'one lane at a time');
});

function seatDriver(sim, id) {
  sim.addPlayer(id, id);
  sim.players.get(id).avatar.lx = INTERIOR.seatX;
  sim.handle(id, { t: 'seat' });
  assert.equal(sim.players.get(id).seat, 'cab');
}

test('the camper changes lane only at a gap, then drives in the new lane', () => {
  const sim = new LaneSim(42);
  seatDriver(sim, 'a');
  const c = sim.camper;
  const gap = gapsOf(sim.lw, 0).find(g => g.x0 > 30);
  // Outside a gap: refused with a notice.
  const wall = segmentAt(sim.lw.dividers[0], c.chassis.getPosition().x);
  assert.ok(!DIVIDER_TYPES[wall.type].camper);
  sim.handle('a', { t: 'lane', dir: -1 });
  assert.equal(c.change, null);
  assert.ok(sim.drain().some(m => m.t === 'notice' && /Find a gap/.test(m.msg)));
  // Drive into the gap and turn.
  sim.handle('a', { t: 'drive', throttle: 1 });
  for (let i = 0; i < 60 * 30 && c.chassis.getPosition().x < gap.x0 + 4; i++) sim.step(1 / 60);
  assert.ok(camperGapAt(sim.lw, 1, 0, c.chassis.getPosition().x));
  sim.handle('a', { t: 'lane', dir: -1 });
  assert.ok(c.change);
  for (let i = 0; i < 120; i++) sim.step(1 / 60);
  assert.equal(c.lane, 0);
  assert.equal(c.change, null);
  assert.equal(sim.snapshot().c.lane, 0);
  assert.ok(Math.cos(c.chassis.getAngle()) > 0.8, 'still upright');
  // Collision is now with lane 0 only.
  const f = c.chassis.getFixtureList();
  assert.equal(f.getFilterMaskBits(), 1);
});

test('travellers rescue animals in their lane; birds can be reached from the next lane', () => {
  const sim = new LaneSim(42);
  sim.addPlayer('a', 'A');
  const ground = sim.animals.find(a => a.kind !== 'songbird' && a.kind !== 'hawk');
  const bird = sim.animals.find(a => a.kind === 'songbird' || a.kind === 'hawk');
  const stand = (an, lane) => sim.handle('a', { t: 'avatar', a: { mode: 'out', lane, x: an.x, y: sim.terrains[lane].groundY(an.x), vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
  const other = ground.lane === 1 ? 0 : 1;
  stand(ground, other);
  sim.handle('a', { t: 'rescue', on: true });
  for (let i = 0; i < 60 * 3; i++) sim.step(1 / 60);
  assert.equal(ground.state, 'stuck', 'not from the wrong lane');
  stand(ground, ground.lane);
  for (let i = 0; i < 60 * 8 && ground.state === 'stuck'; i++) sim.step(1 / 60);
  assert.equal(ground.state, 'riding');
  assert.equal(sim.rescued, 1);
  if (bird) {
    stand(bird, bird.lane === 2 ? 1 : bird.lane + 1);
    for (let i = 0; i < 60 * 8 && bird.state === 'stuck'; i++) sim.step(1 / 60);
    assert.equal(bird.state, 'riding');
  }
});

test('digging edits only the traveller\'s own lane', () => {
  const sim = new LaneSim(7);
  sim.addPlayer('a', 'A');
  const x = 30, y = sim.terrains[2].groundY(x);
  sim.handle('a', { t: 'avatar', a: { mode: 'out', lane: 2, x, y, vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
  sim.handle('a', { t: 'dig', lane: 1, x: x + 1, y: y - 0.2 });     // wrong lane: ignored
  sim.step(1 / 60);
  for (let k = 0; k < 6; k++) { sim.handle('a', { t: 'dig', lane: 2, x: x + 1, y: y - 0.2 - k * 0.1 }); for (let i = 0; i < 5; i++) sim.step(1 / 60); }
  const edits = sim.drain().filter(m => m.t === 'terrain');
  assert.ok(edits.length > 0);
  assert.ok(edits.every(m => m.lane === 2));
  assert.ok(sim.players.get('a').soil > 0);
});

test('the server runs lane trips when asked', async () => {
  const { server } = createGameServer();
  await new Promise(r => server.listen(0, r));
  const port = server.address().port;
  try {
    const made = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'lanes' }) }).then(r => r.json());
    assert.equal(made.mode, 'lanes');
    const info = await fetch(`http://localhost:${port}/api/rooms/${made.code}`).then(r => r.json());
    assert.equal(info.mode, 'lanes');
    const plain = await fetch(`http://localhost:${port}/api/rooms`, { method: 'POST' }).then(r => r.json());
    assert.equal(plain.mode, 'side');
    const ws = new WebSocket(`ws://localhost:${port}/ws?room=${made.code}&name=Ada`);
    const welcome = await new Promise(res => ws.on('message', d => { const m = JSON.parse(d); if (m.t === 'welcome') res(m); }));
    assert.equal(welcome.mode, 'lanes');
    assert.equal(welcome.edits.length, 3);
    assert.equal(typeof welcome.snap.c.lane, 'number');
    ws.close();
  } finally {
    server.close();
  }
});
