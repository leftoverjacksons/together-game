// Hand-made pixel sprites for the pixel-art test (docs/ART.md §7.2), written
// as data and small drawing routines rather than image files. Everything is
// 16 px per metre, faces right, feet (or wheel centre) at the anchor.
//
// Each sprite is a list of frames; a frame is an array of strings, one
// character per pixel, looked up in a palette ('.' is transparent). The same
// frames feed the game (as textures) and scripts/pixel-preview.mjs (as PNGs).

export const PPM = 16;

// Base palette: warm, earthy, no pure black (docs/ART.md §1).
export const COLORS = {
  o: 0x3a2a20,   // outline, dark brown
  e: 0x2d2420,   // eye
  s: 0xf0c4a0, S: 0xd49c7c,          // skin
  l: 0xfff3c4,   // headlamp
  b: 0x5a3e2b, B: 0x43301f,          // boots
  // Traveller colours are filled per player (h H c C p P k K).
  // Collie
  d: 0x2a2523, g: 0x48413c, w: 0xf3efe6, W: 0xcfc6b6, n: 0x1a1614, r: 0xc2563f, y: 0xc9a26b, t: 0xe08a86,
  // Wheel
  T: 0x2f2a2a, G: 0x463f3d, L: 0x5d5552, R: 0xd8ccb2, Q: 0xb0a48c, X: 0x8d826d,
};

export const PLAYER_COLORS = [
  { h: 0xf2b84b, H: 0xc98f2e, c: 0xe07a5f, C: 0xb55a44, p: 0x4b5d7a, P: 0x36445c, k: 0x7a8f4e, K: 0x5b6d38 },
  { h: 0xd8574a, H: 0xa83f36, c: 0x3d8b8b, C: 0x2c6a6a, p: 0x6b4f3a, P: 0x4f3a2a, k: 0xc28a45, K: 0x94672f },
];

// ----- A tiny pixel canvas -----

class Grid {
  constructor(w, h) { this.w = w; this.h = h; this.px = Array.from({ length: h }, () => Array(w).fill('.')); }
  set(x, y, c) { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.px[y][x] = c; }
  rect(x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, c); }
  stamp(rows, ox, oy) { rows.forEach((r, y) => [...r].forEach((c, x) => { if (c !== '.') this.set(ox + x, oy + y, c); })); }
  // A line `width` pixels wide (thickened to the right).
  line(x0, y0, x1, y1, c, width = 1) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let k = 0; k <= n; k++) {
      const x = x0 + (x1 - x0) * k / n, y = y0 + (y1 - y0) * k / n;
      for (let d = 0; d < width; d++) this.set(x + d, y, c);
    }
  }
  ellipse(cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) this.set(x, y, c);
    }
  }
  // Dark-brown outline around everything drawn so far, on transparent neighbours only.
  outline(c = 'o', skip = '') {
    const out = [];
    for (let y = 0; y < this.h; y++) for (let x = 0; x < this.w; x++) {
      if (this.px[y][x] !== '.') continue;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const q = this.px[y + dy]?.[x + dx]; return q && q !== '.' && q !== c && !skip.includes(q); });
      if (n) out.push([x, y]);
    }
    for (const [x, y] of out) this.px[y][x] = c;
    return this;
  }
  rows() { return this.px.map(r => r.join('')); }
}

// ----- Travellers (16 × 28) -----

const HEAD = [
  '.......oo.......',
  '.....oohhoo.....',
  '....ohhhhhho....',
  '...ohhhhhhhho...',
  '...oHHHHHHHlo...',
  '...osssssssso...',
  '...osssssseso...',
  '...ossssssssso..',
  '....oSsssSoo....',
];

