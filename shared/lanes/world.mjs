import { CELL } from '../constants.mjs';
import { mulberry32, fbm1 } from '../rng.mjs';
import { Terrain } from '../terrain.mjs';

// The lane prototype's world: three parallel side-view strips (lanes) seen
// from a raised, locked camera. Lane 0 is nearest the camera.
//
// Between neighbouring lanes runs a divider made of segments. Gaps ('open',
// 'ford') let the camper change lanes; the rest are barriers that travellers
// on foot may or may not cross. Each lane is an ordinary editable Terrain with
// its own height profile and set pieces. Everything here is deterministic
// from the seed, so the server and every client build the same world.

export const LANE_COUNT = 3;
export const LANE_SPACING = 6.5;      // metres between lane centres (z)
export const LANE_DEPTH = 4.2;        // width of a lane strip (z)
export const LANE_LENGTH = 760;
export const LANE_NAMES = ['Creek bank', 'Woodland track', 'Wooded hillside'];
export const laneZ = lane => -lane * LANE_SPACING;

// What each divider segment allows. walk: seconds to cross on foot (0 = impassable).
export const DIVIDER_TYPES = {
  open:   { camper: true,  walk: 0.6, water: false, label: 'an opening' },
  ford:   { camper: true,  walk: 1.2, water: true,  label: 'a shallow ford' },
  reeds:  { camper: false, walk: 0.9, water: false, label: 'reeds' },
  creek:  { camper: false, walk: 0,   water: true,  label: 'deep creek', why: 'The creek is too deep to wade here. Look for stepping stones or a ford.' },
  stones: { camper: false, walk: 1.0, water: true,  label: 'stepping stones' },
  hedge:  { camper: false, walk: 1.4, water: false, label: 'a hedgerow' },
  rocks:  { camper: false, walk: 1.0, water: false, label: 'a rock band' },
  bank:   { camper: false, walk: 0,   water: false, label: 'a steep bank', why: 'The bank is too steep to climb here.' },
};
const BARRIERS = [
  [['reeds', 4], ['creek', 4]],              // creek side (lanes 0 | 1)
  [['hedge', 4], ['rocks', 2], ['bank', 2]], // hillside (lanes 1 | 2)
];
export const GAP_RAMP = 7;            // metres either side of a gap where the lanes blend level
export const LANE_CHANGE_TIME = 1.4;  // seconds for the camper to cross a gap
export const GAP_MARGIN = 2;          // the camper's centre must be this far inside a gap
export const STEP_LIMIT = 1.6;        // highest bank a traveller can scramble up when crossing

const BASE = [15.2, 16.2, 17.6];
const PAD = 50;                       // level camp pads at both ends
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Set pieces per lane: the lane's character.
const KINDS = [
  { every: [35, 60], kinds: ['pool', 'pool', 'stones', 'gully'] },
  { every: [50, 80], kinds: ['hill', 'dip', 'log', 'ravine', 'ledge'] },
  { every: [32, 52], kinds: ['hill', 'ledge', 'boulder', 'ravine', 'hill'] },
];

// Areas along the route. The prototype has one biome (woods and creek) in a
// few moods, so moving along feels like passing through different country.
const AREAS = [
  { name: 'Creekside woods', trees: 1.0, grass: 0x7fae5b, foliage: 0x4f7f45 },
  { name: 'Open glade', trees: 0.3, grass: 0x9cc066, foliage: 0x6c9a4c },
  { name: 'Pine hollow', trees: 1.5, grass: 0x6a9a55, foliage: 0x355f40 },
];

