import { World, Vec2, Edge, Circle, Polygon, Box, WheelJoint } from 'planck';
import {
  CELL, CHUNK, GRAVITY, REACH, BRUSH_RADIUS, SOIL_CAPACITY, STRETCH_LENGTH, INTERIOR, STATION_RANGE, MAX_PLAYERS,
  TOOLS, BOARD_CARRY, RACK_BOARDS, RACK_LOGS, BOARD_MASS, LOG_DENSITY, RACK_POINT, RACK_RANGE, WORK_RANGE,
} from './constants.mjs';
import { Terrain } from './terrain.mjs';
import { newAvatar } from './character.mjs';
import { Structure } from './structure.mjs';
import { forestFloor, floorAt, generateTrees, TREE_HP, logLength, boardsFromLog, LOG_THICKNESS } from './forest.mjs';

// Authoritative simulation for one trip: terrain, camper physics, player
// stations. Avatars are simulated by their owning client and reported here.

export const CAMPER = {
  // Chassis outline (local metres, y up). Wheels hang below.
  // Raked nose and tail so the camper rides up onto obstacles instead of catching.
  hull: [[-2.95, -0.62], [2.65, -0.62], [3.35, 0.2], [3.1, 1.85], [-3.2, 1.85], [-3.3, -0.05]],
  wheelR: 0.72,
  wheelX: [-2.25, 2.25],
  wheelY: -1.2,
  springHz: 5.2,
  springDamping: 0.85,
  maxSpeed: 12,       // wheel rad/s
  torque: 5600,       // per wheel, N·m
  brakeTorque: 9000,
  idleTorque: 260,
};
const ACTIVE_RANGE = 44;          // metres around the camper with collision built
const DIG_STRENGTH = 70, FILL_STRENGTH = 70;
const CHOP_EVERY = 18, SAW_EVERY = 6, SAW_WORK = 36;   // ticks between strokes; strokes per log
const CARRY_FORCE = 3400, CARRY_K = 3200, CARRY_C = 450, CARRY_SLIP = 2.6;
const MAX_BOARDS = 150;
const SLUMP_EVERY = 6;           // ticks between settling passes (10 Hz)
const PUSH_SPIN = 0.45, PUSH_RANGE = 4.8;   // rad/s per pusher
const round = v => Math.round(v * 1000) / 1000;

export class Sim {
  constructor(seed, length = STRETCH_LENGTH) {
    this.seed = seed >>> 0;
    this.tick = 0;
    this.terrain = new Terrain(length, this.seed);
    this.world = new World({ gravity: Vec2(0, GRAVITY) });
    this.players = new Map();
    this.edits = new Map();          // node index -> density, for late joiners
    this.pendingEdits = new Map();   // flushed to clients each tick
    this.chunkBodies = new Map();    // chunk id -> { body, version }
    this.outbox = [];
    this.tippedFor = 0;
    this.tipped = false;
    // End walls so nothing leaves the stretch.
    const walls = this.world.createBody({ type: 'static' });
    for (const x of [0, length]) walls.createFixture(new Edge(Vec2(x, 0), Vec2(x, 200)), { friction: 0.3 });
    this.wet = false;               // rain: faster, shallower slumping
    this.floor = forestFloor(this.terrain);
    this.trees = generateTrees(this.terrain, this.seed).map(t => ({ ...t, hp: TREE_HP, fallDir: 0, fellTick: 0 }));
    this.logs = new Map();          // id -> { id, lane, len, x, y, a, body, carriers: [{ pid, end }], saw }
    this.piles = new Map();         // id -> { id, lane, x, y, n }
    this.rack = { boards: 0, logs: [] };
    this.nextId = 1;
    this.structure = new Structure(this.world, this.terrain);
    this.slumpBlocked = (ax, ay, bx, by) => this.structure.boards.size > 0 && this.structure.blocksSegment(ax, ay, bx, by);
    this.#createCamper(22);
  }

