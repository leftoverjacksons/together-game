import { Application, Container, Graphics } from 'pixi.js';
import { Terrain } from '../shared/terrain.mjs';
import { newAvatar, stepAvatar, stepForest } from '../shared/character.mjs';
import {
  INTERIOR, STATION_RANGE, DOOR_RANGE, REACH, BRUSH_RADIUS, SOIL_CAPACITY, SNAPSHOT_HZ, TOOLS, BOARD_CARRY,
  RACK_POINT, RACK_RANGE, WORK_RANGE, CARRY_SPEED, RACK_BOARDS, RACK_LOGS,
} from '../shared/constants.mjs';
import { forestFloor, floorAt, generateTrees } from '../shared/forest.mjs';
import { Input } from './input.js';
import { Background, Foreground } from './render/background.js';
import { TerrainView } from './render/terrainView.js';
import { CamperView } from './render/camperView.js';
import { AvatarView } from './render/avatarView.js';
import { ForestView, LumberView } from './render/forestView.js';
import { StructureView } from './render/structureView.js';
import { Ambience } from './render/ambience.js';
import { PAL } from './render/palette.js';

const INTERP_DELAY = 110;          // ms behind the newest snapshot
const SEND_INTERVAL = 1000 / SNAPSHOT_HZ;
const TOOL_INTERVAL = { shovel: 80, axe: 300, saw: 100 };
const WALK_INSIDE = 2.6;
const PUSH_RANGE = 4.5;
const TOOL_NAMES = { shovel: 'Shovel', axe: 'Axe', saw: 'Saw', hammer: 'Hammer' };

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  constructor(session, hud) {
    this.session = session;
    this.hud = hud;
    this.snaps = [];
    this.views = new Map();          // player id -> AvatarView
    this.me = null;
    this.tool = 0;
    this.lastSend = 0; this.lastTool = 0; this.lastDrive = { throttle: 0, brake: false, at: 0 };
    this.pushing = false;
    this.cam = { x: 22, y: 18, viewH: 18 };
    this.time = 0;
    this.collider = { solidAt: (x, y) => this.#solid(x, y) };
    this.build = null;               // board being placed: { x, y }
  }

  async start(container) {
    const app = new Application();
    await app.init({ resizeTo: window, antialias: true, background: PAL.skyLow, autoDensity: true, resolution: Math.min(2, devicePixelRatio || 1) });
    container.appendChild(app.canvas);
    this.app = app;
    this.input = new Input(app.canvas);
    this.session.onmessage = m => this.onMessage(m);
    this.session.onstatus = (s, detail) => this.hud.status(s, detail);
    this.session.connect();
    app.ticker.add(t => this.frame(Math.min(0.05, t.deltaMS / 1000)));
  }

  #buildScene(seed, length) {
    const stage = this.app.stage;
    this.bg = new Background(stage, length, seed);
    this.world = new Container();
    stage.addChild(this.world);
    // Back to front: forest lane, road cross-section, camper, road items, travellers, grass.
    this.forestView = new ForestView(this.world, this.terrain, this.floor, this.trees);
    this.forestLumber = new LumberView(this.forestView.items);
    this.terrainView = new TerrainView(this.world, this.terrain);
    this.camperView = new CamperView(this.world);
    this.structureView = new StructureView(this.world);
    this.roadLumber = new LumberView(this.world);
    this.outside = new Container();
    this.world.addChild(this.outside);
    this.world.addChild(this.terrainView.grass);   // grass rim over feet and wheels
    this.screenFx = new Container();
    this.ambience = new Ambience(this.screenFx, this.world, seed);
    this.cursor = new Graphics();
    this.world.addChild(this.cursor);
    this.fg = new Foreground(stage, length, seed);
    stage.addChild(this.screenFx);
    const resize = () => this.bg.resize(this.app.screen.width, this.app.screen.height);
    resize();
    this.app.renderer.on('resize', resize);
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'welcome': {
        this.myId = msg.id;
        const first = !this.terrain;
        if (first) {
          this.terrain = new Terrain(msg.length, msg.seed);
          this.floor = forestFloor(this.terrain);
          this.trees = generateTrees(this.terrain, msg.seed);
        }
        this.terrain.applyEdits(msg.edits.i, msg.edits.v);
        if (first) this.#buildScene(msg.seed, msg.length);
        this.snaps = [{ time: performance.now(), s: msg.snap }];
        const mine = msg.snap.players.find(p => p.id === msg.id);
        if (!this.me) { this.me = Object.assign(newAvatar(0, 0), mine ? mine.a : {}); this.tool = mine?.tool || 0; }
        this.hud.joined(msg.code || null);
        break;
      }
      case 'terrain': this.terrain?.applyEdits(msg.i, msg.v); break;
      case 'notice': if (msg.to === this.myId) this.hud.toast(msg.msg); break;
      case 'fx': this.onFx?.(msg); break;
      case 'snap': {
        this.#updateColliders(msg.structure);
        this.snaps.push({ time: performance.now(), s: msg });
        if (this.snaps.length > 40) this.snaps.shift();
        break;
      }
    }
  }

  // Interpolated view of the server state at (now - delay).
  #sampled(now) {
    const rt = now - INTERP_DELAY;
    const S = this.snaps;
    let a = S[0], b = S[0];
    for (let k = S.length - 1; k >= 0; k--) { if (S[k].time <= rt) { a = S[k]; b = S[k + 1] || S[k]; break; } }
    const t = b === a ? 0 : Math.max(0, Math.min(1, (rt - a.time) / (b.time - a.time)));
    const ca = a.s.c, cb = b.s.c;
    const camper = { x: lerp(ca.x, cb.x, t), y: lerp(ca.y, cb.y, t), a: lerpAngle(ca.a, cb.a, t), vx: lerp(ca.vx, cb.vx, t), w: ca.w.map((v, k) => (k % 3 === 2 ? lerpAngle(v, cb.w[k], t) : lerp(v, cb.w[k], t))), mass: cb.mass };
    const players = b.s.players.map(pb => {
      const pa = a.s.players.find(p => p.id === pb.id) || pb;
      const A = pa.a, B = pb.a;
      const same = A.mode === B.mode && A.lane === B.lane;
      return { ...pb, a: { ...B, x: same ? lerp(A.x, B.x, t) : B.x, y: same ? lerp(A.y, B.y, t) : B.y, lx: same ? lerp(A.lx, B.lx, t) : B.lx, walkPhase: lerp(A.walkPhase, B.walkPhase, t) } };
    });
    const logs = (b.s.logs || []).map(lb => {
      const la = (a.s.logs || []).find(l => l.id === lb.id);
      if (!la || la.lane !== lb.lane) return lb;
      return { ...lb, x: lerp(la.x, lb.x, t), y: lerp(la.y, lb.y, t), a: lerpAngle(la.a, lb.a, t) };
    });
    const tick = a.s.tick + (b.s.tick - a.s.tick) * t;
    return { camper, players, logs, tick, tipped: b.s.tipped, driver: b.s.driver, latest: S[S.length - 1].s };
  }

  // Boards are solid for travellers on foot, alongside the terrain.
  #updateColliders(st) {
    if (!st) return;
    const joints = new Map(st.j.map(j => [j[0], j]));
    this.boardSegs = st.b.map(([, a, b]) => { const A = joints.get(a), B = joints.get(b); return [A[1], A[2], B[1], B[2]]; });
    this.joints = st.j;
  }

  #solid(x, y) {
    if (this.terrain.solidAt(x, y)) return true;
    for (const [ax, ay, bx, by] of this.boardSegs || []) {
      if (x < Math.min(ax, bx) - 0.15 || x > Math.max(ax, bx) + 0.15) continue;
      const dx = bx - ax, dy = by - ay;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      if (Math.hypot(x - ax - t * dx, y - ay - t * dy) < 0.09) return true;
    }
    return false;
  }

  #camperPoint(c, lx, ly) {
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    return { x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca };
  }

  #selectTool(i) {
    if (i === this.tool || i < 0 || i >= TOOLS.length) return;
    this.tool = i;
    this.session.send({ t: 'tool', i });
  }

  frame(dt) {
    if (!this.terrain || !this.me) return;
    this.time += dt;
    const now = performance.now();
    const view = this.#sampled(now);
    const latest = view.latest;
    const c = view.camper;
    const latestMe = latest.players.find(p => p.id === this.myId);
    const seated = latestMe?.seat === 'cab';
    const inp = this.input;
    const me = this.me;
    let prompt = '';
    let working = false;

    for (let k = 0; k < TOOLS.length; k++) if (inp.hit(String(k + 1))) this.#selectTool(k);
    if (inp.wheel) { this.#selectTool((this.tool + Math.sign(inp.wheel) + TOOLS.length) % TOOLS.length); inp.wheel = 0; }
    if (inp.hit('r')) this.session.send({ t: 'weather', wet: !latest.wet });
    const eHit = inp.hit('e');
    const door = this.#camperPoint(c, INTERIOR.doorX, INTERIOR.floorY);

    if (me.mode === 'out') {
      const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
      const carried = latestMe?.carrying != null ? (latest.logs || []).find(l => l.id === latestMe.carrying) : null;
      const speed = carried ? CARRY_SPEED[Math.min(1, carried.c.length - 1)] : undefined;
      // Step between the road and the forest behind it.
      if (inp.hit('w', 'arrowup') && me.lane !== 1) { me.lane = 1; me.y = floorAt(this.floor, me.x); me.vy = 0; me.onGround = true; }
      else if (inp.hit('s', 'arrowdown') && me.lane === 1) { me.lane = 0; me.y = this.terrain.groundY(me.x, floorAt(this.floor, me.x) + 1.5); me.vy = 0; }
      if (me.lane === 1 || TOOLS[this.tool] !== 'hammer') this.build = null;
      const input = { move, jump: inp.held(' '), speed };
      if (me.lane === 1) stepForest(me, x => floorAt(this.floor, x), input, dt, c.x);
      else stepAvatar(me, this.collider, input, dt, c.x);

      const ctx = this.#context(view, latestMe, door, carried);
      prompt = ctx.prompt;
      if (eHit && ctx.action) ctx.action();
      const push = !!ctx.push && inp.held('e');
      if (push !== this.pushing) { this.pushing = push; this.session.send({ t: 'push', on: push }); }
      if (inp.hit('g') && latestMe?.boards) this.session.send({ t: 'drop' });
      const used = this.#tools(now, view, latestMe);
      working = used.working;
      if (!prompt && used.hint) prompt = used.hint;
    } else {
      if (this.pushing) { this.pushing = false; this.session.send({ t: 'push', on: false }); }
      const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
      if (seated) {
        me.lx = INTERIOR.seatX - 0.05; me.facing = 1; me.vx = 0;
        const brake = inp.held(' ', 's', 'arrowdown');
        if (move !== this.lastDrive.throttle || brake !== this.lastDrive.brake || now - this.lastDrive.at > 250) {
          this.session.send({ t: 'drive', throttle: move, brake });
          this.lastDrive = { throttle: move, brake, at: now };
        }
        prompt = '<b>A / D</b> drive · <b>Space</b> brake · <b>E</b> leave the wheel';
        if (eHit) this.session.send({ t: 'unseat' });
      } else {
        me.vx = move * WALK_INSIDE;
        if (move) me.facing = move;
        me.lx = Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, me.lx + me.vx * dt));
        if (move) me.walkPhase += WALK_INSIDE * dt * 2.2;
        const atSeat = Math.abs(me.lx - INTERIOR.seatX) < STATION_RANGE;
        const atDoor = Math.abs(me.lx - INTERIOR.doorX) < STATION_RANGE;
        const driver = view.driver;
        if (atSeat) {
          prompt = driver && driver !== this.myId ? 'Your partner is driving' : '<b>E</b> take the wheel';
          if (eHit && !driver) this.session.send({ t: 'seat' });
        } else if (atDoor) {
          prompt = '<b>E</b> climb out';
          if (eHit) {
            const out = this.#camperPoint(c, INTERIOR.doorX - 0.2, INTERIOR.floorY + 0.05);
            Object.assign(me, { mode: 'out', lane: 0, x: out.x, y: out.y, vx: c.vx, vy: 1.5, onGround: false });
          }
        } else prompt = '<b>A / D</b> walk';
      }
    }

    if (now - this.lastSend > SEND_INTERVAL) {
      this.lastSend = now;
      this.session.send({ t: 'avatar', a: { mode: me.mode, lane: me.lane || 0, x: me.x, y: me.y, vx: me.vx, vy: me.vy, facing: me.facing, lx: me.lx, onGround: me.onGround, walkPhase: me.walkPhase, working } });
    }

    this.#render(dt, view, { working });
    this.hud.update({
      prompt, soil: (latestMe?.soil || 0) / SOIL_CAPACITY, tipped: view.tipped, mass: c.mass, players: latest.players, myId: this.myId,
      tool: this.tool, tools: TOOLS.map(t => TOOL_NAMES[t]), boards: latestMe?.boards || 0, boardCap: BOARD_CARRY,
      rack: latest.rack ? `${latest.rack.boards}/${RACK_BOARDS} boards · ${latest.rack.logs.length}/${RACK_LOGS} logs` : '',
      lane: me.mode === 'out' ? (me.lane === 1 ? 'Forest' : 'Road') : 'Camper', wet: latest.wet,
    });
    inp.endFrame();
  }

  // What E does right now, by priority.
  #context(view, latestMe, door, carried) {
    const me = this.me, c = view.camper, latest = view.latest;
    const lane = me.lane || 0;
    if (lane === 0 && view.tipped && Math.hypot(me.x - c.x, me.y + 0.8 - c.y) < PUSH_RANGE) return { prompt: 'Hold <b>E</b> to push the camper upright', push: true };
    const send = msg => () => this.session.send(msg);
    if (carried) {
      if (lane === 0 && this.#atRack(c)) return { prompt: '<b>E</b> load the log onto the roof rack', action: send({ t: 'stow' }) };
      const alone = carried.c.length < 2;
      return { prompt: `${alone ? 'Hauling alone (slow)' : 'Carrying together'} · <b>E</b> let go${lane === 1 && alone ? ' · <b>S</b> bring it to the road' : ''}`, action: send({ t: 'release' }) };
    }
    if (lane === 0 && Math.hypot(me.x - door.x, me.y - door.y) < DOOR_RANGE) return { prompt: '<b>E</b> climb aboard', action: () => { Object.assign(me, { mode: 'in', lx: INTERIOR.doorX + 0.35, vx: 0 }); } };
    if (lane === 0 && this.#atRack(c)) {
      const boards = latestMe?.boards || 0, rack = latest.rack || { boards: 0, logs: [] };
      if (boards) return { prompt: `<b>E</b> stow ${boards} board${boards > 1 ? 's' : ''} on the roof rack`, action: send({ t: 'stow' }) };
      if (rack.boards) return { prompt: '<b>E</b> take boards from the roof rack', action: send({ t: 'unstow' }) };
      if (rack.logs.length) return { prompt: '<b>E</b> unload a log from the roof rack', action: send({ t: 'unstow' }) };
    }
    if (lane === 0 && (latestMe?.boards || 0) < BOARD_CARRY) {
      const deb = (latest.structure?.d || []).find(d => Math.hypot(d[1] - me.x, d[2] - me.y - 0.5) < WORK_RANGE + 0.4);
      if (deb) return { prompt: '<b>E</b> salvage the broken board', action: send({ t: 'salvage', id: deb[0] }) };
    }
    const log = this.#nearestLog(view, lane);
    if (log) {
      const n = log.c.length;
      if (n < 2) return { prompt: n ? '<b>E</b> grab the other end' : '<b>E</b> pick up the log', action: send({ t: 'grab', id: log.id }) };
    }
    const pile = (latest.piles || []).find(p => p.lane === lane && Math.abs(p.x - me.x) < WORK_RANGE);
    if (pile && (latestMe?.boards || 0) < BOARD_CARRY) return { prompt: `<b>E</b> pick up boards (${pile.n} here)`, action: send({ t: 'take', id: pile.id }) };
    return { prompt: '' };
  }

  #atRack(c) {
    const r = this.#camperPoint(c, RACK_POINT.x, RACK_POINT.y);
    return Math.hypot(this.me.x - r.x, this.me.y + 0.8 - r.y) < RACK_RANGE + 0.6;
  }

  #nearestLog(view, lane) {
    const me = this.me;
    let best = null, bd = WORK_RANGE;
    for (const l of view.logs) {
      if (l.lane !== lane) continue;
      const ca = Math.cos(l.a), sa = Math.sin(l.a);
      const px = me.x - l.x, py = me.y + 0.5 - l.y;
      const along = Math.max(-l.len / 2, Math.min(l.len / 2, px * ca + py * sa));
      const d = Math.hypot(px - along * ca, py - along * sa);
      if (d < bd) { bd = d; best = l; }
    }
    return best;
  }

  #nearestTree(view) {
    const me = this.me;
    if (me.lane !== 1) return null;
    const state = new Map((view.latest.trees || []).map(t => [t[0], t]));
    let best = null;
    for (const t of this.trees) {
      const st = state.get(t.id);
      if (st && st[1] <= 0) continue;
      if (Math.abs(t.x - me.x) < WORK_RANGE && (!best || Math.abs(t.x - me.x) < Math.abs(best.x - me.x))) best = t;
    }
    return best;
  }

  #mouseWorld() {
    const { width: w, height: h } = this.app.screen;
    const ppm = h / this.cam.viewH;
    return { x: (this.input.mouse.x - w / 2) / ppm + this.cam.x, y: (h / 2 - this.input.mouse.y) / ppm + this.cam.y };
  }

  #tools(now, view, latestMe) {
    const m = this.input.mouse, me = this.me;
    const tool = TOOLS[this.tool];
    const lane = me.lane || 0;
    if (latestMe?.carrying != null) return { working: false };
    const every = TOOL_INTERVAL[tool] || 100;
    const ready = now - this.lastTool > every;
    if (tool === 'shovel') {
      if (lane === 1) return { working: false, hint: m.left || m.right ? 'The forest floor can\'t be dug · <b>S</b> back to the road' : '' };
      if (!m.left && !m.right) return { working: false };
      const p = this.#mouseWorld();
      if (Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) > REACH) return { working: false };
      if (Math.abs(p.x - me.x) > 0.2) me.facing = p.x > me.x ? 1 : -1;
      if (ready) { this.lastTool = now; this.session.send({ t: m.left ? 'dig' : 'fill', x: p.x, y: p.y }); }
      return { working: true };
    }
    if (tool === 'axe') {
      const tree = this.#nearestTree(view);
      if (!tree) return { working: false, hint: lane === 0 ? '<b>W</b> step into the forest to fell trees' : '' };
      if (!m.left) return { working: false, hint: 'Hold <b>left mouse</b> to chop · faster together' };
      me.facing = tree.x > me.x ? 1 : -1;
      if (ready) { this.lastTool = now; this.session.send({ t: 'chop' }); }
      return { working: true };
    }
    if (tool === 'saw') {
      const log = this.#nearestLog(view, lane);
      if (!log) return { working: false };
      if (!m.left) return { working: false, hint: 'Hold <b>left mouse</b> to saw the log into boards' };
      me.facing = log.x > me.x ? 1 : -1;
      if (ready) { this.lastTool = now; this.session.send({ t: 'saw' }); }
      return { working: true };
    }
    return this.#hammer(now, view, latestMe);
  }

  #snapJoint(p) {
    let best = null, bd = 0.35;
    for (const [, x, y] of this.joints || []) { const d = Math.hypot(x - p.x, y - p.y); if (d < bd) { bd = d; best = { x, y, joint: true }; } }
    return best || p;
  }

  #anchorAt(p) {
    if (p.joint) { const j = (this.joints || []).find(j => j[1] === p.x && j[2] === p.y); return j ? j[3] === 1 : false; }
    const t = this.terrain;
    return t.solidAt(p.x, p.y) || t.solidAt(p.x, p.y - 0.15) || t.solidAt(p.x - 0.12, p.y - 0.06) || t.solidAt(p.x + 0.12, p.y - 0.06);
  }

  // Hammer: drag with the left button to place a board; right-click removes one.
  #hammer(now, view, latestMe) {
    const m = this.input.mouse, me = this.me;
    const boards = latestMe?.boards || 0;
    if ((me.lane || 0) !== 0) return { working: false, hint: '<b>S</b> back to the road to build' };
    const p = this.#snapJoint(this.#mouseWorld());
    const hands = { x: me.x, y: me.y + 0.9 };
    if (m.right && !this.removing) { this.removing = true; this.session.send({ t: 'unbuild', x: p.x, y: p.y }); }
    if (!m.right) this.removing = false;
    if (m.left && !this.build) {
      if (!boards) { this.structureView.drawGhost(null); return { working: false, hint: 'No boards: saw a log, or take some from the roof rack' }; }
      if (Math.hypot(p.x - hands.x, p.y - hands.y) <= REACH + 0.6) this.build = p;
    }
    if (this.build) {
      let b = p;
      const len = Math.hypot(b.x - this.build.x, b.y - this.build.y);
      if (len > 3 && !b.joint) { const k = 3 / len; b = { x: this.build.x + (b.x - this.build.x) * k, y: this.build.y + (b.y - this.build.y) * k }; }
      const ancA = this.#anchorAt(this.build), ancB = this.#anchorAt(b);
      const L = Math.hypot(b.x - this.build.x, b.y - this.build.y);
      const ok = L >= 0.5 && L <= 3.001 && (ancA || ancB || this.build.joint || b.joint);
      this.structureView.drawGhost(this.build, b, ok, ancA, ancB);
      if (!m.left) {
        if (ok) { this.session.send({ t: 'build', ax: this.build.x, ay: this.build.y, bx: b.x, by: b.y }); this.lastTool = now; }
        this.build = null;
        this.structureView.drawGhost(null);
        return { working: true };
      }
      return { working: false, hint: ok ? 'Release to place the board' : L > 3 ? 'Boards are at most 3 m' : 'Start or end on the ground or on another board' };
    }
    this.structureView.drawGhost(null);
    if (now - this.lastTool < 400) return { working: true };
    return { working: false, hint: `Drag with <b>left mouse</b> to place a board (${boards} carried) · <b>right-click</b> removes one` };
  }

  #render(dt, view, { working }) {
    const { width: w, height: h } = this.app.screen;
    const c = view.camper;
    const me = this.me;
    const meWorld = me.mode === 'in' ? this.#camperPoint(c, me.lx, INTERIOR.floorY) : me;

    // Shared camera: frame the camper and every traveller, look ahead of travel.
    const pts = [[c.x, c.y], [meWorld.x, meWorld.y + 0.8]];
    for (const p of view.players) if (p.id !== this.myId && p.connected) {
      const pw = p.a.mode === 'in' ? this.#camperPoint(c, p.a.lx, INTERIOR.floorY) : p.a;
      pts.push([pw.x, pw.y + 0.8]);
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const aspect = w / h;
    const look = Math.max(-5, Math.min(5, c.vx * 0.6));
    const tx = (x0 + x1) / 2 + look, ty = (y0 + y1) / 2 + 1.5;
    const tv = Math.max(15, Math.min(40, Math.max(y1 - y0 + 9, (x1 - x0 + Math.abs(look) * 2 + 14) / aspect)));
    const k = 1 - Math.exp(-dt * 3.2);
    this.cam.x += (tx - this.cam.x) * k; this.cam.y += (ty - this.cam.y) * k; this.cam.viewH += (tv - this.cam.viewH) * k * 0.7;
    const ppm = h / this.cam.viewH;
    this.world.scale.set(ppm, -ppm);
    this.world.position.set(w / 2 - this.cam.x * ppm, h / 2 + this.cam.y * ppm);

    const halfW = w / 2 / ppm, halfH = h / 2 / ppm;
    const ground = this.terrain.surface[Math.max(0, Math.min(this.terrain.nx - 1, Math.round(this.cam.x / 0.25)))];
    this.refY = this.refY === undefined ? ground : this.refY + (ground - this.refY) * k * 0.5;
    this.bg.update(this.cam.x, this.cam.y, ppm, this.refY);
    this.fg.update(this.cam.x, w, h, ppm);
    const treeState = new Map((view.latest.trees || []).map(t => [t[0], t]));
    this.forestView.update(this.cam.x - halfW, this.cam.x + halfW, treeState, view.tick, this.time);
    this.terrainView.update(this.cam.x - halfW, this.cam.x + halfW, this.cam.y - halfH, this.cam.y + halfH);
    this.camperView.update(c, this.time);
    if (view.latest.rack) this.camperView.setRack(view.latest.rack);
    const piles = view.latest.piles || [];
    this.forestLumber.update(view.logs.filter(l => l.lane === 1), piles.filter(p => p.lane === 1));
    this.roadLumber.update(view.logs.filter(l => l.lane === 0), piles.filter(p => p.lane === 0));
    this.structureView.update(view.latest.structure, this.time, me.mode === 'out' && TOOLS[this.tool] === 'hammer');
    if (!(me.mode === 'out' && TOOLS[this.tool] === 'hammer')) this.structureView.drawGhost(null);

    // Travellers.
    view.players.forEach((p, index) => {
      let v = this.views.get(p.id);
      if (!v) { v = new AvatarView(index); this.views.set(p.id, v); }
      const isMe = p.id === this.myId;
      const a = isMe ? me : p.a;
      const inside = a.mode === 'in';
      const parent = inside ? this.camperView.interior : a.lane === 1 ? this.forestView.actors : this.outside;
      if (v.root.parent !== parent) parent.addChild(v.root);
      v.root.visible = p.connected || isMe;
      const pos = inside ? { x: a.lx, y: INTERIOR.floorY } : { x: a.x, y: a.y };
      v.update({ ...a, ...pos }, this.time, {
        working: isMe ? working : !!p.a.working, inside, seated: p.seat === 'cab', pushing: p.pushing,
        tool: TOOLS[isMe ? this.tool : p.tool] || 'shovel', boards: p.boards || 0, carrying: p.carrying != null,
      });
    });
    for (const [id, v] of this.views) if (!view.players.some(p => p.id === id)) { v.root.destroy({ children: true }); this.views.delete(id); }

    // Shovel brush cursor.
    this.cursor.clear();
    if (me.mode === 'out' && (me.lane || 0) === 0 && TOOLS[this.tool] === 'shovel' && this.input.mouse.inside) {
      const p = this.#mouseWorld();
      const ok = Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) <= REACH;
      this.cursor.circle(p.x, p.y, BRUSH_RADIUS).stroke({ width: 0.05, color: ok ? 0xfff3d6 : 0xd06a50, alpha: ok ? 0.85 : 0.5 });
      if (!ok) this.cursor.circle(me.x, me.y + 0.9, REACH).stroke({ width: 0.03, color: 0xfff3d6, alpha: 0.18 });
    }
    this.drawExtras?.(view);
    this.ambience.update(dt, this.time, w, h, this.cam.x, x => this.terrain.groundY(x, this.cam.y + halfH));
  }
}
