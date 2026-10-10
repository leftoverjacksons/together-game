import { CELL } from './constants.mjs';
import { mulberry32 } from './rng.mjs';

// The forest lane sits just behind the road. Its floor follows the generated
// ground, smoothed so ravines become gentle dips, and is never edited.

export const FOREST_RISE = 0.85;     // forest floor sits slightly above the road surface
export const LOG_THICKNESS = 0.42;

export function forestFloor(terrain) {
  const n = terrain.nx, s = terrain.surface;
  const smooth = (src, half) => {
    const out = new Float32Array(n);
    let sum = 0, count = 0;
    for (let i = -half; i < n; i++) {
      const add = i + half, rem = i - half - 1;
      if (add < n) { sum += src[add]; count++; }
      if (rem >= 0) { sum -= src[rem]; count--; }
      if (i >= 0) out[i] = sum / count;
    }
    return out;
  };
  const wide = smooth(s, Math.round(5 / CELL));
  const top = new Float32Array(n);
  for (let i = 0; i < n; i++) top[i] = Math.max(s[i], wide[i]);
  const floor = smooth(top, Math.round(1.2 / CELL));
  for (let i = 0; i < n; i++) floor[i] += FOREST_RISE;
  return floor;
}

export function floorAt(floor, x) {
  const f = Math.max(0, Math.min(floor.length - 1.001, x / CELL));
  const i = Math.floor(f), t = f - i;
  return floor[i] + (floor[i + 1] - floor[i]) * t;
}

// Trees stand in the forest lane, spaced irregularly, thinning at the camps.
export function generateTrees(terrain, seed) {
  const rand = mulberry32(seed ^ 0x7ee5);
  const trees = [];
  let id = 0;
  for (let x = 6 + rand() * 4; x < terrain.length - 6; x += 2.5 + rand() * 6.5) {
    if (x > 14 && x < 34) continue;               // clearing at the start camp
    const kind = rand() < 0.6 ? 'pine' : 'oak';
    const height = kind === 'pine' ? 6.5 + rand() * 4 : 5 + rand() * 3;
    trees.push({ id: id++, x, kind, height, girth: 0.32 + rand() * 0.16, seed: Math.floor(rand() * 1e9) });
  }
  return trees;
}

export const TREE_HP = 12;           // axe strikes to fell one tree alone
export function logLength(tree) { return Math.min(4.6, Math.max(2.6, tree.height * 0.52)); }
export function boardsFromLog(len) { return Math.max(2, Math.floor(len / 0.75)); }
