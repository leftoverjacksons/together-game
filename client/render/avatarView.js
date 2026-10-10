import { Container, Graphics } from 'pixi.js';
import { PAL } from './palette.js';

// A rounded little traveller drawn in metres, feet at the origin, facing +x.
export class AvatarView {
  constructor(colorIndex) {
    const col = PAL.players[colorIndex % PAL.players.length];
    this.root = new Container();
    this.flip = new Container();
    this.root.addChild(this.flip);
    const limb = (color, w, len) => { const c = new Container(); c.addChild(new Graphics().roundRect(-w / 2, -len, w, len, w / 2).fill(color)); return c; };
    this.legB = limb(darken(col.pants), 0.15, 0.55); this.legB.position.set(-0.02, 0.58);
    this.legF = limb(col.pants, 0.15, 0.55); this.legF.position.set(0.04, 0.58);
    this.armB = limb(darken(col.shirt), 0.12, 0.48); this.armB.position.set(-0.04, 1.08);
    this.armF = limb(col.shirt, 0.12, 0.48); this.armF.position.set(0.06, 1.08);
    const shovel = new Graphics();
    shovel.rect(-0.025, -0.35, 0.05, 0.66).fill(0x8a6440);
    shovel.rect(-0.07, 0.28, 0.14, 0.05).fill(0x6e4f33);
    shovel.poly([-0.1, -0.35, 0.1, -0.35, 0.08, -0.55, 0, -0.6, -0.08, -0.55]).fill(0x9aa3a8);
    shovel.position.set(0, -0.44);
    this.shovel = shovel;
    this.armF.addChild(shovel);
    const body = new Graphics();
    body.roundRect(-0.36, 0.62, 0.26, 0.46, 0.08).fill(col.pack);            // backpack
    body.roundRect(-0.36, 0.95, 0.26, 0.08, 0.03).fill(darken(col.pack));
    body.roundRect(-0.21, 0.52, 0.44, 0.62, 0.17).fill(col.shirt);           // torso
    body.roundRect(-0.21, 0.52, 0.44, 0.12, 0.05).fill(darken(col.shirt));   // belt
    const head = new Graphics();
    head.circle(0.02, 1.36, 0.23).fill(PAL.skin);
    head.circle(0.17, 1.38, 0.035).fill(0x2d2420);                            // eye
    head.ellipse(0.19, 1.27, 0.05, 0.025).fill({ color: 0xd98c78, alpha: 0.6 }); // cheek
    head.roundRect(-0.23, 1.42, 0.5, 0.2, 0.1).fill(col.hat);                 // beanie
    head.rect(-0.23, 1.42, 0.5, 0.06).fill(darken(col.hat));
    head.circle(-0.05, 1.66, 0.06).fill(col.hat);
    head.circle(0.2, 1.47, 0.05).fill(0xfff2c4);                              // headlamp
    this.head = head;
    this.flip.addChild(this.legB, this.armB, body, this.legF, head, this.armF);
    this.shadow = new Graphics().ellipse(0, 0.02, 0.32, 0.06).fill({ color: 0x000000, alpha: 0.18 });
    this.root.addChildAt(this.shadow, 0);
  }

  // a: avatar state with world x,y already resolved; working: tool swing.
  update(a, time, { working = false, inside = false, seated = false, pushing = false } = {}) {
    this.root.position.set(a.x, a.y);
    this.root.rotation = a.rot || 0;
    this.flip.scale.x = a.facing < 0 ? -1 : 1;
    const moving = Math.abs(a.vx) > 0.2 && (a.onGround || inside);
    const ph = a.walkPhase * Math.PI;
    const swing = moving ? Math.sin(ph) * 0.7 : 0;
    this.legF.rotation = swing; this.legB.rotation = -swing;
    this.armF.rotation = -swing * 0.6; this.armB.rotation = swing * 0.6;
    this.shadow.visible = !inside && a.onGround;
    if (!a.onGround && !inside) { this.legF.rotation = 0.5; this.legB.rotation = -0.3; }
    if (seated) { this.legF.rotation = this.legB.rotation = 1.3; this.armF.rotation = this.armB.rotation = 1.2; }
    if (pushing) { this.armF.rotation = this.armB.rotation = 1.5; this.legF.rotation = -0.4; this.legB.rotation = 0.5; }
    if (working) this.armF.rotation = 0.6 + Math.sin(time * 14) * 0.6;
    this.shovel.visible = !inside;
    this.flip.y = moving ? Math.abs(Math.sin(ph)) * 0.04 : seated ? -0.3 : 0;
  }
}

function darken(c, k = 0.78) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}