  #createCamper(x) {
    const g = this.terrain.groundY(x);
    const y = g - CAMPER.wheelY + CAMPER.wheelR + 0.15;
    const chassis = this.world.createBody({ type: 'dynamic', position: Vec2(x, y), angularDamping: 0.5 });
    chassis.createFixture(new Polygon(CAMPER.hull.map(([a, b]) => Vec2(a, b))), { density: 145, friction: 0.55 });
    const wheels = [], joints = [];
    for (const wx of CAMPER.wheelX) {
      const wheel = this.world.createBody({ type: 'dynamic', position: Vec2(x + wx, y + CAMPER.wheelY), angularDamping: 0.4 });
      wheel.createFixture(new Circle(CAMPER.wheelR), { density: 70, friction: 1.25, restitution: 0.05 });
      const joint = this.world.createJoint(new WheelJoint({
        enableMotor: true, motorSpeed: 0, maxMotorTorque: CAMPER.idleTorque, frequencyHz: CAMPER.springHz, dampingRatio: CAMPER.springDamping,
      }, chassis, wheel, wheel.getPosition(), Vec2(0, 1)));
      wheels.push(wheel); joints.push(joint);
    }
    this.camper = { chassis, wheels, joints, throttle: 0, brake: false };
    this.#syncTerrainBodies(true);
  }

  // Build or rebuild static collision for chunks near the camper.
  #syncTerrainBodies(force = false) {
    const t = this.terrain;
    const cx0 = Math.max(0, Math.floor((this.camper.chassis.getPosition().x - ACTIVE_RANGE) / (CHUNK * CELL)));
    const cx1 = Math.min(t.chunksX - 1, Math.floor((this.camper.chassis.getPosition().x + ACTIVE_RANGE) / (CHUNK * CELL)));
    const wanted = new Set();
    for (let cy = 0; cy < t.chunksY; cy++) for (let cx = cx0; cx <= cx1; cx++) wanted.add(cy * t.chunksX + cx);
    // Keep ground under loose logs on the road, wherever they are.
    const loose = [...(this.logs?.values() || [])].map(l => l.body).concat([...(this.structure?.debris.values() || [])].map(d => d.body));
    for (const body of loose) {
      if (!body) continue;
      const lx = body.getPosition().x, size = CHUNK * CELL;
      for (let cx = Math.max(0, Math.floor((lx - 6) / size)); cx <= Math.min(t.chunksX - 1, Math.floor((lx + 6) / size)); cx++)
        for (let cy = 0; cy < t.chunksY; cy++) wanted.add(cy * t.chunksX + cx);
    }
    for (const [id, cb] of this.chunkBodies) if (!wanted.has(id)) { this.world.destroyBody(cb.body); this.chunkBodies.delete(id); }
    for (const id of wanted) {
      const cb = this.chunkBodies.get(id);
      const version = t.chunkVersion[id];
      if (cb && cb.version === version && !force) continue;
      if (cb) this.world.destroyBody(cb.body);
      const cx = id % t.chunksX, cy = (id - cx) / t.chunksX;
      const { segments } = t.extractChunk(cx, cy);
      const body = this.world.createBody({ type: 'static' });
      for (let k = 0; k < segments.length; k += 4) {
        const dx = segments[k + 2] - segments[k], dy = segments[k + 3] - segments[k + 1];
        if (dx * dx + dy * dy < 1e-4) continue;
        body.createFixture(new Edge(Vec2(segments[k], segments[k + 1]), Vec2(segments[k + 2], segments[k + 3])), { friction: 0.9 });
      }
      this.chunkBodies.set(id, { body, version });
    }
  }

  // Move the camper (upright, at rest) onto the ground at x.
  placeCamper(x) {
    const c = this.camper;
    const y = this.terrain.groundY(x) - CAMPER.wheelY + CAMPER.wheelR + 0.15;
    c.chassis.setTransform(Vec2(x, y), 0);
    c.wheels.forEach((w, k) => w.setTransform(Vec2(x + CAMPER.wheelX[k], y + CAMPER.wheelY), 0));
    for (const b of [c.chassis, ...c.wheels]) { b.setLinearVelocity(Vec2(0, 0)); b.setAngularVelocity(0); b.setAwake(true); }
    this.tippedFor = 0;
    this.tipped = false;
    this.#syncTerrainBodies();
  }

  addPlayer(id, name) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= MAX_PLAYERS) return null;
    const c = this.camper.chassis.getPosition();
    const avatar = newAvatar(c.x, c.y);
    avatar.mode = 'in';
    avatar.lx = INTERIOR.doorX + 0.6 + this.players.size * 1.4;
    const p = { id, name: String(name || 'Traveller').slice(0, 20), avatar, seat: null, soil: 0, pushing: false, connected: true, lastTool: 0, tool: 0, boards: 0, carrying: null };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { const p = this.players.get(id); this.#unseat(p); this.#release(p); this.players.delete(id); }

  setConnected(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    if (!on) { this.#unseat(p); this.#release(p); p.pushing = false; }
  }

  #unseat(p) {
    if (p && p.seat === 'cab') { this.camper.throttle = 0; this.camper.brake = false; }
    if (p) p.seat = null;
  }

  driver() { for (const p of this.players.values()) if (p.seat === 'cab') return p; return null; }

  // World position of a chassis-local point.
  camperPoint(lx, ly) {
    const b = this.camper.chassis;
    const p = b.getWorldPoint(Vec2(lx, ly));
    return { x: p.x, y: p.y };
  }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'avatar': {
        const a = msg.a || {};
        const num = (v, d) => (Number.isFinite(v) ? v : d);
        const mode = a.mode === 'in' ? 'in' : 'out';
        const lane = mode === 'out' && a.lane === 1 ? 1 : 0;
        if (mode === 'out' && p.seat) this.#unseat(p);
        if (p.carrying !== null && (mode === 'in' || lane !== p.avatar.lane)) this.#carryAcrossLanes(p, mode, lane, num(a.x, p.avatar.x));
        p.avatar.lane = lane;
        Object.assign(p.avatar, {
          mode, x: num(a.x, p.avatar.x), y: num(a.y, p.avatar.y), vx: num(a.vx, 0), vy: num(a.vy, 0),
          facing: a.facing < 0 ? -1 : 1, lx: Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, num(a.lx, 0))),
          onGround: !!a.onGround, walkPhase: num(a.walkPhase, 0), working: a.working === true,
        });
        break;
      }
      case 'seat': {
        if (p.avatar.mode !== 'in' || Math.abs(p.avatar.lx - INTERIOR.seatX) > STATION_RANGE + 0.2) break;
        const d = this.driver();
        if (!d) p.seat = 'cab';
        break;
      }
      case 'unseat': this.#unseat(p); break;
      case 'drive': {
        if (p.seat !== 'cab') break;
        this.camper.throttle = Math.max(-1, Math.min(1, Number(msg.throttle) || 0));
        this.camper.brake = msg.brake === true;
        break;
      }
      case 'push': p.pushing = msg.on === true; break;
      case 'tool': p.tool = Math.max(0, Math.min(TOOLS.length - 1, msg.i | 0)); break;
      case 'chop': this.#chop(p); break;
      case 'saw': this.#saw(p); break;
      case 'grab': this.#grab(p, msg.id); break;
      case 'release': this.#release(p); break;
      case 'take': this.#take(p, msg.id); break;
      case 'drop': this.#dropBoards(p); break;
      case 'stow': this.#stow(p); break;
      case 'unstow': this.#unstow(p); break;
      case 'build': this.#build(p, msg); break;
      case 'unbuild': this.#unbuild(p, msg); break;
      case 'salvage': this.#salvage(p, msg.id); break;
      case 'weather': this.wet = msg.wet === true; break;   // temporary toggle until weather exists
      case 'dig':
      case 'fill': this.#tool(p, msg); break;
    }
  }

  #tool(p, msg) {
    const now = this.tick;
    if (now - p.lastTool < 4) return;              // ~15 ops/s
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || p.avatar.mode !== 'out') return;
    const ax = p.avatar.x, ay = p.avatar.y + 0.9;
    if ((x - ax) ** 2 + (y - ay) ** 2 > REACH * REACH) return;
    p.lastTool = now;
    let r;
    if (msg.t === 'dig') {
      if (p.soil >= SOIL_CAPACITY - 1e-3) return;
      r = this.terrain.dig(x, y, BRUSH_RADIUS, DIG_STRENGTH, SOIL_CAPACITY - p.soil);
      p.soil = Math.min(SOIL_CAPACITY, p.soil + r.volume);
    } else {
      if (p.soil <= 1e-3) return;
      r = this.terrain.fill(x, y, BRUSH_RADIUS, FILL_STRENGTH, p.soil, (wx, wy) => this.#occupied(wx, wy));
      p.soil = Math.max(0, p.soil - r.volume);
    }
    for (let k = 0; k < r.indices.length; k++) {
      this.edits.set(r.indices[k], r.values[k]);
      this.pendingEdits.set(r.indices[k], r.values[k]);
    }
  }

  #occupied(wx, wy) {
    const pt = Vec2(wx, wy);
    const { chassis, wheels } = this.camper;
    for (const b of [chassis, ...wheels]) {
      for (let f = b.getFixtureList(); f; f = f.getNext()) if (f.testPoint(pt)) return true;
      const c = b.getPosition();
      if (b !== chassis && (c.x - wx) ** 2 + (c.y - wy) ** 2 < (CAMPER.wheelR + 0.2) ** 2) return true;
    }
    for (const q of this.players.values()) {
      const a = q.avatar;
      if (a.mode === 'out' && (a.lane || 0) === 0 && Math.abs(wx - a.x) < 0.4 && wy > a.y - 0.1 && wy < a.y + 1.7) return true;
    }
    return this.structure.pointInBoard(wx, wy, 0.1);
  }

  #camperOccupied(wx, wy) {
    const pt = Vec2(wx, wy);
    const { chassis, wheels } = this.camper;
    for (const b of [chassis, ...wheels]) for (let f = b.getFixtureList(); f; f = f.getNext()) if (f.testPoint(pt)) return true;
    return false;
  }

  // ----- Building -----

  #notice(p, msg) { this.outbox.push({ t: 'notice', to: p.id, msg }); }

  #build(p, msg) {
    const vals = [msg.ax, msg.ay, msg.bx, msg.by].map(Number);
    if (!vals.every(Number.isFinite) || TOOLS[p.tool] !== 'hammer' || p.avatar.mode !== 'out' || (p.avatar.lane || 0) !== 0) return;
    if (p.boards < 1) return this.#notice(p, 'You need boards: saw a log, or take some from the roof rack');
    if (this.structure.boards.size >= MAX_BOARDS) return this.#notice(p, 'That is a lot of boards already');
    const [ax, ay, bx, by] = vals;
    const hx = p.avatar.x, hy = p.avatar.y + 0.9;
    if (Math.hypot(ax - hx, ay - hy) > REACH + 0.6) return this.#notice(p, 'Too far away');
    const r = this.structure.place(ax, ay, bx, by, (x, y) => this.#camperOccupied(x, y));
    if (r.error) return this.#notice(p, r.error);
    p.boards--;
    const fallen = this.structure.analyse();
    if (r.board.unstable) this.#notice(p, 'Shaky! Brace it to the ground or another board before it falls');
    if (fallen.length) this.outbox.push({ t: 'fx', kind: 'snap', n: fallen.length });
  }

  #unbuild(p, msg) {
    if (TOOLS[p.tool] !== 'hammer' || p.avatar.mode !== 'out') return;
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x - p.avatar.x, y - p.avatar.y - 0.9) > REACH + 0.6) return;
    const b = this.structure.boardAt(x, y, 0.35);
    if (!b) return;
    this.structure.remove(b.id);
    if (p.boards < BOARD_CARRY) p.boards++; else this.#addPile(0, x, 1);
    const fallen = this.structure.analyse();
    if (fallen.length) this.outbox.push({ t: 'fx', kind: 'snap', n: fallen.length });
  }

  #salvage(p, id) {
    const d = this.structure.debris.get(id);
    if (!d || p.avatar.mode !== 'out' || p.boards >= BOARD_CARRY) return;
    const q = d.body.getPosition();
    if (Math.hypot(q.x - p.avatar.x, q.y - p.avatar.y - 0.5) > WORK_RANGE + 0.5) return;
    this.structure.salvage(id);
    p.boards++;
  }

  // ----- Timber -----

  #near(p, lane, x, range) { return p.avatar.mode === 'out' && p.avatar.lane === lane && Math.abs(p.avatar.x - x) < range; }

  logPose(log) {
    if (log.body) { const q = log.body.getPosition(); return { x: q.x, y: q.y, a: log.body.getAngle() }; }
    return { x: log.x, y: log.y, a: log.a };
  }

  #chop(p) {
    if (TOOLS[p.tool] !== 'axe' || this.tick - (p.lastChop || 0) < CHOP_EVERY) return;
    let best = null;
    for (const t of this.trees) if (t.hp > 0 && this.#near(p, 1, t.x, WORK_RANGE) && (!best || Math.abs(t.x - p.avatar.x) < Math.abs(best.x - p.avatar.x))) best = t;
    if (!best) return;
    p.lastChop = this.tick;
    best.hp--;
    best.lastHit = this.tick;
    if (best.hp > 0) return;
    best.fallDir = best.x >= p.avatar.x ? 1 : -1;
    best.fellTick = this.tick;
    const len = logLength(best);
    const x = Math.max(len / 2 + 0.5, Math.min(this.terrain.length - len / 2 - 0.5, best.x + best.fallDir * (len / 2 + 0.4)));
    this.#addLog(1, len, x);
  }

  #addLog(lane, len, x, y) {
    const log = { id: this.nextId++, lane, len, x, y: 0, a: 0, body: null, carriers: [], saw: 0 };
    this.logs.set(log.id, log);
    if (lane === 1) this.#settleForestLog(log);
    else this.#makeLogBody(log, x, y ?? this.terrain.groundY(x) + 0.6);
    return log;
  }

  #settleForestLog(log) {
    const h = log.len / 2;
    const ya = floorAt(this.floor, log.x - h), yb = floorAt(this.floor, log.x + h);
    log.y = (ya + yb) / 2 + LOG_THICKNESS / 2;
    log.a = Math.atan2(yb - ya, log.len);
  }

  #makeLogBody(log, x, y, a = 0) {
    const body = this.world.createBody({ type: 'dynamic', position: Vec2(x, y), angle: a, angularDamping: 0.6, linearDamping: 0.05 });
    body.createFixture(new Box(log.len / 2, LOG_THICKNESS / 2), { density: LOG_DENSITY, friction: 0.85 });
    log.body = body;
    this.#syncTerrainBodies();
  }

  #removeLog(log) {
    for (const c of log.carriers) { const q = this.players.get(c.pid); if (q) q.carrying = null; }
    if (log.body) this.world.destroyBody(log.body);
    this.logs.delete(log.id);
  }

  #logDistance(p, log) {
    const { x, y, a } = this.logPose(log);
    const ca = Math.cos(a), sa = Math.sin(a);
    const px = p.avatar.x - x, py = p.avatar.y + 0.5 - y;
    const along = Math.max(-log.len / 2, Math.min(log.len / 2, px * ca + py * sa));
    return Math.hypot(px - along * ca, py - along * sa);
  }

  #nearestLog(p, range = WORK_RANGE) {
    let best = null, bd = range;
    for (const log of this.logs.values()) {
      if (log.lane !== p.avatar.lane || p.avatar.mode !== 'out') continue;
      const d = this.#logDistance(p, log);
      if (d < bd) { bd = d; best = log; }
    }
    return best;
  }

  #saw(p) {
    if (TOOLS[p.tool] !== 'saw' || this.tick - (p.lastSaw || 0) < SAW_EVERY) return;
    const log = this.#nearestLog(p);
    if (!log || log.carriers.length) return;
    p.lastSaw = this.tick;
    log.saw++;
    log.lastSaw = this.tick;
    if (log.saw < SAW_WORK) return;
    const { x } = this.logPose(log);
    const lane = log.lane;
    this.#removeLog(log);
    this.#addPile(lane, x, boardsFromLog(log.len));
  }

  #addPile(lane, x, n) {
    for (const pile of this.piles.values()) if (pile.lane === lane && Math.abs(pile.x - x) < 0.8) { pile.n += n; return pile; }
    const y = lane === 1 ? floorAt(this.floor, x) : this.terrain.groundY(x, 47);
    const pile = { id: this.nextId++, lane, x, y, n };
    this.piles.set(pile.id, pile);
    return pile;
  }

  #grab(p, id) {
    if (p.carrying !== null) return this.#release(p);
    const log = this.logs.get(id) || this.#nearestLog(p);
    if (!log || log.carriers.length >= 2 || this.#logDistance(p, log) > WORK_RANGE) return;
    const { x, a } = this.logPose(log);
    const along = (p.avatar.x - x) * Math.cos(a);
    let end = along >= 0 ? 1 : -1;
    if (log.carriers.some(c => c.end === end)) end = -end;
    log.carriers.push({ pid: p.id, end });
    p.carrying = log.id;
  }

  #release(p) {
    if (!p || p.carrying === null) return;
    const log = this.logs.get(p.carrying);
    if (log) log.carriers = log.carriers.filter(c => c.pid !== p.id);
    p.carrying = null;
  }

  // A lone carrier takes the log between lanes; with two carriers, the one
  // who leaves lets go.
  #carryAcrossLanes(p, mode, lane, x) {
    const log = this.logs.get(p.carrying);
    if (!log || mode === 'in' || log.carriers.length > 1) return this.#release(p);
    const pose = this.logPose(log);
    if (lane === 0) {
      log.lane = 0;
      const cx = Math.max(log.len / 2 + 0.5, Math.min(this.terrain.length - log.len / 2 - 0.5, pose.x));
      this.#makeLogBody(log, cx, this.terrain.groundY(cx, 47) + 0.6, 0);
    } else {
      if (log.body) { this.world.destroyBody(log.body); log.body = null; }
      log.lane = 1; log.x = pose.x;
      this.#settleForestLog(log);
    }
  }

  #take(p, id) {
    const pile = this.piles.get(id);
    if (!pile || !this.#near(p, pile.lane, pile.x, WORK_RANGE)) return;
    const n = Math.min(BOARD_CARRY - p.boards, pile.n);
    p.boards += n; pile.n -= n;
    if (pile.n <= 0) this.piles.delete(pile.id);
  }

  #dropBoards(p) {
    if (!p.boards || p.avatar.mode !== 'out') return;
    this.#addPile(p.avatar.lane, p.avatar.x, p.boards);
    p.boards = 0;
  }

  rackPoint() { return this.camperPoint(RACK_POINT.x, RACK_POINT.y); }

  #atRack(p) {
    const r = this.rackPoint();
    return p.avatar.mode === 'out' && p.avatar.lane === 0 && Math.hypot(p.avatar.x - r.x, p.avatar.y + 0.8 - r.y) < RACK_RANGE + 0.6;
  }

  #stow(p) {
    if (!this.#atRack(p)) return;
    if (p.carrying !== null) {
      const log = this.logs.get(p.carrying);
      if (!log || this.rack.logs.length >= RACK_LOGS) return;
      this.rack.logs.push(log.len);
      this.#removeLog(log);
    } else if (p.boards) {
      const n = Math.min(p.boards, RACK_BOARDS - this.rack.boards);
      this.rack.boards += n; p.boards -= n;
    } else return;
    this.#updateCargoMass();
  }

  #unstow(p) {
    if (!this.#atRack(p) || p.carrying !== null) return;
    if (this.rack.boards && p.boards < BOARD_CARRY) {
      const n = Math.min(BOARD_CARRY - p.boards, this.rack.boards);
      this.rack.boards -= n; p.boards += n;
    } else if (this.rack.logs.length) {
      const len = this.rack.logs.pop();
      const r = this.rackPoint();
      const x = r.x + len / 2 + 0.8;
      this.#addLog(0, len, x, Math.max(r.y + 1.2, this.terrain.groundY(x, 47) + 0.6));
    } else return;
    this.#updateCargoMass();
  }

  cargoMass() { return this.rack.boards * BOARD_MASS + this.rack.logs.reduce((s, len) => s + len * LOG_THICKNESS * LOG_DENSITY, 0); }

  // Cargo rides on the roof: it adds mass and raises the centre of gravity.
  #updateCargoMass() {
    const ch = this.camper.chassis;
    ch.resetMassData();
    const extra = this.cargoMass();
    if (extra <= 0) return;
    const md = { mass: 0, center: Vec2(0, 0), I: 0 };
    ch.getMassData(md);
    const roofY = 2.3, m = md.mass + extra;
    const center = Vec2(md.center.x * md.mass / m, (md.center.y * md.mass + roofY * extra) / m);
    ch.setMassData({ mass: m, center, I: md.I + extra * (roofY * roofY + 1.5) });
  }

  #stepLogs(dt) {
    for (const log of this.logs.values()) {
      if (!log.carriers.length) continue;
      const pose = this.logPose(log);
      const ca = Math.cos(pose.a), sa = Math.sin(pose.a);
      const grip = log.len / 2 - 0.3;
      for (const c of [...log.carriers]) {
        const q = this.players.get(c.pid);
        const gx = pose.x + ca * grip * c.end, gy = pose.y + sa * grip * c.end;
        if (!q || !q.connected || q.avatar.lane !== log.lane || q.avatar.mode !== 'out' || Math.abs(q.avatar.x - gx) > CARRY_SLIP) { this.#release(q || { carrying: log.id, id: c.pid }); continue; }
      }
      if (!log.carriers.length) continue;
      if (log.lane === 1) {
        let target = 0;
        for (const c of log.carriers) target += this.players.get(c.pid).avatar.x - c.end * grip;
        target /= log.carriers.length;
        const step = Math.max(-6 * dt, Math.min(6 * dt, target - log.x));
        log.x = Math.max(log.len / 2, Math.min(this.terrain.length - log.len / 2, log.x + step));
        this.#settleForestLog(log);
      } else {
        // Spring each grip toward the carrier's hands, capped per person: one
        // traveller can only lift one end, so a lone carrier drags the log.
        const b = log.body;
        for (const c of log.carriers) {
          const q = this.players.get(c.pid);
          const g = b.getWorldPoint(Vec2(grip * c.end, 0));
          const v = b.getLinearVelocityFromWorldPoint(g);
          let fx = CARRY_K * (q.avatar.x - g.x) - CARRY_C * (v.x - q.avatar.vx);
          let fy = CARRY_K * (q.avatar.y + 0.95 - g.y) - CARRY_C * v.y;
          const f = Math.hypot(fx, fy);
          if (f > CARRY_FORCE) { fx *= CARRY_FORCE / f; fy *= CARRY_FORCE / f; }
          b.applyForce(Vec2(fx, fy), g, true);
        }
      }
    }
  }

  step(dt) {
    this.tick++;
    const c = this.camper;
    const anyone = this.driver();
    for (const j of c.joints) {
      if (anyone && c.brake) { j.setMotorSpeed(0); j.setMaxMotorTorque(CAMPER.brakeTorque); }
      else if (anyone && c.throttle) { j.setMotorSpeed(-c.throttle * CAMPER.maxSpeed); j.setMaxMotorTorque(CAMPER.torque); }
      else { j.setMotorSpeed(0); j.setMaxMotorTorque(anyone ? CAMPER.idleTorque : CAMPER.brakeTorque * 0.5); }
    }

    // Tipping and recovery: travellers outside can push the camper upright.
    const ch = c.chassis;
    const ang = Math.atan2(Math.sin(ch.getAngle()), Math.cos(ch.getAngle()));
    const upright = Math.cos(ang);
    // Tipped once it has lain over for a second; cleared only when nearly upright,
    // so pushing continues until the camper is back on its wheels.
    if (upright < 0.15 && Math.abs(ch.getAngularVelocity()) < 1.5) this.tippedFor += dt;
    if (this.tippedFor > 1.0) this.tipped = true;
    if (upright > 0.92) { this.tippedFor = 0; this.tipped = false; }
    let pushers = 0;
    const pos = ch.getPosition();
    for (const p of this.players.values()) {
      if (p.pushing && p.connected && p.avatar.mode === 'out' && Math.hypot(p.avatar.x - pos.x, p.avatar.y - pos.y) < PUSH_RANGE) pushers++;
    }
    if (pushers && upright < 0.9) {
      // A deliberate, slow lever rather than a physical torque: one traveller
      // rights it in several seconds, two do it about twice as fast.
      const dir = ang > 0 ? -1 : 1;
      const target = dir * PUSH_SPIN * pushers;
      const w = ch.getAngularVelocity();
      ch.setAngularVelocity(w + (target - w) * Math.min(1, dt * 4));
      ch.applyForceToCenter(Vec2(0, -GRAVITY * this.camperMass() * (upright < -0.3 ? 1.0 : upright < 0.3 ? 0.75 : 0.4)), true);
    }

    this.#stepLogs(dt);
    this.world.step(dt, 8, 3);
    if (this.structure.boards.size) {
      const fallen = this.structure.step(dt, this.players.values());
      if (fallen.length) this.outbox.push({ t: 'fx', kind: 'snap', n: fallen.length });
    }
    if (this.tick % 15 === 0) this.#syncTerrainBodies();

    if (this.tick % SLUMP_EVERY === 0 && this.terrain.active.size) {
      const r = this.terrain.slump(this.wet, this.slumpBlocked);
      for (let k = 0; k < r.indices.length; k++) { this.edits.set(r.indices[k], r.values[k]); this.pendingEdits.set(r.indices[k], r.values[k]); }
    }

    if (this.pendingEdits.size) {
      this.outbox.push({ t: 'terrain', i: [...this.pendingEdits.keys()], v: [...this.pendingEdits.values()] });
      this.pendingEdits.clear();
    }
  }

  snapshot() {
    const c = this.camper, ch = c.chassis, p = ch.getPosition(), v = ch.getLinearVelocity();
    const w = [];
    for (const wh of c.wheels) { const q = wh.getPosition(); w.push(round(q.x), round(q.y), round(wh.getAngle())); }
    const d = this.driver();
    return {
      t: 'snap', tick: this.tick,
      c: { x: round(p.x), y: round(p.y), a: round(ch.getAngle()), vx: round(v.x), vy: round(v.y), w, th: c.throttle, mass: Math.round(this.camperMass()) },
      tipped: this.tipped, driver: d ? d.id : null, wet: this.wet,
      players: [...this.players.values()].map(q => ({
        id: q.id, name: q.name, seat: q.seat, soil: round(q.soil), pushing: q.pushing, connected: q.connected,
        tool: q.tool, boards: q.boards, carrying: q.carrying,
        a: { mode: q.avatar.mode, lane: q.avatar.lane || 0, x: round(q.avatar.x), y: round(q.avatar.y), vx: round(q.avatar.vx), vy: round(q.avatar.vy), facing: q.avatar.facing, lx: round(q.avatar.lx), onGround: q.avatar.onGround, walkPhase: round(q.avatar.walkPhase), working: !!q.avatar.working },
      })),
      trees: this.trees.filter(t => t.hp < TREE_HP).map(t => [t.id, t.hp, t.fallDir, t.fellTick, t.lastHit || 0]),
      logs: [...this.logs.values()].map(l => { const q = this.logPose(l); return { id: l.id, lane: l.lane, len: l.len, x: round(q.x), y: round(q.y), a: round(q.a), c: l.carriers.map(c => c.pid), saw: l.saw / SAW_WORK }; }),
      piles: [...this.piles.values()].map(p => ({ id: p.id, lane: p.lane, x: round(p.x), y: round(p.y), n: p.n })),
      rack: { boards: this.rack.boards, logs: this.rack.logs.map(round) },
      structure: this.structure.snapshot(),
    };
  }

  camperMass() { const c = this.camper; return c.chassis.getMass() + c.wheels.reduce((s, w) => s + w.getMass(), 0); }

  // Everything a joining client needs to reconstruct the world.
  welcome(id) {
    return { t: 'welcome', id, seed: this.seed, length: this.terrain.length, edits: { i: [...this.edits.keys()], v: [...this.edits.values()] }, snap: this.snapshot() };
  }

  drain() { const o = this.outbox; this.outbox = []; return o; }
}
