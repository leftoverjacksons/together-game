import { Application, Container, Graphics } from 'pixi.js';
import { Terrain } from '../shared/terrain.mjs';
import { newAvatar, stepAvatar, stepForest } from '../shared/character.mjs';
import {
  INTERIOR, STATION_RANGE, DOOR_RANGE, REACH, BRUSH_RADIUS, SOIL_CAPACITY, SNAPSHOT_HZ, TOOLS, BOARD_CARRY,
  TOOL_SLOTS, TOOL_NAMES, ITEM_RANGE, GIVE_RANGE, WINCH, STORAGE_RANGE,
  RACK_POINT, RACK_RANGE, WORK_RANGE, CARRY_SPEED, RACK_BOARDS, RACK_LOGS,
} from '../shared/constants.mjs';
import { forestFloor, floorAt, generateTrees } from '../shared/forest.mjs';
import { Input } from './input.js';
import { loadArt } from './assets.js';
import { InventoryPanel, makeToolIcons } from './inventory.js';
import { Background, Foreground } from './render/background.js';
import { TerrainView } from './render/terrainView.js';
import { CamperView } from './render/camperView.js';
import { AvatarView } from './render/avatarView.js';
import { ForestView, LumberView } from './render/forestView.js';
import { StructureView } from './render/structureView.js';
import { ItemsView } from './render/itemsView.js';
import { AnimalView } from './render/animalView.js';
import { ANIMALS, RIDE_SPOTS, RESCUE_RANGE } from '../shared/animals.mjs';
import { Ambience } from './render/ambience.js';
import { Particles } from './render/particles.js';
import { PAL } from './render/palette.js';

const INTERP_DELAY = 110;          // ms behind the newest snapshot
const SEND_INTERVAL = 1000 / SNAPSHOT_HZ;
const TOOL_INTERVAL = { shovel: 80, pickaxe: 120, axe: 300, saw: 100 };
const WALK_INSIDE = 2.6;
const PUSH_RANGE = 4.5;

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };

