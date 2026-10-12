import * as THREE from 'three';
import { CELL, CHUNK } from '../../shared/constants.mjs';
import { CAMPER } from '../../shared/sim.mjs';
import { LANE_DEPTH, laneZ, segmentAt, areaAt } from '../../shared/lanes/world.mjs';
import { PAL } from '../render/palette.js';

// Geometry for the lane prototype. Every lane is its 2D terrain extruded
// along z: the marching-squares fill becomes the cut face toward the camera
// (with soil strata), and the contour becomes the ground surface.

const col = new THREE.Color();
const tmp = new THREE.Color();
const SOIL = PAL.soil.map(c => new THREE.Color(c));
const ROCK = new THREE.Color(PAL.rock);
const ROCK_DARK = new THREE.Color(PAL.rockDark);
const RIM = new THREE.Color(PAL.dirtRim);

// Grass colour at x, blending between areas over 30 m.
export function grassAt(world, x, out = col) {
  const a = areaAt(world, x);
  out.setHex(a.grass);
  const edge = 15;
  const next = world.areas.find(b => b.x0 === a.x1), prev = world.areas.find(b => b.x1 === a.x0);
  if (next && x > a.x1 - edge) out.lerp(tmp.setHex(next.grass), (x - (a.x1 - edge)) / (2 * edge));
  else if (prev && x < a.x0 + edge) out.lerp(tmp.setHex(prev.grass), ((a.x0 + edge) - x) / (2 * edge));
  return out;
}

// Small deterministic jitter so flat faces are not perfectly flat in colour.
const jitter = (x, y) => { const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453; return (s - Math.floor(s)) * 0.08 - 0.04; };

// [start fraction from the front edge, colour override or 0]
const LANE_BANDS = [
  [[0, 0], [0.55, 0], [0.78, 0xb3a37a], [0.9, 0x9a8c6a]],
  [[0, 0], [0.2, 0x9b7a55], [0.33, 0], [0.62, 0x9b7a55], [0.75, 0]],
  [[0, 0], [0.4, 0], [0.7, 0]],
];

