import test from 'node:test';
import assert from 'node:assert/strict';
import { Weather, daylight, DAY_SECONDS } from '../shared/weather.mjs';
import { Sim } from '../shared/sim.mjs';
import { INTERIOR } from '../shared/constants.mjs';

test('the day cycle has day, dusk, night and dawn', () => {
  assert.equal(daylight(0.3), 1);
  assert.equal(daylight(0.8), 0);
  assert.ok(daylight(0.67) > 0 && daylight(0.67) < 1);
  assert.ok(daylight(0.99) > 0 && daylight(0.99) < 1);
  const w = new Weather(1);
  for (let k = 0; k < DAY_SECONDS * 10; k++) w.step(0.1, k);
  assert.ok(w.tod >= 0 && w.tod < 1);
});

test('storms arrive on their own, build up, and pass', () => {
  const w = new Weather(7);
  let peak = 0, wetSeconds = 0;
  for (let k = 0; k < 20 * 60 * 10; k++) { w.step(0.1, k); peak = Math.max(peak, w.storm); if (w.wet) wetSeconds += 0.1; }
  assert.ok(peak > 0.99, 'a full storm happened in 20 minutes');
  assert.ok(wetSeconds > 60 && wetSeconds < 20 * 60 * 0.6, `wet for ${wetSeconds.toFixed(0)} s`);
  assert.ok(w.lightning > 0, 'lightning struck');
});

test('forcing and skipping (testing keys)', () => {
  const w = new Weather(3);
  w.setForced(true);
  for (let k = 0; k < 200; k++) w.step(0.1, k);
  assert.ok(w.storm > 0.9);
  w.setForced(false);
  for (let k = 0; k < 300; k++) w.step(0.1, k);
  assert.ok(w.storm < 0.05);
  w.tod = 0.3; w.skipPhase(); assert.ok(daylight(w.tod) < 1 && w.tod > 0.55);
  w.tod = 0.8; w.skipPhase(); assert.ok(w.tod > 0.9);
});

test('rain makes the camper slip on a climb', () => {
  const climb = storm => {
    const sim = new Sim(1234);
    const hill = sim.terrain.features.find(f => f.kind === 'hill');
    sim.placeCamper(hill.x - hill.width / 2 - 4);
    const ch = sim.camper.chassis; const md = { mass: 0, center: { x: 0, y: 0 }, I: 0 };
    ch.getMassData(md); ch.setMassData({ mass: md.mass * 1.5, center: md.center, I: md.I * 1.5 });
    if (storm) { sim.weather.setForced(true); sim.weather.storm = 1; }
    const p = sim.addPlayer('a', 'A');
    Object.assign(p.avatar, { mode: 'in', lx: INTERIOR.seatX });
    sim.handle('a', { t: 'seat' });
    sim.handle('a', { t: 'drive', throttle: 1 });
    let best = 0;
    for (let i = 0; i < 60 * 12; i++) { sim.step(1 / 60); best = Math.max(best, ch.getPosition().x); }
    return { best, top: hill.x };
  };
  const dry = climb(false), wet = climb(true);
  assert.ok(dry.best > dry.top, 'dry: makes the climb');
  assert.ok(wet.best < dry.best - 1, `wet: slips back (${wet.best.toFixed(1)} vs ${dry.best.toFixed(1)})`);
});
