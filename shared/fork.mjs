import { CELL } from './constants.mjs';
import { ISO } from './terrain.mjs';

// Route forks (docs/DESIGN.md §3c). A side view has one ground surface at any
// x, so two routes can only split where one crosses the other's entrance. A
// fork here is a cave under the road:
//
//   high route  drive on along the surface: the turf over the cave holds, but a
//               crevasse further on has to be bridged with boards or filled
//   low route   dig through the turf crust at the start, drive down a ramp into
//               a dark cave, dig through a cave-in, then dig out through the
//               crust at the far end, where the ramp comes back up
//
// A fox den off the bottom of the entrance ramp is reachable only on foot.
// All x values are relative to the fork start x0; heights to the road h0.

export const FORK = {
  crust: 0.6,          // turf over the entrance and exit ramps
  floor: 7.2,          // cave floor depth below the road
  roof: 2.3,           // depth of the cave ceiling below the road
  slope: Math.tan(30 * Math.PI / 180),       // entrance ramp (going down)
  exitLen: 27.5,       // exit ramp length: an S-curve, level at both ends, 20° at its steepest
  room: [11.4, 44],    // flat cave floor
  plug: [27, 29.5],    // cave-in: soil from floor to ceiling
  crevasse: [19, 25, 1.5],      // on the surface: from, to, depth
  den: [6.4, 10.3, 8.45, 6.75], // fox den: from, to, floor depth, ceiling depth
  shaft: [10.3, 11.3],          // drop from the ramp foot into the den
  exitTop: 71.5,       // where the exit ramp meets the road: room end + exitLen
  length: 75,
  flat: [-18, 85],     // the road is levelled over this span (plus a 12 m blend)
};

// One fork per stretch for now, early enough to meet in the first minutes:
// just after the first set piece past 80 m. Later set pieces move along the
// road to make room. Mutates `features`.
export function planForks(length, rand, features) {
  const extent = f => (f.width || 6) / 2 + 2;
  const k = features.findIndex(f => f.x > 80);
  if (k < 0 || length < 300) return [];
  const x0 = Math.round(features[k].x + extent(features[k]) + 18 + rand() * 10 - FORK.flat[0]);
  const next = features[k + 1];
  if (next) {
    const shift = x0 + FORK.flat[1] + 12 + 20 - (next.x - extent(next));
    if (shift > 0) for (const f of features.slice(k + 1)) f.x += shift;
  }
  for (let i = features.length - 1; i >= 0; i--) if (features[i].x > length - 60) features.splice(i, 1);
  return x0 + FORK.flat[1] + 30 < length - 60 ? [{ x0 }] : [];
}

// Which part of a fork a point is in: 'low' (underground), 'high' (on the
// surface above it) or null.
export function forkZone(forks, x, y) {
  for (const f of forks) {
    if (x < f.x0 - 2 || x > f.x0 + FORK.exitTop + 2) continue;
    return y < f.h0 - 1.2 ? 'low' : 'high';
  }
  return null;
}

// Air intervals [bottom, top] for the column at fork-relative x (absolute heights).
function airAt(f, dx) {
  const { crust, floor, roof, slope, exitLen, room, plug, crevasse, den, shaft, exitTop } = FORK;
  const h0 = f.h0, out = [];
  const roomEnd = room[1];
  if (dx >= 0 && dx < room[0]) out.push([h0 - crust - dx * slope, h0 - crust]);            // entrance ramp under the crust
  if (dx >= room[0] && dx <= roomEnd && !(dx > plug[0] && dx < plug[1])) out.push([h0 - floor, h0 - roof]);
  if (dx > roomEnd && dx <= exitTop) {   // exit ramp
    const u = Math.min(1, (dx - roomEnd) / exitLen), s = u * u * (3 - 2 * u);
    out.push([Math.min(h0 - crust - 0.05, h0 - floor + (floor - crust) * s), h0 - crust]);
  }
  if (dx >= den[0] && dx <= den[1]) out.push([h0 - den[2], h0 - den[3]]);
  if (dx >= shaft[0] && dx <= shaft[1]) out.push([h0 - den[2], h0 - crust - dx * slope + 0.01]);
  if (dx >= crevasse[0] && dx <= crevasse[1]) out.push([h0 - crevasse[2], h0 + 40]);
  return out;
}

// Carve a fork into freshly generated terrain (density, rock mask).
export function carveFork(t, f) {
  const { nx, ny, density, rock } = t;
  const i0 = Math.max(0, Math.floor((f.x0 - 1) / CELL)), i1 = Math.min(nx - 1, Math.ceil((f.x0 + FORK.exitTop + 1) / CELL));
  for (let ix = i0; ix <= i1; ix++) {
    const air = airAt(f, ix * CELL - f.x0);
    const dxs = ix * CELL - f.x0;
    // The turf crusts, the cave-in and the crevasse walls are soil, so they can be dug.
    const soft = (dxs >= -0.5 && dxs <= FORK.room[0] + 0.5) || (dxs >= FORK.plug[0] - 0.5 && dxs <= FORK.plug[1] + 0.5) || (dxs >= FORK.room[1] - 0.5 && dxs <= FORK.exitTop + 0.5) || (dxs >= FORK.crevasse[0] - 1 && dxs <= FORK.crevasse[1] + 1);
    for (let iy = 1; iy < ny - 1; iy++) {
      const y = iy * CELL, i = iy * nx + ix;
      let inside = 0, edge = Infinity;
      for (const [lo, hi] of air) {
        if (y > lo && y < hi) inside = Math.max(inside, Math.min(y - lo, hi - y));
        else edge = Math.min(edge, y <= lo ? lo - y : y - hi);
      }
      if (inside > 0) density[i] = Math.max(0, Math.round(ISO - (inside / CELL) * 64));
      else if (edge < 1) density[i] = Math.min(density[i], Math.round(ISO + (edge / CELL) * 64));
      if (soft && y > f.h0 - FORK.floor - 0.3) rock[i] = 0;
      // The cave roof is lined with rock, so work on the surface (filling the
      // crevasse) can't loosen it into a cave-in.
      if (dxs > FORK.room[0] && dxs < FORK.room[1] && !(dxs > FORK.plug[0] - 0.3 && dxs < FORK.plug[1] + 0.3) && y >= f.h0 - FORK.roof - 0.01 && y <= f.h0 - FORK.crevasse[2] - 0.2 && density[i] > ISO) rock[i] = 1;
      if (density[i] <= ISO) rock[i] = 0;
    }
  }
}
