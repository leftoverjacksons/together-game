import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../shared/sim.mjs';
import { Terrain } from '../shared/terrain.mjs';
import { FORK, forkZone } from '../shared/fork.mjs';
import { INTERIOR } from '../shared/constants.mjs';

function driving(seed = 1234) {
  const sim = new Sim(seed);
  const f = sim.terrain.forks[0];
  sim.placeCamper(f.x0 - 14);
  sim.addPlayer('a', 'A');
  Object.assign(sim.players.get('a').avatar, { mode: 'in', lx: INTERIOR.seatX });
  sim.handle('a', { t: 'seat' });
  sim.handle('a', { t: 'drive', throttle: 1 });
  return { sim, f };
}
const run = (sim, secs) => { for (let i = 0; i < 60 * secs; i++) sim.step(1 / 60); return sim.camper.chassis.getPosition(); };
// Dig out a region exactly (above a floor line), as travellers would with shovels.
const dig = (sim, x0, x1, y0, y1) => { for (let x = x0; x <= x1; x += 0.25) for (let y = y0; y <= y1; y += 0.25) sim.terrain.dig(x, y, 0.4, 255, 99); sim.terrain.active.clear(); };

test('every stretch has a fork with a cave under the road', () => {
  for (const seed of [1, 42, 1234, 777, 9]) {
    const t = new Terrain(640, seed);
    assert.equal(t.forks.length, 1, `seed ${seed}`);
    const f = t.forks[0];
    assert.ok(f.x0 > 100 && f.x0 < 300);
    const mid = f.x0 + 20;
    assert.ok(t.solidAt(mid - 15, f.h0 - 0.3), 'turf crust over the entrance');
    assert.ok(!t.solidAt(f.x0 + 15, f.h0 - 5), 'cave below');
    assert.ok(t.solidAt(f.x0 + 28, f.h0 - 5), 'cave-in plug');
    assert.equal(forkZone(t.forks, f.x0 + 15, f.h0 - 5), 'low');
    assert.equal(forkZone(t.forks, f.x0 + 15, f.h0 + 0.1), 'high');
    assert.equal(forkZone(t.forks, f.x0 - 30, f.h0), null);
  }
});

test('high route: the crevasse stops the camper until it is filled', () => {
  const a = driving();
  const p = run(a.sim, 14);
  assert.ok(p.x < a.f.x0 + FORK.crevasse[1] + 2, `stopped at the crevasse (x ${(p.x - a.f.x0).toFixed(1)})`);
  const b = driving();
  for (let y = b.f.h0 - FORK.crevasse[2]; y <= b.f.h0 - 0.1; y += 0.3) for (let x = b.f.x0 + FORK.crevasse[0]; x <= b.f.x0 + FORK.crevasse[1]; x += 0.3) b.sim.terrain.fill(x, y, 0.5, 255, 99, null);
  const q = run(b.sim, 16);
  assert.ok(q.x > b.f.x0 + FORK.exitTop + 5 && q.y > b.f.h0, `over the top (x ${(q.x - b.f.x0).toFixed(1)})`);
});

test('low route: dig in through the turf, through the cave-in, and out', () => {
  const { sim, f } = driving();
  dig(sim, f.x0 - 0.3, f.x0 + FORK.room[0], f.h0 - 0.45, f.h0 + 0.3);
  let p = run(sim, 14);
  assert.ok(p.y < f.h0 - 3, 'down in the cave');
  assert.ok(p.x < f.x0 + FORK.plug[0], 'held up by the cave-in');
  dig(sim, f.x0 + FORK.plug[0] - 0.3, f.x0 + FORK.plug[1] + 0.3, f.h0 - FORK.floor + 0.3, f.h0 - FORK.roof - 0.2);
  p = run(sim, 10);
  assert.ok(p.x > f.x0 + FORK.room[1] && p.x < f.x0 + FORK.exitTop, 'up against the exit crust');
  dig(sim, f.x0 + FORK.room[1], f.x0 + FORK.exitTop + 0.2, f.h0 - 0.4, f.h0 + 0.3);
  p = run(sim, 14);
  assert.ok(p.x > f.x0 + FORK.exitTop + 5 && p.y > f.h0, `out and away (x ${(p.x - f.x0).toFixed(1)})`);
});

test('the fox in the den is only reachable on foot, down in the den', () => {
  const sim = new Sim(1234);
  const fox = sim.animals.find(a => a.den);
  assert.ok(fox && fox.y < sim.terrain.forks[0].h0 - 7);
  sim.addPlayer('a', 'A');
  const stand = y => sim.handle('a', { t: 'avatar', a: { mode: 'out', lane: 0, x: fox.x, y, vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
  stand(sim.terrain.forks[0].h0);              // on the road right above it
  sim.handle('a', { t: 'rescue', on: true });
  run(sim, 5);
  assert.equal(fox.state, 'waiting', 'not through the ground');
  stand(fox.y);
  run(sim, 5);
  assert.equal(fox.state, 'riding');
});

test('scouting flags: plant, tell the partner, pull up', () => {
  const sim = new Sim(1234);
  const f = sim.terrain.forks[0];
  sim.addPlayer('a', 'Ada'); sim.addPlayer('b', 'Bo');
  sim.handle('a', { t: 'avatar', a: { mode: 'out', lane: 0, x: f.x0 + 20, y: f.h0 - FORK.floor, vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
  sim.handle('a', { t: 'flag', kind: 'blocked' });
  const fx = sim.drain().find(m => m.t === 'fx' && m.kind === 'flag');
  assert.deepEqual([fx.name, fx.flag, fx.zone], ['Ada', 'blocked', 'low']);
  assert.equal(sim.snapshot().flags.length, 1);
  sim.handle('a', { t: 'flag', kind: 'good' });          // beside her own flag: pulls it up
  assert.equal(sim.snapshot().flags.length, 0);
  for (let k = 0; k < 6; k++) {
    sim.handle('a', { t: 'avatar', a: { mode: 'out', lane: 0, x: f.x0 - 40 + k * 3, y: f.h0, vx: 0, vy: 0, facing: 1, lx: 0, onGround: true } });
    sim.handle('a', { t: 'flag', kind: 'good' });
  }
  assert.equal(sim.snapshot().flags.length, 4, 'at most four each');
});
