import { Container, Graphics } from 'pixi.js';
import { CELL } from '../../shared/constants.mjs';
import { mulberry32 } from '../../shared/rng.mjs';
import { floorAt, LOG_THICKNESS } from '../../shared/forest.mjs';
import { PAL } from './palette.js';
import { artSprite } from '../assets.js';

const FALL_TIME = 1.3;   // seconds for a felled tree to topple

function treeGraphic(tree) {
  const art = artSprite('tree.' + tree.kind, tree.seed, { height: tree.height });
  if (art) { const c = new Container(); c.addChild(art); return c; }
  const rand = mulberry32(tree.seed);
  const g = new Graphics();
  const h = tree.height, w = tree.girth;
  // Trunk, tapered, with a lit left edge.
  g.poly([-w, 0, w, 0, w * 0.45, h * 0.8, -w * 0.45, h * 0.8]).fill(PAL.trunk);
  g.poly([-w, 0, -w * 0.45, 0, -w * 0.25, h * 0.8, -w * 0.45, h * 0.8]).fill({ color: 0xffe2b0, alpha: 0.12 });
  g.poly([-w * 1.6, 0, -w * 0.6, 0.35, -w * 0.4, 0]).fill(PAL.trunk);   // root flare
  g.poly([w * 1.5, 0, w * 0.6, 0.3, w * 0.4, 0]).fill(PAL.trunk);
  if (tree.kind === 'pine') {
    const tiers = 5;
    for (let k = 0; k < tiers; k++) {
      const t = k / tiers;
      const base = h * (0.22 + t * 0.62), top = base + h * 0.3;
      const half = (1 - t * 0.75) * h * 0.2 + 0.4;
      const dark = k % 2 ? 0x3f6b4a : 0x46744f;
      g.poly([-half, base, half, base, half * 0.25, base + (top - base) * 0.55, 0, top, -half * 0.25, base + (top - base) * 0.55]).fill(dark);
      g.poly([-half, base, -half * 0.1, base, 0, top, -half * 0.25, base + (top - base) * 0.55]).fill({ color: 0x8fbf6a, alpha: 0.28 });
    }
  } else {
    // Broadleaf: a couple of branches and clustered leaf masses.
    g.moveTo(0, h * 0.45).lineTo(-h * 0.18, h * 0.7).moveTo(0, h * 0.55).lineTo(h * 0.2, h * 0.78).stroke({ width: w * 0.6, color: PAL.trunk, cap: 'round' });
    const blobs = [];
    for (let k = 0; k < 7; k++) blobs.push([(rand() - 0.5) * h * 0.55, h * (0.62 + rand() * 0.3), h * (0.14 + rand() * 0.08)]);
    for (const [x, y, r] of blobs) g.circle(x, y, r);
    g.fill(0x4d7a4f);
    for (const [x, y, r] of blobs) g.circle(x - r * 0.25, y + r * 0.25, r * 0.7);
    g.fill({ color: 0x79a85e, alpha: 0.55 });
    for (const [x, y, r] of blobs) g.circle(x - r * 0.4, y + r * 0.4, r * 0.3);
    g.fill({ color: 0xb6d777, alpha: 0.35 });
  }
  return g;
}

function stumpGraphic(tree) {
  const art = artSprite('tree.stump', tree.seed);
  if (art) { const c = new Container(); c.addChild(art); return c; }
  const w = tree.girth;
  return new Graphics()
    .poly([-w * 1.4, 0, w * 1.4, 0, w, 0.45, -w, 0.45]).fill(PAL.trunk)
    .ellipse(0, 0.45, w, w * 0.3).fill(0xd9b483)
    .ellipse(0, 0.45, w * 0.55, w * 0.16).stroke({ width: 0.02, color: 0xa47d52 });
}

export function logGraphic(len) {
  const art = artSprite('log', 0, { length: len });
  if (art) { const c = new Container(); c.addChild(art); return c; }
  const t = LOG_THICKNESS, h = len / 2;
  const g = new Graphics();
  g.roundRect(-h, -t / 2, len, t, t * 0.45).fill(0x7a5236);
  g.roundRect(-h, -t / 2, len, t * 0.35, t * 0.2).fill({ color: 0x5c3d28, alpha: 0.6 });
  for (let x = -h + 0.3; x < h - 0.2; x += 0.45) g.moveTo(x, -t * 0.25).lineTo(x + 0.25, t * 0.2);
  g.stroke({ width: 0.025, color: 0x5c3d28, alpha: 0.7 });
  for (const e of [-1, 1]) {
    g.ellipse(e * h, 0, t * 0.22, t * 0.5).fill(0xe0bb89);
    g.ellipse(e * h, 0, t * 0.12, t * 0.3).stroke({ width: 0.02, color: 0xb08656 });
  }
  return g;
}

export function pileGraphic(n) {
  const g = new Graphics();
  const shown = Math.min(n, 8);
  for (let k = 0; k < shown; k++) {
    const off = (k % 2) * 0.08;
    g.roundRect(-0.7 + off, k * 0.09, 1.4, 0.08, 0.02).fill(k % 2 ? PAL.woodLight : PAL.wood);
    g.roundRect(-0.7 + off, k * 0.09, 1.4, 0.08, 0.02).stroke({ width: 0.012, color: PAL.woodDark });
  }
  return g;
}

