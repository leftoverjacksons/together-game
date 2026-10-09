export const WORLD = { width: 4100, ground: 520, riverStart: 1620, riverEnd: 1990, bridge: 1540, anchor: 2070, tree: 2780, camp: 3630 };
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export function createWorld() {
  return { tick: 0, vehicle: { x: 430, speed: 0 }, players: [], planks: [{ x: 900, count: 2 }, { x: 1300, count: 2 }], bridge: 0, anchored: false, tension: 100, treeCable: false, treeProgress: 0, dog: false, metMara: false, won: false, lastEvent: 'The old coast road is open. Mostly.', events: [], soloAssist: true };
}
export function addPlayer(s, id, name) {
  const p = { id, name: String(name || 'Traveler').trim().slice(0, 18) || 'Traveler', slot: s.players.length, x: s.vehicle.x - 15, y: 450, vy: 0, inside: true, station: null, carrying: false, connected: true, input: {}, lastInput: 0 };
  s.players.push(p); return p;
}
function announce(s, text) { s.lastEvent = text; s.events.push({ tick: s.tick, text }); s.events = s.events.slice(-12); }
export function context(s, p) {
  if (p.station) return { kind: 'release', label: 'Leave ' + p.station };
  if (p.inside) {
    const dx = p.x - s.vehicle.x;
    if (dx > 60) return { kind: 'driver', label: 'Take the wheel' };
    if (dx < -110) return { kind: 'exit', label: 'Step outside' };
    if (Math.abs(dx + 65) < 42) return { kind: 'winch', label: 'Use the winch' };
    return null;
  }
  if (Math.abs(p.x - WORLD.bridge) < 72 && s.bridge < 3) return { kind: 'bridge', label: p.carrying ? 'Fit a bridge plank' : 'Bridge needs ' + (3 - s.bridge) + ' planks' };
  if (Math.abs(p.x - WORLD.anchor) < 65 && !s.anchored) return { kind: 'anchor', label: 'Secure the bridge cable' };
  if (Math.abs(p.x - WORLD.tree) < 75 && s.treeProgress < 100 && !s.treeCable) return { kind: 'tree', label: 'Hook cable to fallen tree' };
  if (Math.abs(p.x - 2340) < 65 && !s.dog) return { kind: 'dog', label: 'Say hello to the dog' };
  if (Math.abs(p.x - 1120) < 65) return { kind: 'mara', label: 'Talk to Mara' };
  const stack = s.planks.findIndex(v => Math.abs(v.x - p.x) < 62 && v.count > 0);
  if (stack >= 0 && !p.carrying) return { kind: 'salvage', stack, label: 'Pick up a plank' };
  if (Math.abs(p.x - s.vehicle.x) < 190) return { kind: 'board', label: 'Climb aboard' };
  return null;
}
export function interact(s, p) {
  if (!p.connected || s.won) return;
  const c = context(s, p); if (!c) return;
  switch (c.kind) {
    case 'release': p.station = null; break;
    case 'driver': case 'winch':
      if (!s.players.some(q => q !== p && q.connected && q.station === c.kind)) { p.station = c.kind; p.x = s.vehicle.x + (c.kind === 'driver' ? 110 : -65); }
      break;
    case 'exit': p.inside = false; p.x = s.vehicle.x - 170; p.y = 450; break;
    case 'board': p.inside = true; p.x = s.vehicle.x - 120; p.y = 450; p.vy = 0; break;
    case 'salvage': s.planks[c.stack].count--; p.carrying = true; break;
    case 'bridge': if (p.carrying) { s.bridge++; p.carrying = false; announce(s, s.bridge === 3 ? 'Deck repaired. Cross the stepping stones and secure the far cable.' : 'One more piece of the road put back together.'); } break;
    case 'anchor': s.anchored = true; announce(s, 'Cable secured. One at the wheel, one on the winch.'); break;
    case 'tree': if (Math.abs(s.vehicle.x - WORLD.tree) < 650) { s.treeCable = true; announce(s, 'Tree hooked. Back aboard: hold SPACE at the winch to clear the road.'); } else announce(s, 'Bring the house closer before attaching its cable.'); break;
    case 'dog': s.dog = true; announce(s, 'You found a traveling companion. His collar says Moss.'); break;
    case 'mara': s.metMara = true; announce(s, 'Mara: "Three planks for the bridge. Hop the stones to tie the far cable. There is a good campsite past the fallen pine."'); break;
  }
}
function floorAt(s, p) {
  if (p.inside) return 450;
  if (p.x < WORLD.riverStart || p.x > WORLD.riverEnd || s.bridge === 3) return WORLD.ground;
  for (const x of [1660, 1750, 1840, 1930]) if (Math.abs(p.x - x) < 25) return 535;
  return 665;
}
export function step(s, dt = 0.05) {
  s.tick++;
  if (s.won) return;
  const driver = s.players.find(p => p.connected && p.station === 'driver');
  const wincher = s.players.find(p => p.connected && p.station === 'winch');
  const solo = s.soloAssist && s.players.filter(p => p.connected).length === 1;
  const winching = !!wincher?.input.jump || (solo && !!driver);
  let desired = driver ? ((driver.input.right ? 1 : 0) - (driver.input.left ? 1 : 0)) * 95 : 0;
  const crossing = s.vehicle.x > 1480 && s.vehicle.x < 2130;
  if (crossing && s.bridge === 3 && s.anchored) {
    s.tension = clamp(s.tension + (winching ? 32 : -19) * dt, 0, 100);
    desired *= 0.62;
    if (s.tension < 15) desired = Math.min(0, desired);
  } else s.tension = clamp(s.tension + 18 * dt, 0, 100);
  let nextX = clamp(s.vehicle.x + desired * dt, 220, 3740);
  if (s.bridge < 3 || !s.anchored) nextX = Math.min(nextX, WORLD.riverStart - 145);
  if (s.treeProgress < 100) nextX = Math.min(nextX, WORLD.tree - 170);
  const delta = nextX - s.vehicle.x;
  s.vehicle.speed = delta / dt; s.vehicle.x = nextX;
  if (s.treeCable && s.treeProgress < 100 && winching && Math.abs(s.vehicle.x - WORLD.tree) < 650) {
    s.treeProgress = clamp(s.treeProgress + 19 * dt, 0, 100);
    if (s.treeProgress === 100) announce(s, 'The pine rolls clear. The last stretch is yours.');
  }
  for (const p of s.players) {
    if (p.inside) p.x += delta;
    if (!p.connected) continue;
    if (!p.station) {
      const dir = (p.input.right ? 1 : 0) - (p.input.left ? 1 : 0);
      p.x += dir * (p.carrying ? 145 : 185) * dt;
      p.x = p.inside ? clamp(p.x, s.vehicle.x - 145, s.vehicle.x + 135) : clamp(p.x, 30, 4010);
      const floor = floorAt(s, p);
      if (p.input.jump && !p.jumped && p.y >= floor - 1) { p.vy = -350; p.jumped = true; }
      if (!p.input.jump) p.jumped = false;
      p.vy += 850 * dt; p.y += p.vy * dt;
      if (p.y >= floor && p.vy >= 0) { p.y = floor; p.vy = 0; }
      if (p.y > 625) { p.x = p.x < 1810 ? 1580 : 2030; p.y = 500; p.vy = 0; announce(s, 'A wet landing. You scrambled safely back to the bank.'); }
    } else { p.y = 450; p.vy = 0; }
  }
  if (s.vehicle.x > WORLD.camp && s.players.filter(p => p.connected).every(p => p.inside)) { s.won = true; announce(s, 'Home is wherever we park. You made it to Stillwater.'); }
}
export function objective(s) {
  if (s.won) return 'An evening at Stillwater';
  if (s.bridge < 3) return `Mend the old bridge � ${s.bridge}/3 planks`;
  if (!s.anchored) return 'Cross on foot � secure the far cable';
  if (s.vehicle.x < 2130) return 'Cross together � drive + hold the winch';
  if (s.treeProgress < 100) return s.treeCable ? 'Clear the pine � hold SPACE at the winch' : 'Hook the fallen pine to your winch';
  return 'Bring everyone aboard � reach Stillwater';
}
export function snapshot(s) {
  return { ...s, players: s.players.map(({ input, lastInput, ...p }) => p), objective: objective(s) };
}
