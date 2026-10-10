import { World, Vec2, Edge, Circle, Polygon, WheelJoint } from 'planck';
import {
  CELL, CHUNK, GRAVITY, REACH, BRUSH_RADIUS, SOIL_CAPACITY, STRETCH_LENGTH, INTERIOR, STATION_RANGE, MAX_PLAYERS,
} from './constants.mjs';
import { Terrain } from './terrain.mjs';
import { newAvatar } from './character.mjs';

// Authoritative simulation for one trip: terrain, camper physics, player
// stations. Avatars are simulated by their owning client and reported here.

export const CAMPER = {
  // Chassis outline (local metres, y up). Wheels hang below.
  hull: [[-3.2, -0.75], [2.9, -0.75], [3.35, 0.05], [3.1, 1.85], [-3.2, 1.85]],
  wheelR: 0.68,
  wheelX: [-2.05, 2.05],
  wheelY: -1.05,
  maxSpeed: 12,       // wheel rad/s
  torque: 5600,       // per wheel, N·m
  brakeTorque: 9000,
  idleTorque: 260,
};
const ACTIVE_RANGE = 44;          // metres around the camper with collision built
const DIG_STRENGTH = 70, FILL_STRENGTH = 70;
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
    this.#createCamper(22);
  }

  #createCamper(x) {
    const g = this.terrain.groundY(x);
    const y = g - CAMPER.wheelY + CAMPER.wheelR + 0.15;
    const chassis = this.world.createBody({ type: 'dynamic', position: Vec2(x, y), angularDamping: 0.25 });
    chassis.createFixture(new Polygon(CAMPER.hull.map(([a, b]) => Vec2(a, b))), { density: 145, friction: 0.55 });
    const wheels = [], joints = [];
    for (const wx of CAMPER.wheelX) {
      const wheel = this.world.createBody({ type: 'dynamic', position: Vec2(x + wx, y + CAMPER.wheelY), angularDamping: 0.4 });
      wheel.createFixture(new Circle(CAMPER.wheelR), { density: 70, friction: 1.25, restitution: 0.05 });
      const joint = this.world.createJoint(new WheelJoint({
        enableMotor: true, motorSpeed: 0, maxMotorTorque: CAMPER.idleTorque, frequencyHz: 3.2, dampingRatio: 0.65,
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
    this.#syncTerrainBodies();
  }

  addPlayer(id, name) {
    if (this.players.has(id)) return this.players.get(id);
    if (this.players.size >= MAX_PLAYERS) return null;
    const c = this.camper.chassis.getPosition();
    const avatar = newAvatar(c.x, c.y);
    avatar.mode = 'in';
    avatar.lx = INTERIOR.doorX + 0.6 + this.players.size * 1.4;
    const p = { id, name: String(name || 'Traveller').slice(0, 20), avatar, seat: null, soil: 0, pushing: false, connected: true, lastTool: 0 };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { this.#unseat(this.players.get(id)); this.players.delete(id); }

  setConnected(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    if (!on) { this.#unseat(p); p.pushing = false; }
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
        if (mode === 'out' && p.seat) this.#unseat(p);
        Object.assign(p.avatar, {
          mode, x: num(a.x, p.avatar.x), y: num(a.y, p.avatar.y), vx: num(a.vx, 0), vy: num(a.vy, 0),
          facing: a.facing < 0 ? -1 : 1, lx: Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, num(a.lx, 0))),
          onGround: !!a.onGround, walkPhase: num(a.walkPhase, 0),
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
      if (a.mode === 'out' && Math.abs(wx - a.x) < 0.4 && wy > a.y - 0.1 && wy < a.y + 1.7) return true;
    }
    return false;
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
    if (upright < 0.15 && Math.abs(ch.getAngularVelocity()) < 1.5) this.tippedFor += dt; else if (upright > 0.6) this.tippedFor = 0;
    this.tipped = this.tippedFor > 1.0;
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

    this.world.step(dt, 8, 3);
    if (this.tick % 15 === 0) this.#syncTerrainBodies();

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
      tipped: this.tipped, driver: d ? d.id : null,
      players: [...this.players.values()].map(q => ({
        id: q.id, name: q.name, seat: q.seat, soil: round(q.soil), pushing: q.pushing, connected: q.connected,
        a: { mode: q.avatar.mode, x: round(q.avatar.x), y: round(q.avatar.y), vx: round(q.avatar.vx), vy: round(q.avatar.vy), facing: q.avatar.facing, lx: round(q.avatar.lx), onGround: q.avatar.onGround, walkPhase: round(q.avatar.walkPhase) },
      })),
    };
  }

  camperMass() { const c = this.camper; return c.chassis.getMass() + c.wheels.reduce((s, w) => s + w.getMass(), 0); }

  // Everything a joining client needs to reconstruct the world.
  welcome(id) {
    return { t: 'welcome', id, seed: this.seed, length: this.terrain.length, edits: { i: [...this.edits.keys()], v: [...this.edits.values()] }, snap: this.snapshot() };
  }

  drain() { const o = this.outbox; this.outbox = []; return o; }
}