// Forest floor, trees, and the forest-lane logs and piles. Drawn behind the road.
export class ForestView {
  constructor(parent, terrain, floor, trees) {
    this.t = terrain; this.floor = floor; this.trees = trees;
    this.root = new Container();
    this.ground = new Graphics();
    this.treeLayer = new Container();
    this.items = new Container();     // logs, piles on the forest floor
    this.actors = new Container();    // travellers in the forest lane
    this.root.addChild(this.treeLayer, this.ground, this.items, this.actors);
    parent.addChild(this.root);
    this.views = new Map();           // tree id -> { c, tree, stump }
    this.groundRange = null;
  }

  #drawGround(x0, x1) {
    const g = this.ground.clear();
    const pts = [];
    for (let x = x0; x <= x1; x += CELL * 2) pts.push(x, floorAt(this.floor, x));
    g.poly([...pts, x1, floorAt(this.floor, x1) - 8, x0, floorAt(this.floor, x0) - 8]).fill(0x4c6f40);
    // A darker band lower down reads as the forest floor receding behind the road.
    const low = [];
    for (let k = 0; k < pts.length; k += 2) low.push(pts[k], pts[k + 1] - 0.55);
    g.poly([...low, x1, floorAt(this.floor, x1) - 8, x0, floorAt(this.floor, x0) - 8]).fill({ color: 0x324d30, alpha: 0.55 });
    for (let k = 0; k < pts.length - 2; k += 2) g.moveTo(pts[k], pts[k + 1]).lineTo(pts[k + 2], pts[k + 3]);
    g.stroke({ width: 0.14, color: 0x6c9a4e });
    // Moss and leaf litter.
    const rand = mulberry32(Math.floor(x0));
    for (let x = x0; x < x1; x += 0.35 + rand() * 0.6) {
      const y = floorAt(this.floor, x);
      g.ellipse(x, y - 0.08 - rand() * 0.2, 0.12 + rand() * 0.18, 0.05).fill({ color: rand() < 0.5 ? 0x4a6e3b : 0x6e8f45, alpha: 0.7 });
    }
    this.groundRange = [x0, x1];
  }

  // treeState: Map id -> [id, hp, fallDir, fellTick, lastHit]; tick: current server tick (fractional)
  update(minX, maxX, treeState, tick, time) {
    if (!this.groundRange || minX < this.groundRange[0] + 4 || maxX > this.groundRange[1] - 4) {
      this.#drawGround(Math.max(0, Math.floor(minX - 20)), Math.min(this.t.length, Math.ceil(maxX + 20)));
    }
    for (const tree of this.trees) {
      const visible = tree.x > minX - 8 && tree.x < maxX + 8;
      let v = this.views.get(tree.id);
      if (!visible) { if (v) { v.c.destroy({ children: true }); this.views.delete(tree.id); } continue; }
      const st = treeState.get(tree.id);
      if (!v) {
        const c = new Container();
        c.position.set(tree.x, floorAt(this.floor, tree.x) - 0.1);
        const body = treeGraphic(tree);
        c.addChild(body);
        const stump = stumpGraphic(tree);
        stump.visible = false;
        this.treeLayer.addChild(stump);
        stump.position.copyFrom(c.position);
        this.treeLayer.addChild(c);
        v = { c, body, stump };
        this.views.set(tree.id, v);
      }
      if (st && st[1] <= 0) {
        v.stump.visible = true;
        const age = (tick - st[3]) / 60;
        const t = Math.min(1, age / FALL_TIME);
        v.c.visible = t < 1;
        v.c.rotation = -st[2] * (Math.PI / 2) * t * t;
      } else {
        const hitAge = st ? (tick - st[4]) / 60 : 9;
        v.c.rotation = hitAge < 0.3 ? Math.sin(hitAge * 60) * 0.02 * (1 - hitAge / 0.3) : Math.sin(time * 0.6 + tree.x) * 0.006;
      }
    }
  }
}

// Logs and board piles in one lane.
export class LumberView {
  constructor(parent) {
    this.root = new Container();
    parent.addChild(this.root);
    this.logs = new Map();
    this.piles = new Map();
  }

  update(logs, piles) {
    const seen = new Set();
    for (const l of logs) {
      seen.add('l' + l.id);
      let v = this.logs.get(l.id);
      if (!v) {
        v = { c: new Container(), cut: new Graphics() };
        v.c.addChild(logGraphic(l.len), v.cut);
        this.root.addChild(v.c);
        this.logs.set(l.id, v);
      }
      v.c.position.set(l.x, l.y);
      v.c.rotation = l.a;
      v.cut.clear();
      if (l.saw > 0) v.cut.rect(-0.02, LOG_THICKNESS / 2 - LOG_THICKNESS * l.saw, 0.04, LOG_THICKNESS * l.saw).fill(0xf0d6a8);
    }
    for (const [id, v] of this.logs) if (!seen.has('l' + id)) { v.c.destroy({ children: true }); this.logs.delete(id); }
    for (const p of piles) {
      seen.add('p' + p.id);
      let v = this.piles.get(p.id);
      if (!v || v.n !== p.n) {
        if (v) v.g.destroy();
        v = { g: pileGraphic(p.n), n: p.n };
        this.root.addChild(v.g);
        this.piles.set(p.id, v);
      }
      v.g.position.set(p.x, p.y);
    }
    for (const [id, v] of this.piles) if (!seen.has('p' + id)) { v.g.destroy(); this.piles.delete(id); }
  }
}
