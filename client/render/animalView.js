import { Container, Graphics } from 'pixi.js';
import { PIXEL } from '../pixel/mode.js';
import { collieSheet, pixelSprite } from '../pixel/textures.js';
import { artSprite } from '../assets.js';

// Animals drawn in metres, facing +x, feet at the origin. Art slots
// animal.<kind> replace the drawn body (legs are then not animated).

const Q = {   // quadrupeds
  // Border collie: black with a white ruff, blaze, socks and tail tip.
  dog:   { len: 0.74, h: 0.42, leg: 0.36, body: 0x2a2523, belly: 0xf3efe6, head: 0.15, ear: 'tipped', tail: 'bush', tip: 0xf3efe6, collie: true, collar: 0xc2563f },
  fox:   { len: 0.62, h: 0.34, leg: 0.3, body: 0xd9722e, belly: 0xf6eadb, head: 0.13, ear: 'point', tail: 'bush', tip: 0xf6eadb },
  deer:  { len: 1.15, h: 0.95, leg: 0.8, body: 0xa26f43, belly: 0xe5cfae, head: 0.17, ear: 'long', tail: 'flag', neck: 0.5 },
  moose: { len: 1.9, h: 1.45, leg: 1.1, body: 0x5b3f2b, belly: 0x7b5a40, head: 0.27, ear: 'long', tail: 'stub', neck: 0.35, antler: 0xc9a876, hump: true },
  bear:  { len: 1.55, h: 0.85, leg: 0.55, body: 0x5a3a26, belly: 0x6e4a32, head: 0.26, ear: 'round', tail: 'stub', muzzle: 0xa27a58 },
};

function legShape(w, len, color, sock) {
  const c = new Container();
  const g = new Graphics().roundRect(-w / 2, -len, w, len, w / 2).fill(color);
  if (sock) g.roundRect(-w / 2, -len, w, len * 0.3, w / 2).fill(sock);
  c.addChild(g);
  return c;
}

function darken(c, k = 0.8) {
  const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
  return (Math.round(r * k) << 16) | (Math.round(g * k) << 8) | Math.round(b * k);
}

export class AnimalView {
  constructor(kind) {
    this.kind = kind;
    this.root = new Container();
    this.flip = new Container();
    this.scene = new Graphics();      // rescue scene behind (brambles, mud, wire...)
    this.front = new Graphics();      // rescue scene in front (trap jaws, wire over legs)
    this.fx = new Graphics();         // progress ring, call-out, bark lines
    this.root.addChild(this.scene, this.flip, this.front, this.fx);
    this.legs = [];
    const art = artSprite('animal.' + kind);
    if (PIXEL.on && kind === 'dog') {
      // Pixel mode: the hand-made collie sprite.
      this.dogSheet = collieSheet();
      this.pixDog = pixelSprite(this.dogSheet.idle[0], 0.45, 1);
      this.flip.addChild(this.pixDog);
      this.bodyH = 0.45;
    } else if (art) this.flip.addChild(art);
    else if (Q[kind]) this.#quadruped(Q[kind]);
    else this.#small(kind);
  }