export function generateLaneWorld(seed, length = LANE_LENGTH) {
  seed >>>= 0;
  const rand = mulberry32(seed ^ 0x1a7e5);
  const nx = Math.round(length / CELL) + 1;

  const dividers = genDividers(rand, length);
  const gaps = dividers.map(segs => segs.filter(s => DIVIDER_TYPES[s.type].camper));
  const nearGap = (lane, x, pad) => [lane - 1, lane].some(k => k >= 0 && k < LANE_COUNT - 1 && gaps[k].some(g => x > g.x0 - pad && x < g.x1 + pad));

  // Dead ends: a rock wall across an outer lane, always a little past a gap
  // into the middle lane, so the way round is there to be found.
  const walls = [];
  for (const [k, lane] of [[0, 0], [1, 2]]) {
    let last = -1e9;
    gaps[k].forEach((g, n) => {
      if (rand() > 0.3) return;
      const x = g.x1 + 14 + rand() * 12;
      const next = gaps[k][n + 1];
      if (x - last < 40 || x > length - PAD - 10 || (next && x > next.x0 - GAP_RAMP - 6)) return;
      walls.push({ lane, x });
      last = x;
    });
  }

  // Set pieces, keeping clear of walls and (for the outer lanes) of gaps.
  const features = [[], [], []];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const { every, kinds } = KINDS[lane];
    let x = PAD + 10 + rand() * 20, lastKind = '';
    while (x < length - PAD - 10) {
      let kind = kinds[Math.floor(rand() * kinds.length)];
      if (kind === lastKind) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
      const f = makeFeature(kind, x, rand);
      const half = (f.width || 4) / 2;
      const pad = lane === 1 ? half + 2 : half + GAP_RAMP + 1;
      const blocked = nearGap(lane, x, pad) || walls.some(w => w.lane === lane && Math.abs(w.x - x) < half + 10);
      if (!blocked) { features[lane].push(f); lastKind = kind; x += every[0] + rand() * (every[1] - every[0]); }
      else x += 6;
    }
  }

  // Height profiles.
  const h = [0, 1, 2].map(() => new Float32Array(nx));
  const rockBump = [0, 1, 2].map(() => new Float32Array(nx));
  const soilDepth = [0, 1, 2].map(() => new Float32Array(nx));
  const amp = [[1.0, 50, 0.25, 7], [2.4, 48, 0.5, 8], [3.0, 40, 0.7, 9]];
  for (let lane = 0; lane < LANE_COUNT; lane++) {
    const [a1, s1, a2, s2] = amp[lane];
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * CELL;
      h[lane][ix] = BASE[lane] + a1 * fbm1(x / s1, seed + 11 + lane * 7) + a2 * fbm1(x / s2, seed + 13 + lane * 7, 3);
      soilDepth[lane][ix] = 2.4 + 1.6 * (fbm1(x / 13, seed + 31 + lane) * 0.5 + 0.5);
    }
    for (const f of features[lane]) applyFeature(f, h[lane], rockBump[lane]);
    for (const w of walls) if (w.lane === lane) applyFeature({ kind: 'wall', x: w.x, width: 3.2, height: 4.6 }, h[lane], rockBump[lane]);
  }

  // Level camp pads: all three lanes meet at the same height at both ends.
  for (const [from, to, at] of [[PAD - 26, PAD, PAD - 30], [length - PAD, length - PAD + 26, length - PAD + 30]]) {
    const ia = Math.round(at / CELL);
    const pad = (h[0][ia] + h[1][ia] + h[2][ia]) / 3;
    for (let lane = 0; lane < LANE_COUNT; lane++) for (let ix = 0; ix < nx; ix++) {
      const x = ix * CELL;
      const w = from < length / 2 ? 1 - smoothstep(from, to, x) : smoothstep(from, to, x);
      if (w > 0) { h[lane][ix] += (pad - h[lane][ix]) * w; rockBump[lane][ix] *= 1 - w; }
    }
  }

  // Gaps: both lanes blend to a shared height so the camper can roll across.
  // Where gaps on both dividers overlap, repeated passes level all three lanes.
  const weight = gaps.map(gs => {
    const w = new Float32Array(nx);
    for (const g of gs) {
      const i0 = Math.max(0, Math.floor((g.x0 - GAP_RAMP) / CELL)), i1 = Math.min(nx - 1, Math.ceil((g.x1 + GAP_RAMP) / CELL));
      for (let ix = i0; ix <= i1; ix++) { const x = ix * CELL; w[ix] = Math.max(w[ix], smoothstep(g.x0 - GAP_RAMP, g.x0, x) * (1 - smoothstep(g.x1, g.x1 + GAP_RAMP, x))); }
    }
    return w;
  });
  for (let pass = 0; pass < 12; pass++) for (let k = 0; k < LANE_COUNT - 1; k++) {
    const A = h[k], B = h[k + 1], W = weight[k];
    for (let ix = 0; ix < nx; ix++) {
      const w = W[ix];
      if (!w) continue;
      const m = (A[ix] + B[ix]) / 2;
      A[ix] += (m - A[ix]) * w; B[ix] += (m - B[ix]) * w;
      if (w > 0.5) { rockBump[k][ix] = 0; rockBump[k + 1][ix] = 0; }
    }
  }

  // Water in the creek-bank pools: up to a little below the lower rim.
  const pools = [];
  for (const f of features[0]) if (f.kind === 'pool') {
    const ic = Math.round(f.x / CELL), H = h[0];
    const rimL = H[Math.max(0, Math.round((f.x - f.width / 2 - 1) / CELL))], rimR = H[Math.min(nx - 1, Math.round((f.x + f.width / 2 + 1) / CELL))];
    const level = Math.min(rimL, rimR) - 0.3;
    if (H[ic] >= level) continue;
    let a = ic, b = ic;
    while (a > 0 && H[a - 1] < level) a--;
    while (b < nx - 1 && H[b + 1] < level) b++;
    pools.push({ lane: 0, x0: a * CELL, x1: b * CELL, level });
  }

  const animals = placeLaneAnimals(rand, length, features, walls, pools, h);
  const areas = [];
  for (let x = 0, k = Math.floor(rand() * AREAS.length); x < length; k = (k + 1 + (rand() < 0.3 ? 1 : 0)) % AREAS.length) {
    const len = 110 + rand() * 90;
    areas.push({ ...AREAS[k], x0: x, x1: Math.min(length, x + len) });
    x += len;
  }

  return { seed, length, dividers, walls, features, pools, animals, areas, profiles: [0, 1, 2].map(l => ({ h: h[l], rockBump: rockBump[l], soilDepth: soilDepth[l] })) };
}