// pose: { legs: [[footDx, lift], [footDx, lift]] (front, back), arm: [dx, dy] hand offset from the shoulder, backArm, bob, sit }
function traveller(pose) {
  const g = new Grid(16, 28);
  const bob = pose.bob || 0;
  const hipY = 19 + bob, hipX = 7;
  // Back arm and back leg first, in the darker shades.
  const shoulder = [9, 11 + bob];
  const [bdx, bdy] = pose.backArm || [-pose.arm[0] * 0.5, 6];
  g.line(shoulder[0] - 1, shoulder[1], shoulder[0] - 1 + bdx, shoulder[1] + bdy, 'C', 2);
  g.set(shoulder[0] - 1 + bdx, shoulder[1] + bdy + 1, 'S');
  const leg = ([dx, lift], col, x0) => {
    if (pose.sit) {
      g.line(x0, hipY, x0 + 5, hipY + 1, col, 2);
      g.rect(x0 + 5, hipY + 1, x0 + 6, hipY + 4, col === 'p' ? 'p' : 'P');
      g.rect(x0 + 5, hipY + 5, x0 + 7, hipY + 6, col === 'p' ? 'b' : 'B');
      return;
    }
    const footY = 27 - lift;
    const fx = x0 + dx;
    g.line(x0, hipY, fx, footY - 2, col, 2);
    g.rect(fx, footY - 1, fx + 2, footY, col === 'p' ? 'b' : 'B');
  };
  leg(pose.legs[1], 'P', hipX - 1);
  // Backpack.
  g.rect(2, 10 + bob, 5, 17 + bob, 'k');
  g.rect(2, 17 + bob, 5, 17 + bob, 'K');
  g.rect(5, 11 + bob, 5, 16 + bob, 'K');
  g.rect(3, 11 + bob, 4, 11 + bob, 'K');
  // Torso.
  g.rect(6, 9 + bob, 10, 18 + bob, 'c');
  g.rect(10, 10 + bob, 10, 18 + bob, 'C');
  g.rect(6, 18 + bob, 10, 18 + bob, 'C');
  g.set(7, 9 + bob, 's'); g.set(8, 9 + bob, 's');
  leg(pose.legs[0], 'p', hipX);
  g.stamp(HEAD, 0, bob);
  // Front arm with hand.
  const [adx, ady] = pose.arm;
  g.line(shoulder[0], shoulder[1], shoulder[0] + adx, shoulder[1] + ady, 'c', 2);
  g.set(shoulder[0] + adx, shoulder[1] + ady + (ady >= 0 ? 1 : -1), 's');
  g.set(shoulder[0] + adx + 1, shoulder[1] + ady + (ady >= 0 ? 1 : -1), 's');
  return g.outline('o', 'S').rows();
}

const cyc = (k, n) => Math.cos((k / n) * Math.PI * 2), syc = (k, n) => Math.sin((k / n) * Math.PI * 2);

export function travellerFrames() {
  const F = {};
  F.idle = [0, 1].map(k => traveller({ legs: [[1, 0], [-1, 0]], arm: [0, 6], bob: k }));
  F.walk = [0, 1, 2, 3, 4, 5].map(k => {
    const c = cyc(k, 6), s = syc(k, 6);
    return traveller({
      legs: [[Math.round(3 * c), s > 0.3 ? Math.round(2 * s) : 0], [Math.round(-3 * c), s < -0.3 ? Math.round(-2 * s) : 0]],
      arm: [Math.round(-2.5 * c), 6], backArm: [Math.round(2 * c), 6], bob: k % 3 === 1 ? -1 : 0,
    });
  });
  F.work = [[3, -4], [5, -1], [5, 2], [3, 5]].map(arm => traveller({ legs: [[2, 0], [-2, 0]], arm, bob: arm[1] > 3 ? 1 : 0 }));
  F.air = [traveller({ legs: [[2, 2], [-2, 1]], arm: [3, -3], backArm: [-2, -2] })];
  F.sit = [traveller({ legs: [[0, 0], [0, 0]], arm: [4, 2], sit: true, bob: 0 })];
  F.push = [traveller({ legs: [[-2, 0], [-4, 0]], arm: [5, 0], backArm: [4, 1] })];
  F.carry = [traveller({ legs: [[1, 0], [-1, 0]], arm: [1, -8], backArm: [0, -8] })];
  return F;
}

// Where the hand is in each frame (pixels from the sprite's top-left), for tools.
export function travellerHand(frame, k) {
  const arms = { idle: [[9, 17], [9, 18]], walk: null, work: [[12, 7], [14, 10], [14, 13], [12, 16]], air: [[12, 8]], sit: [[13, 13]], push: [[14, 11]], carry: [[10, 3]] };
  if (frame === 'walk') return [9 + Math.round(-2.5 * cyc(k, 6)), 17 + (k % 3 === 1 ? -1 : 0)];
  return (arms[frame] || arms.idle)[k] || arms.idle[0];
}

// ----- Border collie (22 × 13) -----