  #quadruped(p) {
    const body = new Graphics(), head = new Container(), hg = new Graphics();
    const { len, h, leg } = p;
    const legW = len * 0.11;
    const backColor = darken(p.body, 0.78);
    // Far legs (shaded), then body, then near legs.
    for (const [x, near] of [[len * 0.32, false], [-len * 0.32, false], [len * 0.36, true], [-len * 0.28, true]]) {
      const l = legShape(legW, leg, near ? p.body : backColor, p.collie ? (near ? 0xf3efe6 : 0xd8d2c6) : null);
      l.position.set(x, leg);
      this.legs.push({ l, phase: (x > 0 ? 0 : Math.PI) + (near ? Math.PI : 0) });
    }
    for (const L of this.legs.slice(0, 2)) this.flip.addChild(L.l);
    // Tail.
    if (p.tail === 'bush') body.ellipse(-len * 0.62, h + 0.02, len * 0.26, len * 0.09).fill(p.body).ellipse(-len * 0.82, h + 0.0, len * 0.08, len * 0.06).fill(p.tip);
    if (p.tail === 'up') body.poly([-len * 0.45, h + 0.06, -len * 0.62, h + 0.32, -len * 0.55, h + 0.33, -len * 0.4, h + 0.12]).fill(p.body);
    if (p.tail === 'flag') body.ellipse(-len * 0.5, h + 0.12, 0.06, 0.1).fill(0xf6eadb);
    if (p.tail === 'stub') body.circle(-len * 0.5, h + 0.08, 0.06).fill(p.body);
    body.ellipse(0, h + 0.05, len * 0.5, h * 0.32 + 0.04).fill(p.body);
    body.ellipse(0.02, h - 0.04, len * 0.4, h * 0.18).fill(p.belly);
    body.ellipse(-len * 0.05, h + h * 0.22, len * 0.38, h * 0.1).fill({ color: 0xffe6b8, alpha: 0.18 });   // warm top light
    if (p.hump) body.ellipse(len * 0.18, h + h * 0.36, len * 0.22, h * 0.16).fill(p.body);
    if (p.collie) {
      body.ellipse(len * 0.36, h + 0.02, len * 0.16, h * 0.32).fill(p.belly);         // white chest and ruff
      body.ellipse(len * 0.4, h + h * 0.28, len * 0.1, h * 0.2).fill(p.belly);
    }
    this.flip.addChild(body);
    for (const L of this.legs.slice(2)) this.flip.addChild(L.l);
    // Head on a neck.
    const nx = len * 0.46, ny = h + (p.neck || 0.12);
    if (p.neck) body.poly([len * 0.3, h + 0.1, len * 0.42, h - 0.05, nx + 0.06, ny - 0.05, nx - 0.08, ny + 0.06]).fill(p.body);
    const r = p.head;
    hg.ellipse(0, 0, r * 1.05, r * 0.85).fill(p.body);
    hg.ellipse(r * 0.95, -r * 0.18, r * 0.62, r * 0.42).fill(p.muzzle || p.body);
    hg.circle(r * 1.5, -r * 0.12, r * 0.13).fill(0x2d2420);               // nose
    hg.circle(r * 0.35, r * 0.18, r * 0.11).fill(0x2d2420);               // eye
    hg.circle(r * 0.39, r * 0.22, r * 0.04).fill(0xffffff);
    if (p.ear === 'flop') hg.ellipse(-r * 0.35, -r * 0.05, r * 0.28, r * 0.55).fill(darken(p.body, 0.75));
    if (p.ear === 'tipped') hg.poly([-r * 0.55, r * 0.45, -r * 0.3, r * 1.15, -r * 0.05, r * 1.2, r * 0.1, r * 0.95, -r * 0.05, r * 0.5]).fill(p.body);
    if (p.collie) {
      hg.poly([r * 0.05, r * 0.85, r * 0.3, r * 0.85, r * 1.2, -r * 0.05, r * 0.7, -r * 0.35]).fill(p.belly);   // blaze down to the muzzle
      hg.ellipse(r * 1.0, -r * 0.3, r * 0.5, r * 0.28).fill(p.belly);
      hg.circle(r * 1.5, -r * 0.12, r * 0.13).fill(0x2d2420);
      hg.circle(r * 0.35, r * 0.18, r * 0.11).fill(0x6b4a2a).circle(r * 0.39, r * 0.22, r * 0.04).fill(0xffffff);
    }
    if (p.ear === 'point') hg.poly([-r * 0.5, r * 0.5, -r * 0.1, r * 1.35, r * 0.15, r * 0.55]).fill(p.body).poly([-r * 0.35, r * 0.6, -r * 0.1, r * 1.1, r * 0.05, r * 0.62]).fill(0x2d2420);
    if (p.ear === 'long') hg.ellipse(-r * 0.45, r * 0.7, r * 0.18, r * 0.42).fill(p.body);
    if (p.ear === 'round') hg.circle(-r * 0.45, r * 0.75, r * 0.3).fill(p.body).circle(-r * 0.45, r * 0.75, r * 0.15).fill(darken(p.body, 0.7));
    if (p.antler) {
      hg.poly([-r * 0.2, r * 0.7, -r * 1.6, r * 1.4, -r * 2.0, r * 2.3, -r * 1.2, r * 1.9, -r * 0.9, r * 2.5, -r * 0.4, r * 1.6, 0, r * 0.75]).fill(p.antler);
    }
    if (p.collar) hg.roundRect(-r * 0.9, -r * 0.95, r * 0.5, r * 0.3, 0.02).fill(p.collar);
    head.addChild(hg);
    head.position.set(nx, ny);
    this.head = head;
    this.flip.addChild(head);
    this.bodyH = h;
  }

  #small(kind) {
    const g = new Graphics();
    if (kind === 'rabbit') {
      g.ellipse(0, 0.14, 0.17, 0.13).fill(0xb8a48e).ellipse(-0.15, 0.12, 0.06, 0.05).fill(0xfaf4ea);
      g.ellipse(0.13, 0.24, 0.09, 0.08).fill(0xb8a48e);
      g.ellipse(0.08, 0.42, 0.03, 0.12).ellipse(0.13, 0.41, 0.03, 0.12).fill(0xb8a48e);
      g.circle(0.17, 0.26, 0.016).fill(0x2d2420).circle(0.22, 0.23, 0.015).fill(0xd98c78);
      this.bodyH = 0.2;
    } else if (kind === 'chipmunk') {
      g.ellipse(0, 0.07, 0.09, 0.06).fill(0xb27a46);
      g.poly([-0.06, 0.08, -0.16, 0.2, -0.12, 0.24, -0.04, 0.12]).fill(0x8f5f35);
      g.rect(-0.07, 0.09, 0.12, 0.012).rect(-0.07, 0.065, 0.12, 0.012).fill(0x3b2a1c);
      g.circle(0.08, 0.1, 0.045).fill(0xb27a46).circle(0.1, 0.11, 0.01).fill(0x2d2420);
      this.bodyH = 0.1;
    } else if (kind === 'songbird') {
      this.wings = new Graphics().ellipse(-0.02, 0.1, 0.07, 0.03).fill(0x3d6f9a);
      g.ellipse(0, 0.08, 0.07, 0.05).fill(0x5b8fbf).ellipse(0.02, 0.06, 0.05, 0.03).fill(0xf2a65a);
      g.circle(0.06, 0.12, 0.035).fill(0x5b8fbf).poly([0.09, 0.12, 0.13, 0.115, 0.09, 0.105]).fill(0xe8a33c).circle(0.07, 0.13, 0.008).fill(0x2d2420);
      g.poly([-0.06, 0.08, -0.12, 0.1, -0.11, 0.06]).fill(0x3d6f9a);
      this.bodyH = 0.1;
    } else if (kind === 'hawk') {
      this.wings = new Graphics().poly([-0.05, 0.38, -0.25, 0.75, 0.15, 0.42]).fill(0x7a5a3c).poly([-0.05, 0.38, -0.15, 0.62, 0.05, 0.42]).fill(0xb08a5c);
      g.ellipse(0, 0.32, 0.2, 0.12).fill(0x8a6a48).ellipse(0.02, 0.27, 0.13, 0.07).fill(0xe8dcc6);
      g.circle(0.18, 0.43, 0.09).fill(0x8a6a48).poly([0.25, 0.45, 0.32, 0.41, 0.25, 0.38]).fill(0xe8b53c).circle(0.2, 0.46, 0.017).fill(0x2d2420);
      g.poly([-0.18, 0.33, -0.36, 0.38, -0.34, 0.26]).fill(0x7a5a3c);
      g.rect(0.0, 0.08, 0.025, 0.14).rect(0.06, 0.08, 0.025, 0.14).fill(0xe8b53c);
      this.bodyH = 0.4;
    }
    if (this.wings) this.flip.addChild(this.wings);
    this.flip.addChild(g);
  }

  #drawScene(a, def, groundY) {
    const s = this.scene.clear(), f = this.front.clear();
    if (a.state !== 'waiting') return;
    if (a.kind === 'songbird' || a.kind === 'fox') {
      // Brambles / a snare stake.
      if (a.kind === 'songbird') {
        for (let k = 0; k < 7; k++) s.ellipse((k - 3) * 0.12, 0.15 + (k % 2) * 0.08, 0.16, 0.12);
        s.fill(0x3f6b3a);
        for (let k = 0; k < 9; k++) s.circle((k - 4) * 0.08, 0.22 + Math.sin(k * 2.1) * 0.08, 0.025);
        s.fill(0xb8344a);
        for (let k = 0; k < 5; k++) f.moveTo((k - 2) * 0.1, 0.02).lineTo((k - 2) * 0.1 + 0.15, 0.3).stroke({ width: 0.012, color: 0x2e4a2a });
      } else {
        s.rect(-0.45, 0, 0.04, 0.4).fill(0x6e5038);
        f.moveTo(-0.43, 0.3).quadraticCurveTo(-0.1, 0.05, 0.2, 0.06).stroke({ width: 0.015, color: 0x9aa3a8 });
        f.circle(0.2, 0.06, 0.05).stroke({ width: 0.015, color: 0x9aa3a8 });
      }
    } else if (a.kind === 'deer') {
      s.rect(-0.9, 0, 0.08, 1.1).rect(0.9, 0, 0.08, 1.1).fill(0x7a5a40);
      for (const y of [0.35, 0.65]) f.moveTo(-0.86, y).quadraticCurveTo(0, y - 0.25, 0.94, y + 0.05);
      f.stroke({ width: 0.018, color: 0x8d949a });
    } else if (a.kind === 'moose') {
      s.ellipse(0, 0.08, 1.5, 0.3).fill(0x5c4433);
      f.ellipse(0, 0.12, 1.3, 0.25).fill({ color: 0x6b4f3a, alpha: 0.95 });
      f.ellipse(-0.3, 0.2, 0.25, 0.06).fill({ color: 0x8a6a50, alpha: 0.6 });
    } else if (a.kind === 'bear') {
      f.poly([0.4, 0, 0.5, 0.16, 0.56, 0.02, 0.62, 0.16, 0.68, 0.02, 0.74, 0.16, 0.84, 0]).stroke({ width: 0.03, color: 0x6f777c });
      f.rect(0.36, -0.02, 0.5, 0.05).fill(0x5d6266);
    } else if (a.kind === 'rabbit') {
      // Only the ears poke out of the collapsed burrow.
      const top = groundY - a.y;
      if (top > 0.35) f.ellipse(0.06, top + 0.08, 0.035, 0.12).ellipse(0.13, top + 0.07, 0.035, 0.12).fill(0xb8a48e);
    } else if (a.kind === 'hawk') {
      // Injured: drooping wing.
      f.poly([0.0, 0.32, -0.3, 0.05, 0.1, 0.25]).fill(0x7a5a3c);
    }
  }

  // a: interpolated animal; groundY: current ground at a.x (for buried animals).
  update(a, time, def, { groundY, near }) {
    this.root.position.set(a.x, a.y);
    this.flip.scale.x = a.f < 0 ? -1 : 1;
    const flying = a.kind === 'hawk' && (a.state === 'following' || a.help);
    const buried = a.state === 'waiting' && def.rescue === 'dig';
    this.flip.visible = !buried;
    if (this.kind === 'moose' && a.state === 'waiting') this.flip.y = -0.45; else this.flip.y = 0;
    // Legs and hops.
    const ph = time * (a.help ? 9 : 7);
    for (const L of this.legs) L.l.rotation = a.moving || a.help ? Math.sin(ph + L.phase) * 0.55 : 0;
    if (a.help && this.legs.length && this.kind !== 'deer') for (const L of this.legs.slice(2)) L.l.rotation = 0.9;   // braced, pushing
    if (this.kind === 'rabbit' && a.moving) this.flip.y = Math.abs(Math.sin(time * 9)) * 0.15;
    if (this.wings) {
      const flap = flying || (a.kind === 'songbird' && a.moving) ? Math.sin(time * (a.help ? 22 : 12)) : 0;
      this.wings.scale.y = flying ? 0.4 + Math.abs(flap) : 1;
      this.wings.rotation = flap * 0.3;
    }
    if (this.head) this.head.rotation = a.state === 'waiting' ? -0.25 + Math.sin(time * 1.3) * 0.05 : a.moving ? Math.sin(time * 7) * 0.05 : 0;
    if (this.pixDog) {
      const sitting = a.state === 'riding-dog' || a.state === 'riding' || (a.state === 'waiting' && !a.moving);
      this.pixDog.texture = a.moving ? this.dogSheet.run[Math.floor(time * 12) % 4] : sitting && a.state !== 'waiting' ? this.dogSheet.sit[0] : this.dogSheet.idle[Math.floor(time * 3) % 2];
    }
    this.#drawScene(a, def, groundY);
    // Call-out, progress ring, bark lines.
    const fx = this.fx.clear();
    const top = (this.bodyH || 0.4) * (this.kind === 'moose' || this.kind === 'deer' ? 2.1 : 1.6) + 0.35;
    if (a.state === 'waiting' && near) {
      const bob = Math.sin(time * 3) * 0.05;
      fx.circle(0, top + 0.12 + bob, 0.17).fill({ color: 0xfff6e2, alpha: 0.95 });
      fx.rect(-0.022, top + 0.12 + bob - 0.02, 0.044, 0.13).circle(0, top + 0.06 + bob - 0.04, 0.026).fill(0xc2563f);
      if (a.p > 0) fx.arc(0, top + 0.12 + bob, 0.24, Math.PI / 2, Math.PI / 2 - a.p * Math.PI * 2, true).stroke({ width: 0.05, color: 0x3f8f88 });
    }
    if (a.barking) for (let k = 1; k <= 3; k++) fx.arc(0.55 * (a.f < 0 ? -1 : 1), 0.62, 0.08 * k, -0.6, 0.6).stroke({ width: 0.02, color: 0xfff6e2, alpha: 1 - k * 0.25 });
  }
}