function genDividers(rand, length) {
  const out = [];
  for (let k = 0; k < LANE_COUNT - 1; k++) {
    const segs = [];
    let x = 0;
    const barrier = (x0, x1) => {
      // A barrier stretch, split into runs of different kinds.
      let a = x0;
      while (a < x1 - 0.01) {
        const b = Math.min(x1, a + 8 + rand() * 14);
        const type = pick(BARRIERS[k], rand);
        if (type === 'creek' && b - a > 10 && rand() < 0.6) {
          const s = a + 2 + rand() * (b - a - 6.5);
          segs.push({ type, x0: a, x1: s }, { type: 'stones', x0: s, x1: s + 2.5 }, { type, x0: s + 2.5, x1: b });
        } else segs.push({ type, x0: a, x1: b });
        a = b;
      }
    };
    while (x < length) {
      const g0 = Math.max(PAD - 10, x + 22 + rand() * 40);
      const glen = 16 + rand() * 8;
      if (g0 + glen > length - 5) { barrier(x, length); break; }
      barrier(x, g0);
      segs.push({ type: k === 0 && rand() < 0.45 ? 'ford' : 'open', x0: g0, x1: g0 + glen });
      x = g0 + glen;
    }
    out.push(segs);
  }
  return out;
}

function pick(weighted, rand) {
  const total = weighted.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of weighted) if ((r -= w) < 0) return v;
  return weighted[0][0];
}

function makeFeature(kind, x, rand) {
  const f = { kind, x };
  switch (kind) {
    case 'pool':    f.width = 10 + rand() * 6; f.depth = 1.1 + rand() * 0.6; break;
    case 'stones':  f.width = 1.6 + rand() * 1.0; f.height = 0.7 + rand() * 0.45; break;
    case 'gully':   f.width = 3 + rand() * 1.5; f.depth = 1.8 + rand() * 0.8; break;
    case 'hill':    f.width = 24 + rand() * 12; f.height = 2.5 + rand() * 2.5; break;
    case 'dip':     f.width = 10 + rand() * 6; f.depth = 1.5 + rand() * 1.0; break;
    case 'log':     f.width = 1.1; f.height = 0.6; break;
    case 'ravine':  f.width = 3.5 + rand() * 3; f.depth = 2.2 + rand() * 1.6; break;
    case 'ledge':   f.width = 4; f.height = (rand() < 0.5 ? 1 : -1) * (1.0 + rand() * 0.8); break;
    case 'boulder': f.width = 3 + rand() * 2; f.height = 1.4 + rand() * 1.0; break;
  }
  return f;
}

