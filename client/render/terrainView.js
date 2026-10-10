import { Container, Graphics } from 'pixi.js';
import { CELL, CHUNK } from '../../shared/constants.mjs';
import { hash1, noise1 } from '../../shared/rng.mjs';
import { PAL } from './palette.js';

const BANDS = [0.4, 1.1, 1.9, 2.9];   // strata depth below the original surface

// Terrain is drawn in three parts:
//   shape  – marching-squares polygons per chunk, used only as a stencil mask
//   strata – smooth soil bands and bedrock per chunk column, clipped by the mask
//   rim    – grass and exposed-dirt edges along the contour
// Strata never change (they follow the generated surface), so digging only
// rebuilds the mask and rim of the touched chunks.
export class TerrainView {
  constructor(parent, terrain) {
    this.t = terrain;
    this.shape = new Container();
    this.strata = new Container();
    this.grass = new Container();
    this.strata.mask = this.shape;
    parent.addChild(this.shape, this.strata);
    this.chunks = new Map();      // id -> { shape, rim, version }
    this.columns = new Map();     // cx -> Graphics
  }

  update(minX, maxX, minY, maxY, budget = 12) {
    const t = this.t, size = CHUNK * CELL;
    const cx0 = Math.max(0, Math.floor(minX / size) - 1), cx1 = Math.min(t.chunksX - 1, Math.floor(maxX / size) + 1);
    const cy0 = Math.max(0, Math.floor(minY / size) - 1), cy1 = Math.min(t.chunksY - 1, Math.floor(maxY / size) + 1);
    for (let cx = cx0; cx <= cx1; cx++) if (!this.columns.has(cx)) this.#buildColumn(cx);
    const visible = new Set();
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const id = cy * t.chunksX + cx;
      visible.add(id);
      const c = this.chunks.get(id);
      if (c && c.version === t.chunkVersion[id]) { c.shape.visible = c.rim.visible = true; continue; }
      if (budget-- <= 0) { if (c) c.shape.visible = c.rim.visible = true; continue; }
      this.#build(id, cx, cy, c);
    }
    for (const [id, c] of this.chunks) {
      if (visible.has(id)) continue;
      c.shape.visible = c.rim.visible = false;
      const cx = id % t.chunksX;
      if (cx < cx0 - 8 || cx > cx1 + 8) { c.shape.destroy(); c.rim.destroy(); this.chunks.delete(id); }
    }
    for (const [cx, g] of this.columns) {
      g.visible = cx >= cx0 && cx <= cx1;
      if (cx < cx0 - 8 || cx > cx1 + 8) { g.destroy(); this.columns.delete(cx); }
    }
  }

  #buildColumn(cx) {
    const t = this.t, size = CHUNK * CELL;
    const g = new Graphics();
    const x0 = cx * size, x1 = Math.min(t.length, x0 + size);
    const xs = [];
    for (let x = x0; x <= x1 + 1e-6; x += CELL) xs.push(Math.min(x, x1));
    const surf = x => t.surface[Math.min(t.nx - 1, Math.round(x / CELL))];
    const wob = x => 0.35 * (noise1(x / 3, t.seed + 5) - 0.5) + 0.12 * (noise1(x / 0.9, t.seed + 9) - 0.5);
    const top = 48;
    // Bands from the top down; each polygon spans from its upper boundary to the floor,
    // so later (deeper) bands paint over earlier ones without seams.
    const edges = [x => top, ...BANDS.map(d => x => surf(x) - d + wob(x))];
    edges.forEach((edge, b) => {
      const pts = [];
      for (const x of xs) pts.push(x, edge(x));
      pts.push(x1, 0, x0, 0);
      g.poly(pts).fill(PAL.soil[b]);
    });
    // Bedrock, smooth along its generated top.
    const rock = [];
    for (const x of xs) rock.push(x, t.rockTop[Math.min(t.nx - 1, Math.round(x / CELL))]);
    rock.push(x1, 0, x0, 0);
    g.poly(rock).fill(PAL.rock);
    g.moveTo(x0, t.rockTop[Math.round(x0 / CELL)]);
    for (const x of xs) g.lineTo(x, t.rockTop[Math.min(t.nx - 1, Math.round(x / CELL))]);
    g.stroke({ width: 0.06, color: PAL.rockDark });
    // Pebbles in soil and cracks in rock.
    for (let k = 0; k < 90; k++) {
      const px = x0 + hash1(cx * 977 + k, t.seed) * size;
      const py = hash1(cx * 977 + k + 300, t.seed) * surf(px);
      const r = 0.035 + hash1(k, cx) * 0.08;
      g.ellipse(px, py, r * 1.5, r);
    }
    g.fill({ color: 0x000000, alpha: 0.13 });
    for (let k = 0; k < 40; k++) {
      const px = x0 + hash1(cx * 577 + k, t.seed + 1) * size;
      const py = hash1(cx * 577 + k + 300, t.seed + 1) * surf(px);
      g.ellipse(px, py, 0.05, 0.03);
    }
    g.fill({ color: 0xffe2b0, alpha: 0.12 });
    this.strata.addChild(g);
    this.columns.set(cx, g);
  }

  #build(id, cx, cy, existing) {
    const t = this.t;
    const shape = existing ? existing.shape.clear() : new Graphics();
    const rim = existing ? existing.rim.clear() : new Graphics();
    if (!existing) { this.shape.addChild(shape); this.grass.addChild(rim); }
    const { fills, segments } = t.extractChunk(cx, cy);
    for (const polys of fills.values()) for (const p of polys) shape.poly(p);
    shape.fill(0xffffff);

    // Rim: grass on upward faces near the original surface, exposed dirt elsewhere.
    const grassSegs = [], dirtSegs = [], wallSegs = [];
    for (let k = 0; k < segments.length; k += 4) {
      const ax = segments[k], ay = segments[k + 1], bx = segments[k + 2], by = segments[k + 3];
      const dx = bx - ax, len = Math.hypot(dx, by - ay) || 1;
      const ny = -dx / len;                 // outward normal y (solid on the left)
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const ix = Math.min(t.nx - 1, Math.max(0, Math.round(mx / CELL)));
      const nearSurface = t.surface[ix] - my < 0.45;
      if (ny > 0.35) (nearSurface ? grassSegs : dirtSegs).push(ax, ay, bx, by);
      else wallSegs.push(ax, ay, bx, by);
    }
    const strokeSegs = (segs, style) => { for (let k = 0; k < segs.length; k += 4) rim.moveTo(segs[k], segs[k + 1]).lineTo(segs[k + 2], segs[k + 3]); if (segs.length) rim.stroke(style); };
    strokeSegs(wallSegs, { width: 0.08, color: PAL.outline, alpha: 0.3, cap: 'round' });
    strokeSegs(dirtSegs, { width: 0.1, color: PAL.dirtRim, cap: 'round' });
    strokeSegs(grassSegs, { width: 0.28, color: PAL.grassDark, cap: 'round' });
    strokeSegs(grassSegs, { width: 0.15, color: PAL.grass, cap: 'round' });
    for (let k = 0; k < grassSegs.length; k += 4) {
      const ax = grassSegs[k], ay = grassSegs[k + 1], bx = grassSegs[k + 2], by = grassSegs[k + 3];
      const h = hash1(Math.round(ax * 97), t.seed);
      if (h < 0.3) continue;
      const x = ax + (bx - ax) * h, y = ay + (by - ay) * h;
      const tall = 0.16 + h * 0.26;
      rim.poly([x - 0.07, y, x - 0.12, y + tall * 0.8, x - 0.02, y + 0.02, x + 0.02, y + tall, x + 0.06, y, x + 0.12, y + tall * 0.7, x + 0.09, y]);
    }
    rim.fill(PAL.grassLight);
    // Flowers, mushrooms and pebbles on undisturbed grass (digging removes them).
    for (let k = 0; k < grassSegs.length; k += 4) {
      const ax = grassSegs[k], ay = grassSegs[k + 1];
      const h = hash1(Math.round(ax * 53) + 7, t.seed);
      if (h > 0.16) continue;
      const kind = Math.floor(hash1(Math.round(ax * 31), t.seed + 3) * 5);
      if (kind <= 1) {
        const tall = 0.22 + h * 1.2, col = [0xf2d15c, 0xf4f0e6, 0xd97a9a, 0xb49be0][Math.floor(h * 25) % 4];
        rim.moveTo(ax, ay).lineTo(ax + 0.03, ay + tall).stroke({ width: 0.025, color: PAL.grassDark });
        for (let p = 0; p < 5; p++) rim.circle(ax + 0.03 + Math.cos(p * 1.26) * 0.05, ay + tall + Math.sin(p * 1.26) * 0.05, 0.035);
        rim.fill(col);
        rim.circle(ax + 0.03, ay + tall, 0.025).fill(0xe8a33c);
      } else if (kind === 2) {
        rim.rect(ax - 0.02, ay, 0.04, 0.1).fill(0xf1e6d0);
        rim.ellipse(ax, ay + 0.11, 0.08, 0.045).fill(0xc2563f);
        rim.circle(ax - 0.03, ay + 0.125, 0.012).circle(ax + 0.025, ay + 0.12, 0.01).fill(0xfff4e0);
      } else if (kind === 3) {
        rim.ellipse(ax, ay + 0.03, 0.12, 0.07).fill(0x8b8590);
        rim.ellipse(ax - 0.03, ay + 0.05, 0.06, 0.03).fill({ color: 0xffffff, alpha: 0.18 });
      }
    }
    this.chunks.set(id, { shape, rim, version: t.chunkVersion[id] });
  }
}
