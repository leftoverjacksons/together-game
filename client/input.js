// Keyboard and mouse state, with per-frame "pressed" edges.
export class Input {
  constructor(target) {
    this.down = new Set();
    this.pressed = new Set();
    this.mouse = { x: 0, y: 0, left: false, right: false, inside: false };
    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (!this.down.has(k)) this.pressed.add(k);
      this.down.add(k);
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'tab'].includes(k)) e.preventDefault();
    });
    addEventListener('keyup', e => this.down.delete(e.key.toLowerCase()));
    addEventListener('blur', () => { this.down.clear(); this.mouse.left = this.mouse.right = false; });
    target.addEventListener('pointermove', e => { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; });
    target.addEventListener('pointerleave', () => { this.mouse.inside = false; });
    target.addEventListener('pointerdown', e => { if (e.button === 0) this.mouse.left = true; if (e.button === 2) this.mouse.right = true; });
    addEventListener('pointerup', e => { if (e.button === 0) this.mouse.left = false; if (e.button === 2) this.mouse.right = false; });
    target.addEventListener('contextmenu', e => e.preventDefault());
    this.wheel = 0;
    target.addEventListener('wheel', e => { this.wheel += e.deltaY; e.preventDefault(); }, { passive: false });
  }
  held(...keys) { return keys.some(k => this.down.has(k)); }
  hit(...keys) { return keys.some(k => this.pressed.has(k)); }
  endFrame() { this.pressed.clear(); }
}
