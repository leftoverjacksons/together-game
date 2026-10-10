import { Assets, Sprite, TilingSprite } from 'pixi.js';

// Art slots. public/assets/manifest.json maps slot keys to image files:
//
//   "camper.front": { "file": "camper-front.png", "anchor": [0.5, 0.5], "at": [0, 0.6] }
//   "tree.pine":    [ { "file": "pine-1.png", "anchor": [0.5, 1], "height": 8 }, ... ]
//
// anchor: Pixi anchor in the image (0..1, y down); at: offset in metres from
// the slot's origin (y up); ppm: image pixels per metre (defaults to the
// manifest's); height/length: the size in metres the image was drawn at, so it
// can be scaled to fit (trees by height, logs and boards by length).
// A slot without a file falls back to the code-drawn art. See docs/ART.md.

const art = { ppm: 128, slots: new Map(), textures: new Map() };

export async function loadArt(base = '/assets/') {
  let manifest;
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return;
    manifest = await r.json();
  } catch { return; }
  art.ppm = manifest.ppm || 128;
  const entries = Object.entries(manifest.slots || {});
  await Promise.all(entries.map(async ([key, value]) => {
    const variants = (Array.isArray(value) ? value : [value]).filter(v => v && typeof v.file === 'string' && /^[\w./-]+\.(png|webp|jpg|svg)$/i.test(v.file) && !v.file.includes('..'));
    const loaded = [];
    for (const v of variants) {
      try { loaded.push({ ...v, texture: await Assets.load(base + v.file) }); } catch { console.warn('Missing art', v.file); }
    }
    if (loaded.length) art.slots.set(key, loaded);
  }));
}

export function hasArt(key) { return art.slots.has(key); }

export function slotInfo(key, variant = 0) {
  const list = art.slots.get(key);
  return list ? list[Math.abs(variant | 0) % list.length] : null;
}

// A sprite for a slot in world space (metres, y up), or null if there is no art.
// fit: { height } or { length } in metres to scale the image to.
export function artSprite(key, variant = 0, fit = {}) {
  const v = slotInfo(key, variant);
  if (!v) return null;
  const s = new Sprite(v.texture);
  const [ax, ay] = v.anchor || [0.5, 0.5];
  s.anchor.set(ax, ay);
  let k = 1 / (v.ppm || art.ppm), kx = k, ky = k;
  if (fit.height && v.height) { kx *= fit.height / v.height; ky *= fit.height / v.height; }
  if (fit.length && v.length) kx *= fit.length / v.length;
  s.scale.set(kx, -ky);
  if (v.at) s.position.set(v.at[0], v.at[1]);
  return s;
}

// A horizontally repeating strip for background layers.
export function artStrip(key, widthMetres) {
  const v = slotInfo(key);
  if (!v) return null;
  const k = 1 / (v.ppm || art.ppm);
  const t = new TilingSprite({ texture: v.texture, width: widthMetres / k, height: v.texture.height });
  const [ax, ay] = v.anchor || [0, 1];
  t.anchor.set(ax, ay);
  t.scale.set(k, -k);
  if (v.at) t.position.set(v.at[0], v.at[1]);
  return t;
}
