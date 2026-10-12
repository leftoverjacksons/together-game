import { World, Vec2, Edge, Circle, Polygon, Box, WheelJoint } from 'planck';
import {
  CELL, CHUNK, GRAVITY, REACH, BRUSH_RADIUS, SOIL_CAPACITY, STRETCH_LENGTH, INTERIOR, STATION_RANGE, MAX_PLAYERS,
  TOOLS, BOARD_CARRY, RACK_BOARDS, RACK_LOGS, BOARD_MASS, LOG_DENSITY, RACK_POINT, RACK_RANGE, WORK_RANGE,
  TOOL_SLOTS, START_TOOLS, START_TOOLBOX, TOOLBOX_SIZE, ITEM_RANGE, GIVE_RANGE, WINCH, TOOL_NAMES, STORAGE_RANGE,
} from './constants.mjs';
import { mulberry32 } from './rng.mjs';
import { Terrain } from './terrain.mjs';
import { newAvatar } from './character.mjs';
import { Structure } from './structure.mjs';
import { Weather } from './weather.mjs';
import { FORK, forkZone } from './fork.mjs';
import { ANIMALS, RESCUE_RANGE, HELP_STAMINA, RIDE_SPOTS, placeAnimals } from './animals.mjs';
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
const DIG_STRENGTH = 70, FILL_STRENGTH = 70, PICK_STRENGTH = 30;
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
    this.weather = new Weather(this.seed);
    this.wet = false;               // rain: slumping, slick ground (follows the weather)
    this.floor = forestFloor(this.terrain);
    this.trees = generateTrees(this.terrain, this.seed).map(t => ({ ...t, hp: TREE_HP, fallDir: 0, fellTick: 0 }));
    this.logs = new Map();          // id -> { id, lane, len, x, y, a, body, carriers: [{ pid, end }], saw }
    this.piles = new Map();         // id -> { id, lane, x, y, n }
    this.rack = { boards: 0, logs: [] };
    this.nextId = 1;
    this.items = new Map();         // id -> { id, kind, lane, x, y } tools lying in the world
    this.toolbox = [...START_TOOLBOX];
    this.winch = { state: 'stowed', carrier: null, anchor: null, length: 0, reel: 0, tension: 0 };
    this.structure = new Structure(this.world, this.terrain);
    this.slumpBlocked = (ax, ay, bx, by) => this.structure.boards.size > 0 && this.structure.blocksSegment(ax, ay, bx, by);
    this.#createCamper(22);
    this.flags = new Map();         // id -> { id, owner, kind: 'good'|'blocked', x, y }
    this.#placeFinds();
    this.#placeAnimals();
    this.#furnishForks();
  }

  // ----- Animals -----

  #placeAnimals() {
    this.animals = [];
    this.rescued = 0;
    this.struggle = { t: 0, dir: 1, active: false };
    for (const spec of placeAnimals(this.terrain.length, this.seed)) {
      const def = ANIMALS[spec.kind];
      const lane = def.lane;
      const x = lane === 0 ? this.#clearOfForks(spec.x) : spec.x;
      const y = lane === 1 ? floorAt(this.floor, x) : this.terrain.groundY(x);
      const a = { id: this.nextId++, kind: spec.kind, state: 'waiting', lane, x, y, progress: 0, facing: 1, stamina: 1, bark: 0, spot: -1, carrier: null, pin: null };
      if (def.rescue === 'dig') {
        // A collapsed burrow: a mound of soil over the rabbit.
        for (const [dx, dy, r] of [[0, 0.35, 0.8], [0, 0.75, 0.75], [-0.6, 0.3, 0.6], [0.6, 0.3, 0.6], [0, 1.05, 0.55]]) {
          const res = this.terrain.fill(x + dx, y + dy, r, 255, 10, null);
          for (let k = 0; k < res.indices.length; k++) this.edits.set(res.indices[k], res.values[k]);
        }
        // The burrow mound is settled ground: rain should not wash the rabbit free.
        this.terrain.loose.fill(0);
        this.terrain.active.clear();
      }
      if (def.rescue === 'saw') a.pin = this.#addLog(0, 2.4, x + 0.2, y + 0.3).id;
      this.animals.push(a);
    }
  }

  // Route forks: nothing else spawns inside one; the cave holds a fox den
  // (reachable only on foot) and a spare jack on its floor.
  #clearOfForks(x) {
    for (const f of this.terrain.forks) if (x > f.x0 - 8 && x < f.x0 + FORK.length + 8) return f.x0 + FORK.length + 12;
    return x;
  }

  #furnishForks() {
    for (const f of this.terrain.forks) {
      const dx = (FORK.den[0] + FORK.den[1]) / 2;
      this.animals.push({ id: this.nextId++, kind: 'fox', state: 'waiting', lane: 0, x: f.x0 + dx, y: f.h0 - FORK.den[2], progress: 0, facing: -1, stamina: 1, bark: 0, spot: -1, carrier: null, pin: null, den: true });
      const jack = { id: this.nextId++, kind: 'jack', lane: 0, x: f.x0 + 37, y: f.h0 - FORK.floor };
      this.items.set(jack.id, jack);
    }
  }

  // Scouting: plant a flag where you stand ('good' or 'blocked'), or pull up your own nearby flag.
  #flag(p, kind) {
    const a = p.avatar;
    if (a.mode !== 'out' || (a.lane || 0) !== 0) return;
    const own = [...this.flags.values()].find(f => f.owner === p.id && Math.hypot(f.x - a.x, f.y - a.y) < 1.5);
    if (own) { this.flags.delete(own.id); return; }
    const mine = [...this.flags.values()].filter(f => f.owner === p.id);
    if (mine.length >= 4) this.flags.delete(mine[0].id);
    const f = { id: this.nextId++, owner: p.id, kind: kind === 'blocked' ? 'blocked' : 'good', x: a.x, y: a.y };
    this.flags.set(f.id, f);
    this.outbox.push({ t: 'fx', kind: 'flag', by: p.id, name: p.name, flag: f.kind, zone: forkZone(this.terrain.forks, f.x, f.y) });
  }

  #animalGround(a) {
    return a.lane === 1 ? floorAt(this.floor, a.x) : this.terrain.groundY(a.x, a.y + 2.5);
  }

  #rescue(a) {
    const def = ANIMALS[a.kind];
    a.progress = 1; a.carrier = null;
    if (def.size === 'small') {
      const used = new Set(this.animals.filter(o => o.state === 'riding').map(o => o.spot));
      a.state = 'riding';
      a.spot = RIDE_SPOTS.findIndex((_, k) => !used.has(k));
      this.rescued++;
      this.#updateCargoMass();
    } else if (def.size === 'dog') a.state = 'companion';
    else { a.state = 'following'; a.lane = 1; }
    this.outbox.push({ t: 'fx', kind: 'rescued', animal: a.kind, x: a.x });
  }

  // The dog hops into the camper when everyone is aboard, trots around inside
  // after the travellers, and hops out when someone gets off and it has stopped.
  // Returns true when the dog's movement is fully handled here.
  #dogAboard(a, dt, outside, cp, cv) {
    const inside = [...this.players.values()].filter(q => q.connected && q.avatar.mode === 'in');
    const door = this.camperPoint(INTERIOR.doorX, INTERIOR.floorY);
    if (a.state === 'riding-dog') {
      if (outside.length && Math.abs(cv.x) < 1.0) {
        Object.assign(a, { state: 'companion', x: door.x - 0.6, y: this.terrain.groundY(door.x - 0.6, door.y + 2), lane: 0, hop: this.tick });
        return true;
      }
      const walker = inside.find(q => !q.seat) || inside[0];
      const target = walker ? (walker.seat ? INTERIOR.seatX - 0.9 : walker.avatar.lx - 0.7 * (walker.avatar.facing || 1)) : INTERIOR.doorX + 0.6;
      const step = Math.max(-2.8 * dt, Math.min(2.8 * dt, target - a.lx));
      if (Math.abs(step) > 0.002) a.facing = Math.sign(step);
      a.moving = Math.abs(step) > 0.01;
      a.lx = Math.max(INTERIOR.minX + 0.2, Math.min(INTERIOR.maxX - 0.3, a.lx + step));
      a.x = cp.x; a.lane = 0;
      return true;
    }
    if (a.state !== 'companion' || outside.length || !inside.length) return false;
    // Everyone is aboard: run to the door and hop in (or catch up if left far behind).
    if (Math.abs(a.x - door.x) > 40) a.x = door.x - 2;
    if (Math.abs(a.x - door.x) < 0.7 && Math.abs(cv.x) < 4) {
      Object.assign(a, { state: 'riding-dog', lx: INTERIOR.doorX + 0.4, hop: this.tick, moving: false });
      return true;
    }
    if (a.lane !== 0) { a.lane = 0; a.y = this.#animalGround(a); }
    const step = Math.max(-8 * dt, Math.min(8 * dt, door.x - a.x));
    a.facing = Math.sign(step) || a.facing;
    a.moving = Math.abs(step) > 0.01;
    a.x += step;
    a.y = this.#animalGround(a);
    return true;
  }

  #carryAnimal(p, id) {
    const a = this.animals.find(o => o.id === id);
    if (!a) return;
    if (a.state === 'carried' && a.carrier === p.id) { a.state = 'waiting'; a.carrier = null; a.lane = p.avatar.lane || 0; return; }
    if (a.state !== 'waiting' || ANIMALS[a.kind].rescue !== 'carry' || p.avatar.mode !== 'out') return;
    if ((p.avatar.lane || 0) !== a.lane || Math.abs(p.avatar.x - a.x) > RESCUE_RANGE) return;
    a.state = 'carried'; a.carrier = p.id;
  }

  #stepAnimals(dt) {
    const ch = this.camper.chassis, cp = ch.getPosition(), cv = ch.getLinearVelocity();
    // Struggling: someone is driving but the camper is barely moving.
    const d = this.driver(), th = this.camper.throttle;
    const along = cv.x * Math.sign(th || 1);
    const S = this.struggle;
    if (d && th && along < 1.0) S.t += dt; else if (!th || along > 2.5) S.t = 0;
    S.active = S.t > 0.6;
    S.dir = Math.sign(th || S.dir);
    const outside = [...this.players.values()].filter(q => q.connected && q.avatar.mode === 'out');
    const anyoneDriving = !!d && Math.abs(cv.x) > 1.5;
    for (const a of this.animals) {
      const def = ANIMALS[a.kind];
      if (a.state === 'waiting') {
        if (def.rescue === 'free') {
          const workers = outside.filter(q => q.rescuing && (q.avatar.lane || 0) === a.lane && Math.abs(q.avatar.x - a.x) < RESCUE_RANGE && Math.abs(q.avatar.y - a.y) < 2.2).length;
          if (workers) a.progress = Math.min(1, a.progress + (dt / def.work) * workers);
          else a.progress = Math.max(0, a.progress - dt * 0.05);
          if (a.progress >= 1) this.#rescue(a);
        } else if (def.rescue === 'dig' && this.tick % 10 === 0) {
          if (!this.terrain.solidAt(a.x, a.y + 0.3) && !this.terrain.solidAt(a.x, a.y + 0.6)) this.#rescue(a);
        } else if (def.rescue === 'saw' && this.tick % 10 === 0) {
          const log = this.logs.get(a.pin);
          if (!log || Math.hypot(this.logPose(log).x - a.x, this.logPose(log).y - a.y) > 1.6) this.#rescue(a);
        }
        continue;
      }
      if (a.state === 'carried') {
        const q = this.players.get(a.carrier);
        if (!q || !q.connected) { a.state = 'waiting'; a.carrier = null; continue; }
        a.x = q.avatar.x + 0.35 * (q.avatar.facing || 1); a.y = q.avatar.y + 1.0; a.lane = q.avatar.lane || 0; a.facing = q.avatar.facing;
        if (this.nearCamper(q)) this.#rescue(a);
        continue;
      }
      if (a.state === 'riding') continue;
      // Moving animals: pick a target, walk or fly toward it.
      let tx = a.x, ty = null, lane = a.lane, help = false;
      if (def.size === 'dog') {
        if (this.#dogAboard(a, dt, outside, cp, cv)) continue;
        const seek = this.animals.find(o => o.state === 'waiting' && Math.abs(o.x - a.x) < 35);
        const leader = outside.sort((u, v) => Math.abs(u.avatar.x - a.x) - Math.abs(v.avatar.x - a.x))[0];
        if (seek) { tx = seek.x - Math.sign(seek.x - a.x) * 2.2; lane = seek.lane; if (Math.abs(tx - a.x) < 1.5 && this.tick - a.bark > 180) a.bark = this.tick; }
        else if (leader) { tx = leader.avatar.x - (leader.avatar.facing || 1) * 1.6; lane = leader.avatar.lane || 0; }
        else tx = cp.x - 3.5;
      } else {
        const can = a.stamina > HELP_STAMINA.min;
        help = S.active && can && (def.helps !== 'lift' || ch.getAngle() * S.dir > 0.12 || S.t > 1.5);
        if (help) a.stamina = Math.max(0, a.stamina - HELP_STAMINA.drain * dt);
        else a.stamina = Math.min(1, a.stamina + HELP_STAMINA.recover * dt);
        const offset = { deer: -5, moose: -8.5, bear: -11.5, hawk: 0 }[a.kind];
        if (help && def.helps === 'pull') { tx = cp.x + S.dir * 6; lane = 0; }
        else if (help && def.helps === 'push') { tx = cp.x - S.dir * 4.4; lane = 0; }
        else tx = cp.x + offset;
        if (a.kind !== 'hawk' && !help) lane = 1;
        if (a.kind === 'hawk') { lane = 0; ty = help ? cp.y + 2.9 : cp.y + 5 + Math.sin(this.tick / 40) * 0.6; tx = help ? cp.x + S.dir * 1.2 : tx + Math.sin(this.tick / 70) * 4; }
        if (help) {
          const f = def.force;
          if (def.helps === 'lift') ch.applyForce(Vec2(0, f), ch.getWorldPoint(Vec2(1.2 * S.dir, 1.5)), true);
          else { const ax = ch.getWorldVector(Vec2(1, 0)); ch.applyForceToCenter(Vec2(ax.x * f * S.dir, ax.y * f * S.dir), true); }
        }
      }
      a.help = help;
      if (lane !== a.lane) { a.lane = lane; a.y = this.#animalGround(a); }
      const speed = def.size === 'dog' ? 7.5 : 10;
      const step = Math.max(-speed * dt, Math.min(speed * dt, tx - a.x));
      if (Math.abs(step) > 0.002) a.facing = Math.sign(step);
      a.moving = Math.abs(step) > 0.01;
      a.x = Math.max(1, Math.min(this.terrain.length - 1, a.x + step));
      if (ty !== null) a.y += (ty - a.y) * Math.min(1, dt * 3);
      else a.y = this.#animalGround(a);
    }
  }

  // Finds: spare tools lying along the stretch, mostly among the trees.
  #placeFinds() {
    const rand = mulberry32(this.seed ^ 0xf1d5);
    const kinds = ['pickaxe', 'jack', 'pickaxe', 'jack', 'axe', 'saw'];
    let x = 55 + rand() * 30;
    for (const kind of kinds) {
      if (x > this.terrain.length - 40) break;
      const lane = rand() < 0.7 ? 1 : 0;
      this.#addItem(kind, lane, lane === 0 ? this.#clearOfForks(x) : x);
      x += 70 + rand() * 60;
    }
  }

  // fromY: drop from this height (a traveller's feet) rather than from the sky,
  // so a tool dropped in a cave stays in the cave.
  #addItem(kind, lane, x, fromY = null) {
    const y = lane === 1 ? floorAt(this.floor, x) : this.terrain.groundY(x, fromY === null ? 47 : fromY + 1);
    const item = { id: this.nextId++, kind, lane, x, y };
    this.items.set(item.id, item);
    return item;
  }

  toolOf(p) { return p.tools[p.tool] || null; }

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
    const tools = [...START_TOOLS[this.players.size % START_TOOLS.length]];
    const p = { id, name: String(name || 'Traveller').slice(0, 20), avatar, seat: null, soil: 0, pushing: false, connected: true, lastTool: 0, tool: 0, tools, boards: 0, carrying: null };
    this.players.set(id, p);
    return p;
  }

  removePlayer(id) { const p = this.players.get(id); this.#unseat(p); this.#release(p); this.#dropHook(p); this.players.delete(id); }

  setConnected(id, on) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = on;
    if (!on) { this.#unseat(p); this.#release(p); this.#dropHook(p); p.pushing = false; }
  }

  #unseat(p) {
    if (p && p.seat === 'cab') { this.camper.throttle = 0; this.camper.brake = false; }
    if (p && (p.seat === 'winch' || p.seat === 'cab')) this.winch.reel = 0;
    if (p) p.seat = null;
  }

  // The winch can be run from its station, or from the wheel when travelling alone.
  #canWinch(p) {
    if (p.seat === 'winch') return true;
    const others = [...this.players.values()].filter(q => q.connected && q !== p).length;
    return p.seat === 'cab' && others === 0;
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
        if (mode === 'in' && this.winch.carrier === p.id) this.#dropHook(p);
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
        const station = msg.station === 'winch' ? 'winch' : 'cab';
        const at = station === 'winch' ? INTERIOR.winchX : INTERIOR.seatX;
        if (p.avatar.mode !== 'in' || Math.abs(p.avatar.lx - at) > STATION_RANGE + 0.2) break;
        if ([...this.players.values()].some(q => q !== p && q.seat === station)) break;
        this.#unseat(p);
        p.seat = station;
        break;
      }
      case 'winch': if (this.#canWinch(p)) this.winch.reel = Math.max(-1, Math.min(1, msg.reel | 0)); break;
      case 'hook': this.#hook(p); break;
      case 'pickup': this.#pickup(p, msg.id); break;
      case 'droptool': this.#dropTool(p, msg.slot); break;
      case 'give': this.#give(p, msg.slot); break;
      case 'store': this.#store(p, msg.slot | 0); break;
      case 'retrieve': this.#retrieve(p, msg.index | 0, msg.slot); break;
      case 'swapSlots': {
        const a = msg.a | 0, b = msg.b | 0;
        if (a >= 0 && b >= 0 && a < TOOL_SLOTS && b < TOOL_SLOTS) [p.tools[a], p.tools[b]] = [p.tools[b], p.tools[a]];
        break;
      }
      case 'stowBoards': if (this.nearCamper(p)) this.#stowBoards(p); break;
      case 'takeBoards': if (this.nearCamper(p)) this.#takeBoards(p); break;
      case 'unseat': this.#unseat(p); break;
      case 'drive': {
        if (p.seat !== 'cab') break;
        this.camper.throttle = Math.max(-1, Math.min(1, Number(msg.throttle) || 0));
        this.camper.brake = msg.brake === true;
        break;
      }
      case 'push': p.pushing = msg.on === true; break;
      case 'rescue': p.rescuing = msg.on === true; break;
      case 'carryAnimal': this.#carryAnimal(p, msg.id); break;
      case 'tool': p.tool = Math.max(0, Math.min(TOOL_SLOTS - 1, msg.i | 0)); break;
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
      case 'weather': this.weather.setForced(msg.wet === true); break;   // testing: force a storm (R)
      case 'skipTime': this.weather.skipPhase(); break;                     // testing: next dusk or dawn (N)
      case 'flag': this.#flag(p, msg.kind); break;
      case 'dig':
      case 'fill': this.#tool(p, msg); break;
    }
  }

  #tool(p, msg) {
    const now = this.tick;
    if (now - p.lastTool < 4) return;              // ~15 ops/s
    const x = Number(msg.x), y = Number(msg.y);
    const tool = this.toolOf(p);
    if (!Number.isFinite(x) || !Number.isFinite(y) || p.avatar.mode !== 'out') return;
    if (tool !== 'shovel' && !(tool === 'pickaxe' && msg.t === 'dig')) return;
    const ax = p.avatar.x, ay = p.avatar.y + 0.9;
    if ((x - ax) ** 2 + (y - ay) ** 2 > REACH * REACH) return;
    p.lastTool = now;
    let r;
    if (msg.t === 'dig') {
      if (p.soil >= SOIL_CAPACITY - 1e-3) return;
      // The pickaxe breaks rock as well as soil, but slowly; rubble goes in the bucket.
      r = tool === 'pickaxe'
        ? this.terrain.dig(x, y, BRUSH_RADIUS * 0.8, PICK_STRENGTH, SOIL_CAPACITY - p.soil, true)
        : this.terrain.dig(x, y, BRUSH_RADIUS, DIG_STRENGTH, SOIL_CAPACITY - p.soil);
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
    if (!vals.every(Number.isFinite) || this.toolOf(p) !== 'hammer' || p.avatar.mode !== 'out' || (p.avatar.lane || 0) !== 0) return;
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
    if (this.toolOf(p) !== 'hammer' || p.avatar.mode !== 'out') return;
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
    if (this.toolOf(p) !== 'axe' || this.tick - (p.lastChop || 0) < CHOP_EVERY) return;
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
    if (this.toolOf(p) !== 'saw' || this.tick - (p.lastSaw || 0) < SAW_EVERY) return;
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

  cargoMass() {
    const animals = (this.animals || []).filter(a => a.state === 'riding').reduce((s, a) => s + ANIMALS[a.kind].mass, 0);
    return this.rack.boards * BOARD_MASS + this.rack.logs.reduce((s, len) => s + len * LOG_THICKNESS * LOG_DENSITY, 0) + animals;
  }

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

  // ----- Items -----

  #nearItem(p, id) {
    const it = this.items.get(id);
    return it && p.avatar.mode === 'out' && (p.avatar.lane || 0) === it.lane && Math.abs(it.x - p.avatar.x) < ITEM_RANGE + 0.3 && Math.abs(it.y - p.avatar.y) < 2.2 ? it : null;
  }

  #pickup(p, id) {
    const it = this.#nearItem(p, id);
    if (!it) return;
    let slot = p.tools.indexOf(null);
    if (slot < 0) { slot = p.tool; this.#addItem(p.tools[slot], it.lane, p.avatar.x, p.avatar.y); }   // full: swap with the tool in hand
    p.tools[slot] = it.kind;
    p.tool = slot;
    this.items.delete(it.id);
  }

  #slotOf(p, slot) { return Number.isInteger(slot) && slot >= 0 && slot < TOOL_SLOTS ? slot : p.tool; }

  #dropTool(p, slotArg) {
    const slot = this.#slotOf(p, slotArg);
    const kind = p.tools[slot];
    if (!kind) return;
    if (p.avatar.mode === 'in') {   // dropping inside the camper puts it in storage
      if (this.toolbox.length < TOOLBOX_SIZE) { this.toolbox.push(kind); p.tools[slot] = null; }
      return;
    }
    this.#addItem(kind, p.avatar.lane || 0, p.avatar.x + 0.3 * (p.avatar.facing || 1), p.avatar.y);
    p.tools[slot] = null;
  }

  #give(p, slotArg) {
    const slot = this.#slotOf(p, slotArg);
    const kind = p.tools[slot];
    if (!kind) return;
    const q = [...this.players.values()].find(o => o !== p && o.connected && o.avatar.mode === p.avatar.mode &&
      (p.avatar.mode === 'in' ? Math.abs(o.avatar.lx - p.avatar.lx) < GIVE_RANGE : (o.avatar.lane || 0) === (p.avatar.lane || 0) && Math.hypot(o.avatar.x - p.avatar.x, o.avatar.y - p.avatar.y) < GIVE_RANGE));
    if (!q) return this.#notice(p, 'Get closer to your partner to hand it over');
    const free = q.tools.indexOf(null);
    if (free < 0) return this.#notice(p, 'Their hands are full: they need to drop or stow a tool');
    q.tools[free] = kind;
    p.tools[slot] = null;
    this.#notice(q, `${p.name} handed you the ${TOOL_NAMES[kind].toLowerCase()}`);
  }

  // Camper storage: reachable from anywhere inside, or on foot near the camper.
  nearCamper(p) {
    if (p.avatar.mode === 'in') return true;
    const c = this.camper.chassis.getPosition();
    const along = Math.max(0, Math.abs(p.avatar.x - c.x) - 3.3);   // distance beyond the camper's ends
    return (p.avatar.lane || 0) === 0 && along < STORAGE_RANGE && Math.abs(p.avatar.y + 0.8 - c.y) < 3;
  }

  #store(p, slot) {
    const kind = p.tools[slot];
    if (!kind || !this.nearCamper(p) || this.toolbox.length >= TOOLBOX_SIZE) return;
    this.toolbox.push(kind);
    p.tools[slot] = null;
  }

  // Take a tool from storage into a given slot (swapping whatever is there),
  // or into a free slot, or swap it with the tool in hand.
  #retrieve(p, index, target) {
    const kind = this.toolbox[index];
    if (!kind || !this.nearCamper(p)) return;
    let slot = Number.isInteger(target) && target >= 0 && target < TOOL_SLOTS ? target : p.tools.indexOf(null);
    if (slot < 0) slot = p.tool;
    const old = p.tools[slot];
    if (old) this.toolbox[index] = old; else this.toolbox.splice(index, 1);
    p.tools[slot] = kind;
    p.tool = slot;
  }

  #stowBoards(p) {
    const n = Math.min(p.boards, RACK_BOARDS - this.rack.boards);
    if (n <= 0) return;
    this.rack.boards += n; p.boards -= n;
    this.#updateCargoMass();
  }

  #takeBoards(p) {
    const n = Math.min(BOARD_CARRY - p.boards, this.rack.boards);
    if (n <= 0) return;
    this.rack.boards -= n; p.boards += n;
    this.#updateCargoMass();
  }

  // ----- Winch -----

  winchPoint() { return this.camperPoint(WINCH.x, WINCH.y); }

  #dropHook(p) {
    if (p && this.winch.carrier === p.id) Object.assign(this.winch, { state: 'stowed', carrier: null, anchor: null });
  }

  // E with the hook: take it from the bumper, attach it to a tree, stump or rock,
  // take it back off, or stow it.
  #hook(p) {
    const w = this.winch, a = p.avatar;
    if (a.mode !== 'out') return;
    const wp = this.winchPoint();
    const hands = { x: a.x, y: a.y + 0.95 };
    if (w.state === 'stowed') {
      if ((a.lane || 0) === 0 && Math.hypot(hands.x - wp.x, hands.y - wp.y) < RACK_RANGE + 0.6) Object.assign(w, { state: 'carried', carrier: p.id, anchor: null });
      return;
    }
    if (w.state === 'carried' && w.carrier === p.id) {
      if ((a.lane || 0) === 0 && Math.hypot(hands.x - wp.x, hands.y - wp.y) < RACK_RANGE + 0.6) { Object.assign(w, { state: 'stowed', carrier: null }); return; }
      const anchor = this.#findAnchor(p);
      if (!anchor) return this.#notice(p, 'Hook it to a tree, a stump or rock');
      const d = Math.hypot(anchor.x - wp.x, anchor.y - wp.y);
      Object.assign(w, { state: 'anchored', carrier: null, anchor, length: Math.min(WINCH.maxLen, d + 0.3), reel: w.reel });
      return;
    }
    if (w.state === 'anchored' && Math.hypot(w.anchor.x - a.x, w.anchor.y - (a.y + 0.8)) < WINCH.attachRange + 0.8) {
      Object.assign(w, { state: 'carried', carrier: p.id, anchor: null });
    }
  }

  #findAnchor(p) {
    const a = p.avatar;
    if ((a.lane || 0) === 1) {
      const tree = this.trees.find(t => Math.abs(t.x - a.x) < WINCH.attachRange);
      if (tree) return { x: tree.x, y: floorAt(this.floor, tree.x) + (tree.hp > 0 ? 1.0 : 0.3), kind: tree.hp > 0 ? 'tree' : 'stump', id: tree.id };
      return null;
    }
    // Rock within reach of the hands.
    const t = this.terrain;
    for (let r = 0.3; r <= WINCH.attachRange; r += 0.3) {
      for (let k = 0; k < 8; k++) {
        const ang = (k / 8) * Math.PI * 2;
        const x = a.x + Math.cos(ang) * r, y = a.y + 0.6 + Math.sin(ang) * r;
        const ix = Math.round(x / CELL), iy = Math.round(y / CELL);
        if (ix < 0 || iy < 0 || ix >= t.nx || iy >= t.ny) continue;
        const i = iy * t.nx + ix;
        if (t.rock[i] && t.density[i] > 127) return { x, y, kind: 'rock' };
      }
    }
    return null;
  }

  #stepWinch(dt) {
    const w = this.winch;
    w.tension = 0;
    if (w.state === 'carried') {
      const q = this.players.get(w.carrier);
      const wp = this.winchPoint();
      if (!q || !q.connected || Math.hypot(q.avatar.x - wp.x, q.avatar.y - wp.y) > WINCH.maxLen + 2) this.#dropHook(q || { id: w.carrier });
      return;
    }
    if (w.state !== 'anchored') return;
    if (w.anchor.kind === 'rock') {
      const t = this.terrain;
      if (!t.solidAt(w.anchor.x, w.anchor.y)) { Object.assign(w, { state: 'stowed', anchor: null }); return; }   // rock dug away
    }
    const ch = this.camper.chassis;
    const wpv = ch.getWorldPoint(Vec2(WINCH.x, WINCH.y));
    const dx = w.anchor.x - wpv.x, dy = w.anchor.y - wpv.y, d = Math.hypot(dx, dy) || 1;
    if (w.reel > 0) w.length = Math.max(1, w.length - WINCH.reel * dt);
    if (w.reel < 0) w.length = Math.min(WINCH.maxLen, w.length + WINCH.reel * dt);
    // Don't let reeling build up more stretch than the motor could hold.
    w.length = Math.max(w.length, d - WINCH.force / WINCH.k);
    if (d <= w.length) return;
    const ux = dx / d, uy = dy / d;
    const v = ch.getLinearVelocityFromWorldPoint(wpv);
    const away = -(v.x * ux + v.y * uy);
    const f = Math.min(WINCH.force, WINCH.k * (d - w.length) + WINCH.c * Math.max(0, away));
    ch.applyForce(Vec2(ux * f, uy * f), wpv, true);
    w.tension = f / WINCH.force;
  }

  // Weather: rain wakes loose soil and makes the tyres slip.
  #stepWeather(dt) {
    const W = this.weather;
    W.step(dt, this.tick);
    const wet = W.wet;
    if (wet && !this.wet) this.terrain.reactivateLoose();
    this.wet = wet;
    const grip = 1.25 * (1 - 0.45 * W.storm);
    for (const wheel of this.camper.wheels) {
      wheel.getFixtureList().setFriction(grip);
      // Existing contacts keep their mixed friction until told otherwise.
      for (let ce = wheel.getContactList(); ce; ce = ce.next) ce.contact.setFriction(Math.sqrt(ce.contact.getFixtureA().getFriction() * ce.contact.getFixtureB().getFriction()));
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
    // Back on its wheels counts as upright even when parked on a slope.
    if (upright < 0.15 && Math.abs(ch.getAngularVelocity()) < 1.5) this.tippedFor += dt;
    if (this.tippedFor > 1.0) this.tipped = true;
    if (upright > 0.7) { this.tippedFor = 0; this.tipped = false; }
    let pushers = 0;
    const pos = ch.getPosition();
    for (const p of this.players.values()) {
      // A jack gives one traveller the leverage of three.
      if (p.pushing && p.connected && p.avatar.mode === 'out' && Math.hypot(p.avatar.x - pos.x, p.avatar.y - pos.y) < PUSH_RANGE) pushers += this.toolOf(p) === 'jack' ? 3 : 1;
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

    this.#stepWeather(dt);
    this.#stepLogs(dt);
    this.#stepWinch(dt);
    this.#stepAnimals(dt);
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
      tod: Math.round(this.weather.tod * 10000) / 10000, storm: round(this.weather.storm), lightning: this.weather.lightning,
      players: [...this.players.values()].map(q => ({
        id: q.id, name: q.name, seat: q.seat, soil: round(q.soil), pushing: q.pushing, connected: q.connected,
        tool: q.tool, tools: q.tools, boards: q.boards, carrying: q.carrying,
        a: { mode: q.avatar.mode, lane: q.avatar.lane || 0, x: round(q.avatar.x), y: round(q.avatar.y), vx: round(q.avatar.vx), vy: round(q.avatar.vy), facing: q.avatar.facing, lx: round(q.avatar.lx), onGround: q.avatar.onGround, walkPhase: round(q.avatar.walkPhase), working: !!q.avatar.working },
      })),
      trees: this.trees.filter(t => t.hp < TREE_HP).map(t => [t.id, t.hp, t.fallDir, t.fellTick, t.lastHit || 0]),
      logs: [...this.logs.values()].map(l => { const q = this.logPose(l); return { id: l.id, lane: l.lane, len: l.len, x: round(q.x), y: round(q.y), a: round(q.a), c: l.carriers.map(c => c.pid), saw: l.saw / SAW_WORK }; }),
      piles: [...this.piles.values()].map(p => ({ id: p.id, lane: p.lane, x: round(p.x), y: round(p.y), n: p.n })),
      rack: { boards: this.rack.boards, logs: this.rack.logs.map(round) },
      structure: this.structure.snapshot(),
      flags: [...this.flags.values()].map(f => ({ id: f.id, owner: f.owner, kind: f.kind, x: round(f.x), y: round(f.y) })),
      items: [...this.items.values()].map(it => ({ id: it.id, kind: it.kind, lane: it.lane, x: round(it.x), y: round(it.y) })),
      toolbox: this.toolbox,
      rescued: this.rescued, struggling: this.struggle.active,
      animals: this.animals.map(a => ({ id: a.id, kind: a.kind, state: a.state, x: round(a.x), y: round(a.y), lane: a.lane, p: round(a.progress), f: a.facing, help: !!a.help, moving: !!a.moving, bark: a.bark, spot: a.spot, stamina: round(a.stamina), carrier: a.carrier, lx: round(a.lx || 0), hop: a.hop || 0 })),
      winch: { state: this.winch.state, carrier: this.winch.carrier, anchor: this.winch.anchor && { x: round(this.winch.anchor.x), y: round(this.winch.anchor.y), kind: this.winch.anchor.kind }, length: round(this.winch.length), reel: this.winch.reel, tension: round(this.winch.tension) },
    };
  }

  camperMass() { const c = this.camper; return c.chassis.getMass() + c.wheels.reduce((s, w) => s + w.getMass(), 0); }

  // Everything a joining client needs to reconstruct the world.
  welcome(id) {
    return { t: 'welcome', id, seed: this.seed, length: this.terrain.length, edits: { i: [...this.edits.keys()], v: [...this.edits.values()] }, snap: this.snapshot() };
  }

  drain() { const o = this.outbox; this.outbox = []; return o; }
}
