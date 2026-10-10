import { Container, Graphics } from 'pixi.js';
import { toolGraphic } from './toolArt.js';

// Tools lying on the ground, with a gentle glint so they are noticed.
export class ItemsView {
  constructor(parent) {
    this.root = new Container();
    parent.addChild(this.root);
    this.views = new Map();
  }

  update(items, time) {
    const seen = new Set();
    for (const it of items) {
      seen.add(it.id);
      let v = this.views.get(it.id);
      if (!v) {
        const c = new Container();
        const tool = toolGraphic(it.kind);
        tool.rotation = Math.PI / 2;     // lying on its side
        tool.position.set(-0.25, 0.08);
        const glint = new Graphics().circle(0, 0, 0.06).fill({ color: 0xfff6d0, alpha: 0.9 });
        c.addChild(tool, glint);
        this.root.addChild(c);
        v = { c, glint };
        this.views.set(it.id, v);
      }
      v.c.position.set(it.x, it.y);
      const t = (time * 0.8 + it.id * 0.37) % 2.5;
      v.glint.alpha = t < 0.4 ? Math.sin((t / 0.4) * Math.PI) : 0;
      v.glint.position.set(0.15 * Math.cos(it.id), 0.25);
    }
    for (const [id, v] of this.views) if (!seen.has(id)) { v.c.destroy({ children: true }); this.views.delete(id); }
  }
}
