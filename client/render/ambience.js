import { Container, Graphics } from 'pixi.js';
import { mulberry32 } from '../../shared/rng.mjs';

// Signs of life: drifting pollen in the light, butterflies near the ground,
// and birds crossing the distant sky.
export class Ambience {
  constructor(screenLayer, worldLayer, seed) {
    this.rand = mulberry32(seed ^ 0x51ed);
    this.pollen = new Graphics();
    this.birds = new Graphics();
    screenLayer.addChild(this.birds, this.pollen);
    this.motes = Array.from({ length: 70 }, () => ({ x: this.rand(), y: this.rand(), s: 0.6 + this.rand() * 1.6, p: this.rand() * 10, d: 0.2 + this.rand() * 0.8 }));
    this.flock = Array.from({ length: 5 }, (_, k) => ({ x: -0.2 - k * 0.04 - this.rand() * 0.03, y: 0.18 + (k % 2) * 0.025 + this.rand() * 0.02, p: this.rand() * 6 }));
    this.butterflyLayer = new Container();
    worldLayer.addChild(this.butterflyLayer);
    this.butterflies = Array.from({ length: 5 }, (_, k) => {
      const g = new Graphics();
      const col = [0xf4d35e, 0xf2a65a, 0xffffff, 0xb8d8f2, 0xf28fad][k];
      g.ellipse(-0.07, 0.04, 0.07, 0.05).ellipse(0.07, 0.04, 0.07, 0.05).fill(col);
      g.ellipse(-0.05, -0.03, 0.045, 0.035).ellipse(0.05, -0.03, 0.045, 0.035).fill(col);
      g.rect(-0.01, -0.06, 0.02, 0.12).fill(0x3b2f2a);
      this.butterflyLayer.addChild(g);
      return { g, ox: (this.rand() - 0.5) * 30, oy: 0.6 + this.rand() * 1.5, p: this.rand() * 10, speed: 0.4 + this.rand() * 0.5 };
    });
  }

  update(dt, time, w, h, camX, ground, { day = 1, storm = 0 } = {}) {
    // Birds and butterflies keep to daylight and fair weather; pollen fades in the rain.
    const fair = day * (1 - storm);
    this.birds.alpha = fair;
    this.butterflyLayer.visible = fair > 0.3;
    this.pollen.alpha = 1 - storm;
    const g = this.pollen.clear();
    for (const m of this.motes) {
      m.x += dt * 0.006 * m.d; m.y -= dt * 0.004 * m.d;
      if (m.x > 1.05) m.x -= 1.1; if (m.y < -0.05) m.y += 1.1;
      const px = ((m.x - camX * 0.0006 * m.d) % 1 + 1) % 1;
      const tw = 0.35 + 0.35 * Math.sin(time * 1.3 + m.p);
      g.circle(px * w + Math.sin(time * 0.7 + m.p) * 8, m.y * h, m.s).fill({ color: 0xfff0c0, alpha: tw * 0.7 });
    }
    const b = this.birds.clear();
    for (const f of this.flock) {
      f.x += dt * 0.012;
      if (f.x > 1.3) { f.x = -0.3 - this.rand() * 0.6; f.y = 0.1 + this.rand() * 0.2; }
      const flap = Math.sin(time * 7 + f.p) * 4;
      const x = f.x * w, y = f.y * h;
      b.moveTo(x - 7, y - flap).quadraticCurveTo(x - 3, y - 2, x, y).quadraticCurveTo(x + 3, y - 2, x + 7, y - flap);
    }
    b.stroke({ width: 1.6, color: 0x5d4b4b, alpha: 0.55 });
    for (const bf of this.butterflies) {
      if (bf.x === undefined) bf.x = camX + bf.ox;
      if (Math.abs(bf.x - camX) > 30) bf.x = camX - Math.sign(bf.x - camX) * (20 + this.rand() * 8);
      const x = bf.x + Math.sin(time * bf.speed + bf.p) * 3;
      const gy = ground(x);
      bf.g.position.set(x, gy + bf.oy + Math.sin(time * 1.7 + bf.p) * 0.35);
      bf.g.scale.x = 0.35 + 0.65 * Math.abs(Math.sin(time * 16 + bf.p));
    }
  }
}
