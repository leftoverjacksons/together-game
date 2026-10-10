import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../shared/terrain.mjs';

test('generation is deterministic for a seed', () => {
  const a = new Terrain(320, 42), b = new Terrain(320, 42), c = new Terrain(320, 43);
  assert.deepEqual(a.density, b.density);
  assert.notDeepEqual(a.density, c.density);
  assert.ok(a.features.length > 0);
});

test('start pad is level ground', () => {
  const t = new Terrain(320, 7);
  const h = [10, 15, 20, 25].map(x => t.groundY(x));
  assert.ok(Math.max(...h) - Math.min(...h) < 0.3, `pad heights ${h}`);
});

test('marching squares polygons and segments are well formed', () => {
  const t = new Terrain(320, 9);
  let segs = 0;
  for (let cy = 0; cy < t.chunksY; cy++) for (let cx = 0; cx < t.chunksX; cx++) {
    const { fills, segments } = t.extractChunk(cx, cy);
    assert.equal(segments.length % 4, 0);
    segs += segments.length / 4;
    for (const polys of fills.values()) for (const p of polys) {
      assert.ok(p.length >= 6 && p.length % 2 === 0);
      let area = 0;
      for (let k = 0; k < p.length; k += 2) { const j = (k + 2) % p.length; area += p[k] * p[j + 1] - p[j] * p[k + 1]; }
      assert.ok(area > -1e-9, 'polygons wind counter-clockwise');
    }
  }
  assert.ok(segs > 100);
});

test('digging removes soil, filling puts it back, rock is untouched', () => {
  const t = new Terrain(320, 11);
  const x = 12, y = t.groundY(x);
  const before = t.chunkVersion.slice();
  const dug = t.dig(x, y, 0.55, 70, 10);
  assert.ok(dug.volume > 0.05);
  assert.ok(!t.solidAt(x, y - 0.05), 'surface lowered');
  assert.notDeepEqual(t.chunkVersion, before);
  const filled = t.fill(x, y, 0.55, 70, dug.volume, null);
  assert.ok(filled.volume > 0 && filled.volume <= dug.volume + 1e-9);
  // Capacity is respected.
  assert.ok(t.dig(x, y, 0.55, 255, 0.01).volume <= 0.01 + 1e-9);
  // Rock nodes never change.
  const ri = t.rock.indexOf(1);
  const rx = (ri % t.nx) * 0.25, ry = Math.floor(ri / t.nx) * 0.25;
  const v = t.density[ri];
  t.dig(rx, ry, 0.55, 255, 10);
  assert.equal(t.density[ri], v);
});

test('soil cannot be placed in open air', () => {
  const t = new Terrain(320, 5);
  assert.equal(t.fill(20, 44, 0.55, 70, 5, null).volume, 0);
});

test('applyEdits reproduces server edits on a client copy', () => {
  const server = new Terrain(320, 99), client = new Terrain(320, 99);
  const r = server.dig(30, server.groundY(30), 0.55, 70, 5);
  client.applyEdits(r.indices, r.values);
  assert.deepEqual(client.density, server.density);
});
