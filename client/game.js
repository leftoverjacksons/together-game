import { Application, Container, Graphics } from 'pixi.js';
import { Terrain } from '../shared/terrain.mjs';
import { newAvatar, stepAvatar } from '../shared/character.mjs';
import { INTERIOR, STATION_RANGE, DOOR_RANGE, REACH, BRUSH_RADIUS, SOIL_CAPACITY, SNAPSHOT_HZ } from '../shared/constants.mjs';
import { Input } from './input.js';
import { Background, Foreground } from './render/background.js';
import { TerrainView } from './render/terrainView.js';
import { CamperView } from './render/camperView.js';
import { AvatarView } from './render/avatarView.js';
import { Ambience } from './render/ambience.js';
import { PAL } from './render/palette.js';

const INTERP_DELAY = 110;          // ms behind the newest snapshot
const SEND_INTERVAL = 1000 / SNAPSHOT_HZ;
const TOOL_INTERVAL = 80;
const WALK_INSIDE = 2.6;
const PUSH_RANGE = 4.5;

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  constructor(session, hud) {
    this.session = session;
    this.hud = hud;
    this.snaps = [];
    this.views = new Map();          // player id -> AvatarView
    this.me = null;
    this.lastSend = 0; this.lastTool = 0; this.lastDrive = { throttle: 0, brake: false, at: 0 };
    this.pushing = false;
    this.cam = { x: 22, y: 18, viewH: 18 };
    this.time = 0;
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
    this.terrainView = new TerrainView(this.world, this.terrain);
    this.camperView = new CamperView(this.world);
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
        if (first) this.terrain = new Terrain(msg.length, msg.seed);
        this.terrain.applyEdits(msg.edits.i, msg.edits.v);
        if (first) this.#buildScene(msg.seed, msg.length);
        this.snaps = [{ time: performance.now(), s: msg.snap }];
        const mine = msg.snap.players.find(p => p.id === msg.id);
        if (!this.me) this.me = Object.assign(newAvatar(0, 0), mine ? mine.a : {});
        this.hud.joined(msg.code || null);
        break;
      }
      case 'terrain': this.terrain?.applyEdits(msg.i, msg.v); break;
      case 'snap': {
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
      const same = A.mode === B.mode;
      return { ...pb, a: { ...B, x: same ? lerp(A.x, B.x, t) : B.x, y: same ? lerp(A.y, B.y, t) : B.y, lx: same ? lerp(A.lx, B.lx, t) : B.lx, walkPhase: lerp(A.walkPhase, B.walkPhase, t) } };
    });
    return { camper, players, tipped: b.s.tipped, driver: b.s.driver, latest: S[S.length - 1].s };
  }

  #camperPoint(c, lx, ly) {
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    return { x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca };
  }

  frame(dt) {
    if (!this.terrain || !this.me) return;
    this.time += dt;
    const now = performance.now();
    const view = this.#sampled(now);
    const c = view.camper;
    const latestMe = view.latest.players.find(p => p.id === this.myId);
    const seated = latestMe?.seat === 'cab';
    const inp = this.input;
    const me = this.me;
    let prompt = '';
    let working = false;

    const door = this.#camperPoint(c, INTERIOR.doorX, INTERIOR.floorY);
    const eHit = inp.hit('e');
    if (me.mode === 'out') {
      const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
      stepAvatar(me, this.terrain, { move, jump: inp.held('w', ' ', 'arrowup') }, dt, c.x);
      const nearDoor = Math.hypot(me.x - door.x, me.y - door.y) < DOOR_RANGE;
      const nearCamper = Math.hypot(me.x - c.x, me.y + 0.8 - c.y) < PUSH_RANGE;
      let push = false;
      if (view.tipped && nearCamper) {
        prompt = 'Hold <b>E</b> to push the camper upright';
        push = inp.held('e');
      } else if (nearDoor) {
        prompt = '<b>E</b> climb aboard';
        if (eHit) { me.mode = 'in'; me.lx = INTERIOR.doorX + 0.35; me.vx = 0; }
      }
      if (push !== this.pushing) { this.pushing = push; this.session.send({ t: 'push', on: push }); }
      working = this.#tools(now, latestMe);
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
            Object.assign(me, { mode: 'out', x: out.x, y: out.y, vx: c.vx, vy: 1.5, onGround: false });
          }
        } else prompt = '<b>A / D</b> walk · stations are lit when you are close';
      }
    }

    if (now - this.lastSend > SEND_INTERVAL) {
      this.lastSend = now;
      this.session.send({ t: 'avatar', a: { mode: me.mode, x: me.x, y: me.y, vx: me.vx, vy: me.vy, facing: me.facing, lx: me.lx, onGround: me.onGround, walkPhase: me.walkPhase } });
    }

    this.#render(dt, view, { working, seated });
    this.hud.update({ prompt, soil: (latestMe?.soil || 0) / SOIL_CAPACITY, tipped: view.tipped, mass: c.mass, players: view.latest.players, myId: this.myId });
    inp.endFrame();
  }

  #mouseWorld() {
    const { width: w, height: h } = this.app.screen;
    const ppm = h / this.cam.viewH;
    return { x: (this.input.mouse.x - w / 2) / ppm + this.cam.x, y: (h / 2 - this.input.mouse.y) / ppm + this.cam.y };
  }

  #tools(now, latestMe) {
    const m = this.input.mouse;
    if (!m.left && !m.right) return false;
    const p = this.#mouseWorld();
    const me = this.me;
    if (Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) > REACH) return false;
    if (now - this.lastTool > TOOL_INTERVAL) {
      this.lastTool = now;
      this.session.send({ t: m.left ? 'dig' : 'fill', x: p.x, y: p.y });
    }
    if (Math.abs(p.x - me.x) > 0.2) me.facing = p.x > me.x ? 1 : -1;
    return true;
  }

  #render(dt, view, { working, seated }) {
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
    this.terrainView.update(this.cam.x - halfW, this.cam.x + halfW, this.cam.y - halfH, this.cam.y + halfH);
    this.camperView.update(c, this.time);

    // Travellers.
    view.players.forEach((p, index) => {
      let v = this.views.get(p.id);
      if (!v) { v = new AvatarView(index); this.views.set(p.id, v); }
      const isMe = p.id === this.myId;
      const a = isMe ? me : p.a;
      const inside = a.mode === 'in';
      const parent = inside ? this.camperView.interior : this.outside;
      if (v.root.parent !== parent) parent.addChild(v.root);
      v.root.visible = p.connected || isMe;
      const pos = inside ? { x: a.lx, y: INTERIOR.floorY } : { x: a.x, y: a.y };
      v.update({ ...a, ...pos }, this.time, { working: isMe ? working : false, inside, seated: p.seat === 'cab', pushing: p.pushing });
    });
    for (const [id, v] of this.views) if (!view.players.some(p => p.id === id)) { v.root.destroy({ children: true }); this.views.delete(id); }

    // Brush cursor.
    this.cursor.clear();
    if (me.mode === 'out' && this.input.mouse.inside) {
      const p = this.#mouseWorld();
      const ok = Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) <= REACH;
      this.cursor.circle(p.x, p.y, BRUSH_RADIUS).stroke({ width: 0.05, color: ok ? 0xfff3d6 : 0xd06a50, alpha: ok ? 0.85 : 0.5 });
      if (!ok) this.cursor.circle(me.x, me.y + 0.9, REACH).stroke({ width: 0.03, color: 0xfff3d6, alpha: 0.18 });
    }
    this.ambience.update(dt, this.time, w, h, this.cam.x, x => this.terrain.groundY(x, this.cam.y + halfH));
  }
}
