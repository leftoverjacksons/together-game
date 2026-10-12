// Writes an enlarged sheet of the hand-made pixel sprites to a PNG, for checking
// them without running the game: node scripts/pixel-preview.mjs out.png [scale]
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { travellerFrames, collieFrames, wheelFrames, colorOf, PLAYER_COLORS } from '../client/pixel/sprites.js';

const [out = 'pixel-preview.png', scaleArg = '8'] = process.argv.slice(2);
const S = +scaleArg;
const rowsOfSprites = [
  ...PLAYER_COLORS.map(p => ({ frames: Object.values(travellerFrames()).flat(), player: p })),
  { frames: Object.values(collieFrames()).flat() },
  { frames: Object.values(wheelFrames()).flat() },
];
const gap = 3;
const W = Math.max(...rowsOfSprites.map(r => r.frames.reduce((s, f) => s + f[0].length + gap, gap)));
const H = rowsOfSprites.reduce((s, r) => s + r.frames[0].length + gap, gap);
const img = new Uint8Array(W * S * H * S * 4);
const put = (x, y, rgb) => {
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const o = ((y * S + j) * W * S + x * S + i) * 4;
    img[o] = rgb >> 16; img[o + 1] = (rgb >> 8) & 255; img[o + 2] = rgb & 255; img[o + 3] = 255;
  }
};
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, ((x + y) & 1) ? 0xe9dfcc : 0xf4ecdc);
let oy = gap;
for (const r of rowsOfSprites) {
  let ox = gap;
  for (const f of r.frames) {
    f.forEach((row, y) => [...row].forEach((ch, x) => { const c = colorOf(ch, r.player); if (c !== null && c !== undefined) put(ox + x, oy + y, c); }));
    ox += f[0].length + gap;
  }
  oy += r.frames[0].length + gap;
}
// Minimal PNG encoder.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
const w = W * S, h = H * S;
const raw = Buffer.alloc((w * 4 + 1) * h);
for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(img.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${w}×${h})`);