function collie({ legs, tail = 0, sit = false, bob = 0, mouth = false }) {
  const g = new Grid(22, 13);
  const by = 5 + bob;
  // Tail: a bushy plume with a white tip, swishing.
  const tx = 1, ty = sit ? 8 : 3 + tail;
  g.line(5, by, tx + 1, ty, 'd', 2);
  g.line(tx + 1, ty, tx, ty + 1, 'w', 2);
  // Legs (back pair darker).
  const legAt = (x, dx, col, sock) => {
    const top = by + 2, foot = 11;
    g.line(x, top, x + dx, foot - 1, col, 1);
    g.set(x + dx, foot, sock ? 'w' : col);
    if (sock) g.set(x + dx, foot - 1, 'w');
  };
  if (sit) {
    g.ellipse(7, 9, 3, 2.2, 'd');                 // haunch on the ground
    g.rect(5, 11, 9, 11, 'd');
    g.set(9, 11, 'w'); g.set(8, 11, 'w');
    g.ellipse(10, 6, 3.5, 3.2, 'd');              // upright body
    legAt(12, 0, 'd', true); legAt(13, 0, 'd', true);
  } else {
    legAt(6, legs[2], 'g', false); legAt(13, legs[3], 'g', true);
    g.ellipse(9.5, by + 0.5, 5.5, 2.4, 'd');
    g.rect(6, by - 2, 12, by - 2, 'g');           // light catching the back
    legAt(7, legs[0], 'd', false); legAt(14, legs[1], 'd', true);
  }
  // White chest and collar.
  const cx = sit ? 12 : 14, cy = sit ? 5 : by;
  g.ellipse(cx, cy + 1, 1.6, 2, 'w');
  g.set(cx - 1, cy + 2, 'W');
  // Head.
  const hx = sit ? 13 : 15, hy = sit ? 0 : by - 5;
  g.ellipse(hx + 2, hy + 3, 2.6, 2.3, 'd');
  g.set(hx + 1, hy, 'd'); g.set(hx + 2, hy + 1, 'd');            // folded ear
  g.set(hx + 1, hy + 1, 'g');
  g.rect(hx + 3, hy + 1, hx + 3, hy + 4, 'w');                    // blaze
  g.rect(hx + 3, hy + 4, hx + 5, hy + 5, 'w');                    // muzzle
  g.set(hx + 5, hy + 3, 'w'); g.set(hx + 6, hy + 4, 'n');          // nose
  g.set(hx + 2, hy + 2, 'y');                                     // eye
  if (mouth) g.set(hx + 5, hy + 6, 't');
  g.set(hx + 1, hy + 5, 'r'); g.set(hx + 2, hy + 5, 'r');          // collar
  return g.outline('o', 'w').rows();
}

export function collieFrames() {
  const F = {};
  F.idle = [-1, 1].map(t => collie({ legs: [0, 0, 0, 0], tail: t, mouth: true }));
  F.run = [0, 1, 2, 3].map(k => {
    const c = Math.round(2 * cyc(k, 4));
    return collie({ legs: [c, -c, -c, c], tail: -1, bob: k % 2 ? -1 : 0, mouth: true });
  });
  F.sit = [collie({ legs: [0, 0, 0, 0], sit: true, mouth: true })];
  return F;
}

// ----- Camper wheel (23 × 23, centre at 11.5, 11.5) -----

export function wheelFrames() {
  const g = new Grid(23, 23);
  const c = 11;
  for (let y = 0; y < 23; y++) for (let x = 0; x < 23; x++) {
    const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
    const a = Math.atan2(dy, dx);
    if (d > 11.4) continue;
    const knob = Math.floor(((a + Math.PI) / (Math.PI * 2)) * 14) % 2;
    if (d > 10.4 && knob) continue;                         // knobbly tread
    let col = 'T';
    if (d > 7.6 && d < 8.6) col = 'G';                       // sidewall groove
    if (d > 9 && d < 10.4 && a < -1.6 && a > -2.9) col = 'L'; // glint from the upper left
    if (d <= 5.6) col = d > 4.7 ? 'Q' : 'R';                 // hub
    g.set(x, y, col);
  }
  for (let k = 0; k < 5; k++) { const a = (k / 5) * Math.PI * 2; g.set(c + Math.round(Math.cos(a) * 3), c + Math.round(Math.sin(a) * 3), 'X'); }
  g.set(c, c, 'X');
  return { idle: [g.rows()] };
}

// Colour lookup for one character in a sprite, with optional player colours.
export function colorOf(ch, player) {
  if (ch === '.') return null;
  if (player && player[ch] !== undefined) return player[ch];
  return COLORS[ch];
}

// The fixed palette for the optional palette snap: every sprite colour, both
// players' colours, and the main landscape colours.
export function snapPalette(PAL) {
  const set = new Set([...Object.values(COLORS), ...PLAYER_COLORS.flatMap(p => Object.values(p))]);
  for (const c of [PAL.skyTop, PAL.skyMid, PAL.skyLow, PAL.far, PAL.farHaze, PAL.mid, PAL.midTrees, PAL.near, PAL.nearTrees, PAL.trunk, PAL.fore,
    PAL.grass, PAL.grassLight, PAL.grassDark, PAL.dirtRim, ...PAL.soil, PAL.rock, PAL.rockDark, PAL.body, PAL.bodyShade, PAL.stripe, PAL.stripeDark,
    PAL.wood, PAL.woodDark, PAL.woodLight, PAL.glass, PAL.lamp, 0x222a48, 0x4a5578, 0xfff6e0,
    0x8fc0d4, 0xb3d3da, 0xcfdcd2, 0xe8d6b8, 0xf6c99c, 0xfbe7c6, 0xd9b4b8, 0xa98fa6, 0x6f8f72, 0x9db08a]) set.add(c);   // sky and haze steps
  return [...set];
}
