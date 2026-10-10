import { Container, Graphics } from 'pixi.js';
import { PAL } from './palette.js';
import { artSprite } from '../assets.js';

// A rounded little traveller drawn in metres, feet at the origin, facing +x.
export class AvatarView {
  constructor(colorIndex) {
    const col = PAL.players[colorIndex % PAL.players.length];
    this.root = new Container();
    this.flip = new Container();
    this.root.addChild(this.flip);
    // Art slots traveller<N>.leg / .arm / .torso / .head replace the drawn parts.
    // Limbs pivot at the hip or shoulder and hang down; the back limb is shaded.
    const part = key => artSprite(`traveller${colorIndex % 2}.${key}`);
    const limb = (key, color, w, len, back) => {
      const c = new Container();
      const art = part(key);
      if (art) { if (back) art.tint = 0xc8c8c8; c.addChild(art); } else c.addChild(new Graphics().roundRect(-w / 2, -len, w, len, w / 2).fill(color));
      return c;
    };
    this.legB = limb('leg', darken(col.pants), 0.15, 0.55, true); this.legB.position.set(-0.02, 0.58);
    this.legF = limb('leg', col.pants, 0.15, 0.55); this.legF.position.set(0.04, 0.58);
    this.armB = limb('arm', darken(col.shirt), 0.12, 0.48, true); this.armB.position.set(-0.04, 1.08);
    this.armF = limb('arm', col.shirt, 0.12, 0.48); this.armF.position.set(0.06, 1.08);
    // Hand tools, held at the end of the front arm; one visible at a time.
    const handle = 0x8a6440, steel = 0x9aa3a8;
    const shovel = new Graphics()
      .rect(-0.025, -0.35, 0.05, 0.66).fill(handle).rect(-0.07, 0.28, 0.14, 0.05).fill(0x6e4f33)
      .poly([-0.1, -0.35, 0.1, -0.35, 0.08, -0.55, 0, -0.6, -0.08, -0.55]).fill(steel);
    const axe = new Graphics()
      .rect(-0.025, -0.45, 0.05, 0.6).fill(handle)
      .poly([0.02, -0.45, 0.2, -0.52, 0.22, -0.32, 0.02, -0.36]).fill(steel).poly([0.18, -0.52, 0.22, -0.52, 0.24, -0.32, 0.2, -0.32]).fill(0xd7dde0);
    const saw = new Graphics()
      .roundRect(-0.06, -0.08, 0.12, 0.16, 0.04).fill(0xa8523a)
      .poly([-0.04, -0.08, 0.04, -0.08, 0.06, -0.62, -0.02, -0.62]).fill(steel);
    for (let y = -0.12; y > -0.6; y -= 0.06) saw.poly([-0.04 - (y + 0.08) * 0.04, y, -0.08 - (y + 0.08) * 0.04, y - 0.03, -0.04 - (y + 0.08) * 0.04, y - 0.06]);
    saw.fill(steel);
    const hammer = new Graphics()
      .rect(-0.022, -0.36, 0.044, 0.44).fill(handle)
      .roundRect(-0.12, -0.44, 0.24, 0.1, 0.02).fill(0x6f777c);
    this.tools = { shovel, axe, saw, hammer };
    for (const g of Object.values(this.tools)) { g.position.set(0, -0.44); this.armF.addChild(g); }
    this.shovel = shovel;
    const torsoArt = part('torso'), headArt = part('head');
    const body = new Container();
    if (torsoArt) body.addChild(torsoArt);
    const bodyG = new Graphics();
    if (!torsoArt) body.addChild(bodyG);
    bodyG.roundRect(-0.36, 0.62, 0.26, 0.46, 0.08).fill(col.pack);            // backpack
    bodyG.roundRect(-0.36, 0.95, 0.26, 0.08, 0.03).fill(darken(col.pack));
    bodyG.roundRect(-0.21, 0.52, 0.44, 0.62, 0.17).fill(col.shirt);           // torso
    bodyG.roundRect(-0.21, 0.52, 0.44, 0.12, 0.05).fill(darken(col.shirt));   // belt
    const head = new Container();
    if (headArt) head.addChild(headArt);
    const headG = new Graphics();
    if (!headArt) head.addChild(headG);
    headG.circle(0.02, 1.36, 0.23).fill(PAL.skin);
    headG.circle(0.17, 1.38, 0.035).fill(0x2d2420);                            // eye
    headG.ellipse(0.19, 1.27, 0.05, 0.025).fill({ color: 0xd98c78, alpha: 0.6 }); // cheek
    headG.roundRect(-0.23, 1.42, 0.5, 0.2, 0.1).fill(col.hat);                 // beanie
    headG.rect(-0.23, 1.42, 0.5, 0.06).fill(darken(col.hat));
    headG.circle(-0.05, 1.66, 0.06).fill(col.hat);
    headG.circle(0.2, 1.47, 0.05).fill(0xfff2c4);                              // headlamp
    this.head = head;
    this.boardsOnBack = new Graphics();
    this.flip.addChild(this.boardsOnBack, this.legB, this.armB, body, this.legF, head, this.armF);
    this.shownBoards = 0;
    this.shadow = new Graphics().ellipse(0, 0.02, 0.32, 0.06).fill({ color: 0x000000, alpha: 0.18 });
    this.root.addChildAt(this.shadow, 0);
  }

  // a: avatar state with world x,y already resolved; working: tool swing.
  update(a, time, { working = false, inside = false, seated = false, pushing = false, tool = 'shovel', boards = 0, carrying = false } = {}) {
    this.root.position.set(a.x, a.y);
    const forest = !inside && a.lane === 1;
    this.root.scale.set(forest ? 0.9 : 1);
    this.root.tint = forest ? 0xc9d2bf : 0xffffff;   // a little shade among the trees
    if (boards !== this.shownBoards) {
      const g = this.boardsOnBack.clear();
      for (let k = 0; k < boards; k++) g.roundRect(-0.42 - k * 0.035, 0.45 + k * 0.02, 0.07, 1.0, 0.02).fill(k % 2 ? PAL.woodLight : PAL.wood);
      this.shownBoards = boards;
    }
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
    if (carrying) { this.armF.rotation = this.armB.rotation = 2.4; }
    if (working) {
      const sw = tool === 'axe' ? Math.max(0, Math.sin(time * 9)) * 2.2 - 0.2 : tool === 'saw' ? 1.3 + Math.sin(time * 16) * 0.35 : tool === 'hammer' ? 1.2 + Math.sin(time * 12) * 0.7 : 0.6 + Math.sin(time * 14) * 0.6;
      this.armF.rotation = sw;
    }
    for (const [name, g] of Object.entries(this.tools)) g.visible = !inside && !carrying && name === tool;
    this.flip.y = moving ? Math.abs(Math.sin(ph)) * 0.04 : seated ? -0.3 : 0;
  }
}

function darken(c, k = 0.78) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}