export function buildChunkGeometry(terrain, world, lane, cx, cy) {
  const { fills, segments } = terrain.extractChunk(cx, cy);
  if (!segments.length && !fills.size) return null;
  const zF = laneZ(lane) + LANE_DEPTH / 2, zB = laneZ(lane) - LANE_DEPTH / 2;
  const pos = [], cols = [];
  const vert = (x, y, z, c) => { pos.push(x, y, z); cols.push(c.r, c.g, c.b); };

  // Cut face.
  for (const [key, polys] of fills) {
    const base = key === 'rock' ? ROCK : SOIL[+key.slice(4)] || SOIL[4];
    for (const p of polys) {
      const c = base;
      for (let k = 2; k + 3 < p.length; k += 2) {
        vert(p[0], p[1], zF, c); vert(p[k], p[k + 1], zF, c); vert(p[k + 2], p[k + 3], zF, c);
      }
    }
  }

  // Ground surface: each contour segment swept from the front edge to the back.
  const grass = new THREE.Color();
  for (let k = 0; k < segments.length; k += 4) {
    const x1 = segments[k], y1 = segments[k + 1], x2 = segments[k + 2], y2 = segments[k + 3];
    const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy);
    if (len < 1e-4) continue;
    const nx = dy / len, ny = -dx / len;            // outward normal
    const mx = (x1 + x2) / 2 - nx * 0.15, my = (y1 + y2) / 2 - ny * 0.15;
    const ix = Math.round(mx / CELL), iy = Math.round(my / CELL);
    const rocky = ix >= 0 && ix < terrain.nx && iy >= 0 && iy < terrain.ny && terrain.rock[iy * terrain.nx + ix];
    let c;
    if (rocky) c = ny > 0.4 ? ROCK : ROCK_DARK;
    else if (ny > 0.42) c = grassAt(world, mx, grass).offsetHSL(0, 0, jitter(mx, 1) * 0.3);
    else c = ny > -0.2 ? RIM : SOIL[1];
    // Bands across the lane give each lane its look: wheel ruts on the
    // woodland track, a gravel edge along the creek bank, rougher grass uphill.
    const grassy = !rocky && ny > 0.42;
    const bands = LANE_BANDS[lane];
    for (let s = 0; s < bands.length; s++) {
      const za = zF + (zB - zF) * bands[s][0], zb = zF + (zB - zF) * (s + 1 < bands.length ? bands[s + 1][0] : 1);
      const cc = grassy && bands[s][1] ? tmp.setHex(bands[s][1]).offsetHSL(0, 0, jitter(mx, s) * 0.5) : s % 2 ? tmp.copy(c).offsetHSL(0, 0, -0.02) : c;
      vert(x1, y1, za, cc); vert(x2, y2, zb, cc); vert(x2, y2, za, cc);
      vert(x1, y1, za, cc); vert(x1, y1, zb, cc); vert(x2, y2, zb, cc);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export const chunkSize = CHUNK * CELL;

// ----- Dividers -----

// Cross-section of a divider at one x: heights at five points from the front
// lane's back edge to the back lane's front edge, plus an optional water level.
function dividerProfile(type, hA, hB) {
  const lo = Math.min(hA, hB), hi = Math.max(hA, hB), mid = (hA + hB) / 2;
  switch (type) {
    case 'creek': case 'stones': return { h: [hA, lo - 0.9, lo - 1.3, lo - 0.9, hB], water: lo - 0.35 };
    case 'ford': return { h: [hA, lo - 0.35, lo - 0.5, lo - 0.35, hB], water: lo - 0.12 };
    case 'bank': return { h: [hA, hi + 1.2, hi + 2.0, hi + 1.4, hB] };
    case 'rocks': return { h: [hA, mid + 0.35, mid + 0.55, mid + 0.35, hB] };
    case 'hedge': return { h: [hA, mid + 0.1, mid + 0.15, mid + 0.1, hB] };
    default: return { h: [hA, mid - 0.05, mid - 0.08, mid - 0.05, hB] };
  }
}

const DIV_COLOR = {
  open: null, ford: 0x8a7a5a, reeds: null, creek: 0x6e5a40, stones: 0x6e5a40,
  hedge: 0x5b4a33, rocks: PAL.rockDark, bank: PAL.soil[1],
};

// One divider, built in x-chunks of 8 m. Returns { ground, water, props: [{ kind, x, y, z, s }] }.
export function buildDividerChunk(world, terrains, k, x0, x1) {
  const A = terrains[k], B = terrains[k + 1];
  const zA = laneZ(k) - LANE_DEPTH / 2, zB = laneZ(k + 1) + LANE_DEPTH / 2;
  const zs = [0, 0.25, 0.5, 0.75, 1].map(t => zA + (zB - zA) * t);
  const step = 0.5;
  const rows = [];
  for (let x = x0; x <= x1 + 1e-6; x += step) {
    const ix = Math.min(A.nx - 1, Math.round(x / CELL));
    const seg = segmentAt(world.dividers[k], x);
    rows.push({ x, seg, ...dividerProfile(seg.type, A.surface[ix], B.surface[ix]) });
  }
  const pos = [], cols = [], wpos = [];
  const c0 = new THREE.Color(), c1 = new THREE.Color(), grass = new THREE.Color();
  for (let r = 0; r + 1 < rows.length; r++) {
    const a = rows[r], b = rows[r + 1];
    grassAt(world, a.x, grass);
    const special = DIV_COLOR[a.seg.type];
    for (let j = 0; j < 4; j++) {
      // Banks and channels show their earth in the middle; the edges stay grassy.
      const inner = j === 1 || j === 2;
      if (special !== null && special !== undefined && inner) c0.setHex(special); else c0.copy(grass).offsetHSL(0, 0, -0.03);
      if (a.seg.type === 'reeds' && inner) c0.copy(grass).offsetHSL(0.02, 0.05, -0.06);
      c1.copy(c0).offsetHSL(0, 0, jitter(a.x, j));
      const p = [[a.x, a.h[j], zs[j]], [b.x, b.h[j], zs[j]], [b.x, b.h[j + 1], zs[j + 1]], [a.x, a.h[j + 1], zs[j + 1]]];
      for (const q of [p[0], p[1], p[2], p[0], p[2], p[3]]) { pos.push(...q); cols.push(c1.r, c1.g, c1.b); }
    }
    if (a.water !== undefined && b.water !== undefined) {
      const wz0 = zs[0] + 0.15, wz1 = zs[4] - 0.15;
      wpos.push(a.x, a.water, wz0, b.x, b.water, wz0, b.x, b.water, wz1, a.x, a.water, wz0, b.x, b.water, wz1, a.x, a.water, wz1);
    }
  }
  const ground = new THREE.BufferGeometry();
  ground.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ground.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  ground.computeVertexNormals();
  let water = null;
  if (wpos.length) {
    water = new THREE.BufferGeometry();
    water.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
    water.computeVertexNormals();
  }

  // Props, placed deterministically along the divider.
  const props = [];
  const zMid = (zA + zB) / 2;
  const rnd = (n) => { const s = Math.sin(n * 91.345 + k * 17.17) * 24634.6345; return s - Math.floor(s); };
  for (let x = Math.ceil(x0 / 0.7) * 0.7; x < x1; x += 0.7) {
    const n = Math.round(x / 0.7);
    const seg = segmentAt(world.dividers[k], x);
    const ix = Math.min(A.nx - 1, Math.round(x / CELL));
    const prof = dividerProfile(seg.type, A.surface[ix], B.surface[ix]);
    const zj = zMid + (rnd(n) - 0.5) * 1.4;
    const yMid = prof.h[2];
    if (seg.type === 'hedge') props.push({ kind: 'bush', x: x + rnd(n + 1) * 0.3, y: yMid + 0.5, z: zj, s: 0.75 + rnd(n + 2) * 0.45 });
    else if (seg.type === 'rocks' && rnd(n + 3) < 0.6) props.push({ kind: 'rock', x, y: yMid + 0.15, z: zj, s: 0.45 + rnd(n + 4) * 0.5 });
    else if (seg.type === 'reeds') { props.push({ kind: 'reed', x, y: yMid + 0.5, z: zj, s: 1 }); if (rnd(n + 5) < 0.5) props.push({ kind: 'reed', x: x + 0.35, y: yMid + 0.45, z: zMid + (rnd(n + 6) - 0.5) * 1.4, s: 0.85 }); }
    else if (seg.type === 'stones' && n % 2 === 0) props.push({ kind: 'stone', x, y: prof.water + 0.05, z: zMid + (n % 4 ? 0.45 : -0.45), s: 0.42 });
    else if (seg.type === 'bank' && rnd(n + 7) < 0.25) props.push({ kind: 'rock', x, y: yMid, z: zj, s: 0.5 + rnd(n + 8) * 0.4 });
    else if (seg.type === 'open' && rnd(n + 9) < 0.12) props.push({ kind: 'flower', x, y: yMid + 0.1, z: zj, s: 1 });
  }
  return { ground, water, props };
}

// ----- The camper -----

export function makeCamper() {
  const group = new THREE.Group();
  const shape = new THREE.Shape(CAMPER.hull.map(([x, y]) => new THREE.Vector2(x, y)));
  const depth = 2.5;
  const bodyMat = new THREE.MeshLambertMaterial({ color: PAL.body });
  const body = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), bodyMat);
  body.position.z = -depth / 2;
  group.add(body);
  const stripeMat = new THREE.MeshLambertMaterial({ color: PAL.stripe });
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x5f8fa3 });
  const parts = [bodyMat, stripeMat, glassMat];
  for (const side of [1, -1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(6.3, 0.28, 0.04), stripeMat);
    stripe.position.set(0, 0.35, side * (depth / 2 + 0.02));
    group.add(stripe);
    for (const [wx, ww] of [[-1.9, 1.3], [-0.2, 1.3], [1.55, 0.9]]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(ww, 0.75, 0.04), glassMat);
      win.position.set(wx, 1.15, side * (depth / 2 + 0.03));
      group.add(win);
    }
  }
  const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.9, depth - 0.3), glassMat);
  windscreen.position.set(3.18, 1.1, 0); windscreen.rotation.z = -0.12;
  group.add(windscreen);
  // Interior floor, seen when the walls fade.
  const floor = new THREE.Mesh(new THREE.BoxGeometry(5.4, 0.06, depth - 0.2), new THREE.MeshLambertMaterial({ color: PAL.wood }));
  floor.position.set(-0.15, -0.38, 0);
  group.add(floor);
  const tyreMat = new THREE.MeshLambertMaterial({ color: PAL.tire });
  const rimMat = new THREE.MeshLambertMaterial({ color: PAL.rim });
  const wheels = [];
  for (let w = 0; w < 2; w++) {
    const pair = new THREE.Group();
    for (const side of [1, -1]) {
      const tyre = new THREE.Mesh(new THREE.CylinderGeometry(CAMPER.wheelR, CAMPER.wheelR, 0.45, 18), tyreMat);
      tyre.rotation.x = Math.PI / 2;
      tyre.position.z = side * 1.05;
      const rim = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.47), rimMat);
      rim.position.z = side * 1.05;
      pair.add(tyre, rim);
    }
    group.add(pair);
    wheels.push(pair);
  }
  return { group, wheels, materials: parts, bodyMat };
}

