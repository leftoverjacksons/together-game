import { World, Vec2, Edge, Circle, Polygon, WheelJoint } from 'planck';
import { CELL, CHUNK, GRAVITY, REACH, BRUSH_RADIUS, SOIL_CAPACITY, INTERIOR, STATION_RANGE, MAX_PLAYERS } from '../constants.mjs';
import { CAMPER } from '../sim.mjs';
import { newAvatar } from '../character.mjs';
import {
  LANE_COUNT, LANE_LENGTH, LANE_CHANGE_TIME, RESCUE_TIME, BIRDS, DIVIDER_TYPES,
  generateLaneWorld, makeTerrains, camperGapAt, segmentAt, waterLevel,
} from './world.mjs';

// Authoritative simulation for the lane prototype. Same session interface as
// Sim (addPlayer, handle, step, snapshot, welcome, drain), so the server and
// LocalSession can run either.
//
// Physics stays 2D: one planck world holds every lane's terrain, each lane in
// its own collision category. The camper collides only with the lane it is in,
// or with both lanes while crossing a gap (where the generator made them level).

const ACTIVE_RANGE = 44;
const DIG_STRENGTH = 70, FILL_STRENGTH = 70;
const SLUMP_EVERY = 6;
const PUSH_SPIN = 0.45, PUSH_RANGE = 4.8;
const RESCUE_RANGE = 1.8;
const CAMPER_BIT = 1 << 4;
const laneBit = lane => 1 << lane;
const round = v => Math.round(v * 1000) / 1000;

export class LaneSim {
  constructor(seed, length = LANE_LENGTH) {
    this.mode = 'lanes';
    this.seed = seed >>> 0;
    this.tick = 0;
    this.lw = generateLaneWorld(this.seed, length);
    this.terrains = makeTerrains(this.lw);
    this.world = new World({ gravity: Vec2(0, GRAVITY) });
    this.players = new Map();
    this.edits = this.terrains.map(() => new Map());
    this.pending = this.terrains.map(() => new Map());
    this.chunkBodies = new Map();    // lane * 1e6 + chunk id -> { body, version }
    this.outbox = [];
    this.tippedFor = 0;
    this.tipped = false;
    const walls = this.world.createBody({ type: 'static' });
    for (const x of [0, length]) walls.createFixture(new Edge(Vec2(x, 0), Vec2(x, 200)), { friction: 0.3, filterCategoryBits: 0x7, filterMaskBits: 0xffff });
    this.animals = this.lw.animals.map(a => ({ ...a, y: this.terrains[a.lane].groundY(a.x), state: 'stuck', progress: 0, spot: -1 }));
    this.rescued = 0;
    this.#createCamper(22, 1);
  }

  get length() { return this.lw.length; }

