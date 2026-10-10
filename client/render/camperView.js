import { Container, Graphics } from 'pixi.js';
import { CAMPER } from '../../shared/sim.mjs';
import { INTERIOR } from '../../shared/constants.mjs';
import { PAL } from './palette.js';
import { artSprite } from '../assets.js';

// The camper as a dollhouse cross-section: the near wall is cut away so the
// interior and both travellers stay visible while driving.
export class CamperView {
  constructor(parent) {
    this.root = new Container();
    this.arms = new Graphics();
    this.wheels = CAMPER.wheelX.map(() => this.#wheel());
    this.body = new Container();
    this.back = new Container();     // interior back wall and furniture
    this.interior = new Container(); // travellers inside are added here
    this.front = new Container();    // frame, roof, bumper drawn over travellers
    this.glow = new Graphics();
    this.rack = new Graphics();
    this.body.addChild(this.back, this.interior, this.front, this.rack, this.glow);
    this.rackKey = '';
    this.root.addChild(this.body, this.arms, ...this.wheels);
    parent.addChild(this.root);
    this.#drawBody();
  }

  #wheel() {
    const c = new Container();
    const art = artSprite('camper.wheel');
    if (art) { c.addChild(art); return c; }
    const g = new Graphics();
    const R = CAMPER.wheelR;
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      g.poly([ca * R * 0.86 - sa * 0.09, sa * R * 0.86 + ca * 0.09, ca * R * 1.04 - sa * 0.07, sa * R * 1.04 + ca * 0.07, ca * R * 1.04 + sa * 0.07, sa * R * 1.04 - ca * 0.07, ca * R * 0.86 + sa * 0.09, sa * R * 0.86 - ca * 0.09]);
    }
    g.fill(PAL.tire);
    g.circle(0, 0, R * 0.95).fill(PAL.tire);
    g.circle(0, 0, R * 0.82).stroke({ width: 0.04, color: 0x463f3d });
    g.circle(0, 0, R * 0.5).fill(PAL.rim);
    g.circle(0, 0, R * 0.5).stroke({ width: 0.05, color: 0xb0a48c });
    for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.circle(Math.cos(a) * R * 0.3, Math.sin(a) * R * 0.3, 0.045); }
    g.fill(0x8d826d);
    g.circle(0, 0, 0.09).fill(0x6e6555);
    // Highlight arc from the warm key light.
    g.arc(0, 0, R * 0.92, 1.9, 2.9).stroke({ width: 0.05, color: 0xffe2b0, alpha: 0.35 });
    c.addChild(g);
    return c;
  }

  #drawBody() {
    // Art slots camper.back / camper.front replace the drawn versions when present.
    const backArt = artSprite('camper.back'), frontArt = artSprite('camper.front');
    if (backArt) this.back.addChild(backArt);
    if (frontArt) this.front.addChild(frontArt);
    const b = new Graphics(), f = new Graphics();
    if (!backArt) this.back.addChild(b);
    if (!frontArt) this.front.addChild(f);
    const floor = INTERIOR.floorY;
    // Interior back wall (warm wood) inside the hull.
    b.poly([-2.85, -0.5, 2.6, -0.5, 3.2, 0.22, 2.95, 1.7, -3.05, 1.7, -3.15, -0.05]).fill(PAL.wood);
    for (let y = floor + 0.35; y < 1.7; y += 0.32) b.moveTo(-3.05, y).lineTo(2.2, y);
    b.stroke({ width: 0.025, color: PAL.woodDark, alpha: 0.5 });
    // Rear window with a view, curtains.
    b.roundRect(-1.6, 0.55, 1.3, 0.75, 0.12).fill(PAL.glass);
    b.roundRect(-1.6, 0.55, 1.3, 0.75, 0.12).stroke({ width: 0.06, color: PAL.woodDark });
    b.poly([-1.6, 1.3, -1.25, 1.3, -1.45, 0.6, -1.6, 0.6]).fill(0xd9785f);
    b.poly([-0.3, 1.3, -0.65, 1.3, -0.45, 0.6, -0.3, 0.6]).fill(0xd9785f);
    // Bunk with blanket at the rear.
    b.rect(-3.05, floor, 1.1, 0.5).fill(PAL.woodDark);
    b.roundRect(-3.0, floor + 0.45, 1.05, 0.2, 0.08).fill(0x5f8fb0);
    b.roundRect(-2.95, floor + 0.55, 0.35, 0.16, 0.07).fill(0xf3ead8);
    // Kitchen counter and shelf.
    b.rect(-0.3, floor, 0.8, 0.75).fill(PAL.woodDark);
    b.rect(-0.35, floor + 0.72, 0.9, 0.08).fill(PAL.woodLight);
    b.rect(-0.2, floor + 0.15, 0.28, 0.45).stroke({ width: 0.03, color: 0x7d5534 });
    b.rect(0.14, floor + 0.15, 0.28, 0.45).stroke({ width: 0.03, color: 0x7d5534 });
    b.rect(-0.3, 1.25, 0.8, 0.06).fill(PAL.woodLight);
    b.circle(-0.1, 1.42, 0.11).fill(0xc2563f);
    b.rect(0.12, 1.31, 0.14, 0.24).fill(0x6c9a5b);
    b.rect(0.32, 1.31, 0.16, 0.18).fill(0xe8c66a);
    // Cab: dashboard and steering wheel.
    b.poly([2.35, floor + 0.55, 3.15, floor + 0.55, 3.1, floor + 0.95, 2.55, floor + 0.85]).fill(0x5a4a3c);
    b.rect(1.7, floor, 0.55, 0.45).fill(0x7d4f3a);                // seat base
    b.roundRect(1.6, floor + 0.4, 0.18, 0.75, 0.08).fill(0x7d4f3a); // seat back
    b.moveTo(2.55, floor + 0.85).lineTo(2.4, floor + 1.15).stroke({ width: 0.06, color: 0x3a3030 });
    b.ellipse(2.38, floor + 1.18, 0.07, 0.24).stroke({ width: 0.06, color: 0x3a3030 });
    // Windshield.
    b.poly([2.6, 0.35, 3.22, 0.3, 3.03, 1.55, 2.6, 1.55]).fill({ color: PAL.glass, alpha: 0.85 });
    // Floor.
    b.rect(-3.05, floor - 0.27, 6.2, 0.27).fill(PAL.woodDark);
    b.moveTo(-3.05, floor).lineTo(3.0, floor).stroke({ width: 0.05, color: PAL.woodLight });
    // Toolbox chest and winch control panel (stations).
    const tb = INTERIOR.toolboxX;
    b.roundRect(tb - 0.32, floor, 0.64, 0.38, 0.05).fill(0x9b4a37);
    b.rect(tb - 0.32, floor + 0.3, 0.64, 0.06).fill(0x7c3a2b);
    b.rect(tb - 0.06, floor + 0.2, 0.12, 0.08).fill(0xd8b25a);
    const wx = INTERIOR.winchX;
    b.roundRect(wx - 0.18, floor + 0.55, 0.36, 0.5, 0.05).fill(0x4a5258);
    b.circle(wx - 0.07, floor + 0.92, 0.04).fill(0x8fd18a).circle(wx + 0.07, floor + 0.92, 0.04).fill(0xe0704e);
    b.moveTo(wx, floor + 0.65).lineTo(wx + 0.12, floor + 0.85).stroke({ width: 0.04, color: 0x2e3438, cap: 'round' });
    b.circle(wx + 0.12, floor + 0.85, 0.045).fill(0xc2563f);
    // Door frame at the rear.
    b.roundRect(INTERIOR.doorX - 0.35, floor, 0.7, 1.75, 0.1).stroke({ width: 0.06, color: PAL.woodDark });
    b.circle(INTERIOR.doorX + 0.24, floor + 0.85, 0.04).fill(0xd8b25a);

    // Frame drawn over the interior: roof, pillars, underbody, cut edge.
    const hull = CAMPER.hull.flat();
    f.poly(hull).stroke({ width: 0.16, color: PAL.body, join: 'round' });
    f.poly(hull).stroke({ width: 0.03, color: PAL.outline, alpha: 0.6, join: 'round' });
    f.roundRect(-3.3, 1.75, 6.45, 0.28, 0.12).fill(PAL.body);                 // roof
    f.rect(-3.3, 1.9, 6.45, 0.06).fill(PAL.stripe);
    for (let x = -2.9; x <= 2.5; x += 0.9) f.rect(x, 2.03, 0.08, 0.22).fill(0x4a4440);
    f.rect(-3.0, 2.2, 5.6, 0.06).fill(0x4a4440);                              // roof rack
    f.rect(3.0, -0.3, 0.06, 2.3).fill(0x4a4440);                              // ladder to the rack
    for (let y = -0.1; y < 1.9; y += 0.32) f.rect(3.0, y, 0.22, 0.04).fill(0x4a4440);
    f.poly([-2.95, -0.62, 2.65, -0.62, 2.82, -0.42, -3.12, -0.42]).fill(PAL.bodyShade); // underbody skirt
    f.rect(-2.9, -0.56, 5.6, 0.08).fill(PAL.stripe);
    f.rect(-3.32, -0.05, 0.18, 1.9).fill(PAL.body);                           // rear pillar
    f.rect(2.42, -0.55, 0.16, 2.4).fill(PAL.body);                            // B pillar
    f.roundRect(3.05, -0.2, 0.42, 0.36, 0.08).fill(0x5a5450);                 // bumper / winch mount
    f.roundRect(3.12, -0.14, 0.28, 0.2, 0.06).fill(0x3e3a38);                 // winch drum
    for (let k = 0; k < 4; k++) f.rect(3.16 + k * 0.06, -0.12, 0.02, 0.16).fill({ color: 0x8a8580, alpha: 0.6 });
    f.circle(3.32, 0.5, 0.13).fill(PAL.lamp);                                 // headlight
    f.rect(-3.42, 0.25, 0.14, 0.25).fill(0xd24b3f);                           // taillight
  }

  // Lumber on the roof rack: board stacks at the back, logs at the front.
  setRack(rack) {
    const key = rack.boards + ':' + rack.logs.join(',');
    if (key === this.rackKey) return;
    this.rackKey = key;
    const g = this.rack.clear();
    const layers = Math.ceil(rack.boards / 3);
    for (let k = 0; k < layers; k++) {
      const y = 2.26 + k * 0.075;
      g.roundRect(-3.0 + (k % 2) * 0.06, y, 2.7, 0.07, 0.02).fill(k % 2 ? PAL.woodLight : PAL.wood);
      g.roundRect(-3.0 + (k % 2) * 0.06, y, 2.7, 0.07, 0.02).stroke({ width: 0.012, color: PAL.woodDark });
    }
    if (layers) g.rect(-2.1, 2.24, 0.05, layers * 0.075 + 0.04).rect(-0.9, 2.24, 0.05, layers * 0.075 + 0.04).fill(0xc2563f); // straps
    rack.logs.forEach((len, k) => {
      const L = Math.min(len, 3.6), cx = 0.95, y = 2.47 + k * 0.4;
      g.roundRect(cx - L / 2, y - 0.2, L, 0.4, 0.18).fill(k % 2 ? 0x6e4a31 : 0x7a5236);
      g.ellipse(cx + L / 2, y, 0.09, 0.2).fill(0xe0bb89);
    });
  }

  // camper: interpolated {x, y, a, w: [x, y, a, x, y, a]}
  update(c, time) {
    this.root.position.set(0, 0);
    this.body.position.set(c.x, c.y);
    this.body.rotation = c.a;
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    this.arms.clear();
    for (let k = 0; k < this.wheels.length; k++) {
      const wx = c.w[k * 3], wy = c.w[k * 3 + 1];
      this.wheels[k].position.set(wx, wy);
      this.wheels[k].rotation = c.w[k * 3 + 2];
      const ax = c.x + CAMPER.wheelX[k] * ca - (-0.55) * sa, ay = c.y + CAMPER.wheelX[k] * sa + (-0.55) * ca;
      this.arms.moveTo(ax, ay).lineTo(wx, wy);
    }
    this.arms.stroke({ width: 0.16, color: 0x3d3633 });
    // Lantern flicker.
    const flick = 0.85 + 0.1 * Math.sin(time * 9.3) + 0.05 * Math.sin(time * 23.1);
    this.glow.clear().circle(-0.9, 1.45, 0.09).fill(PAL.lamp).circle(-0.9, 1.45, 0.6).fill({ color: PAL.lamp, alpha: 0.12 * flick }).circle(-0.9, 1.45, 1.2).fill({ color: PAL.lamp, alpha: 0.06 * flick });
  }
}
