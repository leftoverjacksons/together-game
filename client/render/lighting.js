import { Container, Graphics, RenderTexture, Sprite, Texture } from 'pixi.js';
import { mulberry32 } from '../../shared/rng.mjs';

// Darkness and light. Each frame a small lightmap is rendered: an ambient
// colour (white by day, deep blue at night, grey in storms) plus additive
// light sprites (headlamps, headlights, lantern...). It is laid over the
// scene with multiply blending, so only lit areas keep their colour.

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return Texture.from(c);
}

const lerp = (a, b, t) => a + (b - a) * t;
function mixColor(c1, c2, t) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export class Lighting {
  constructor(renderer, stage) {
    this.renderer = renderer;
    this.scale = 0.5;                          // lightmap at half resolution
    this.lights = new Container();
    this.pool = [];
    this.glow = canvasTexture(128, 128, (g, w, h) => {
      const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.55)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    });
    // A beam: bright at its origin (left middle), fading with distance and toward its edges.
    this.cone = canvasTexture(256, 128, (g, w, h) => {
      const r = g.createRadialGradient(0, h / 2, 0, 0, h / 2, w);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.5, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r;
      g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, 0); g.lineTo(w, h); g.closePath(); g.fill();
      g.globalCompositeOperation = 'destination-in';
      const edge = g.createLinearGradient(0, 0, 0, h);
      edge.addColorStop(0, 'rgba(0,0,0,0)'); edge.addColorStop(0.3, 'rgba(0,0,0,1)'); edge.addColorStop(0.7, 'rgba(0,0,0,1)'); edge.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = edge; g.fillRect(0, 0, w, h);
    });
    this.rt = null;
    this.overlay = new Sprite();
    this.overlay.blendMode = 'multiply';
    this.sky = new Graphics();                 // stars and moon, drawn over the darkness
    stage.addChild(this.overlay, this.sky);
    const rand = mulberry32(99);
    this.stars = Array.from({ length: 90 }, () => ({ x: rand(), y: rand() * 0.38, r: 0.6 + rand() * 1.2, p: rand() * 6 }));
  }

  #ensureTarget(w, h) {
    const tw = Math.max(1, Math.ceil(w * this.scale)), th = Math.max(1, Math.ceil(h * this.scale));
    if (this.rt && this.rt.width === tw && this.rt.height === th) return;
    this.rt?.destroy(true);
    this.rt = RenderTexture.create({ width: tw, height: th });
    this.overlay.texture = this.rt;
    this.overlay.width = w; this.overlay.height = h;
  }

  #sprite(k, tex) {
    let s = this.pool[k];
    if (!s) { s = new Sprite(tex); s.blendMode = 'add'; this.pool[k] = s; this.lights.addChild(s); }
    s.texture = tex; s.visible = true;
    return s;
  }

  // ambient: the darkness colour; lights: [{ kind: 'glow'|'cone', x, y (screen px), r (px), len, angle, color, alpha }]
  update({ w, h, ambient, lights, night, storm, time }) {
    const active = ambient !== 0xffffff || lights.length && night > 0.02;
    this.overlay.visible = active;
    const sky = this.sky.clear();
    if (!active) return;
    this.#ensureTarget(w, h);
    const k = this.scale;
    let n = 0;
    for (const L of lights) {
      const s = this.#sprite(n++, L.kind === 'cone' ? this.cone : this.glow);
      s.tint = L.color ?? 0xfff1d6;
      s.alpha = L.alpha ?? 1;
      if (L.kind === 'cone') {
        s.anchor.set(0, 0.5);
        s.position.set(L.x * k, L.y * k);
        s.width = L.len * k; s.height = L.len * (L.spread ?? 0.6) * k;
        s.rotation = L.angle;
      } else {
        s.anchor.set(0.5);
        s.position.set(L.x * k, L.y * k);
        s.width = s.height = L.r * 2 * k;
        s.rotation = 0;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].visible = false;
    this.renderer.render({ container: this.lights, target: this.rt, clear: true, clearColor: ambient });
    // Stars and a moon on clear nights.
    const vis = night * (1 - storm);
    if (vis > 0.02) {
      for (const st of this.stars) sky.circle(st.x * w, st.y * h, st.r).fill({ color: 0xfff6e0, alpha: vis * (0.5 + 0.4 * Math.sin(time * 1.5 + st.p)) });
      sky.circle(w * 0.78, h * 0.13, 26).fill({ color: 0xfdf3d8, alpha: vis * 0.95 });
      sky.circle(w * 0.78 + 9, h * 0.13 - 6, 22).fill({ color: 0x1d2440, alpha: vis * 0.25 });
      sky.circle(w * 0.78, h * 0.13, 60).fill({ color: 0xfdf3d8, alpha: vis * 0.06 });
    }
  }
}

// Ambient colour for a time of day (daylight 0..1) and storm intensity (0..1).
export function ambientColor(day, storm, flash) {
  const NIGHT = 0x222a48, DUSK = 0xf0a07a;
  let c;
  if (day >= 1) c = 0xffffff;
  else if (day > 0.5) c = mixColor(DUSK, 0xffffff, (day - 0.5) * 2);
  else c = mixColor(NIGHT, DUSK, day * 2);
  if (storm > 0) c = mixColor(c, mixColor(0x7d879c, NIGHT, 1 - day), storm * 0.75);
  if (flash > 0) c = mixColor(c, 0xffffff, flash);
  return c;
}
