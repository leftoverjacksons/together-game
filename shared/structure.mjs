import { Vec2, Box } from 'planck';

// Board structures with limited structural physics.
//
// Boards connect joints. Joints touching solid ground are anchors (pinned:
// fixed in place, free to rotate). Joints shared by boards are rigid. Every
// few ticks the structure is analysed as a 2D frame (direct stiffness method,
// each board split into two elements so mid-span loads bend it). Loads are
// board weight, travellers standing on boards and the camper's contact forces.
// A board that stays overstressed breaks off as debris; a part that is not
// held in place (singular stiffness) is "shaky": it stands for a few seconds
// so a builder can brace it, but falls (newest boards first) when that time
// runs out or as soon as anything loads it.

export const BOARD = {
  maxLen: 3.0, minLen: 0.5, thick: 0.12, snap: 0.35,
  mass: 14,                 // kg, matches a carried board
  EA: 1e8, EI: 2.5e4,       // axial and bending stiffness (N, N·m²)
  maxAxial: 45000,          // N
  maxMoment: 7000,          // N·m: a 3 m span holds a person, not a camper wheel
  breakAfter: 0.25,         // seconds overstressed before it snaps
  shakyFor: 6,              // seconds an unsupported part stands before it falls
};
const PERSON_LOAD = 800;    // N
const G = 9.81;

export class Structure {
  constructor(world, terrain) {
    this.world = world;
    this.terrain = terrain;
    this.joints = new Map();      // id -> { id, x, y, anchor }
    this.boards = new Map();      // id -> { id, a, b, body, u, over }
    this.debris = new Map();      // id -> { id, body }
    this.nextId = 1;
    this.contacts = new Map();    // board id -> [{ x, y, fx, fy }] accumulated forces
    this.samples = 0;
    world.on('post-solve', (contact, impulse) => this.#onContact(contact, impulse));
  }

  #onContact(contact, impulse) {
    const fa = contact.getFixtureA(), fb = contact.getFixtureB();
    const da = fa.getUserData(), db = fb.getUserData();
    const boardFix = da?.board ? fa : db?.board ? fb : null;
    if (!boardFix) return;
    const other = boardFix === fa ? fb : fa;
    if (other.getBody().isStatic()) return;
    const id = boardFix.getUserData().board;
    const wm = contact.getWorldManifold(null);
    if (!wm) return;
    const sign = boardFix === fa ? -1 : 1;    // normal points from A to B
    const n = contact.getManifold().pointCount;
    for (let k = 0; k < n; k++) {
      const imp = impulse.normalImpulses[k] || 0;
      if (imp <= 0) continue;
      let list = this.contacts.get(id);
      if (!list) this.contacts.set(id, (list = []));
      list.push({ x: wm.points[k].x, y: wm.points[k].y, ix: sign * wm.normal.x * imp, iy: sign * wm.normal.y * imp });
    }
  }

  isAnchorPoint(x, y) {
    const t = this.terrain;
    return t.solidAt(x, y) || t.solidAt(x, y - 0.15) || t.solidAt(x - 0.12, y - 0.06) || t.solidAt(x + 0.12, y - 0.06);
  }