function applyFeature(f, h, rockBump) {
  const nx = h.length;
  const i0 = Math.max(0, Math.floor((f.x - 40) / CELL)), i1 = Math.min(nx - 1, Math.ceil((f.x + 40) / CELL));
  for (let ix = i0; ix <= i1; ix++) {
    const d = ix * CELL - f.x;
    const t = f.width ? d / (f.width / 2) : 0;
    switch (f.kind) {
      case 'pool': case 'dip':
        if (Math.abs(t) < 1) h[ix] -= f.depth * (1 - t * t) * (1 - t * t);
        break;
      case 'gully': case 'ravine': {
        const half = f.width / 2, edge = 0.5;
        h[ix] -= f.depth * smoothstep(-half - edge, -half, d) * (1 - smoothstep(half, half + edge, d));
        break;
      }
      case 'hill':
        if (Math.abs(t) < 1) h[ix] += f.height * (1 - t * t) * (1 - t * t);
        break;
      case 'ledge':
        h[ix] += f.height * smoothstep(-0.4, 0.4, d);
        break;
      case 'stones': case 'log': case 'boulder': case 'wall':
        if (Math.abs(t) < 1) rockBump[ix] = Math.max(rockBump[ix], f.height * Math.sqrt(1 - t * t));
        break;
    }
  }
}

// Animals in trouble, mostly in the harder outer lanes, near their set pieces.
const KINDS_ANIMAL = ['rabbit', 'songbird', 'fox', 'chipmunk', 'deer', 'hawk', 'rabbit', 'moose', 'songbird'];
export const RESCUE_TIME = { rabbit: 2.5, chipmunk: 2.5, songbird: 2, fox: 3, deer: 4, hawk: 3, moose: 5 };
export const BIRDS = new Set(['songbird', 'hawk']);

function placeLaneAnimals(rand, length, features, walls, pools, h) {
  const list = [];
  let x = PAD + 20 + rand() * 15, n = 0;
  while (x < length - PAD) {
    const r = rand();
    const lane = r < 0.45 ? 2 : r < 0.87 ? 0 : 1;
    // Prefer a spot by a set piece or just past a dead end.
    const spots = features[lane].map(f => f.x + (f.width || 4) * 0.25).concat(walls.filter(w => w.lane === lane).map(w => w.x + 6)).filter(s => Math.abs(s - x) < 25);
    let ax = spots.length ? spots[Math.floor(rand() * spots.length)] : x;
    if (lane === 0 && pools.some(p => ax > p.x0 - 1 && ax < p.x1 + 1)) ax += 0; // standing in the shallows is fine
    const kind = KINDS_ANIMAL[n++ % KINDS_ANIMAL.length];
    list.push({ id: n, kind, lane, x: Math.round(ax * 100) / 100 });
    x += 38 + rand() * 30;
  }
  return list;
}

export function makeTerrains(world) {
  return world.profiles.map((p, lane) => new Terrain(world.length, world.seed + lane * 101, () => p));
}

export function segmentAt(segs, x) {
  let lo = 0, hi = segs.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].x0 <= x) lo = m; else hi = m - 1; }
  return segs[lo];
}

export function areaAt(world, x) {
  return world.areas.find(a => x >= a.x0 && x < a.x1) || world.areas[world.areas.length - 1];
}

// Can the camper (centre at x) change from `from` to `to` here?
export function camperGapAt(world, from, to, x) {
  if (Math.abs(to - from) !== 1 || to < 0 || to >= LANE_COUNT) return null;
  const seg = segmentAt(world.dividers[Math.min(from, to)], x);
  if (!DIVIDER_TYPES[seg.type].camper || x < seg.x0 + GAP_MARGIN || x > seg.x1 - GAP_MARGIN) return null;
  return seg;
}

// Can a traveller at (x, y) in `from` cross on foot into `to`?
// Returns { ok, time, y } or { ok: false, why }.
export function footCrossing(world, terrains, from, to, x, y) {
  if (Math.abs(to - from) !== 1 || to < 0 || to >= LANE_COUNT) return { ok: false, why: '' };
  const seg = segmentAt(world.dividers[Math.min(from, to)], x);
  const info = DIVIDER_TYPES[seg.type];
  if (!info.walk) return { ok: false, why: info.why || 'No way across here.' };
  const t = terrains[to];
  const gy = t.groundY(x, y + STEP_LIMIT + 0.4);
  if (t.solidAt(x, y + STEP_LIMIT + 0.3) || gy - y > STEP_LIMIT) return { ok: false, why: 'Too steep to climb up there.' };
  if (y - gy > 3.5) return { ok: false, why: 'Too far to drop down there.' };
  return { ok: true, time: info.walk, y: gy, label: info.label };
}

// Water depth over the ground at x in a lane (0 when dry).
export function waterLevel(world, lane, x) {
  for (const p of world.pools) if (p.lane === lane && x >= p.x0 && x <= p.x1) return p.level;
  return null;
}
