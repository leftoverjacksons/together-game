import { Container, Graphics, FillGradient } from 'pixi.js';
import { mulberry32, fbm1 } from '../../shared/rng.mjs';
import { PAL } from './palette.js';
import { artStrip } from '../assets.js';

// Sky, sun and parallax silhouette layers. Each layer is a long strip drawn
// once in its own metres; the camera moves it by its depth factor.

const LAYERS = [
  { key: 'peaks', f: 0.03, fv: 0.05, k: 0.42, base: 6, color: 0xb7a3c2, amp: 13, freq: 1 / 22, trees: 0, snow: 0xf4ece6, haze: 0.42 },
  { key: 'far', f: 0.08, fv: 0.12, k: 0.5, base: 5, color: PAL.far, amp: 10, freq: 1 / 50, trees: 0, haze: 0.3 },
  { key: 'mid', f: 0.2, fv: 0.28, k: 0.6, base: 2.5, color: PAL.mid, amp: 4.5, freq: 1 / 30, trees: 0.25, treeColor: PAL.midTrees, haze: 0.18, deer: 2 },
  { key: 'farForest', f: 0.32, fv: 0.42, k: 0.68, base: 1.4, color: 0x6c9270, amp: 3, freq: 1 / 24, trees: 0.75, treeColor: 0x5f8766, haze: 0.1 },
  { key: 'near', f: 0.45, fv: 0.55, k: 0.75, base: 0.8, color: PAL.near, amp: 2.6, freq: 1 / 20, trees: 0.55, treeColor: PAL.nearTrees, deer: 3 },
];