// ----- Characters and animals -----

export function makeAvatar(index) {
  const p = PAL.players[index % PAL.players.length];
  const g = new THREE.Group();
  const shirt = new THREE.MeshLambertMaterial({ color: p.shirt });
  const pants = new THREE.MeshLambertMaterial({ color: p.pants });
  const skin = new THREE.MeshLambertMaterial({ color: PAL.skin });
  const hat = new THREE.MeshLambertMaterial({ color: p.hat });
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 10), pants); legs.position.y = 0.35;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.25, 0.4, 4, 10), shirt); torso.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10), skin); head.position.y = 1.43;
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 14), hat); brim.position.y = 1.57;
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.16, 12), hat); crown.position.y = 1.66;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.4, 0.34), new THREE.MeshLambertMaterial({ color: p.pack })); pack.position.set(-0.27, 1.0, 0);
  const body = new THREE.Group();
  body.add(legs, torso, head, brim, crown, pack);
  g.add(body);
  return { group: g, body, materials: [shirt, pants, skin, hat] };
}

const ANIMAL_LOOK = {
  rabbit: { color: 0xb59a7a, size: 0.32, ear: true },
  chipmunk: { color: 0xa0683c, size: 0.22 },
  songbird: { color: 0xd9643a, size: 0.18, bird: true },
  hawk: { color: 0x8a6440, size: 0.4, bird: true },
  fox: { color: 0xd8713a, size: 0.42 },
  deer: { color: 0xa87a50, size: 0.75, legs: true },
  moose: { color: 0x5d4330, size: 1.0, legs: true },
};

