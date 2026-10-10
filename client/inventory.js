import { Container } from 'pixi.js';
import { TOOL_NAMES, TOOLS, TOOLBOX_SIZE } from '../shared/constants.mjs';
import { toolGraphic } from './render/toolArt.js';

// Renders each tool's in-game graphic (or its art slot) to a small image.
export async function makeToolIcons(renderer) {
  const icons = {};
  for (const kind of TOOLS) {
    // Extraction ignores the target's own transform, so scale an inner container.
    const c = new Container(), inner = new Container();
    const g = toolGraphic(kind);
    g.rotation = -Math.PI / 4;
    inner.addChild(g);
    inner.scale.set(90, -90);
    c.addChild(inner);
    try { icons[kind] = await renderer.extract.base64({ target: c, resolution: 1 }); } catch { icons[kind] = ''; }
    c.destroy({ children: true });
  }
  return icons;
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The inventory panel (Tab): your pack, the camper's storage, the roof rack,
// and your partner's pack.
export class InventoryPanel {
  constructor(el, actions) {
    this.el = el;
    this.actions = actions;      // { select(i), store(i), drop(i), retrieve(i), give(), stowBoards(), takeBoards() }
    this.icons = {};
    this.open = false;
    this.key = '';
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      const i = Number(b.dataset.i);
      const fn = this.actions[b.dataset.act];
      if (fn) fn(i);
    });
    el.addEventListener('contextmenu', e => e.preventDefault());
  }

  toggle(force) {
    this.open = force ?? !this.open;
    this.el.hidden = !this.open;
    this.key = '';
  }

  #tile(kind, { act, i, selected, disabled, key }) {
    const name = kind ? TOOL_NAMES[kind] : 'Empty';
    const img = kind && this.icons[kind] ? `<img src="${this.icons[kind]}" alt="">` : '';
    return `<button class="tile${selected ? ' on' : ''}${kind ? '' : ' empty'}" data-act="${act}" data-i="${i}" ${disabled || !kind && act !== 'select' ? 'disabled' : ''}>${img}<span>${name}</span>${key ? `<i>${key}</i>` : ''}</button>`;
  }

  // s: { tools, selected, storage, near, boards, boardCap, rack, partner: { name, tools, near } | null }
  update(s) {
    if (!this.open) return;
    const key = JSON.stringify(s) + Object.keys(this.icons).length;
    if (key === this.key) return;
    this.key = key;
    const pack = s.tools.map((k, i) => `<div class="slot">${this.#tile(k, { act: 'select', i, selected: i === s.selected, key: i + 1 })}
      <div class="slot-actions"><button data-act="store" data-i="${i}" ${!k || !s.near || s.storage.length >= TOOLBOX_SIZE ? 'disabled' : ''}>Stow</button><button data-act="drop" data-i="${i}" ${!k ? 'disabled' : ''}>Drop</button></div></div>`).join('');
    const storage = Array.from({ length: TOOLBOX_SIZE }, (_, i) => this.#tile(s.storage[i] || null, { act: 'retrieve', i, disabled: !s.near }));
    const partner = s.partner ? `<section><h3>${esc(s.partner.name)}'s pack</h3><div class="tiles">${s.partner.tools.map(k => this.#tile(k, { act: 'none', i: 0, disabled: true })).join('')}</div>
      <button data-act="give" ${s.partner.near && s.tools[s.selected] && s.partner.tools.includes(null) ? '' : 'disabled'}>Hand over your ${s.tools[s.selected] ? TOOL_NAMES[s.tools[s.selected]].toLowerCase() : 'tool'}</button>
      ${s.partner.near ? '' : '<p class="hint">Stand next to them to hand things over.</p>'}</section>` : '';
    this.el.innerHTML = `
      <header><h2>Inventory</h2><button data-act="close">Close (Tab)</button></header>
      <div class="inv-body">
        <section><h3>Your pack</h3><div class="tiles pack">${pack}</div>
          <p>Boards on your back: ${s.boards}/${s.boardCap} <button data-act="stowBoards" ${s.near && s.boards ? '' : 'disabled'}>Stow on the rack</button></p></section>
        <section><h3>Camper storage</h3><div class="tiles grid">${storage.join('')}</div>
          <p>Roof rack: ${s.rack.boards} boards · ${s.rack.logs} logs <button data-act="takeBoards" ${s.near && s.rack.boards && s.boards < s.boardCap ? '' : 'disabled'}>Take boards</button></p>
          <p class="hint">${s.near ? 'Click a tool to take it. If your pack is full, it swaps with the tool in your hand.' : 'Get inside or close to the camper to use its storage.'}</p></section>
        ${partner}
      </div>`;
  }
}

