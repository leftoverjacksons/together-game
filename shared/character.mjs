import { CELL, LEASH } from './constants.mjs';

// Kinematic platformer controller against the terrain density field.
// Runs on the client that owns the avatar (online) or for both avatars (local).

export const BODY = { halfW: 0.26, height: 1.55, step: 0.42 };
const WALK = 4.6, ACCEL = 30, AIR_ACCEL = 12, GRAV = -26, JUMP = 8.6, MAX_FALL = -22;

export function newAvatar(x, y) {
  return { mode: 'out', x, y, vx: 0, vy: 0, facing: 1, onGround: false, lx: 0, walkPhase: 0 };
}

function blockedBody(t, x, y) {
  const { halfW, height } = BODY;
  // Sample the body outline (feet raised slightly so slopes don't snag).
  for (let k = 0; k <= 4; k++) {
    const yy = y + 0.12 + (height - 0.12) * (k / 4);
    if (t.solidAt(x - halfW, yy) || t.solidAt(x + halfW, yy)) return true;
  }
  return t.solidAt(x, y + height);
}

function feetBlocked(t, x, y) {
  const { halfW } = BODY;
  return t.solidAt(x - halfW * 0.85, y) || t.solidAt(x, y) || t.solidAt(x + halfW * 0.85, y);
}

// input: { move: -1..1, jump: bool }; camperX bounds the leash.
export function stepAvatar(a, t, input, dt, camperX) {
  const move = Math.max(-1, Math.min(1, input.move || 0));
  if (move) a.facing = move > 0 ? 1 : -1;
  const target = move * (input.speed ?? WALK);
  const acc = (a.onGround ? ACCEL : AIR_ACCEL) * (input.grip ?? 1);
  const dv = target - a.vx;
  a.vx += Math.sign(dv) * Math.min(Math.abs(dv), acc * dt);
  if (input.jump && a.onGround) { a.vy = JUMP; a.onGround = false; }
  a.vy = Math.max(MAX_FALL, a.vy + GRAV * dt);

  // If buried (soil placed on us, or spawned inside), climb out.
  if (blockedBody(t, a.x, a.y)) {
    for (let k = 1; k <= 40; k++) if (!blockedBody(t, a.x, a.y + k * CELL / 2)) { a.y += k * CELL / 2; break; }
  }

  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(a.vx), Math.abs(a.vy)) * dt / (CELL * 0.4)));
  const sdt = dt / steps;
  const wasGround = a.onGround;
  a.onGround = false;
  for (let s = 0; s < steps; s++) {
    // Horizontal, with step-up.
    let nx = a.x + a.vx * sdt;
    if (camperX !== undefined) nx = Math.max(camperX - LEASH, Math.min(camperX + LEASH, nx));
    if (nx !== a.x) {
      if (!blockedBody(t, nx, a.y)) a.x = nx;
      else {
        let climbed = false;
        for (let up = 0.05; up <= BODY.step; up += 0.05) {
          if (!blockedBody(t, nx, a.y + up)) { a.x = nx; a.y += up; climbed = true; break; }
        }
        if (!climbed) a.vx = 0;
      }
    }
    // Vertical.
    const ny = a.y + a.vy * sdt;
    if (a.vy <= 0) {
      if (feetBlocked(t, a.x, ny)) {
        let lo = ny, hi = a.y;
        for (let k = 0; k < 8; k++) { const m = (lo + hi) / 2; if (feetBlocked(t, a.x, m)) lo = m; else hi = m; }
        a.y = hi; a.vy = 0; a.onGround = true;
      } else a.y = ny;
    } else {
      if (t.solidAt(a.x, ny + BODY.height)) a.vy = 0; else a.y = ny;
    }
  }
  // Stick to the ground when walking down slopes.
  if (!a.onGround && wasGround && a.vy <= 0) {
    for (let d = 0.05; d <= 0.45; d += 0.05) {
      if (feetBlocked(t, a.x, a.y - d)) {
        let lo = a.y - d, hi = a.y - d + 0.05;
        for (let k = 0; k < 6; k++) { const m = (lo + hi) / 2; if (feetBlocked(t, a.x, m)) lo = m; else hi = m; }
        a.y = hi; a.vy = 0; a.onGround = true; break;
      }
    }
  }
  if (a.onGround && Math.abs(a.vx) > 0.2) a.walkPhase += Math.abs(a.vx) * dt * 2.2;
  return a;
}

// The forest lane: walk along a fixed floor height function.
export function stepForest(a, floorY, input, dt, camperX) {
  const move = Math.max(-1, Math.min(1, input.move || 0));
  if (move) a.facing = move > 0 ? 1 : -1;
  const dv = move * (input.speed ?? WALK) - a.vx;
  a.vx += Math.sign(dv) * Math.min(Math.abs(dv), (a.onGround ? ACCEL : AIR_ACCEL) * (input.grip ?? 1) * dt);
  if (input.jump && a.onGround) { a.vy = JUMP; a.onGround = false; }
  a.vy = Math.max(MAX_FALL, a.vy + GRAV * dt);
  a.x += a.vx * dt;
  if (camperX !== undefined) a.x = Math.max(camperX - LEASH, Math.min(camperX + LEASH, a.x));
  const g = floorY(a.x);
  a.y += a.vy * dt;
  const wasGround = a.onGround;
  a.onGround = false;
  if (a.y <= g || (wasGround && a.vy <= 0 && a.y - g < 0.4)) { a.y = g; a.vy = 0; a.onGround = true; }
  if (a.onGround && Math.abs(a.vx) > 0.2) a.walkPhase += Math.abs(a.vx) * dt * 2.2;
  return a;
}
