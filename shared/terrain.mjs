import { CELL, CHUNK, WORLD_HEIGHT } from './constants.mjs';
import { mulberry32, fbm1, noise1 } from './rng.mjs';

// Editable terrain: a grid of density nodes (0 = air, 255 = solid, threshold
// 127.5) plus a rock mask that cannot be dug. Contours are extracted per chunk
// with marching squares, so the same geometry drives collision and rendering.

export const ISO = 127.5;
const SOIL_BANDS = [0.4, 1.1, 1.9, 2.9];   // strata depth thresholds (metres)
const LOOSEN_MARGIN = 0.8;                  // digging loosens soil this far beyond the brush
const SLUMP_RATE_DRY = 10, SLUMP_RATE_WET = 30;   // density moved per pass

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class Terrain {
  // profile(terrain) -> { h, rockBump, soilDepth } replaces the built-in
  // generator (the lane prototype supplies its own height profiles).
  constructor(length, seed, profile = null) {
    this.profile = profile;
    this.seed = seed >>> 0;
    this.length = length;
    this.nx = Math.round(length / CELL) + 1;
    this.ny = Math.round(WORLD_HEIGHT / CELL) + 1;
    this.density = new Uint8Array(this.nx * this.ny);
    this.rock = new Uint8Array(this.nx * this.ny);
    this.loose = new Uint8Array(this.nx * this.ny);   // disturbed soil that can slump
    this.active = new Set();                          // loose nodes that may still move
    this.surface = new Float32Array(this.nx);   // generated surface height per column
    this.rockTop = new Float32Array(this.nx);   // generated top of undiggable rock per column
    this.chunksX = Math.ceil((this.nx - 1) / CHUNK);
    this.chunksY = Math.ceil((this.ny - 1) / CHUNK);
    // Bumped whenever a chunk's nodes change; consumers keep their own copies.
    this.chunkVersion = new Uint32Array(this.chunksX * this.chunksY);
    this.features = [];
    this.generate();
  }

  idx(x, y) { return y * this.nx + x; }

  generate() {
    const { nx, ny, seed } = this;
    if (this.profile) {
      const { h, rockBump, soilDepth } = this.profile(this);
      this.#fill(h, rockBump, soilDepth);
      return;
    }
    const rand = mulberry32(seed);
    const h = new Float32Array(nx);
    const soilDepth = new Float32Array(nx);
    const rockBump = new Float32Array(nx);

    for (let ix = 0; ix < nx; ix++) {
      const x = ix * CELL;
      h[ix] = 16 + 3.5 * fbm1(x / 45, seed) + 0.9 * fbm1(x / 8, seed + 77, 3);
      soilDepth[ix] = 2.2 + 2.5 * noise1(x / 13, seed + 31);
    }

    // Set pieces, spaced along the stretch. Each modifies the height profile.
    const kinds = ['ravine', 'hill', 'ledge', 'boulder', 'dip'];
    let cursor = 60 + rand() * 20;
    const end = this.length - 60;
    let last = '';
    while (cursor < end) {
      let kind = kinds[Math.floor(rand() * kinds.length)];
      if (kind === last) kind = kinds[(kinds.indexOf(kind) + 1) % kinds.length];
      last = kind;
      const f = { kind, x: cursor };
      if (kind === 'ravine') { f.width = 4.5 + rand() * 3.5; f.depth = 2.8 + rand() * 1.8; }
      if (kind === 'hill') { f.width = 26 + rand() * 14; f.height = 4.5 + rand() * 3.5; }
      if (kind === 'ledge') { f.height = (rand() < 0.5 ? 1 : -1) * (1.4 + rand() * 1.0); }
      if (kind === 'boulder') { f.width = 3 + rand() * 2.5; f.height = 1.3 + rand() * 1.2; }
      if (kind === 'dip') { f.width = 12 + rand() * 6; f.depth = 2 + rand() * 1.5; }
      this.features.push(f);
      cursor += 65 + rand() * 45;
    }

    for (let ix = 0; ix < nx; ix++) {
      const x = ix * CELL;
      for (const f of this.features) {
        const d = x - f.x;
        if (f.kind === 'ravine') {
          const edge = 0.5;
          const inside = smoothstep(-f.width / 2 - edge, -f.width / 2, d) * (1 - smoothstep(f.width / 2, f.width / 2 + edge, d));
          h[ix] -= f.depth * inside;
        } else if (f.kind === 'hill') {
          const t = d / (f.width / 2);
          if (Math.abs(t) < 1) h[ix] += f.height * (1 - t * t) * (1 - t * t);
        } else if (f.kind === 'ledge') {
          h[ix] += f.height * smoothstep(-0.4, 0.4, d);
        } else if (f.kind === 'boulder') {
          const t = d / (f.width / 2);
          if (Math.abs(t) < 1) rockBump[ix] = Math.max(rockBump[ix], f.height * Math.sqrt(1 - t * t));
        } else if (f.kind === 'dip') {
          const t = d / (f.width / 2);
          if (Math.abs(t) < 1) h[ix] -= f.depth * (1 - t * t) * (1 - t * t);
        }
      }
    }

    // Level pads at the start and end (camps).
    const startH = h[Math.round(40 / CELL)];
    const endIx = Math.round((this.length - 40) / CELL);
    const endH = h[endIx];
    for (let ix = 0; ix < nx; ix++) {
      const x = ix * CELL;
      const a = 1 - smoothstep(18, 40, x);
      const b = smoothstep(this.length - 40, this.length - 18, x);
      h[ix] = h[ix] * (1 - a) + startH * a;
      h[ix] = h[ix] * (1 - b) + endH * b;
    }
    this.#fill(h, rockBump, soilDepth);
  }

  #fill(h, rockBump, soilDepth) {
    const { nx, ny } = this;
    for (let ix = 0; ix < nx; ix++) {
      const top = h[ix] + rockBump[ix];
      this.surface[ix] = top;
      const rockTop = rockBump[ix] > 0 ? top : h[ix] - soilDepth[ix];
      this.rockTop[ix] = rockTop;
      for (let iy = 0; iy < ny; iy++) {
        const y = iy * CELL;
        const i = iy * nx + ix;
        this.density[i] = clamp(Math.round(ISO + ((top - y) / CELL) * 64), 0, 255);
        this.rock[i] = y < rockTop && this.density[i] >= 128 ? 1 : 0;
      }
    }
    this.chunkVersion.fill(1);
  }

  sampleDensity(x, y) {
    if (y < 0) return 255;
    if (x < 0 || x > this.length) return 255;
    const fx = x / CELL, fy = y / CELL;
    if (fy >= this.ny - 1) return 0;
    const ix = Math.min(Math.floor(fx), this.nx - 2), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const d = this.density, nx = this.nx, i = iy * nx + ix;
    const a = d[i] + (d[i + 1] - d[i]) * tx;
    const b = d[i + nx] + (d[i + nx + 1] - d[i + nx]) * tx;
    return a + (b - a) * ty;
  }

  solidAt(x, y) { return this.sampleDensity(x, y) > ISO; }

  // Highest solid point at or below `fromY` in column x.
  groundY(x, fromY = WORLD_HEIGHT - 0.5) {
    for (let y = fromY; y > 0; y -= CELL / 2) {
      if (this.solidAt(x, y)) {
        let lo = y, hi = y + CELL / 2;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (this.solidAt(x, m)) lo = m; else hi = m; }
        return lo;
      }
    }
    return 0;
  }

  // Remove soil around (x, y). Returns changed nodes and volume removed (m²).
  // allowRock: a pickaxe can break rock (slowly).
  dig(x, y, radius, strength, maxVolume, allowRock = false) {
    return this.#brush(x, y, radius, strength, maxVolume, -1, null, allowRock);
  }

  // Add soil around (x, y). `blocked(wx, wy)` rejects nodes occupied by bodies.
  fill(x, y, radius, strength, maxVolume, blocked) {
    // Soil must be placed against existing ground.
    const r = radius + CELL * 1.5;
    let anchored = false;
    const x0 = Math.max(0, Math.floor((x - r) / CELL)), x1 = Math.min(this.nx - 1, Math.ceil((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL)), y1 = Math.min(this.ny - 1, Math.ceil((y + r) / CELL));
    for (let iy = y0; iy <= y1 && !anchored; iy++) for (let ix = x0; ix <= x1; ix++) {
      const dx = ix * CELL - x, dy = iy * CELL - y;
      if (dx * dx + dy * dy <= r * r && this.density[iy * this.nx + ix] > ISO) { anchored = true; break; }
    }
    if (!anchored) return { indices: [], values: [], volume: 0 };
    return this.#brush(x, y, radius, strength, maxVolume, 1, blocked);
  }

  #brush(x, y, radius, strength, maxVolume, sign, blocked, allowRock = false) {
    const indices = [], values = [];
    let volume = 0;
    const perUnit = (CELL * CELL) / 255;
    const x0 = Math.max(0, Math.floor((x - radius) / CELL)), x1 = Math.min(this.nx - 1, Math.ceil((x + radius) / CELL));
    const y0 = Math.max(1, Math.floor((y - radius) / CELL)), y1 = Math.min(this.ny - 2, Math.ceil((y + radius) / CELL));
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const wx = ix * CELL, wy = iy * CELL;
        const dx = wx - x, dy = wy - y;
        const q = (dx * dx + dy * dy) / (radius * radius);
        if (q > 1) continue;
        const i = iy * this.nx + ix;
        if (sign < 0 && this.rock[i] && !allowRock) continue;
        if (sign > 0 && blocked && blocked(wx, wy)) continue;
        const old = this.density[i];
        let delta = Math.round(strength * (1 - q));
        if (sign < 0) delta = Math.min(delta, old); else delta = Math.min(delta, 255 - old);
        const room = Math.floor((maxVolume - volume) / perUnit);
        if (room <= 0) break;
        delta = Math.min(delta, room);
        if (delta <= 0) continue;
        const v = old + sign * delta;
        volume += delta * perUnit;
        indices.push(i); values.push(v);
      }
    }
    this.applyEdits(indices, values);
    if (volume > 0) this.loosen(x, y, radius + LOOSEN_MARGIN);
    return { indices, values, volume };
  }

  // Mark soil around a disturbance as loose so it can settle.
  loosen(x, y, radius) {
    const x0 = Math.max(1, Math.floor((x - radius) / CELL)), x1 = Math.min(this.nx - 2, Math.ceil((x + radius) / CELL));
    const y0 = Math.max(1, Math.floor((y - radius) / CELL)), y1 = Math.min(this.ny - 2, Math.ceil((y + radius) / CELL));
    for (let iy = y0; iy <= y1; iy++) for (let ix = x0; ix <= x1; ix++) {
      const dx = ix * CELL - x, dy = iy * CELL - y;
      if (dx * dx + dy * dy > radius * radius) continue;
      const i = iy * this.nx + ix;
      if (this.rock[i]) continue;
      this.loose[i] = 1;
      this.active.add(i);
    }
  }

  // Wake all loose soil (for example when rain starts) so it settles again.
  reactivateLoose() {
    const { loose, density } = this;
    for (let i = 0; i < loose.length; i++) if (loose[i] && density[i] > 0) this.active.add(i);
  }

  // One settling pass over active loose soil. Unsupported loose soil always
  // falls into space below it. In rain it also slides diagonally while steeper
  // than its angle of repose (about 27°, reaching two cells across). `blocked(ax, ay, bx, by)`
  // vetoes moves that would pass through a board. Returns the changed nodes.
  slump(wet, blocked, budget = 6000) {
    const { nx, density: d, rock, loose } = this;
    const rate = wet ? SLUMP_RATE_WET : SLUMP_RATE_DRY;
    const reach = wet ? 2 : 1;
    const changed = new Map();
    const next = new Set();
    const nodes = [...this.active];
    this.active.clear();
    // Bottom-up so a column settles in one pass.
    nodes.sort((a, b) => a - b);
    this.slumpTick = (this.slumpTick || 0) + 1;
    const move = (from, to, amount) => {
      d[from] -= amount; d[to] += amount;
      loose[to] = 1;
      changed.set(from, d[from]); changed.set(to, d[to]);
      for (const n of [from, to]) for (const o of [0, -1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1, -2, 2, nx - 2, nx + 2]) {
        const j = n + o;
        if (j > nx && j < d.length - nx && loose[j]) next.add(j);
      }
    };
    let work = 0;
    for (const i of nodes) {
      if (++work > budget) { next.add(i); continue; }
      if (!loose[i] || rock[i] || d[i] === 0) continue;
      const ix = i % nx, iy = (i - ix) / nx;
      if (iy < 1 || ix < reach || ix >= nx - reach) continue;
      const wx = ix * CELL, wy = iy * CELL;
      // Fall.
      const below = i - nx;
      if (!rock[below] && d[below] < 255 && !(blocked && blocked(wx, wy, wx, wy - CELL))) {
        move(i, below, Math.min(d[i], 255 - d[below], rate * 2));
        continue;
      }
      // Slide, only from the exposed surface, and only in rain: dry earthworks keep their shape.
      if (!wet || d[i + nx] > ISO) continue;
      const first = (ix + this.slumpTick) & 1 ? 1 : -1;
      for (const s of [first, -first]) {
        const side = i + s;
        const target = i - nx + s * reach;
        if (d[side] > ISO || rock[target] || d[target] >= 255) continue;
        if (reach === 2 && d[i + s] > ISO) continue;
        if (blocked && blocked(wx, wy, wx + s * reach * CELL, wy - CELL)) continue;
        move(i, target, Math.min(d[i], 255 - d[target], rate));
        break;
      }
    }
    this.active = next;
    const indices = [...changed.keys()];
    if (indices.length) this.applyEdits(indices, indices.map(k => d[k]));
    return { indices, values: indices.map(k => d[k]) };
  }

  applyEdits(indices, values) {
    const { nx, density } = this;
    for (let k = 0; k < indices.length; k++) {
      const i = indices[k];
      density[i] = values[k];
      const ix = i % nx, iy = (i - ix) / nx;
      for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
        const cx = Math.floor((ix + ox) / CHUNK), cy = Math.floor((iy + oy) / CHUNK);
        if (cx >= 0 && cy >= 0 && cx < this.chunksX && cy < this.chunksY) this.chunkVersion[cy * this.chunksX + cx]++;
      }
    }
  }

  // Marching squares over one chunk.
  //   fills:    Map<styleKey, number[][]> flat polygon point lists (CCW, y up)
  //   segments: number[] [x1,y1,x2,y2,...] contour with solid on the left
  //   styleKey: 'rock' or 'soil0'..'soil4' (strata by depth below original surface)
  extractChunk(cx, cy) {
    const fills = new Map();
    const segments = [];
    const { nx, density, rock } = this;
    const gx0 = cx * CHUNK, gy0 = cy * CHUNK;
    const gx1 = Math.min(gx0 + CHUNK, this.nx - 1), gy1 = Math.min(gy0 + CHUNK, this.ny - 1);
    const push = (key, pts) => { let l = fills.get(key); if (!l) fills.set(key, (l = [])); l.push(pts); };

    for (let ix = gx0; ix < gx1; ix++) {
      let runKey = null, runStart = 0;
      const flush = endY => { if (runKey !== null) { const x = ix * CELL, X = x + CELL, y = runStart * CELL, Y = endY * CELL; push(runKey, [x, y, X, y, X, Y, x, Y]); runKey = null; } };
      for (let iy = gy0; iy < gy1; iy++) {
        const bl = iy * nx + ix, br = bl + 1, tl = bl + nx, tr = tl + 1;
        const dBL = density[bl], dBR = density[br], dTR = density[tr], dTL = density[tl];
        const sBL = dBL > ISO, sBR = dBR > ISO, sTR = dTR > ISO, sTL = dTL > ISO;
        const caseId = (sBL ? 1 : 0) | (sBR ? 2 : 0) | (sTR ? 4 : 0) | (sTL ? 8 : 0);
        const key = this.#styleKey(ix, iy, rock[bl] | rock[br] | rock[tl] | rock[tr]);
        if (caseId === 15) {
          if (runKey !== key) { flush(iy); runKey = key; runStart = iy; }
          continue;
        }
        flush(iy);
        if (caseId === 0) continue;

        const x = ix * CELL, y = iy * CELL, X = x + CELL, Y = y + CELL;
        const lerp = (a, b) => (ISO - a) / (b - a);
        // Crossings, always parameterised from the lower-index node.
        const pB = sBL !== sBR ? [x + lerp(dBL, dBR) * CELL, y] : null;
        const pR = sBR !== sTR ? [X, y + lerp(dBR, dTR) * CELL] : null;
        const pT = sTL !== sTR ? [x + lerp(dTL, dTR) * CELL, Y] : null;
        const pL = sBL !== sTL ? [x, y + lerp(dBL, dTL) * CELL] : null;

        const saddle = caseId === 5 || caseId === 10;
        if (saddle && (dBL + dBR + dTR + dTL) / 4 <= ISO) {
          // Two separate corners: [corner, crossing on outgoing edge, crossing on incoming edge].
          const tris = caseId === 5
            ? [[[x, y], pB, pL], [[X, Y], pT, pR]]
            : [[[X, y], pR, pB], [[x, Y], pL, pT]];
          for (const [c, a, b] of tris) {
            push(key, [c[0], c[1], a[0], a[1], b[0], b[1]]);
            segments.push(a[0], a[1], b[0], b[1]);
          }
          continue;
        }

        const corners = [[x, y, sBL], [X, y, sBR], [X, Y, sTR], [x, Y, sTL]];
        const crossings = [pB, pR, pT, pL];
        const pts = [], isCross = [];
        for (let k = 0; k < 4; k++) {
          const c = corners[k];
          if (c[2]) { pts.push(c[0], c[1]); isCross.push(false); }
          if (crossings[k]) { pts.push(crossings[k][0], crossings[k][1]); isCross.push(true); }
        }
        push(key, pts);
        const n = isCross.length;
        for (let k = 0; k < n; k++) {
          const k2 = (k + 1) % n;
          if (isCross[k] && isCross[k2]) segments.push(pts[k * 2], pts[k * 2 + 1], pts[k2 * 2], pts[k2 * 2 + 1]);
        }
      }
      flush(gy1);
    }
    return { fills, segments };
  }

  #styleKey(ix, iy, isRock) {
    if (isRock) return 'rock';
    const depth = this.surface[ix] - (iy + 0.5) * CELL + 0.35 * (noise1(ix * CELL / 3, this.seed + 5) - 0.5);
    let b = 0;
    while (b < SOIL_BANDS.length && depth > SOIL_BANDS[b]) b++;
    return 'soil' + b;
  }
}