  #findJoint(x, y) {
    let best = null, bd = BOARD.snap;
    for (const j of this.joints.values()) { const d = Math.hypot(j.x - x, j.y - y); if (d < bd) { bd = d; best = j; } }
    return best;
  }

  // Place a board. occupied(x, y) rejects points inside the camper or travellers.
  // Returns { board } or { error }. The board may immediately collapse (see analyse).
  place(ax, ay, bx, by, occupied) {
    const ja = this.#findJoint(ax, ay);
    if (ja) { ax = ja.x; ay = ja.y; }
    let jb = this.#findJoint(bx, by);
    if (jb === ja) jb = null;
    if (jb) { bx = jb.x; by = jb.y; }
    let len = Math.hypot(bx - ax, by - ay);
    if (len > BOARD.maxLen && !jb) { const k = BOARD.maxLen / len; bx = ax + (bx - ax) * k; by = ay + (by - ay) * k; len = BOARD.maxLen; }
    if (len > BOARD.maxLen + 1e-6) return { error: 'Too long: boards are at most 3 m' };
    if (len < BOARD.minLen) return { error: 'Too short' };
    if (ja && jb && [...this.boards.values()].some(b => (b.a === ja.id && b.b === jb.id) || (b.a === jb.id && b.b === ja.id))) return { error: 'Already a board there' };
    for (let k = 0; k <= 8; k++) if (occupied(ax + (bx - ax) * k / 8, ay + (by - ay) * k / 8)) return { error: 'Something is in the way' };
    const anchorA = ja ? ja.anchor : this.isAnchorPoint(ax, ay);
    const anchorB = jb ? jb.anchor : this.isAnchorPoint(bx, by);
    if (!ja && !jb && !anchorA && !anchorB) return { error: 'A board must rest on the ground or join another board' };
    const A = ja || this.#addJoint(ax, ay, anchorA);
    const B = jb || this.#addJoint(bx, by, anchorB);
    const board = { id: this.nextId++, a: A.id, b: B.id, len: Math.hypot(B.x - A.x, B.y - A.y), body: null, u: 0, over: 0, shaky: 0, unstable: false };
    this.#makeBody(board);
    this.boards.set(board.id, board);
    return { board };
  }

  #addJoint(x, y, anchor) {
    const j = { id: this.nextId++, x, y, anchor };
    this.joints.set(j.id, j);
    return j;
  }

  #makeBody(board) {
    const A = this.joints.get(board.a), B = this.joints.get(board.b);
    const len = Math.hypot(B.x - A.x, B.y - A.y);
    const body = this.world.createBody({ type: 'static', position: Vec2((A.x + B.x) / 2, (A.y + B.y) / 2), angle: Math.atan2(B.y - A.y, B.x - A.x) });
    body.createFixture(new Box(len / 2, BOARD.thick / 2), { friction: 0.9, density: BOARD.mass / (len * BOARD.thick), userData: { board: board.id } });
    board.body = body;
  }

  // Detach a board: it falls as debris (or is removed outright when salvaged).
  #detach(board, asDebris) {
    this.boards.delete(board.id);
    this.contacts.delete(board.id);
    if (asDebris) {
      const body = board.body;
      body.setType('dynamic');
      body.getFixtureList().setUserData({ debris: board.id });
      body.resetMassData();
      body.setAwake(true);
      this.debris.set(board.id, { id: board.id, body, len: board.len });
    } else this.world.destroyBody(board.body);
    this.#pruneJoints();
  }

  #pruneJoints() {
    const used = new Set();
    for (const b of this.boards.values()) { used.add(b.a); used.add(b.b); }
    for (const id of [...this.joints.keys()]) if (!used.has(id)) this.joints.delete(id);
  }

  remove(id) {
    const b = this.boards.get(id);
    if (!b) return false;
    this.#detach(b, false);
    return true;
  }

  salvage(id) {
    const d = this.debris.get(id);
    if (!d) return false;
    this.world.destroyBody(d.body);
    this.debris.delete(id);
    return true;
  }

  // Board nearest to a point (within pad), for removal.
  boardAt(x, y, pad = 0.3) {
    let best = null, bd = pad;
    for (const b of this.boards.values()) { const d = this.#segDist(b, x, y); if (d < bd) { bd = d; best = b; } }
    return best;
  }

  #segDist(b, x, y) {
    const A = this.joints.get(b.a), B = this.joints.get(b.b);
    return segDist(A.x, A.y, B.x, B.y, x, y);
  }

  pointInBoard(x, y, pad = BOARD.thick / 2) {
    for (const b of this.boards.values()) if (this.#segDist(b, x, y) < pad) return true;
    return false;
  }

  // Does the step from (ax, ay) to (bx, by) cross a board? Used to stop slumping.
  blocksSegment(ax, ay, bx, by) {
    for (const b of this.boards.values()) {
      const A = this.joints.get(b.a), B = this.joints.get(b.b);
      if (segmentsIntersect(ax, ay, bx, by, A.x, A.y, B.x, B.y) || segDist(A.x, A.y, B.x, B.y, bx, by) < BOARD.thick) return true;
    }
    return false;
  }

  // Called after each physics step to accumulate samples; analyse every `every` steps.
  step(dt, players, every = 6) {
    this.samples++;
    if (this.samples < every) return [];
    const window = this.samples * dt;
    this.samples = 0;
    // Anchors stay anchors only while ground is still there.
    for (const j of this.joints.values()) if (j.anchor && !this.isAnchorPoint(j.x, j.y)) j.anchor = false;
    const loads = new Map();   // board id -> [{ x, y, fx, fy }]
    for (const [id, list] of this.contacts) loads.set(id, list.map(c => ({ x: c.x, y: c.y, fx: c.ix / window, fy: c.iy / window })));
    this.contacts.clear();
    for (const p of players) {
      const a = p.avatar;
      if (a.mode !== 'out' || (a.lane || 0) !== 0 || !a.onGround) continue;
      const b = this.boardAt(a.x, a.y - 0.08, 0.2);
      if (!b) continue;
      if (!loads.has(b.id)) loads.set(b.id, []);
      loads.get(b.id).push({ x: a.x, y: a.y, fx: 0, fy: -PERSON_LOAD });
    }
    return this.analyse(loads, window);
  }

  // Frame analysis. Returns ids of boards that broke or collapsed this pass.
  analyse(loads = new Map(), window = 0.1) {
    const fallen = [];
    for (let guard = 0; guard < 200; guard++) {
      const comps = this.#components();
      let changed = false;
      for (const comp of comps) {
        const res = this.#solve(comp, loads);
        if (res.singular) {
          // Not held in place. It stands briefly so it can be braced; it falls,
          // newest board first, when the grace runs out or when it is loaded.
          let loaded = false, oldest = 0;
          for (const b of comp.boards) {
            if (!b.unstable) { b.unstable = true; b.shaky = 0; }
            b.shaky += window;
            b.u = 0;
            oldest = Math.max(oldest, b.shaky);
            if ((loads.get(b.id) || []).some(l => Math.hypot(l.fx, l.fy) > 200)) loaded = true;
          }
          if (loaded || oldest >= BOARD.shakyFor) {
            const newest = comp.boards.reduce((m, b) => (b.id > m.id ? b : m));
            fallen.push(newest.id);
            this.#detach(newest, true);
            loads.delete(newest.id);
            changed = true;
            break;
          }
          continue;
        }
        for (const b of comp.boards) {
          b.unstable = false; b.shaky = 0;
          b.u = res.util.get(b.id) || 0;
          b.over = b.u > 1 ? b.over + window : 0;
        }
      }
      if (changed) continue;
      const broken = [...this.boards.values()].filter(b => b.over >= BOARD.breakAfter);
      if (!broken.length) break;
      for (const b of broken) { fallen.push(b.id); this.#detach(b, true); }
    }
    return fallen;
  }

  #components() {
    const parent = new Map();
    const find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const j of this.joints.keys()) parent.set(j, j);
    for (const b of this.boards.values()) parent.set(find(b.a), find(b.b));
    const groups = new Map();
    for (const b of this.boards.values()) {
      const r = find(b.a);
      if (!groups.has(r)) groups.set(r, { boards: [] });
      groups.get(r).boards.push(b);
    }
    return [...groups.values()];
  }

  #solve(comp, loads) {
    // Nodes: board end joints plus one mid node per board.
    const nodeIndex = new Map();
    const nodes = [];
    const addNode = (key, x, y, anchor) => { if (!nodeIndex.has(key)) { nodeIndex.set(key, nodes.length); nodes.push({ x, y, anchor }); } return nodeIndex.get(key); };
    const elems = [];
    for (const b of comp.boards) {
      const A = this.joints.get(b.a), B = this.joints.get(b.b);
      const i = addNode('j' + A.id, A.x, A.y, A.anchor);
      const j = addNode('j' + B.id, B.x, B.y, B.anchor);
      const m = addNode('m' + b.id, (A.x + B.x) / 2, (A.y + B.y) / 2, false);
      b._nodes = [i, m, j];
      elems.push({ board: b, i, j: m }, { board: b, i: m, j });
    }
    // DOF numbering: anchors fix u and v.
    const dof = [];
    let n = 0;
    for (const nd of nodes) dof.push([nd.anchor ? -1 : n++, nd.anchor ? -1 : n++, n++]);
    const K = new Float64Array(n * n), F = new Float64Array(n);
    const addF = (node, fx, fy) => { const d = dof[node]; if (d[0] >= 0) F[d[0]] += fx; if (d[1] >= 0) F[d[1]] += fy; };
    for (const e of elems) {
      const a = nodes[e.i], c = nodes[e.j];
      const L = Math.hypot(c.x - a.x, c.y - a.y);
      e.L = L; e.c = (c.x - a.x) / L; e.s = (c.y - a.y) / L;
      e.k = frameLocal(BOARD.EA, BOARD.EI, L);
      const kg = toGlobal(e.k, e.c, e.s);
      const map = [...dof[e.i], ...dof[e.j]];
      for (let r = 0; r < 6; r++) { if (map[r] < 0) continue; for (let q = 0; q < 6; q++) if (map[q] >= 0) K[map[r] * n + map[q]] += kg[r * 6 + q]; }
    }
    for (const b of comp.boards) {
      const [i, m, j] = b._nodes;
      const w = BOARD.mass * G;
      addF(i, 0, -w / 4); addF(m, 0, -w / 2); addF(j, 0, -w / 4);
      for (const l of loads.get(b.id) || []) {
        const A = nodes[i], B = nodes[j];
        const dx = B.x - A.x, dy = B.y - A.y;
        const t = Math.max(0, Math.min(1, ((l.x - A.x) * dx + (l.y - A.y) * dy) / (dx * dx + dy * dy)));
        if (t < 0.5) { const k = t / 0.5; addF(i, l.fx * (1 - k), l.fy * (1 - k)); addF(m, l.fx * k, l.fy * k); }
        else { const k = (t - 0.5) / 0.5; addF(m, l.fx * (1 - k), l.fy * (1 - k)); addF(j, l.fx * k, l.fy * k); }
      }
    }
    const d = choleskySolve(K, F, n);
    if (!d) return { singular: true };
    const util = new Map();
    for (const e of elems) {
      const map = [...dof[e.i], ...dof[e.j]];
      const dg = map.map(k => (k >= 0 ? d[k] : 0));
      const { c, s } = e;
      const dl = [c * dg[0] + s * dg[1], -s * dg[0] + c * dg[1], dg[2], c * dg[3] + s * dg[4], -s * dg[3] + c * dg[4], dg[5]];
      const f = new Array(6).fill(0);
      for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) f[r] += e.k[r * 6 + q] * dl[q];
      const u = Math.abs(f[3]) / BOARD.maxAxial + Math.max(Math.abs(f[2]), Math.abs(f[5])) / BOARD.maxMoment;
      util.set(e.board.id, Math.max(util.get(e.board.id) || 0, u));
    }
    return { singular: false, util };
  }

  snapshot() {
    const r = v => Math.round(v * 1000) / 1000;
    return {
      j: [...this.joints.values()].map(j => [j.id, r(j.x), r(j.y), j.anchor ? 1 : 0]),
      b: [...this.boards.values()].map(b => [b.id, b.a, b.b, Math.round(b.u * 100) / 100, b.unstable ? 1 : 0]),
      d: [...this.debris.values()].map(d => { const p = d.body.getPosition(); return [d.id, r(p.x), r(p.y), r(d.body.getAngle()), r(d.len)]; }),
    };
  }
}

