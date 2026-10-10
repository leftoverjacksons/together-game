import { Container, Graphics } from 'pixi.js';
import { PAL } from './palette.js';
import { artSprite, hasArt } from '../assets.js';

const THICK = 0.12;

function plank(g, ax, ay, bx, by, tint) {
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len * THICK / 2, ny = dx / len * THICK / 2;
  g.poly([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]).fill(tint ?? PAL.wood);
  g.moveTo(ax + nx * 0.8, ay + ny * 0.8).lineTo(bx + nx * 0.8, by + ny * 0.8).stroke({ width: 0.02, color: PAL.woodLight, alpha: 0.8 });
  g.poly([ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, ax - nx, ay - ny]).stroke({ width: 0.018, color: PAL.woodDark });
}

// Stress colour: wood when relaxed, warming to red as it nears breaking.
function stressTint(u) {
  const t = Math.max(0, Math.min(1, (u - 0.3) / 0.7));
  const r = 0xc9 + (0xe0 - 0xc9) * t, gr = 0x97 + (0x4a - 0x97) * t, b = 0x66 + (0x3a - 0x66) * t;
  return (Math.round(r) << 16) | (Math.round(gr) << 8) | Math.round(b);
}

export class StructureView {
  constructor(parent) {
    this.root = new Container();
    this.boards = new Graphics();
    this.shaky = new Graphics();
    this.debris = new Graphics();
    this.ghost = new Graphics();
    this.boardArt = new Container();   // sprites when a 'board' art slot exists
    this.root.addChild(this.debris, this.boardArt, this.boards, this.shaky, this.ghost);
    parent.addChild(this.root);
    this.key = '';
  }

  // st: { j: [[id,x,y,anchor]], b: [[id,a,b,u,unstable]], d: [[id,x,y,angle]] }
  update(st, time, showStress) {
    if (!st) return;
    const joints = new Map(st.j.map(j => [j[0], j]));
    const key = st.b.map(b => `${b[0]}:${showStress ? Math.round(b[3] * 10) : 0}:${b[4]}`).join(',') + '|' + showStress;
    if (key !== this.key) {
      this.key = key;
      const g = this.boards.clear();
      for (const c of this.boardArt.removeChildren()) c.destroy();
      const useArt = hasArt('board');
      for (const [id, a, b, u, unstable] of st.b) {
        if (unstable) continue;
        const A = joints.get(a), B = joints.get(b);
        if (useArt) {
          const len = Math.hypot(B[1] - A[1], B[2] - A[2]);
          const sp = artSprite('board', id, { length: len });
          sp.position.set((A[1] + B[1]) / 2, (A[2] + B[2]) / 2);
          sp.rotation = Math.atan2(B[2] - A[2], B[1] - A[1]);
          if (showStress) sp.tint = stressTint(u);
          this.boardArt.addChild(sp);
        } else plank(g, A[1], A[2], B[1], B[2], showStress ? stressTint(u) : undefined);
      }
      for (const [, x, y, anchor] of st.j) {
        if (anchor) g.poly([x - 0.05, y + 0.02, x + 0.05, y + 0.02, x, y - 0.32]).fill(0x6e5038);   // stake
        g.circle(x, y, 0.05).fill(0x8d949a);                                                       // bolt
        g.circle(x, y, 0.022).fill(0x5d6266);
      }
    }
    // Shaky boards wobble and glow until braced.
    const s = this.shaky.clear();
    for (const [, a, b, , unstable] of st.b) {
      if (!unstable) continue;
      const A = joints.get(a), B = joints.get(b);
      const w = Math.sin(time * 30) * 0.03;
      plank(s, A[1], A[2], B[1] + w, B[2] + w, 0xe6a15a);
    }
    const d = this.debris.clear();
    for (const [, x, y, ang, len] of st.d) {
      const hx = Math.cos(ang) * len / 2, hy = Math.sin(ang) * len / 2;
      plank(d, x - hx, y - hy, x + hx, y + hy, 0xb98a5c);
    }
  }

  // Preview of a board being placed.
  drawGhost(a, b, ok, anchorA, anchorB) {
    const g = this.ghost.clear();
    if (!a) return;
    plank(g, a.x, a.y, b.x, b.y, ok ? 0xf3e2b8 : 0xd06a50);
    g.alpha = 0.7;
    for (const [p, anc] of [[a, anchorA], [b, anchorB]]) if (anc) g.circle(p.x, p.y, 0.14).stroke({ width: 0.04, color: 0x8fd18a });
  }
}