export function makeAnimal(kind) {
  const look = ANIMAL_LOOK[kind] || ANIMAL_LOOK.rabbit;
  const g = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: look.color });
  const s = look.size;
  const body = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat);
  body.scale.set(s * 1.25, s * 0.8, s * 0.75);
  body.position.y = look.legs ? s * 1.3 : s * 0.75;
  const head = new THREE.Mesh(new THREE.SphereGeometry(s * 0.5, 10, 8), mat);
  head.position.set(s * 1.15, body.position.y + s * 0.55, 0);
  g.add(body, head);
  if (look.legs) for (const lx of [-0.7, 0.7]) for (const lz of [-0.4, 0.4]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(s * 0.09, s * 0.08, s * 1.1, 6), mat);
    leg.position.set(lx * s, s * 0.55, lz * s); g.add(leg);
  }
  if (look.ear) for (const lz of [-0.08, 0.08]) {
    const ear = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.2, 2, 6), mat);
    ear.position.set(s * 1.1, head.position.y + 0.22, lz); g.add(ear);
  }
  if (look.bird) { body.scale.set(s * 1.4, s * 0.75, s * 0.7); }
  // A bobbing marker while the animal needs help.
  const marker = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: 0xffd77a }));
  marker.position.y = body.position.y + s + 0.7;
  g.add(marker);
  return { group: g, marker, size: s };
}