function frameLocal(EA, EI, L) {
  const a = EA / L, b = 12 * EI / L ** 3, c = 6 * EI / L ** 2, d = 4 * EI / L, e = 2 * EI / L;
  return [
    a, 0, 0, -a, 0, 0,
    0, b, c, 0, -b, c,
    0, c, d, 0, -c, e,
    -a, 0, 0, a, 0, 0,
    0, -b, -c, 0, b, -c,
    0, c, e, 0, -c, d,
  ];
}

function toGlobal(k, c, s) {
  const T = [c, s, 0, -s, c, 0, 0, 0, 1];
  const Tf = i => { const r = Math.floor(i / 6), q = i % 6; return (Math.floor(r / 3) === Math.floor(q / 3)) ? T[(r % 3) * 3 + (q % 3)] : 0; };
  const out = new Array(36).fill(0);
  // out = Tᵀ k T
  const tmp = new Array(36).fill(0);
  for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) { let v = 0; for (let m = 0; m < 6; m++) v += k[r * 6 + m] * Tf(m * 6 + q); tmp[r * 6 + q] = v; }
  for (let r = 0; r < 6; r++) for (let q = 0; q < 6; q++) { let v = 0; for (let m = 0; m < 6; m++) v += Tf(m * 6 + r) * tmp[m * 6 + q]; out[r * 6 + q] = v; }
  return out;
}

// Solves K d = F for symmetric positive definite K. Returns null when K is
// singular (the structure is a mechanism).
function choleskySolve(K, F, n) {
  if (n === 0) return new Float64Array(0);
  let maxDiag = 0;
  for (let i = 0; i < n; i++) maxDiag = Math.max(maxDiag, K[i * n + i]);
  const L = new Float64Array(n * n);
  for (let j = 0; j < n; j++) {
    let sum = K[j * n + j];
    for (let k = 0; k < j; k++) sum -= L[j * n + k] ** 2;
    if (sum <= maxDiag * 1e-9) return null;
    const ljj = Math.sqrt(sum);
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = K[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = s / ljj;
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) { let s = F[i]; for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k]; y[i] = s / L[i * n + i]; }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = y[i]; for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k]; x[i] = s / L[i * n + i]; }
  return x;
}

export function segDist(ax, ay, bx, by, x, y) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(x - ax - t * dx, y - ay - t * dy);
}

function segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  const d1 = (dx - cx) * (ay - cy) - (dy - cy) * (ax - cx);
  const d2 = (dx - cx) * (by - cy) - (dy - cy) * (bx - cx);
  const d3 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const d4 = (bx - ax) * (dy - ay) - (by - ay) * (dx - ax);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}
