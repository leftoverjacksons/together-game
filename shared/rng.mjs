// Deterministic RNG and noise. Integer/arithmetic only (no trig), so results
// match across Node and every browser.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash1(i, seed) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(seed | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);

// 1D value noise in [0, 1).
export function noise1(x, seed) {
  const i = Math.floor(x);
  const t = smooth(x - i);
  const a = hash1(i, seed), b = hash1(i + 1, seed);
  return a + (b - a) * t;
}

// Fractal noise in roughly [-1, 1].
export function fbm1(x, seed, octaves = 4) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (noise1(x * freq, seed + o * 1013) * 2 - 1) * amp;
    norm += amp; amp *= 0.5; freq *= 2;
  }
  return sum / norm;
}
