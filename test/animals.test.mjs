import test from 'node:test';
import assert from 'node:assert/strict';
import { Sim } from '../shared/sim.mjs';
import { INTERIOR } from '../shared/constants.mjs';

const run = (sim, s) => { for (let i = 0; i < s * 60; i++) sim.step(1 / 60); };
const find = (sim, kind) => sim.animals.find(a => a.kind === kind);
function onFoot(sim, p, x, lane) {
  Object.assign(p.avatar, { mode: 'out', lane, x, y: lane === 1 ? sim.floor[Math.round(x / 0.25)] : sim.terrain.groundY(x), onGround: true });
}

test('the dog is near the start and becomes a companion after a moment of attention', () => {
  const sim = new Sim(1234);
  const dog = find(sim, 'dog');
  assert.ok(dog.x > 40 && dog.x < 60);
  const p = sim.addPlayer('a', 'A');
  onFoot(sim, p, dog.x - 0.8, 0);
  sim.handle('a', { t: 'rescue', on: true });
  run(sim, 2);
  assert.equal(dog.state, 'companion');
});

test('hold-to-free animals go twice as fast with two travellers', () => {
  const time = n => {
    const sim = new Sim(1234);
    const deer = find(sim, 'deer');
    for (let k = 0; k < n; k++) { const p = sim.addPlayer('p' + k, 'P'); onFoot(sim, p, deer.x + (k ? 0.6 : -0.6), deer.lane); sim.handle('p' + k, { t: 'rescue', on: true }); }
    let t = 0;
    while (deer.state === 'waiting' && t < 20) { run(sim, 0.25); t += 0.25; }
    assert.equal(deer.state, 'following');
    return t;
  };
  const alone = time(1), together = time(2);
  assert.ok(together < alone * 0.6, `alone ${alone}s, together ${together}s`);
});

test('the rabbit is freed by digging away its collapsed burrow', () => {
  const sim = new Sim(1234);
  const rabbit = find(sim, 'rabbit');
  assert.ok(sim.terrain.solidAt(rabbit.x, rabbit.y + 0.4), 'buried under a mound');
  const p = sim.addPlayer('a', 'A');
  for (let k = 0; k < 400 && rabbit.state === 'waiting'; k++) {
    onFoot(sim, p, rabbit.x - 1.6, 0);
    p.soil = 0;
    const dx = rabbit.x - 0.6 + (k % 5) * 0.3;
    sim.handle('a', { t: 'dig', x: dx, y: sim.terrain.groundY(dx) });
    run(sim, 0.1);
  }
  assert.equal(rabbit.state, 'riding');
  assert.equal(sim.rescued, 1);
});

test('the chipmunk is freed when the branch pinning it is sawn', () => {
  const sim = new Sim(1234);
  const chip = find(sim, 'chipmunk');
  const p = sim.addPlayer('a', 'A');
  p.tools[1] = 'saw'; p.tool = 1;
  run(sim, 1);
  const log = sim.logs.get(chip.pin);
  onFoot(sim, p, sim.logPose(log).x, 0);
  for (let k = 0; k < 400 && chip.state === 'waiting'; k++) { sim.handle('a', { t: 'saw' }); run(sim, 0.1); }
  assert.equal(chip.state, 'riding');
});

test('the hawk is carried to the camper', () => {
  const sim = new Sim(1234);
  const hawk = find(sim, 'hawk');
  const p = sim.addPlayer('a', 'A');
  onFoot(sim, p, hawk.x, hawk.lane);
  sim.handle('a', { t: 'carryAnimal', id: hawk.id });
  assert.equal(hawk.state, 'carried');
  sim.placeCamper(hawk.x + 6);
  onFoot(sim, p, hawk.x + 2, 0);
  run(sim, 0.5);
  assert.equal(hawk.state, 'following');
});

test('a large helper pushes a stalled, heavily loaded camper up a hill', () => {
  const progress = withBear => {
    const sim = new Sim(1234);
    const hill = sim.terrain.features.find(f => f.kind === 'hill');
    sim.placeCamper(hill.x - hill.width / 2 - 4);
    // Overload the camper until it can't make the climb on its own.
    const ch = sim.camper.chassis; const md = { mass: 0, center: { x: 0, y: 0 }, I: 0 };
    ch.getMassData(md); ch.setMassData({ mass: md.mass * 1.9, center: md.center, I: md.I * 1.9 });
    const p = sim.addPlayer('a', 'A');
    if (withBear) { const bear = find(sim, 'bear'); bear.state = 'following'; bear.x = ch.getPosition().x - 10; }
    Object.assign(p.avatar, { mode: 'in', lx: INTERIOR.seatX });
    sim.handle('a', { t: 'seat' });
    sim.handle('a', { t: 'drive', throttle: 1 });
    let helped = false, best = 0;
    for (let i = 0; i < 60 * 14; i++) { sim.step(1 / 60); if (sim.animals.some(a => a.help)) helped = true; best = Math.max(best, ch.getPosition().x); }
    return { best, top: hill.x, helped };
  };
  const without = progress(false), withB = progress(true);
  assert.ok(without.best < without.top, `stalls on the hill alone (reached ${without.best.toFixed(1)}, top ${without.top.toFixed(1)})`);
  assert.ok(withB.helped, 'the bear joined in');
  assert.ok(withB.best > without.best + 2, `bear helped: ${without.best.toFixed(1)} -> ${withB.best.toFixed(1)}`);
});

test('the collie hops into the camper when everyone is aboard, and out again', () => {
  const sim = new Sim(1234);
  const dog = find(sim, 'dog');
  dog.state = 'companion';
  sim.placeCamper(dog.x + 8);
  const p = sim.addPlayer('a', 'A');
  Object.assign(p.avatar, { mode: 'in', lx: 0 });
  run(sim, 3);
  assert.equal(dog.state, 'riding-dog', 'hopped in');
  onFoot(sim, p, sim.camper.chassis.getPosition().x - 4, 0);
  run(sim, 0.5);
  assert.equal(dog.state, 'companion', 'hopped out');
});
