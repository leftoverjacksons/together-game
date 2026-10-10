import { Graphics } from 'pixi.js';

// Small world-space particles: dirt, wood chips, sawdust, wheel dust.
export class Particles {
  constructor(parent) {
    this.g = new Graphics();
    parent.addChild(this.g);
    this.list = [];
  }

  burst(x, y, kind, n = 6, dir = 0) {
    const style = {
      dirt: { colors: [0x7d5336, 0x8f603d, 0x5c3c29], size: [0.04, 0.09], speed: 3.2, life: 0.9, grav: 14 },
      chips: { colors: [0xe0bb89, 0xc99766, 0xf0d6a8], size: [0.03, 0.07], speed: 3.8, life: 1.1, grav: 12 },
      sawdust: { colors: [0xf0d6a8, 0xe8c99a], size: [0.015, 0.035], speed: 1.4, life: 0.8, grav: 4 },
      dust: { colors: [0xd9bf98, 0xcfb08a], size: [0.12, 0.3], speed: 0.9, life: 1.2, grav: -0.4, fade: true },
      leaves: { colors: [0x6e9a4f, 0x8fbf6a, 0xc9a24a], size: [0.05, 0.09], speed: 2.5, life: 2.2, grav: 2.2, flutter: true },
    }[kind];
    for (let k = 0; k < n && this.list.length < 400; k++) {
      const a = Math.PI / 2 + (Math.random() - 0.5) * 2.2 + dir;
      const v = style.speed * (0.4 + Math.random() * 0.8);
      this.list.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: style.life * (0.6 + Math.random() * 0.6),
        r: style.size[0] + Math.random() * (style.size[1] - style.size[0]), c: style.colors[k % style.colors.length],
        grav: style.grav, fade: style.fade, flutter: style.flutter, ph: Math.random() * 6,
      });
    }
  }

  update(dt, ground) {
    const g = this.g.clear();
    this.list = this.list.filter(p => (p.age += dt) < p.life);
    for (const p of this.list) {
      p.vy -= p.grav * dt;
      if (p.flutter) { p.vx += Math.sin(p.age * 6 + p.ph) * dt * 3; p.vy = Math.max(p.vy, -1.2); }
      p.x += p.vx * dt; p.y += p.vy * dt;
      const gy = ground(p.x);
      if (p.y < gy) { p.y = gy; p.vy = 0; p.vx *= 0.6; }
      const t = p.age / p.life;
      const alpha = p.fade ? 0.35 * (1 - t) : t > 0.7 ? (1 - t) / 0.3 : 1;
      g.circle(p.x, p.y, p.r * (p.fade ? 1 + t * 1.5 : 1)).fill({ color: p.c, alpha });
    }
  }
}