function deer(g, x, y, s, color) {
  // A grazing deer silhouette, head down.
  g.ellipse(x, y + 0.95 * s, 0.6 * s, 0.28 * s);
  for (const lx of [-0.42, -0.3, 0.32, 0.45]) g.rect(x + lx * s, y, 0.07 * s, 0.85 * s);
  g.poly([x + 0.45 * s, y + 1.05 * s, x + 0.62 * s, y + 1.1 * s, x + 0.95 * s, y + 0.45 * s, x + 0.8 * s, y + 0.4 * s]);
  g.ellipse(x + 0.92 * s, y + 0.4 * s, 0.14 * s, 0.09 * s);
  g.poly([x - 0.6 * s, y + 1.05 * s, x - 0.72 * s, y + 1.2 * s, x - 0.55 * s, y + 1.1 * s]);
  g.fill(color);
}

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
    this.clouds = new Graphics();
    this.root.addChild(this.sky, this.sunGlow, this.clouds);
    const crand = mulberry32(seed ^ 0xc10d);
    this.cloudList = Array.from({ length: 7 }, () => ({ x: crand(), y: 0.06 + crand() * 0.26, s: 0.6 + crand() * 0.9, speed: 0.002 + crand() * 0.004, puffs: Array.from({ length: 6 }, () => [crand() - 0.5, crand() * 0.4, 0.35 + crand() * 0.4]) }));
    this.layers = [];
    for (const L of LAYERS) {
      const c = new Container();
      const g = new Graphics();
      const rand = mulberry32(seed ^ (L.f * 1e6));
      const span = length * L.f + 400;
      const pts = [];
      const step = 1.5;
      for (let x = -200; x <= span; x += step) {
        const n = fbm1(x * L.freq, seed + L.key.length * 97, 4);
        // Peaks use ridged noise for sharp summits; other layers roll.
        const v = L.snow ? Math.max(0, 1 - Math.abs(n) * 1.8) ** 1.6 : n * 0.5 + 0.5;
        pts.push(x, L.base + L.amp * v);
      }
      g.poly([...pts, span, -80, -200, -80]).fill(L.color);
      if (L.snow) {
        // Snow caps: the part of each summit above the snow line, with a ragged lower edge.
        const line = L.base + L.amp * 0.6;
        let run = [];
        const flush = () => {
          if (run.length > 2) {
            const low = run.map(([x, y]) => [x, line + (y - line) * 0.35 + (rand() - 0.5) * 0.9]).reverse();
            g.poly([...run.flat(), ...low.flat()]).fill(L.snow);
          }
          run = [];
        };
        for (let k = 0; k < pts.length; k += 2) { if (pts[k + 1] > line) run.push([pts[k], pts[k + 1]]); else flush(); }
        flush();
      }
      if (L.deer) {
        for (let k = 0; k < L.deer * (span / 400); k++) {
          const x = -150 + rand() * (span + 100);
          const ix = Math.max(0, Math.min(pts.length / 2 - 1, Math.round((x + 200) / step)));
          deer(g, x, pts[ix * 2 + 1] - 0.2, 0.5 + rand() * 0.2, L.treeColor);
        }
      }
      if (L.trees) {
        for (let x = -200; x <= span; x += 1.2 + rand() * 3) {
          if (rand() > L.trees) continue;
          const ix = Math.round((x + 200) / step);
          tree(g, x, pts[ix * 2 + 1] - 0.4, 0.6 + rand() * 0.7, rand, L.treeColor);
        }
      }
      // Art slot bg.<layer> (a horizontally repeating strip) replaces the drawn layer.
      const strip = artStrip('bg.' + L.key, span + 200);
      if (strip) { strip.position.x = -200; c.addChild(strip); g.destroy(); } else c.addChild(g);
      this.root.addChild(c);
      // Atmospheric haze in front of each distant layer.
      const haze = new Graphics();
      if (L.haze) this.root.addChild(haze);
      this.layers.push({ ...L, c, hazeG: haze });
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
    for (const L of this.layers) {
      if (!L.haze) continue;
      const hz = new FillGradient({ type: 'linear', start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [
        { offset: 0, color: 'rgba(247,214,170,0)' }, { offset: 0.55, color: `rgba(247,210,165,${L.haze * 0.6})` }, { offset: 1, color: `rgba(245,200,150,${L.haze})` },
      ], textureSpace: 'local' });
      L.hazeG.clear().rect(0, 0, w, h).fill(hz);
    }
  }

  #drawClouds(camX, time) {
    const { w, h } = this;
    const g = this.clouds.clear();
    for (const c of this.cloudList) {
      const x = (((c.x + time * c.speed - camX * 0.0004) % 1.4) + 1.4) % 1.4 - 0.2;
      const cx = x * w, cy = c.y * h, R = 60 * c.s * Math.max(0.6, h / 700);
      for (const [px, py, pr] of c.puffs) g.ellipse(cx + px * R * 2.4, cy - py * R, pr * R * 1.4, pr * R);
      g.fill({ color: 0xfff8ee, alpha: 0.42 });
      for (const [px, py, pr] of c.puffs) g.ellipse(cx + px * R * 2.4, cy - py * R + pr * R * 0.35, pr * R * 1.2, pr * R * 0.5);
      g.fill({ color: 0xe8b9a0, alpha: 0.1 });
    }
  }

  // refY: ground height near the camera; each layer's horizon tracks it with
  // its own vertical parallax so the silhouettes sit just behind the terrain.
  update(camX, camY, ppm, refY, time = 0) {
    const { w, h } = this;
    this.#drawClouds(camX, time);
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
    // Occasional big trunks passing close to the camera.
    const trunks = new Graphics();
    for (let x = 60; x < span; x += 80 + rand() * 110) {
      const wdt = 0.9 + rand() * 0.6;
      trunks.poly([x - wdt, -2, x + wdt, -2, x + wdt * 0.8, 40, x - wdt * 0.8, 40]).fill(0x24382a);
      trunks.poly([x - wdt * 0.8, -2, x - wdt * 0.45, -2, x - wdt * 0.35, 40, x - wdt * 0.6, 40]).fill({ color: 0xffd9a0, alpha: 0.08 });
    }
    this.trunks = new Container();
    this.trunks.addChild(trunks);
    this.c.addChild(g);
    this.f = f;
    stage.addChild(this.trunks, this.c);
    // Soft light shafts slanting from the sun, over everything.
    this.shafts = new Graphics();
    this.shafts.blendMode = 'add';
    stage.addChild(this.shafts);
  }

  update(camX, w, h, ppm, time = 0, wet = false) {
    const s = ppm * 1.15;
    this.c.scale.set(s, -s);
    this.c.position.set(w / 2 - camX * this.f * s, h + 0.4 * s);
    const ts = ppm * 1.3;
    this.trunks.scale.set(ts, -ts);
    this.trunks.position.set(w / 2 - camX * 1.45 * ts, h + 0.5 * ts);
    const g = this.shafts.clear();
    if (wet) return;
    const sx = w * 0.3 - camX * ppm * 0.003, sy = h * 0.25;
    for (let k = 0; k < 4; k++) {
      const a = 0.35 + k * 0.17 + Math.sin(time * 0.1 + k) * 0.02, spread = 0.035 + (k % 2) * 0.02;
      const L = Math.max(w, h) * 1.4;
      g.poly([sx, sy, sx + Math.cos(a - spread) * L, sy + Math.sin(a - spread) * L, sx + Math.cos(a + spread) * L, sy + Math.sin(a + spread) * L]);
      g.fill({ color: 0xffe6b0, alpha: 0.035 + 0.015 * Math.sin(time * 0.3 + k * 2) });
    }
  }
}