  #createCamper(x, lane) {
    const g = this.terrains[lane].groundY(x);
    const y = g - CAMPER.wheelY + CAMPER.wheelR + 0.15;
    const filter = { filterCategoryBits: CAMPER_BIT, filterMaskBits: laneBit(lane) };
    const chassis = this.world.createBody({ type: 'dynamic', position: Vec2(x, y), angularDamping: 0.5 });
    chassis.createFixture(new Polygon(CAMPER.hull.map(([a, b]) => Vec2(a, b))), { density: 145, friction: 0.55, ...filter });
    const wheels = [], joints = [];
    for (const wx of CAMPER.wheelX) {
      const wheel = this.world.createBody({ type: 'dynamic', position: Vec2(x + wx, y + CAMPER.wheelY), angularDamping: 0.4 });
      wheel.createFixture(new Circle(CAMPER.wheelR), { density: 70, friction: 1.25, restitution: 0.05, ...filter });
      const joint = this.world.createJoint(new WheelJoint({
        enableMotor: true, motorSpeed: 0, maxMotorTorque: CAMPER.idleTorque, frequencyHz: CAMPER.springHz, dampingRatio: CAMPER.springDamping,
      }, chassis, wheel, wheel.getPosition(), Vec2(0, 1)));
      wheels.push(wheel); joints.push(joint);
    }
    this.camper = { chassis, wheels, joints, throttle: 0, brake: false, lane, change: null };
    this.#syncTerrainBodies(true);
  }

  #setCamperMask(mask) {
    const { chassis, wheels } = this.camper;
    for (const b of [chassis, ...wheels]) for (let f = b.getFixtureList(); f; f = f.getNext()) f.setFilterData({ groupIndex: 0, categoryBits: CAMPER_BIT, maskBits: mask });
  }

  #syncTerrainBodies(force = false) {
    const cxw = this.camper.chassis.getPosition().x, size = CHUNK * CELL;
    const wanted = new Set();
    this.terrains.forEach((t, lane) => {
      const cx0 = Math.max(0, Math.floor((cxw - ACTIVE_RANGE) / size)), cx1 = Math.min(t.chunksX - 1, Math.floor((cxw + ACTIVE_RANGE) / size));
      for (let cy = 0; cy < t.chunksY; cy++) for (let cx = cx0; cx <= cx1; cx++) wanted.add(lane * 1e6 + cy * t.chunksX + cx);
    });
    for (const [key, cb] of this.chunkBodies) if (!wanted.has(key)) { this.world.destroyBody(cb.body); this.chunkBodies.delete(key); }
    for (const key of wanted) {
      const lane = Math.floor(key / 1e6), id = key % 1e6, t = this.terrains[lane];
      const cb = this.chunkBodies.get(key);
      const version = t.chunkVersion[id];
      if (cb && cb.version === version && !force) continue;
      if (cb) this.world.destroyBody(cb.body);
      const cx = id % t.chunksX, cy = (id - cx) / t.chunksX;
      const { segments } = t.extractChunk(cx, cy);
      const body = this.world.createBody({ type: 'static' });
      for (let k = 0; k < segments.length; k += 4) {
        const dx = segments[k + 2] - segments[k], dy = segments[k + 3] - segments[k + 1];
        if (dx * dx + dy * dy < 1e-4) continue;
        body.createFixture(new Edge(Vec2(segments[k], segments[k + 1]), Vec2(segments[k + 2], segments[k + 3])), { friction: 0.9, filterCategoryBits: laneBit(lane), filterMaskBits: 0xffff });
      }
      this.chunkBodies.set(key, { body, version });
    }
  }

  addPlayer(id, name) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= MAX_PLAYERS) return null;
    const c = this.camper.chassis.getPosition();
    const avatar = newAvatar(c.x, c.y);
    avatar.mode = 'in';
    avatar.lane = this.camper.lane;
    avatar.lx = INTERIOR.doorX + 0.6 + this.players.size * 1.4;
    const p = { id, name: String(name || 'Traveller').slice(0, 20), avatar, seat: null, soil: 0, pushing: false, rescuing: false, connected: true, lastTool: 0, index: this.players.size };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { const p = this.players.get(id); this.#unseat(p); this.players.delete(id); }

  setConnected(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    if (!on) { this.#unseat(p); p.pushing = false; p.rescuing = false; }
  }

  #unseat(p) {
    if (p && p.seat === 'cab') { this.camper.throttle = 0; this.camper.brake = false; }
    if (p) p.seat = null;
  }

  driver() { for (const p of this.players.values()) if (p.seat === 'cab') return p; return null; }
  #notice(p, msg) { this.outbox.push({ t: 'notice', to: p.id, msg }); }

  handle(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'avatar': {
        const a = msg.a || {};
        const num = (v, d) => (Number.isFinite(v) ? v : d);
        const mode = a.mode === 'in' ? 'in' : 'out';
        if (mode === 'out' && p.seat) this.#unseat(p);
        const lane = Number.isInteger(a.lane) && a.lane >= 0 && a.lane < LANE_COUNT ? a.lane : p.avatar.lane;
        const cross = a.cross && Number.isInteger(a.cross.to) ? { from: a.cross.from | 0, to: a.cross.to | 0, t: Math.max(0, Math.min(1, num(a.cross.t, 0))) } : null;
        Object.assign(p.avatar, {
          mode, lane: mode === 'in' ? this.camper.lane : lane, cross,
          x: num(a.x, p.avatar.x), y: num(a.y, p.avatar.y), vx: num(a.vx, 0), vy: num(a.vy, 0),
          facing: a.facing < 0 ? -1 : 1, lx: Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, num(a.lx, 0))),
          onGround: !!a.onGround, walkPhase: num(a.walkPhase, 0), working: a.working === true,
        });
        break;
      }
      case 'seat': {
        if (p.avatar.mode !== 'in' || Math.abs(p.avatar.lx - INTERIOR.seatX) > STATION_RANGE + 0.2) break;
        if ([...this.players.values()].some(q => q !== p && q.seat === 'cab')) break;
        p.seat = 'cab';
        break;
      }
      case 'unseat': this.#unseat(p); break;
      case 'drive': {
        if (p.seat !== 'cab') break;
        this.camper.throttle = Math.max(-1, Math.min(1, Number(msg.throttle) || 0));
        this.camper.brake = msg.brake === true;
        break;
      }
      case 'lane': this.#laneChange(p, msg.dir > 0 ? 1 : -1); break;
      case 'push': p.pushing = msg.on === true; break;
      case 'rescue': p.rescuing = msg.on === true; break;
      case 'dig': case 'fill': this.#tool(p, msg); break;
    }
  }

  #laneChange(p, dir) {
    const c = this.camper;
    if (p.seat !== 'cab' || c.change) return;
    const to = c.lane + dir;
    if (to < 0 || to >= LANE_COUNT) return;
    const x = c.chassis.getPosition().x;
    if (Math.cos(c.chassis.getAngle()) < 0.85) return this.#notice(p, 'Level out before changing lanes.');
    if (!camperGapAt(this.lw, c.lane, to, x)) {
      const seg = segmentAt(this.lw.dividers[Math.min(c.lane, to)], x);
      return this.#notice(p, `No way through ${DIVIDER_TYPES[seg.type].label} here. Find a gap.`);
    }
    c.change = { from: c.lane, to, t: 0 };
    this.#setCamperMask(laneBit(c.lane) | laneBit(to));
  }

  #tool(p, msg) {
    if (this.tick - p.lastTool < 4) return;
    const x = Number(msg.x), y = Number(msg.y);
    const a = p.avatar;
    if (!Number.isFinite(x) || !Number.isFinite(y) || a.mode !== 'out' || a.cross || msg.lane !== a.lane) return;
    if ((x - a.x) ** 2 + (y - a.y - 0.9) ** 2 > REACH * REACH) return;
    p.lastTool = this.tick;
    const t = this.terrains[a.lane];
    let r;
    if (msg.t === 'dig') {
      if (p.soil >= SOIL_CAPACITY - 1e-3) return;
      r = t.dig(x, y, BRUSH_RADIUS, DIG_STRENGTH, SOIL_CAPACITY - p.soil);
      p.soil = Math.min(SOIL_CAPACITY, p.soil + r.volume);
    } else {
      if (p.soil <= 1e-3) return;
      r = t.fill(x, y, BRUSH_RADIUS, FILL_STRENGTH, p.soil, (wx, wy) => this.#occupied(a.lane, wx, wy));
      p.soil = Math.max(0, p.soil - r.volume);
    }
    this.#record(a.lane, r);
  }

  #record(lane, r) {
    for (let k = 0; k < r.indices.length; k++) { this.edits[lane].set(r.indices[k], r.values[k]); this.pending[lane].set(r.indices[k], r.values[k]); }
  }

  #occupied(lane, wx, wy) {
    const c = this.camper;
    if (c.lane === lane || (c.change && c.change.to === lane)) {
      const pt = Vec2(wx, wy);
      for (const b of [c.chassis, ...c.wheels]) {
        for (let f = b.getFixtureList(); f; f = f.getNext()) if (f.testPoint(pt)) return true;
        const q = b.getPosition();
        if (b !== c.chassis && (q.x - wx) ** 2 + (q.y - wy) ** 2 < (CAMPER.wheelR + 0.2) ** 2) return true;
      }
    }
    for (const q of this.players.values()) {
      const a = q.avatar;
      if (a.mode === 'out' && a.lane === lane && Math.abs(wx - a.x) < 0.4 && wy > a.y - 0.1 && wy < a.y + 1.7) return true;
    }
    return false;
  }

  #stepAnimals(dt) {
    for (const an of this.animals) {
      if (an.state !== 'stuck') continue;
      let workers = 0;
      for (const p of this.players.values()) {
        const a = p.avatar;
        if (!p.rescuing || !p.connected || a.mode !== 'out' || a.cross) continue;
        // Birds can be reached from a neighbouring lane; everything else from its own.
        const laneOk = a.lane === an.lane || (BIRDS.has(an.kind) && Math.abs(a.lane - an.lane) === 1);
        if (laneOk && Math.abs(a.x - an.x) < RESCUE_RANGE) workers++;
      }
      if (!workers) { an.progress = Math.max(0, an.progress - dt * 0.15); continue; }
      an.progress += workers * dt / (RESCUE_TIME[an.kind] || 3);
      if (an.progress >= 1) {
        an.state = 'riding';
        an.spot = this.rescued % 8;
        this.rescued++;
        this.outbox.push({ t: 'fx', kind: 'rescued', animal: an.kind, id: an.id });
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

    // Crossing a gap.
    if (c.change) {
      c.change.t += dt / LANE_CHANGE_TIME;
      if (c.change.t >= 1) {
        c.lane = c.change.to;
        c.change = null;
        this.#setCamperMask(laneBit(c.lane));
        for (const p of this.players.values()) if (p.avatar.mode === 'in') p.avatar.lane = c.lane;
      }
    }

    // Water drags at the camper: pools in its lane, or a ford while crossing.
    const ch = c.chassis, pos = ch.getPosition(), vel = ch.getLinearVelocity();
    let wet = 0;
    const level = waterLevel(this.lw, c.lane, pos.x);
    if (level !== null) wet = Math.max(0, Math.min(1, (level - (pos.y - 1.9)) / 1.6));
    if (c.change && segmentAt(this.lw.dividers[Math.min(c.change.from, c.change.to)], pos.x).type === 'ford') wet = Math.max(wet, 0.45);
    if (wet > 0) ch.applyForceToCenter(Vec2(-vel.x * this.camperMass() * 1.1 * wet, 0), true);
    c.wet = wet;

    // Tipping and recovery, as in the main game.
    const ang = Math.atan2(Math.sin(ch.getAngle()), Math.cos(ch.getAngle()));
    const upright = Math.cos(ang);
    if (upright < 0.15 && Math.abs(ch.getAngularVelocity()) < 1.5) this.tippedFor += dt;
    if (this.tippedFor > 1.0) this.tipped = true;
    if (upright > 0.7) { this.tippedFor = 0; this.tipped = false; }
    let pushers = 0;
    for (const p of this.players.values()) {
      const a = p.avatar;
      if (p.pushing && p.connected && a.mode === 'out' && a.lane === c.lane && Math.hypot(a.x - pos.x, a.y - pos.y) < PUSH_RANGE) pushers++;
    }
    if (pushers && upright < 0.9) {
      const dir = ang > 0 ? -1 : 1;
      const target = dir * PUSH_SPIN * pushers;
      const w = ch.getAngularVelocity();
      ch.setAngularVelocity(w + (target - w) * Math.min(1, dt * 4));
      ch.applyForceToCenter(Vec2(0, -GRAVITY * this.camperMass() * (upright < -0.3 ? 1.0 : upright < 0.3 ? 0.75 : 0.4)), true);
    }

    this.#stepAnimals(dt);
    this.world.step(dt, 8, 3);
    if (this.tick % 15 === 0) this.#syncTerrainBodies();

    if (this.tick % SLUMP_EVERY === 0) this.terrains.forEach((t, lane) => { if (t.active.size) this.#record(lane, t.slump(false)); });
    this.pending.forEach((m, lane) => {
      if (!m.size) return;
      this.outbox.push({ t: 'terrain', lane, i: [...m.keys()], v: [...m.values()] });
      m.clear();
    });
  }

  camperMass() { const c = this.camper; return c.chassis.getMass() + c.wheels.reduce((s, w) => s + w.getMass(), 0); }

  snapshot() {
    const c = this.camper, ch = c.chassis, p = ch.getPosition(), v = ch.getLinearVelocity();
    const w = [];
    for (const wh of c.wheels) { const q = wh.getPosition(); w.push(round(q.x), round(q.y), round(wh.getAngle())); }
    const d = this.driver();
    return {
      t: 'snap', tick: this.tick,
      c: { x: round(p.x), y: round(p.y), a: round(ch.getAngle()), vx: round(v.x), vy: round(v.y), w, th: c.throttle, lane: c.lane, ch: c.change && { from: c.change.from, to: c.change.to, t: round(c.change.t) }, wet: round(c.wet || 0) },
      tipped: this.tipped, driver: d ? d.id : null,
      players: [...this.players.values()].map(q => ({
        id: q.id, name: q.name, seat: q.seat, soil: round(q.soil), pushing: q.pushing, connected: q.connected, index: q.index,
        a: { mode: q.avatar.mode, lane: q.avatar.lane, cross: q.avatar.cross, x: round(q.avatar.x), y: round(q.avatar.y), vx: round(q.avatar.vx), vy: round(q.avatar.vy), facing: q.avatar.facing, lx: round(q.avatar.lx), onGround: q.avatar.onGround, walkPhase: round(q.avatar.walkPhase), working: !!q.avatar.working },
      })),
      animals: this.animals.map(a => ({ id: a.id, kind: a.kind, lane: a.lane, x: a.x, y: round(a.y), state: a.state, p: round(a.progress), spot: a.spot })),
      rescued: this.rescued,
    };
  }

  welcome(id) {
    return { t: 'welcome', mode: 'lanes', id, seed: this.seed, length: this.lw.length, edits: this.edits.map(m => ({ i: [...m.keys()], v: [...m.values()] })), snap: this.snapshot() };
  }

  drain() { const o = this.outbox; this.outbox = []; return o; }
}