export class Game {
  constructor(session, hud, audio) {
    this.audio = audio;
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
    await loadArt();
    const send = msg => this.session.send(msg);
    this.inventory = new InventoryPanel(document.getElementById('inventory'), {
      select: i => this.#selectTool(i), store: i => send({ t: 'store', slot: i }), retrieve: i => send({ t: 'retrieve', index: i }),
      drop: i => send({ t: 'droptool', slot: i }), give: () => send({ t: 'give' }),
      stowBoards: () => send({ t: 'stowBoards' }), takeBoards: () => send({ t: 'takeBoards' }), close: () => this.inventory.toggle(false),
      swapSlots: (a, b) => send({ t: 'swapSlots', a, b }), retrieveTo: (i, slot) => send({ t: 'retrieve', index: i, slot }), giveSlot: i => send({ t: 'give', slot: i }),
    });
    this.toolIcons = await makeToolIcons(app.renderer);
    this.inventory.icons = this.toolIcons;
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
    this.animalsRoad = new Container();        // under road logs, so a pinned chipmunk peeks out
    this.world.addChild(this.animalsRoad);
    this.animalFx = new Graphics();            // helper ropes and talons
    this.animalViews = new Map();
    this.itemsForest = new ItemsView(this.forestView.items);
    this.itemsRoad = new ItemsView(this.world);
    this.cable = new Graphics();
    this.world.addChild(this.cable, this.animalFx);
    this.roadLumber = new LumberView(this.world);
    this.outside = new Container();
    this.world.addChild(this.outside);
    this.world.addChild(this.terrainView.grass);   // grass rim over feet and wheels
    this.screenFx = new Container();
    this.ambience = new Ambience(this.screenFx, this.world, seed);
    this.particles = new Particles(this.world);
    this.cursor = new Graphics();
    this.world.addChild(this.cursor);
    this.fg = new Foreground(stage, length, seed);
    this.weather = new Graphics();
    stage.addChild(this.weather, this.screenFx);
    this.rainDrops = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 0.8 }));
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
      case 'fx':
        if (msg.kind === 'snap') this.audio?.snap(this.cam.x);
        if (msg.kind === 'rescued') this.#onRescued(msg);
        break;
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
    const animals = (b.s.animals || []).map(nb => {
      const na = (a.s.animals || []).find(o => o.id === nb.id);
      if (!na || na.state !== nb.state || na.lane !== nb.lane) return nb;
      return { ...nb, x: lerp(na.x, nb.x, t), y: lerp(na.y, nb.y, t) };
    });
    const tick = a.s.tick + (b.s.tick - a.s.tick) * t;
    return { camper, players, logs, animals, tick, tipped: b.s.tipped, driver: b.s.driver, latest: S[S.length - 1].s };
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
    if (i === this.tool || i < 0 || i >= TOOL_SLOTS) return;
    this.tool = i;
    this.session.send({ t: 'tool', i });
  }

  // Kind of tool in a player's selected slot (mine uses the local selection).
  #toolKind(p) {
    if (!p) return null;
    return (p.tools || [])[p.id === this.myId ? this.tool : p.tool] || null;
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

    for (let k = 0; k < TOOL_SLOTS; k++) if (inp.hit(String(k + 1))) this.#selectTool(k);
    if (inp.wheel) { this.#selectTool((this.tool + Math.sign(inp.wheel) + TOOL_SLOTS) % TOOL_SLOTS); inp.wheel = 0; }
    this.myTool = this.#toolKind(latestMe);
    if (inp.hit('f') && this.myTool) this.session.send({ t: 'give' });
    if (inp.hit('tab', 'i')) this.inventory.toggle();
    if (inp.hit('r')) this.session.send({ t: 'weather', wet: !latest.wet });
    if (inp.hit('m') && this.audio) this.hud.toast(this.audio.toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
    const eHit = inp.hit('e');
    const door = this.#camperPoint(c, INTERIOR.doorX, INTERIOR.floorY);

    if (me.mode === 'out') {
      const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
      const carried = latestMe?.carrying != null ? (latest.logs || []).find(l => l.id === latestMe.carrying) : null;
      const speed = carried ? CARRY_SPEED[Math.min(1, carried.c.length - 1)] : undefined;
      // Step between the road and the forest behind it.
      if (inp.hit('w', 'arrowup') && me.lane !== 1) { me.lane = 1; me.y = floorAt(this.floor, me.x); me.vy = 0; me.onGround = true; }
      else if (inp.hit('s', 'arrowdown') && me.lane === 1) { me.lane = 0; me.y = this.terrain.groundY(me.x, floorAt(this.floor, me.x) + 1.5); me.vy = 0; }
      if (me.lane === 1 || this.myTool !== 'hammer') this.build = null;
      const input = { move, jump: inp.held(' '), speed };
      if (me.lane === 1) stepForest(me, x => floorAt(this.floor, x), input, dt, c.x);
      else stepAvatar(me, this.collider, input, dt, c.x);

      const ctx = this.#context(view, latestMe, door, carried);
      prompt = ctx.prompt;
      if (eHit && ctx.action) ctx.action();
      const push = !!ctx.push && inp.held('e');
      if (push !== this.pushing) { this.pushing = push; this.session.send({ t: 'push', on: push }); }
      const rescuing = !!ctx.rescue && inp.held('e');
      if (rescuing !== this.rescuing) { this.rescuing = rescuing; this.session.send({ t: 'rescue', on: rescuing }); }
      if (rescuing) working = true;
      if (inp.hit('g') && this.myTool) this.session.send({ t: 'droptool' });
      if (inp.hit('b') && latestMe?.boards) this.session.send({ t: 'drop' });
      const hook = this.#hookContext(view);
      if (hook.prompt && !prompt) prompt = hook.prompt;
      if (inp.hit('q') && hook.ok) this.session.send({ t: 'hook' });
      const used = this.#tools(now, view, latestMe);
      working = working || used.working;
      if (!prompt && used.hint) prompt = used.hint;
    } else {
      if (this.pushing) { this.pushing = false; this.session.send({ t: 'push', on: false }); }
      if (this.rescuing) { this.rescuing = false; this.session.send({ t: 'rescue', on: false }); }
      const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
      const winch = latest.winch || {};
      const alone = latest.players.filter(p => p.connected).length < 2;
      const reel = (inp.held('w', 'arrowup') ? 1 : 0) - (inp.held('s', 'arrowdown') ? 1 : 0);
      const atWinch = latestMe?.seat === 'winch';
      if ((atWinch || (seated && alone)) && reel !== (this.lastReel || 0)) { this.lastReel = reel; this.session.send({ t: 'winch', reel }); }
      const tension = winch.state === 'anchored' ? ` · cable ${Math.round((winch.tension || 0) * 100)}%` : '';
      if (seated) {
        me.lx = INTERIOR.seatX - 0.05; me.facing = 1; me.vx = 0;
        const brake = inp.held(' ');
        if (move !== this.lastDrive.throttle || brake !== this.lastDrive.brake || now - this.lastDrive.at > 250) {
          this.session.send({ t: 'drive', throttle: move, brake });
          this.lastDrive = { throttle: move, brake, at: now };
        }
        prompt = '<b>A / D</b> drive · <b>Space</b> brake' + (alone && winch.state === 'anchored' ? ' · <b>W / S</b> winch' + tension : '') + ' · <b>E</b> leave the wheel';
        if (eHit) this.session.send({ t: 'unseat' });
      } else if (atWinch) {
        me.lx = INTERIOR.winchX; me.facing = 1; me.vx = 0;
        prompt = winch.state === 'anchored' ? `<b>W</b> reel in · <b>S</b> pay out${tension} · <b>E</b> leave` : 'The hook is not attached: someone outside takes it from the bumper (Q) · <b>E</b> leave';
        if (eHit) this.session.send({ t: 'unseat' });
      } else {
        me.vx = move * WALK_INSIDE;
        if (move) me.facing = move;
        me.lx = Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, me.lx + me.vx * dt));
        if (move) me.walkPhase += WALK_INSIDE * dt * 2.2;
        // Nearest station within reach.
        const stations = [['seat', INTERIOR.seatX], ['winch', INTERIOR.winchX], ['toolbox', INTERIOR.toolboxX], ['door', INTERIOR.doorX]]
          .map(([k, x]) => [k, Math.abs(me.lx - x)]).filter(([, d]) => d < STATION_RANGE).sort((a, b) => a[1] - b[1]);
        const station = stations[0]?.[0];
        const atSeat = station === 'seat', atDoor = station === 'door';
        const driver = view.driver;
        if (station === 'winch') {
          const busy = latest.players.some(p => p.id !== this.myId && p.seat === 'winch');
          prompt = busy ? 'Your partner is on the winch' : '<b>E</b> work the winch';
          if (eHit && !busy) this.session.send({ t: 'seat', station: 'winch' });
        } else if (station === 'toolbox') {
          prompt = '<b>E</b> open the camper storage (<b>Tab</b> anywhere inside)';
          if (eHit) this.inventory.toggle(true);
        } else if (atSeat) {
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
    if (this.inventory.open) {
      const partner = latest.players.find(p => p.id !== this.myId);
      const pa = partner?.a;
      const partnerNear = !!partner && partner.connected && pa.mode === me.mode && (me.mode === 'in' ? Math.abs(pa.lx - me.lx) < GIVE_RANGE : (pa.lane || 0) === (me.lane || 0) && Math.hypot(pa.x - me.x, pa.y - me.y) < GIVE_RANGE);
      this.inventory.update({
        tools: latestMe?.tools || [], selected: this.tool, storage: latest.toolbox || [], near: this.#nearCamper(c), inside: me.mode === 'in',
        boards: latestMe?.boards || 0, boardCap: BOARD_CARRY, rack: { boards: latest.rack?.boards || 0, logs: latest.rack?.logs.length || 0 },
        partner: partner ? { name: partner.name, tools: partner.tools || [], near: partnerNear } : null,
      });
    }
    this.hud.update({
      prompt, soil: (latestMe?.soil || 0) / SOIL_CAPACITY, tipped: view.tipped, mass: c.mass, players: latest.players, myId: this.myId,
      tool: this.tool, tools: Array.from({ length: TOOL_SLOTS }, (_, k) => { const kind = latestMe?.tools?.[k]; return { name: kind ? TOOL_NAMES[kind] : 'Empty', icon: kind ? this.toolIcons?.[kind] : '' }; }), boards: latestMe?.boards || 0, boardCap: BOARD_CARRY,
      rack: latest.rack ? `${latest.rack.boards}/${RACK_BOARDS} boards · ${latest.rack.logs.length}/${RACK_LOGS} logs` : '',
      lane: me.mode === 'out' ? (me.lane === 1 ? 'Forest' : 'Road') : 'Camper', wet: latest.wet,
      rescued: latest.rescued || 0, helping: (latest.animals || []).filter(a => a.help).map(a => a.kind),
    });
    inp.endFrame();
  }

  // What E does right now, by priority.
  #context(view, latestMe, door, carried) {
    const me = this.me, c = view.camper, latest = view.latest;
    const lane = me.lane || 0;
    const send = msg => () => this.session.send(msg);
    const board = () => { Object.assign(me, { mode: 'in', lx: INTERIOR.doorX + 0.35, vx: 0 }); };
    // A tilted camper can still be boarded as long as it is more or less on its wheels.
    if (lane === 0 && !carried && Math.cos(c.a) > 0.45 && Math.hypot(me.x - door.x, me.y - door.y) < DOOR_RANGE + 0.6) return { prompt: '<b>E</b> climb aboard', action: board };
    if (lane === 0 && view.tipped && Math.hypot(me.x - c.x, me.y + 0.8 - c.y) < PUSH_RANGE) return { prompt: 'Hold <b>E</b> to push the camper upright', push: true };
    const thudSend = msg => () => { this.session.send(msg); this.audio?.thud(me.x); };
    if (carried) {
      if (lane === 0 && this.#atRack(c)) return { prompt: '<b>E</b> load the log onto the roof rack', action: send({ t: 'stow' }) };
      const alone = carried.c.length < 2;
      return { prompt: `${alone ? 'Hauling alone (slow)' : 'Carrying together'} · <b>E</b> let go${lane === 1 && alone ? ' · <b>S</b> bring it to the road' : ''}`, action: thudSend({ t: 'release' }) };
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
    const carriedAnimal = (latest.animals || []).find(a => a.state === 'carried' && a.carrier === this.myId);
    if (carriedAnimal) return { prompt: `Carry the ${carriedAnimal.kind} to the camper · <b>E</b> put it down`, action: send({ t: 'carryAnimal', id: carriedAnimal.id }) };
    const animal = (view.animals || []).find(a => a.state === 'waiting' && a.lane === lane && Math.abs(a.x - me.x) < RESCUE_RANGE);
    if (animal) {
      const def = ANIMALS[animal.kind];
      if (def.rescue === 'free') return { prompt: `Hold <b>E</b> to ${def.verb}${animal.p > 0 ? ` · ${Math.round(animal.p * 100)}%` : ''}${def.size === 'large' ? ' · faster together' : ''}`, rescue: true };
      if (def.rescue === 'carry') return { prompt: `<b>E</b> pick up the injured ${animal.kind}`, action: send({ t: 'carryAnimal', id: animal.id }) };
      if (def.rescue === 'dig') return { prompt: `Dig the rabbit out of its collapsed burrow with the <b>shovel</b>` };
      if (def.rescue === 'saw') return { prompt: `Saw the branch pinning the chipmunk, or haul it away` };
    }
    const item = (latest.items || []).find(it => it.lane === lane && Math.abs(it.x - me.x) < ITEM_RANGE);
    if (item) {
      const full = !(latestMe?.tools || []).includes(null);
      return { prompt: `<b>E</b> ${full ? 'swap for' : 'pick up'} the ${TOOL_NAMES[item.kind].toLowerCase()}`, action: send({ t: 'pickup', id: item.id }) };
    }
    const log = this.#nearestLog(view, lane);
    if (log) {
      const n = log.c.length;
      if (n < 2) return { prompt: n ? '<b>E</b> grab the other end' : '<b>E</b> pick up the log', action: thudSend({ t: 'grab', id: log.id }) };
    }
    const pile = (latest.piles || []).find(p => p.lane === lane && Math.abs(p.x - me.x) < WORK_RANGE);
    if (pile && (latestMe?.boards || 0) < BOARD_CARRY) return { prompt: `<b>E</b> pick up boards (${pile.n} here)`, action: send({ t: 'take', id: pile.id }) };
    const partner = latest.players.find(p => p.id !== this.myId && p.connected && p.a.mode === 'out' && (p.a.lane || 0) === lane && Math.hypot(p.a.x - me.x, p.a.y - me.y) < GIVE_RANGE);
    if (partner && this.myTool && (partner.tools || []).includes(null)) return { prompt: `<b>F</b> hand the ${TOOL_NAMES[this.myTool].toLowerCase()} to ${partner.name}` };
    return { prompt: '' };
  }

  // The winch hook (Q): take it from the bumper, hook it on, take it off, stow it.
  #hookContext(view) {
    const w = view.latest.winch, me = this.me, lane = me.lane || 0, c = view.camper;
    if (!w) return {};
    const wp = this.#camperPoint(c, WINCH.x, WINCH.y);
    const nearBumper = lane === 0 && Math.hypot(me.x - wp.x, me.y + 0.95 - wp.y) < 2.5;
    if (w.state === 'stowed') return nearBumper ? { ok: true, prompt: '<b>Q</b> take the winch hook' } : {};
    if (w.state === 'carried' && w.carrier === this.myId) {
      if (nearBumper) return { ok: true, prompt: '<b>Q</b> stow the hook' };
      const tree = lane === 1 && this.trees.find(t => Math.abs(t.x - me.x) < WINCH.attachRange);
      if (tree) return { ok: true, prompt: '<b>Q</b> hook the cable around this tree' };
      if (lane === 0 && this.#rockNear(me)) return { ok: true, prompt: '<b>Q</b> hook the cable to the rock' };
      return { prompt: 'Carrying the winch hook: find a tree, a stump or rock (<b>W</b> for the forest)' };
    }
    if (w.state === 'anchored' && w.anchor && Math.hypot(w.anchor.x - me.x, w.anchor.y - me.y - 0.8) < WINCH.attachRange + 0.8) return { ok: true, prompt: '<b>Q</b> unhook the cable' };
    return {};
  }

  #rockNear(me) {
    const t = this.terrain;
    for (let r = 0.3; r <= WINCH.attachRange; r += 0.3) for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      const ix = Math.round((me.x + Math.cos(ang) * r) / 0.25), iy = Math.round((me.y + 0.6 + Math.sin(ang) * r) / 0.25);
      if (ix < 0 || iy < 0 || ix >= t.nx || iy >= t.ny) continue;
      const i = iy * t.nx + ix;
      if (t.rock[i] && t.density[i] > 127) return true;
    }
    return false;
  }

  #nearCamper(c) {
    const me = this.me;
    return me.mode === 'in' || ((me.lane || 0) === 0 && Math.max(0, Math.abs(me.x - c.x) - 3.3) < STORAGE_RANGE && Math.abs(me.y + 0.8 - c.y) < 3);
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
    const tool = this.myTool;
    const lane = me.lane || 0;
    if (!tool) return { working: false };
    if (latestMe?.carrying != null || this.inventory.open) return { working: false };
    const every = TOOL_INTERVAL[tool] || 100;
    const ready = now - this.lastTool > every;
    if (tool === 'shovel' || tool === 'pickaxe') {
      if (lane === 1) return { working: false, hint: m.left || m.right ? 'The forest floor can\'t be dug · <b>S</b> back to the road' : '' };
      if (!m.left && !m.right) return { working: false };
      const p = this.#mouseWorld();
      if (Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) > REACH) return { working: false };
      if (Math.abs(p.x - me.x) > 0.2) me.facing = p.x > me.x ? 1 : -1;
      if (tool === 'pickaxe' && !m.left) return { working: false };
      if (ready) {
        this.lastTool = now;
        this.session.send({ t: m.left ? 'dig' : 'fill', x: p.x, y: p.y });
        if ((this.toolSounds = (this.toolSounds || 0) + 1) % 3 === 0) m.left ? this.audio?.dig(p.x) : this.audio?.fill(p.x);
      }
      return { working: true };
    }
    if (tool === 'axe') {
      const tree = this.#nearestTree(view);
      if (!tree) return { working: false, hint: lane === 0 ? '<b>W</b> step into the forest to fell trees' : '' };
      if (!m.left) return { working: false, hint: 'Hold <b>left mouse</b> to chop · faster together' };
      me.facing = tree.x > me.x ? 1 : -1;
      if (ready) { this.lastTool = now; this.session.send({ t: 'chop' }); this.audio?.chop(tree.x); }
      return { working: true };
    }
    if (tool === 'saw') {
      const log = this.#nearestLog(view, lane);
      if (!log) return { working: false };
      if (!m.left) return { working: false, hint: 'Hold <b>left mouse</b> to saw the log into boards' };
      me.facing = log.x > me.x ? 1 : -1;
      if (ready) { this.lastTool = now; this.session.send({ t: 'saw' }); if ((this.toolSounds = (this.toolSounds || 0) + 1) % 2 === 0) this.audio?.saw(log.x); }
      return { working: true };
    }
    if (tool === 'hammer') return this.#hammer(now, view, latestMe);
    if (tool === 'jack') return { working: false, hint: view.tipped ? 'With the jack, hold <b>E</b> beside the camper: you push like three' : '' };
    return { working: false };
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

  // Sounds driven by shared state: partner's tools, falling trees, new boards,
  // footsteps, stressed boards, engine and weather.
  #sounds(view) {
    const A = this.audio;
    if (!A?.ctx) return;
    const latest = view.latest, now = this.time;
    A.listenerX = this.cam.x;
    A.setEngine(!!view.driver, Math.abs(latest.c.th || 0), view.camper.vx, view.camper.x);
    A.setRain(!!latest.wet);
    A.tick(!!latest.wet);
    this.sfx = this.sfx || { fallen: null, boards: null, steps: new Map(), partner: new Map(), creak: 0 };
    const S = this.sfx;
    const fallen = new Set((latest.trees || []).filter(t => t[1] <= 0).map(t => t[0]));
    if (S.fallen) for (const id of fallen) if (!S.fallen.has(id)) { const tr = this.trees.find(t => t.id === id); if (tr) A.fell(tr.x); }
    S.fallen = fallen;
    const ids = new Set((latest.structure?.b || []).map(b => b[0]));
    if (S.boards) for (const b of latest.structure.b) if (!S.boards.has(b[0])) { const j = latest.structure.j.find(q => q[0] === b[2]); A.hammer(j ? j[1] : this.cam.x); }
    S.boards = ids;
    if (latest.structure?.b.some(b => b[3] > 0.85) && now - S.creak > 0.7) { S.creak = now; A.creak(this.cam.x); }
    for (const p of view.players) {
      const a = p.id === this.myId ? this.me : p.a;
      if (a.mode === 'out' && a.onGround) {
        const k = Math.floor(a.walkPhase || 0);
        if (S.steps.has(p.id) && S.steps.get(p.id) !== k) A.step(a.x, a.lane === 1);
        S.steps.set(p.id, k);
      }
      if (p.id === this.myId || !p.a.working || p.a.mode !== 'out') continue;
      const tool = this.#toolKind(p), last = S.partner.get(p.id) || 0;
      const every = { shovel: 0.25, pickaxe: 0.3, axe: 0.3, saw: 0.2 }[tool];
      if (every && now - last > every) {
        S.partner.set(p.id, now);
        if (tool === 'shovel') A.dig(p.a.x); else if (tool === 'axe' || tool === 'pickaxe') A.chop(p.a.x); else A.saw(p.a.x);
      }
    }
  }

  // Rain: a cool grade over the scene and slanting streaks.
  #weather(dt, w, h, wet) {
    this.rainAmt = (this.rainAmt || 0) + ((wet ? 1 : 0) - (this.rainAmt || 0)) * Math.min(1, dt * 0.8);
    const g = this.weather.clear();
    if (this.rainAmt < 0.01) return;
    g.rect(0, 0, w, h).fill({ color: 0x5d6f86, alpha: 0.22 * this.rainAmt });
    for (const d of this.rainDrops) {
      d.y += dt * 1.6 * d.s; d.x -= dt * 0.25 * d.s;
      if (d.y > 1) { d.y -= 1; d.x = Math.random() * 1.2; }
      if (d.x < -0.1) d.x += 1.2;
      const x = d.x * w, y = d.y * h, L = 18 * d.s;
      g.moveTo(x, y).lineTo(x - L * 0.25, y + L);
    }
    g.stroke({ width: 1.2, color: 0xdfe8f2, alpha: 0.45 * this.rainAmt });
  }

  // Particles for work done by anyone: driven by the same cues as sounds.
  #effects(view) {
    const P = this.particles, now = this.time;
    this.fx = this.fx || { last: new Map(), dust: 0, fallen: null };
    const F = this.fx;
    for (const p of view.players) {
      const a = p.id === this.myId ? this.me : p.a;
      const working = p.id === this.myId ? this.workingNow : p.a.working;
      if (!working || a.mode !== 'out') continue;
      const tool = this.#toolKind(p);
      const last = F.last.get(p.id) || 0;
      if (now - last < 0.18) continue;
      F.last.set(p.id, now);
      const hx = a.x + (a.facing || 1) * 0.6, hy = a.y + 0.4;
      if ((tool === 'shovel' || tool === 'pickaxe') && p.id === this.myId) { const m = this.#mouseWorld(); P.burst(m.x, m.y, 'dirt', 4); }
      else if (tool === 'shovel') P.burst(hx, a.y + 0.1, 'dirt', 3);
      else if (tool === 'axe') P.burst(hx, a.y + 1.0, 'chips', 3, -(a.facing || 1) * 0.6);
      else if (tool === 'saw') P.burst(hx, a.y + 0.4, 'sawdust', 4);
    }
    const fallen = new Set((view.latest.trees || []).filter(t => t[1] <= 0).map(t => t[0]));
    if (F.fallen) for (const id of fallen) if (!F.fallen.has(id)) {
      const tr = this.trees.find(t => t.id === id);
      if (tr) setTimeout(() => P.burst(tr.x + (view.latest.trees.find(t => t[0] === id)?.[2] || 1) * tr.height * 0.5, floorAt(this.floor, tr.x) + 0.3, 'leaves', 18), 1100);
    }
    F.fallen = fallen;
    // Dust behind the wheels when the camper moves on dry ground.
    const c = view.camper;
    if (!view.latest.wet && Math.abs(c.vx) > 2 && now - F.dust > 0.08) {
      F.dust = now;
      for (let k = 0; k < 2; k++) {
        const wx = c.w[k * 3], wy = c.w[k * 3 + 1];
        if (wy - 0.72 - this.terrain.groundY(wx, wy) < 0.25) P.burst(wx - Math.sign(c.vx) * 0.5, wy - 0.6, 'dust', 1, -Math.sign(c.vx) * 0.9);
      }
    }
  }

  #renderAnimals(view) {
    const fx = this.animalFx.clear(), c = view.camper, me = this.me;
    const meX = me.mode === 'in' ? c.x : me.x;
    for (const a of view.animals || []) {
      let v = this.animalViews.get(a.id);
      if (!v) { v = new AnimalView(a.kind); this.animalViews.set(a.id, v); }
      const def = ANIMALS[a.kind];
      const riding = a.state === 'riding' || a.state === 'riding-dog';
      const parent = riding ? this.camperView.interior : a.lane === 1 && a.kind !== 'hawk' ? this.forestView.actors : this.animalsRoad;
      if (v.root.parent !== parent) parent.addChild(v.root);
      if (Math.abs(a.x - this.cam.x) > 60 && !riding) { v.root.visible = false; continue; }
      v.root.visible = true;
      const pos = riding ? (a.state === 'riding-dog' ? { x: -1.75, y: INTERIOR.floorY } : { x: RIDE_SPOTS[Math.max(0, a.spot)][0], y: RIDE_SPOTS[Math.max(0, a.spot)][1] }) : { x: a.x, y: a.y };
      const lastBark = this.barks?.get(a.id) || 0;
      if (a.bark && a.bark !== lastBark) { (this.barks = this.barks || new Map()).set(a.id, a.bark); this.audio?.bark(a.x); this.barkUntil = this.time + 0.6; }
      v.root.scale.set(!riding && a.lane === 1 && a.kind !== 'hawk' ? 0.9 : 1);
      v.update({ ...a, ...pos, barking: a.kind === 'dog' && this.time < (this.barkUntil || 0) }, this.time, def, {
        groundY: def.rescue === 'dig' ? this.terrain.groundY(a.x, a.y + 3) : 0,
        near: a.state === 'waiting' && Math.abs(a.x - meX) < 18,
      });
      // Helpers: deer pull on ropes to the bumper; the hawk grips the roof.
      if (a.help && a.kind === 'deer') {
        const wp = this.#camperPoint(c, WINCH.x, WINCH.y + 0.4);
        fx.moveTo(a.x + 0.4 * -a.f, a.y + 1.0).lineTo(wp.x, wp.y).stroke({ width: 0.035, color: 0xc9a876 });
      }
      if (a.help && a.kind === 'hawk') {
        const roof = this.#camperPoint(c, 1.2, 2.3);
        fx.moveTo(a.x, a.y + 0.1).lineTo(roof.x, roof.y).stroke({ width: 0.02, color: 0xe8b53c });
      }
    }
  }

  #onRescued(msg) {
    const def = ANIMALS[msg.animal];
    const name = msg.animal;
    const text = def.size === 'dog' ? 'The dog decides you are friends. It will sniff out animals in trouble.'
      : def.size === 'large' ? `You rescued the ${name}! It will walk with you and help when the camper struggles.`
      : `You rescued the ${name}! It hops into the camper.`;
    this.hud.toast(text);
    this.audio?.chime();
  }

  // Winch cable from the bumper to the hook: straight when taut, sagging when slack.
  #drawCable(view) {
    const g = this.cable.clear(), w = view.latest.winch, c = view.camper;
    if (!w || w.state === 'stowed') return;
    const a = this.#camperPoint(c, WINCH.x, WINCH.y);
    let b;
    if (w.state === 'carried') {
      const p = w.carrier === this.myId ? this.me : view.players.find(q => q.id === w.carrier)?.a;
      if (!p) return;
      b = { x: p.x + (p.facing || 1) * 0.15, y: p.y + 0.95 };
    } else b = w.anchor;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const slack = w.state === 'carried' ? 0.4 : Math.max(0, (w.length || d) - d);
    const sag = Math.min(2.5, Math.sqrt(slack * d) * 0.6);
    g.moveTo(a.x, a.y).quadraticCurveTo((a.x + b.x) / 2, (a.y + b.y) / 2 - sag, b.x, b.y);
    const taut = (w.tension || 0) > 0.05;
    g.stroke({ width: 0.045, color: taut ? 0x4a3a30 : 0x5a4a3e });
    g.circle(b.x, b.y, 0.09).stroke({ width: 0.04, color: 0x6f777c });
  }

  #render(dt, view, { working }) {
    this.workingNow = working;
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
    const wet = !!view.latest.wet;
    this.bg.update(this.cam.x, this.cam.y, ppm, this.refY, this.time);
    this.fg.update(this.cam.x, w, h, ppm, this.time, wet);
    this.#weather(dt, w, h, wet);
    const treeState = new Map((view.latest.trees || []).map(t => [t[0], t]));
    this.forestView.update(this.cam.x - halfW, this.cam.x + halfW, treeState, view.tick, this.time);
    this.terrainView.update(this.cam.x - halfW, this.cam.x + halfW, this.cam.y - halfH, this.cam.y + halfH);
    this.camperView.update(c, this.time);
    // Cut away the near wall while anyone is on foot inside; a lone driver sees it closed.
    const onFootInside = view.players.some(p => {
      const a = p.id === this.myId ? me : p.a;
      return (p.connected || p.id === this.myId) && a.mode === 'in' && p.seat !== 'cab';
    });
    this.camperView.setCutaway(onFootInside, dt);
    if (view.latest.rack) this.camperView.setRack(view.latest.rack);
    const piles = view.latest.piles || [];
    this.forestLumber.update(view.logs.filter(l => l.lane === 1), piles.filter(p => p.lane === 1));
    this.roadLumber.update(view.logs.filter(l => l.lane === 0), piles.filter(p => p.lane === 0));
    this.structureView.update(view.latest.structure, this.time, me.mode === 'out' && this.myTool === 'hammer');
    if (!(me.mode === 'out' && this.myTool === 'hammer')) this.structureView.drawGhost(null);
    this.itemsForest.update((view.latest.items || []).filter(it => it.lane === 1), this.time);
    this.itemsRoad.update((view.latest.items || []).filter(it => it.lane === 0), this.time);
    this.#drawCable(view);

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
        tool: this.#toolKind(p), boards: p.boards || 0, carrying: p.carrying != null,
      });
    });
    for (const [id, v] of this.views) if (!view.players.some(p => p.id === id)) { v.root.destroy({ children: true }); this.views.delete(id); }
    this.#renderAnimals(view);

    // Shovel brush cursor.
    this.cursor.clear();
    if (me.mode === 'out' && (me.lane || 0) === 0 && (this.myTool === 'shovel' || this.myTool === 'pickaxe') && this.input.mouse.inside) {
      const p = this.#mouseWorld();
      const ok = Math.hypot(p.x - me.x, p.y - (me.y + 0.9)) <= REACH;
      this.cursor.circle(p.x, p.y, BRUSH_RADIUS).stroke({ width: 0.05, color: ok ? 0xfff3d6 : 0xd06a50, alpha: ok ? 0.85 : 0.5 });
      if (!ok) this.cursor.circle(me.x, me.y + 0.9, REACH).stroke({ width: 0.03, color: 0xfff3d6, alpha: 0.18 });
    }
    this.#sounds(view);
    this.#effects(view);
    this.particles.update(dt, x => this.terrain.groundY(x, this.cam.y + halfH));
    this.ambience.update(dt, this.time, w, h, this.cam.x, x => this.terrain.groundY(x, this.cam.y + halfH));
  }
}
