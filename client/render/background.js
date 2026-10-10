import { Container, Graphics, FillGradient } from 'pixi.js';
import { mulberry32, fbm1 } from '../../shared/rng.mjs';
import { PAL } from './palette.js';

// Sky, sun and parallax silhouette layers. Each layer is a long strip drawn
// once in its own metres; the camera moves it by its depth factor.

const LAYERS = [
  { key: 'far', f: 0.08, fv: 0.12, k: 0.5, base: 5, color: PAL.far, amp: 10, freq: 1 / 50, trees: 0 },
  { key: 'mid', f: 0.22, fv: 0.3, k: 0.62, base: 2.5, color: PAL.mid, amp: 4.5, freq: 1 / 30, trees: 0.25, treeColor: PAL.midTrees },
  { key: 'near', f: 0.45, fv: 0.55, k: 0.75, base: 0.8, color: PAL.near, amp: 2.6, freq: 1 / 20, trees: 0.55, treeColor: PAL.nearTrees },
];

function tree(g, x, y, s, rand, color) {
  if (rand() < 0.55) {
    // Conifer: stacked soft triangles.
    const h = 4.5 * s, w = 1.6 * s;
    for (let k = 0; k < 3; k++) {
      const yy = y + h * 0.18 + k * h * 0.24, ww = w * (1 - k * 0.22);
      g.poly([x - ww, yy, x + ww, yy, x, yy + h * 0.42]);
    }
    g.rect(x - 0.12 * s, y, 0.24 * s, h * 0.2);
  } else {
    // Broadleaf: clustered circles.
    const r = 1.3 * s;
    g.rect(x - 0.13 * s, y, 0.26 * s, 1.6 * s);
    g.circle(x, y + 2.3 * s, r);
    g.circle(x - r * 0.7, y + 1.8 * s, r * 0.75);
    g.circle(x + r * 0.7, y + 1.9 * s, r * 0.8);
  }
  g.fill(color);
}

export class Background {
  constructor(stage, length, seed) {
    this.root = new Container();
    stage.addChild(this.root);
    this.sky = new Graphics();
    this.sunGlow = new Graphics();
    this.root.addChild(this.sky, this.sunGlow);
    this.layers = [];
    for (const L of LAYERS) {
      const c = new Container();
      const g = new Graphics();
      const rand = mulberry32(seed ^ (L.f * 1e6));
      const span = length * L.f + 400;
      const pts = [];
      const step = 1.5;
      for (let x = -200; x <= span; x += step) pts.push(x, L.base + L.amp * (fbm1(x * L.freq, seed + L.key.length * 97, 4) * 0.5 + 0.5));
      g.poly([...pts, span, -80, -200, -80]).fill(L.color);
      if (L.trees) {
        for (let x = -200; x <= span; x += 1.2 + rand() * 3) {
          if (rand() > L.trees) continue;
          const ix = Math.round((x + 200) / step);
          tree(g, x, pts[ix * 2 + 1] - 0.4, 0.6 + rand() * 0.7, rand, L.treeColor);
        }
      }
      // Atmospheric haze: far layers fade toward the sky colour.
      g.alpha = 1;
      c.addChild(g);
      this.root.addChild(c);
      this.layers.push({ ...L, c });
    }
  }

  resize(w, h) {
    this.w = w; this.h = h;
    const grad = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
      { offset: 0, color: PAL.skyTop }, { offset: 0.55, color: PAL.skyMid }, { offset: 1, color: PAL.skyLow },
    ], textureSpace: 'local' });
    this.sky.clear().rect(0, 0, w, h).fill(grad);
    const r = Math.max(w, h) * 0.45;
    const glow = new FillGradient({ type: 'radial', center: { x: 0.5, y: 0.5 }, innerRadius: 0, outerCenter: { x: 0.5, y: 0.5 }, outerRadius: 0.5, colorStops: [
      { offset: 0, color: 'rgba(255,244,214,0.95)' }, { offset: 0.08, color: 'rgba(255,236,190,0.9)' }, { offset: 0.2, color: 'rgba(255,214,150,0.35)' }, { offset: 1, color: 'rgba(255,200,140,0)' },
    ], textureSpace: 'local' });
    this.sunGlow.clear().rect(-r, -r, r * 2, r * 2).fill(glow);
  }

  // refY: ground height near the camera; each layer's horizon tracks it with
  // its own vertical parallax so the silhouettes sit just behind the terrain.
  update(camX, camY, ppm, refY) {
    const { w, h } = this;
    this.sunGlow.position.set(w * 0.3 - camX * ppm * 0.003, h * 0.3 + (camY - refY) * ppm * 0.05);
    for (const L of this.layers) {
      const s = ppm * L.k;
      L.c.scale.set(s, -s);
      const horizon = h / 2 + (camY - refY) * ppm * L.fv + 1.2 * ppm;
      L.c.position.set(w / 2 - camX * L.f * s, horizon);
    }
  }
}

// Dark ferns and grass between the camera and the play plane.
export class Foreground {
  constructor(stage, length, seed) {
    this.c = new Container();
    const g = new Graphics();
    const rand = mulberry32(seed ^ 0xf0e1);
    const f = 1.3, span = length * f + 200;
    for (let x = -100; x < span; x += 3 + rand() * 9) {
      if (rand() < 0.45) continue;
      const s = 0.8 + rand() * 1.2;
      // Fern: fan of curved blades.
      for (let k = -3; k <= 3; k++) {
        const a = k * 0.28, len = (1.7 - Math.abs(k) * 0.18) * s;
        const tx = x + Math.sin(a) * len, ty = Math.cos(a) * len;
        g.poly([x - 0.08 * s, 0, tx - 0.1 * s + Math.sin(a) * 0.2, ty * 0.6, tx, ty, tx + 0.1 * s, ty * 0.6, x + 0.08 * s, 0]);
      }
    }
    g.fill(PAL.fore);
    this.c.addChild(g);
    this.f = f;
    stage.addChild(this.c);
  }

  update(camX, w, h, ppm) {
    const s = ppm * 1.15;
    this.c.scale.set(s, -s);
    this.c.position.set(w / 2 - camX * this.f * s, h + 0.4 * s);
  }
}
