import { Texture, Sprite } from 'pixi.js';
import { travellerFrames, collieFrames, wheelFrames, travellerHand, colorOf, PLAYER_COLORS, PPM } from './sprites.js';

// Pixi textures for the hand-made sprites, built once from their pixel rows.

function frameTexture(rows, player) {
  const h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    const col = colorOf(ch, player);
    if (col === null || col === undefined) return;
    const o = (y * w + x) * 4;
    img.data[o] = col >> 16; img.data[o + 1] = (col >> 8) & 255; img.data[o + 2] = col & 255; img.data[o + 3] = 255;
  }));
  g.putImageData(img, 0, 0);
  const t = Texture.from(c);
  t.source.scaleMode = 'nearest';
  return t;
}

const cache = new Map();
function sheet(key, make, player) {
  if (!cache.has(key)) {
    const out = {};
    for (const [name, frames] of Object.entries(make())) out[name] = frames.map(f => frameTexture(f, player));
    cache.set(key, out);
  }
  return cache.get(key);
}

export const travellerSheet = i => sheet('traveller' + (i % 2), travellerFrames, PLAYER_COLORS[i % 2]);
export const collieSheet = () => sheet('collie', collieFrames);
export const wheelSheet = () => sheet('wheel', wheelFrames);
export { travellerHand };

// A sprite in world metres (y up), anchored at (ax, ay) of the image.
export function pixelSprite(texture, ax = 0.5, ay = 1) {
  const s = new Sprite(texture);
  s.anchor.set(ax, ay);
  s.scale.set(1 / PPM, -1 / PPM);
  return s;
}
