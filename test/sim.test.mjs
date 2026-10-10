import test from 'node:test';
import assert from 'node:assert/strict';
import { Vec2 } from 'planck';
import { Sim } from '../shared/sim.mjs';
import { INTERIOR, SOIL_CAPACITY } from '../shared/constants.mjs';
import { newAvatar, stepAvatar } from '../shared/character.mjs';

const run = (sim, seconds) => { for (let i = 0; i < seconds * 60; i++) sim.step(1 / 60); };

function seated(seed = 1234) {
  const sim = new Sim(seed);
  const p = sim.addPlayer('a', 'A');
  p.avatar.lx = INTERIOR.seatX;
  sim.handle('a', { t: 'seat' });
  return { sim, p };
}

test('camper settles upright and only a seated player can drive', () => {
  const { sim, p } = seated();
  assert.equal(p.seat, 'cab');
  sim.addPlayer('b', 'B');
  sim.handle('b', { t: 'drive', throttle: -1 });
  assert.equal(sim.camper.throttle, 0);
  run(sim, 1);
  const s = sim.snapshot();
  assert.ok(Math.abs(s.c.a) < 0.1);
});

test('throttle moves the camper forward; no driver means it holds still', () => {
  const { sim } = seated();
  run(sim, 1);
  const x0 = sim.snapshot().c.x;
  sim.handle('a', { t: 'drive', throttle: 1 });
  run(sim, 2);
  const x1 = sim.snapshot().c.x;
  assert.ok(x1 - x0 > 8, `moved ${x1 - x0}`);
  sim.handle('a', { t: 'unseat' });
  run(sim, 3);
  const x2 = sim.snapshot().c.x;
  run(sim, 2);
  assert.ok(Math.abs(sim.snapshot().c.x - x2) < 0.3, 'parked camper stays put');
});

test('only one driver at a time, and seats need proximity', () => {
  const { sim } = seated();
  const b = sim.addPlayer('b', 'B');
  b.avatar.lx = INTERIOR.seatX;
  sim.handle('b', { t: 'seat' });
  assert.equal(b.seat, null);
  sim.handle('a', { t: 'unseat' });
  b.avatar.lx = INTERIOR.doorX;
  sim.handle('b', { t: 'seat' });
  assert.equal(b.seat, null);
});

test('a flipped camper can be pushed upright by one traveller', () => {
  const sim = new Sim(1234);
  sim.placeCamper(30);
  const ch = sim.camper.chassis, pos = ch.getPosition();
  ch.setTransform(Vec2(pos.x, pos.y + 2), 3.0);
  run(sim, 4);
  assert.equal(sim.tipped, true);
  const p = sim.addPlayer('a', 'A');
  Object.assign(p.avatar, { mode: 'out', x: pos.x - 2, y: pos.y - 1 });
  sim.handle('a', { t: 'push', on: true });
  for (let i = 0; i < 10 * 60 && sim.tipped; i++) { p.avatar.x = ch.getPosition().x - 2; p.avatar.y = ch.getPosition().y - 1; sim.step(1 / 60); }
  run(sim, 1);
  assert.ok(Math.cos(ch.getAngle()) > 0.9, `angle ${ch.getAngle()}`);
});

test('digging fills the bucket up to capacity and respects reach', () => {
  const sim = new Sim(77);
  const p = sim.addPlayer('a', 'A');
  const x = 40, g = sim.terrain.groundY(x);
  Object.assign(p.avatar, { mode: 'out', x, y: g });
  sim.handle('a', { t: 'dig', x: x + 10, y: g });
  assert.equal(p.soil, 0, 'out of reach');
  for (let i = 0; i < 400 && p.soil < SOIL_CAPACITY - 1e-3; i++) {
    const dx = x - 2.5 + (i % 11) * 0.5;
    sim.handle('a', { t: 'dig', x: dx, y: sim.terrain.groundY(dx) });
    run(sim, 0.1);
  }
  assert.ok(Math.abs(p.soil - SOIL_CAPACITY) < 2e-3, `soil ${p.soil}`);
  const out = sim.drain();
  assert.ok(out.some(m => m.t === 'terrain'));
  assert.ok(sim.edits.size > 0);
});

test('soil cannot be placed inside the camper', () => {
  const sim = new Sim(77);
  const p = sim.addPlayer('a', 'A');
  const c = sim.camper.chassis.getPosition();
  Object.assign(p.avatar, { mode: 'out', x: c.x, y: sim.terrain.groundY(c.x) });
  p.soil = 2;
  sim.handle('a', { t: 'fill', x: c.x, y: c.y });
  assert.equal(p.soil, 2);
});

test('avatar walks on terrain and cannot leave the camper leash', () => {
  const sim = new Sim(5);
  const t = sim.terrain;
  const a = newAvatar(25, t.groundY(25) + 1);
  for (let i = 0; i < 60; i++) stepAvatar(a, t, {}, 1 / 60, 25);
  assert.ok(a.onGround);
  assert.ok(Math.abs(a.y - t.groundY(25)) < 0.1);
  for (let i = 0; i < 60 * 12; i++) stepAvatar(a, t, { move: 1 }, 1 / 60, 25);
  assert.ok(a.x <= 25 + 30 + 1e-9);
});
