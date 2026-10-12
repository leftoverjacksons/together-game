import * as THREE from 'three';
import { Input } from '../input.js';
import { newAvatar, stepAvatar } from '../../shared/character.mjs';
import { INTERIOR, STATION_RANGE, DOOR_RANGE, REACH, SOIL_CAPACITY, SNAPSHOT_HZ, BRUSH_RADIUS } from '../../shared/constants.mjs';
import {
  LANE_COUNT, LANE_DEPTH, LANE_NAMES, laneZ, generateLaneWorld, makeTerrains, camperGapAt, footCrossing,
  areaAt, DIVIDER_TYPES, BIRDS,
} from '../../shared/lanes/world.mjs';
import { buildChunkGeometry, buildDividerChunk, chunkSize, makeCamper, makeAvatar, makeAnimal } from './meshes.js';
import { PAL } from '../render/palette.js';

// The lane prototype client: three side-view lanes rendered in 3D under a
// raised camera whose angle never changes. Rules and physics are the same
// shared code as the main game; only the view and the lane rules are new.

const INTERP_DELAY = 110;
const SEND_INTERVAL = 1000 / SNAPSHOT_HZ;
const WALK_INSIDE = 2.6;
const TOOL_MS = 80;
const PUSH_RANGE = 4.5;
const RESCUE_RANGE = 1.8;
const CROSS_HOP = 0.45;
const VIEW_AHEAD = 70;            // metres of terrain kept built either side of the camera
const MAX_BUILDS = 6;             // chunk meshes (re)built per frame
const FRONT = laneZ(0) + LANE_DEPTH / 2, BACK = laneZ(LANE_COUNT - 1) - LANE_DEPTH / 2;
const PITCHES = [20, 24, 28, 32, 36, 42, 50];
const ANIMAL_NAMES = { rabbit: 'rabbit', chipmunk: 'chipmunk', songbird: 'songbird', hawk: 'hawk', fox: 'fox', deer: 'deer', moose: 'moose' };
const ANIMAL_TROUBLE = { rabbit: 'dig out the rabbit', chipmunk: 'free the chipmunk', songbird: 'untangle the songbird', hawk: 'help the hurt hawk', fox: 'open the snare on the fox', deer: 'cut the deer free of the wire', moose: 'help the moose out of the mud' };

const lerp = (a, b, t) => a + (b - a) * t;
const lerpAngle = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return a + d * t; };
const smooth = t => t * t * (3 - 2 * t);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const $ = id => document.getElementById(id);

export class LaneGame {
  constructor(session, hud, audio) {
    this.session = session;
    this.hud = hud;
    this.audio = audio;
    this.snaps = [];
    this.me = null;
    this.lastSend = 0; this.lastTool = 0; this.lastDrive = { throttle: 0, brake: false, at: 0 };
    this.pushing = false; this.rescuing = false;
    this.time = 0;
    const saved = PITCHES.indexOf(+store.get('together:lanes:pitch'));
    this.pitchIndex = saved >= 0 ? saved : 4;
    this.cam = null;
    this.mouse = new THREE.Vector2();
  }

  async start(container) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(1.5, devicePixelRatio || 1));
    renderer.setSize(innerWidth, innerHeight);
    renderer.setClearColor(0xcfe3ea);
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.input = new Input(renderer.domElement);
    document.body.classList.add('lanes-mode');
    $('help').innerHTML = `<h2>Controls · lane prototype</h2><table>
      <tr><td>A / D</td><td>Walk · drive when at the wheel</td></tr>
      <tr><td>W / S</td><td>On foot: cross into the lane behind / in front (where the divider lets you) · At the wheel: turn into the next lane at a gap</td></tr>
      <tr><td>Space</td><td>Jump · brake when at the wheel</td></tr>
      <tr><td>E</td><td>Board the camper, take the wheel, climb out · hold to help an animal · hold to push the camper upright</td></tr>
      <tr><td>Left / right mouse</td><td>Dig / place soil in your lane</td></tr>
      <tr><td>[ / ]</td><td>Camera angle (lower / higher), for testing</td></tr>
      <tr><td>M</td><td>Sound on / off</td></tr>
      <tr><td>H</td><td>Show or hide this panel</td></tr></table>`;
    addEventListener('resize', () => {
      renderer.setSize(innerWidth, innerHeight);
      if (this.camera) { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }
    });
    this.session.onmessage = m => this.onMessage(m);
    this.session.onstatus = (s, detail) => this.hud.status(s, detail);
    this.session.connect();
    let last = performance.now();
    renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.frame(dt, now);
    });
  }

  onMessage(msg) {
    switch (msg.t) {
      case 'welcome': {
        this.myId = msg.id;
        if (!this.terrains) {
          this.world = generateLaneWorld(msg.seed, msg.length);
          this.terrains = makeTerrains(this.world);
          this.#buildScene();
        }
        msg.edits.forEach((e, lane) => this.terrains[lane].applyEdits(e.i, e.v));
        this.snaps = [{ time: performance.now(), s: msg.snap }];
        const mine = msg.snap.players.find(p => p.id === msg.id);
        if (!this.me) this.me = Object.assign(newAvatar(0, 0), mine ? mine.a : {}, { cross: null });
        this.hud.joined(msg.code || null);
        break;
      }
      case 'terrain': this.terrains?.[msg.lane]?.applyEdits(msg.i, msg.v); break;
      case 'notice': if (msg.to === this.myId) this.hud.toast(msg.msg); break;
      case 'fx':
        if (msg.kind === 'rescued') { this.hud.toast(`You rescued the ${ANIMAL_NAMES[msg.animal] || msg.animal}! It hops up onto the camper roof.`); this.audio?.chime(); }
        break;
      case 'snap':
        this.snaps.push({ time: performance.now(), s: msg });
        if (this.snaps.length > 40) this.snaps.shift();
        break;
    }
  }

  // ----- Scene -----

  #buildScene() {
    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xcfe3ea, 80, 240);
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 600);
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6b5a45, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(-30, 60, 45);
    scene.add(sun);

    const laneMat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, transparent: false });
    this.laneMats = Array.from({ length: LANE_COUNT }, laneMat);
    this.divMats = Array.from({ length: LANE_COUNT - 1 }, laneMat);
    this.waterMat = new THREE.MeshLambertMaterial({ color: 0x5aa7c2, transparent: true, opacity: 0.62, depthWrite: false });
    this.divWaterMats = this.divMats.map(() => this.waterMat.clone());
    this.chunks = new Map();     // 'lane:cx:cy' -> { mesh, version }
    this.dividers = new Map();   // 'k:cx' -> group
    this.propGeo = new THREE.IcosahedronGeometry(1, 0);
    this.propMats = { bush: 0x4f7f45, rock: PAL.rock, reed: 0x9aa860, stone: 0x8d8a92, flower: 0xf2c14e };

    this.#buildBackdrop();
    this.#buildEdge();
    this.#buildLaneDecor();

    const cam = makeCamper();
    this.camperView = cam;
    scene.add(cam.group);
    this.avatars = new Map();
    this.animalViews = new Map();
    for (const a of this.world.animals) {
      const v = makeAnimal(a.kind);
      scene.add(v.group);
      this.animalViews.set(a.id, v);
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(BRUSH_RADIUS * 0.85, BRUSH_RADIUS, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthTest: false }));
    ring.renderOrder = 10;
    scene.add(ring);
    this.cursor = ring;
  }

  // The hillside rising behind the back lane, distant ridges, and trees.
  #buildBackdrop() {
    const W = this.world, T = this.terrains[LANE_COUNT - 1];
    const back = BACK, zs = [back, back - 0.5, back - 4, back - 10, back - 21, back - 39, back - 61];
    const rise = [0, 0.4, 1.0, 2.8, 6.2, 11.2, 16.2];
    const pos = [], cols = [];
    const c = new THREE.Color();
    const heights = [];
    for (let x = -40; x <= W.length + 40; x += 2) {
      const ix = Math.max(0, Math.min(T.nx - 1, Math.round(x / 0.25)));
      const base = T.surface[ix];
      heights.push({ x, h: zs.map((z, j) => base + rise[j] + (j ? 1.6 * Math.sin(x * 0.05 + j * 1.7) + Math.sin(x * 0.13 + j) * 0.7 : 0)) });
    }
    for (let r = 0; r + 1 < heights.length; r++) {
      const a = heights[r], b = heights[r + 1];
      const area = areaAt(W, Math.max(0, Math.min(W.length - 1, a.x)));
      for (let j = 0; j + 1 < zs.length; j++) {
        c.setHex(area.grass).offsetHSL(0, -0.05, (j === 0 ? -0.12 : -0.06) - j * 0.02);
        const q = [[a.x, a.h[j], zs[j]], [b.x, b.h[j], zs[j]], [b.x, b.h[j + 1], zs[j + 1]], [a.x, a.h[j + 1], zs[j + 1]]];
        for (const p of [q[0], q[1], q[2], q[0], q[2], q[3]]) { pos.push(...p); cols.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    g.computeVertexNormals();
    this.scene.add(new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true })));

    // Distant ridges (the fog does the aerial perspective).
    for (const [z, base, amp, color] of [[-130, 22, 18, 0x86a493], [-200, 26, 30, 0x9fb5b0]]) {
      const rp = [];
      for (let x = -200; x <= W.length + 200; x += 8) {
        const y = base + amp * (0.5 + 0.3 * Math.sin(x * 0.011 + z) + 0.2 * Math.sin(x * 0.037 + z * 2));
        rp.push(x, 0, z, x + 8, 0, z, x + 8, base + amp * (0.5 + 0.3 * Math.sin((x + 8) * 0.011 + z) + 0.2 * Math.sin((x + 8) * 0.037 + z * 2)), z, x, 0, z, x + 8, base + amp * (0.5 + 0.3 * Math.sin((x + 8) * 0.011 + z) + 0.2 * Math.sin((x + 8) * 0.037 + z * 2)), z, x, y, z);
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
      rg.computeVertexNormals();
      this.scene.add(new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ color })));
    }

    // Trees on the hillside: instanced cones and trunks, density by area.
    const spots = [];
    let seed = W.seed % 9973;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let x = -30; x < W.length + 30; x += 1.6) {
      const area = areaAt(W, Math.max(0, Math.min(W.length - 1, x)));
      for (let j = 0; j < 3; j++) {
        if (rnd() > 0.42 * area.trees) continue;
        const z = back - 6 - rnd() * 32;
        const t = (back - z) / 58;
        const row = heights[Math.max(0, Math.min(heights.length - 1, Math.round((x + 40) / 2)))];
        let k = 0; while (k + 1 < zs.length && zs[k + 1] > z) k++;
        const f = (zs[k] - z) / (zs[k] - zs[k + 1] || 1);
        const y = lerp(row.h[k], row.h[Math.min(k + 1, zs.length - 1)], f);
        spots.push({ x: x + rnd() * 1.2, y, z, s: 0.8 + rnd() * 0.7 + t * 0.4, tint: rnd(), color: area.foliage });
      }
    }
    const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(1.5, 5.2, 7), new THREE.MeshLambertMaterial({ flatShading: true }), spots.length);
    const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.3, 1.8, 6), new THREE.MeshLambertMaterial({ color: PAL.trunk }), spots.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    spots.forEach((t, i) => {
      m.compose(p.set(t.x, t.y + 0.9 * t.s, t.z), q, s.set(t.s, t.s, t.s)); trunks.setMatrixAt(i, m);
      m.compose(p.set(t.x, t.y + (1.6 + 2.6) * t.s, t.z), q, s.set(t.s, t.s * (0.9 + t.tint * 0.3), t.s)); foliage.setMatrixAt(i, m);
      foliage.setColorAt(i, c.setHex(t.color).offsetHSL(0, 0, (t.tint - 0.5) * 0.1));
    });
    this.scene.add(foliage, trunks);
  }

  // Ferns and bushes along the back lane's far edge mark where the hillside starts.
  #buildEdge() {
    const list = [];
    for (let x = 0; x < this.world.length; x += 0.9) {
      const r = Math.abs(Math.sin(x * 37.1) * 9137.7) % 1;
      if (r < 0.35) continue;
      const ix = Math.round(x / 0.25);
      list.push({ x: x + r * 0.5, y: this.terrains[LANE_COUNT - 1].surface[ix] + 0.25, z: BACK - 0.35 - r * 0.4, s: 0.35 + r * 0.45 });
    }
    const inst = new THREE.InstancedMesh(this.propGeo, new THREE.MeshLambertMaterial({ color: 0x4a7a40, flatShading: true }), list.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    list.forEach((b, i) => { m.compose(p.set(b.x, b.y, b.z), q, s.set(b.s * 1.2, b.s * 0.8, b.s)); inst.setMatrixAt(i, m); });
    this.scene.add(inst);
  }

  // Water in the creek-bank pools, and logs lying across the track.
  #buildLaneDecor() {
    for (const p of this.world.pools) {
      const z0 = laneZ(p.lane);
      const bottom = p.level - 3;
      const box = new THREE.Mesh(new THREE.BoxGeometry(p.x1 - p.x0, p.level - bottom, LANE_DEPTH - 0.05), this.waterMat);
      box.position.set((p.x0 + p.x1) / 2, (p.level + bottom) / 2, z0);
      box.renderOrder = 2;
      this.scene.add(box);
    }
    const logMat = new THREE.MeshLambertMaterial({ color: 0x7a5434 });
    for (const f of this.world.features[1]) if (f.kind === 'log') {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, LANE_DEPTH + 0.6, 10), logMat);
      log.rotation.x = Math.PI / 2;
      log.position.set(f.x, this.terrains[1].surface[Math.round(f.x / 0.25)] - 0.25, laneZ(1));
      this.scene.add(log);
    }
  }

  // Build terrain and divider meshes near the camera; drop far ones.
  #updateChunks(cx) {
    let budget = MAX_BUILDS;
    const lo = Math.max(0, Math.floor((cx - VIEW_AHEAD) / chunkSize)), hi = Math.floor((cx + VIEW_AHEAD) / chunkSize);
    this.terrains.forEach((t, lane) => {
      for (let x = lo; x <= Math.min(hi, t.chunksX - 1); x++) for (let y = 0; y < t.chunksY; y++) {
        const key = lane + ':' + x + ':' + y, id = y * t.chunksX + x;
        const have = this.chunks.get(key);
        if (have && have.version === t.chunkVersion[id]) continue;
        if (budget-- <= 0) return;
        if (have?.mesh) { this.scene.remove(have.mesh); have.mesh.geometry.dispose(); }
        const g = buildChunkGeometry(t, this.world, lane, x, y);
        const mesh = g ? new THREE.Mesh(g, this.laneMats[lane]) : null;
        if (mesh) this.scene.add(mesh);
        this.chunks.set(key, { mesh, version: t.chunkVersion[id], cx: x });
      }
    });
    for (let k = 0; k < LANE_COUNT - 1; k++) for (let x = lo; x <= hi; x++) {
      const key = k + ':' + x;
      if (this.dividers.has(key) || x * chunkSize > this.world.length) continue;
      if (budget-- <= 0) break;
      const d = buildDividerChunk(this.world, this.terrains, k, x * chunkSize, Math.min(this.world.length, (x + 1) * chunkSize));
      const group = new THREE.Group();
      group.add(new THREE.Mesh(d.ground, this.divMats[k]));
      if (d.water) { const w = new THREE.Mesh(d.water, this.divWaterMats[k]); w.renderOrder = 2; group.add(w); }
      const byKind = new Map();
      for (const pr of d.props) { if (!byKind.has(pr.kind)) byKind.set(pr.kind, []); byKind.get(pr.kind).push(pr); }
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
      for (const [kind, list] of byKind) {
        const mat = new THREE.MeshLambertMaterial({ color: this.propMats[kind], flatShading: true });
        const inst = new THREE.InstancedMesh(this.propGeo, mat, list.length);
        list.forEach((pr, i) => {
          const sc = kind === 'reed' ? s.set(0.06, 0.55, 0.06) : kind === 'rock' || kind === 'stone' ? s.set(pr.s, pr.s * 0.55, pr.s * 0.8) : kind === 'flower' ? s.set(0.09, 0.09, 0.09) : s.set(pr.s, pr.s * 0.8, pr.s);
          m.compose(p.set(pr.x, pr.y, pr.z), q, sc);
          inst.setMatrixAt(i, m);
        });
        group.add(inst);
        group.userData.mats = (group.userData.mats || []).concat(mat);
      }
      group.userData.k = k;
      this.scene.add(group);
      this.dividers.set(key, group);
    }
    for (const [key, ch] of this.chunks) if (Math.abs(ch.cx * chunkSize - cx) > VIEW_AHEAD + 2 * chunkSize) {
      if (ch.mesh) { this.scene.remove(ch.mesh); ch.mesh.geometry.dispose(); }
      this.chunks.delete(key);
    }
    for (const [key, g] of this.dividers) if (Math.abs(+key.split(':')[1] * chunkSize - cx) > VIEW_AHEAD + 2 * chunkSize) {
      this.scene.remove(g);
      g.traverse(o => { if (o.geometry && o.geometry !== this.propGeo) o.geometry.dispose(); });
      for (const m of g.userData.mats || []) m.dispose();
      this.dividers.delete(key);
    }
  }

  // ----- State -----

  #sampled(now) {
    const rt = now - INTERP_DELAY;
    const S = this.snaps;
    let a = S[0], b = S[0];
    for (let k = S.length - 1; k >= 0; k--) { if (S[k].time <= rt) { a = S[k]; b = S[k + 1] || S[k]; break; } }
    const t = b === a ? 0 : Math.max(0, Math.min(1, (rt - a.time) / (b.time - a.time)));
    const ca = a.s.c, cb = b.s.c;
    let z;
    if (cb.ch) z = lerp(laneZ(cb.ch.from), laneZ(cb.ch.to), smooth(ca.ch && ca.ch.to === cb.ch.to ? lerp(ca.ch.t, cb.ch.t, t) : cb.ch.t));
    else z = laneZ(cb.lane);
    const camper = {
      x: lerp(ca.x, cb.x, t), y: lerp(ca.y, cb.y, t), a: lerpAngle(ca.a, cb.a, t), vx: lerp(ca.vx, cb.vx, t), z, lane: cb.lane, ch: cb.ch,
      w: ca.w.map((v, k) => (k % 3 === 2 ? lerpAngle(v, cb.w[k], t) : lerp(v, cb.w[k], t))), wet: cb.wet,
    };
    const players = b.s.players.map(pb => {
      const pa = a.s.players.find(p => p.id === pb.id) || pb;
      const A = pa.a, B = pb.a;
      const same = A.mode === B.mode && A.lane === B.lane && !!A.cross === !!B.cross;
      return { ...pb, a: { ...B, x: same ? lerp(A.x, B.x, t) : B.x, y: same ? lerp(A.y, B.y, t) : B.y, lx: same ? lerp(A.lx, B.lx, t) : B.lx, walkPhase: lerp(A.walkPhase, B.walkPhase, t) } };
    });
    return { camper, players, animals: b.s.animals, tipped: b.s.tipped, driver: b.s.driver, latest: S[S.length - 1].s };
  }

  #camperPoint(c, lx, ly) {
    const ca = Math.cos(c.a), sa = Math.sin(c.a);
    return { x: c.x + lx * ca - ly * sa, y: c.y + lx * sa + ly * ca };
  }

  // The lane an avatar is in, as a float while crossing.
  #laneOf(a) { return a.cross ? lerp(a.cross.from, a.cross.to, smooth(a.cross.t)) : a.lane; }

  // ----- Frame -----

  frame(dt, now) {
    if (!this.terrains || !this.me) return;
    this.time += dt;
    const view = this.#sampled(now);
    const latest = view.latest;
    const c = view.camper;
    const latestMe = latest.players.find(p => p.id === this.myId);
    const seated = latestMe?.seat === 'cab';
    const inp = this.input;
    const me = this.me;
    const send = m => this.session.send(m);
    let prompt = '';
    let working = false;

    if (inp.hit('[')) this.#pitch(-1);
    if (inp.hit(']')) this.#pitch(1);
    if (inp.hit('m') && this.audio) this.hud.toast(this.audio.toggleMute() ? 'Sound off (M)' : 'Sound on (M)');
    const eHit = inp.hit('e');
    const move = (inp.held('d', 'arrowright') ? 1 : 0) - (inp.held('a', 'arrowleft') ? 1 : 0);
    const door = this.#camperPoint(c, INTERIOR.doorX, INTERIOR.floorY);

    if (me.mode === 'out') {
      if (me.cross) {
        // Crossing between lanes: a short scramble with a little hop.
        const k = me.cross;
        k.t = Math.min(1, k.t + dt / k.dur);
        me.x += move * 0.6 * dt;
        me.y = lerp(k.y0, k.y1, smooth(k.t)) + Math.sin(Math.PI * k.t) * CROSS_HOP;
        me.walkPhase += dt * 5;
        if (k.t >= 1) { me.lane = k.to; me.y = k.y1; me.vy = 0; me.vx = 0; me.onGround = true; me.cross = null; }
        prompt = `Crossing ${k.label}…`;
      } else {
        const dir = inp.hit('w', 'arrowup') ? 1 : inp.hit('s', 'arrowdown') ? -1 : 0;
        if (dir) {
          const r = footCrossing(this.world, this.terrains, me.lane, me.lane + dir, me.x, me.y);
          if (r.ok) me.cross = { from: me.lane, to: me.lane + dir, t: 0, dur: r.time, y0: me.y, y1: r.y, label: r.label };
          else if (r.why) this.hud.toast(r.why);
        }
        if (!me.cross) stepAvatar(me, this.terrains[me.lane], { move, jump: inp.held(' ') }, dt, c.x);
        const ctx = this.#context(view, latestMe, door);
        prompt = ctx.prompt;
        if (eHit && ctx.action) ctx.action();
        const push = !!ctx.push && inp.held('e');
        if (push !== this.pushing) { this.pushing = push; send({ t: 'push', on: push }); }
        const rescuing = !!ctx.rescue && inp.held('e');
        if (rescuing !== this.rescuing) { this.rescuing = rescuing; send({ t: 'rescue', on: rescuing }); }
        working = rescuing;
        const used = this.#dig(now, latestMe);
        working = working || used;
      }
    } else {
      if (this.pushing) { this.pushing = false; send({ t: 'push', on: false }); }
      if (this.rescuing) { this.rescuing = false; send({ t: 'rescue', on: false }); }
      me.lane = c.lane;
      if (seated) {
        me.lx = INTERIOR.seatX - 0.05; me.facing = 1; me.vx = 0;
        const brake = inp.held(' ');
        if (move !== this.lastDrive.throttle || brake !== this.lastDrive.brake || now - this.lastDrive.at > 250) {
          send({ t: 'drive', throttle: move, brake });
          this.lastDrive = { throttle: move, brake, at: now };
        }
        const turn = inp.hit('w', 'arrowup') ? 1 : inp.hit('s', 'arrowdown') ? -1 : 0;
        if (turn) send({ t: 'lane', dir: turn });
        prompt = '<b>A / D</b> drive · <b>Space</b> brake · ' + this.#gapHint(c) + ' · <b>E</b> leave the wheel';
        if (eHit) send({ t: 'unseat' });
      } else {
        me.vx = move * WALK_INSIDE;
        if (move) me.facing = move;
        me.lx = Math.max(INTERIOR.minX, Math.min(INTERIOR.maxX, me.lx + me.vx * dt));
        if (move) me.walkPhase += WALK_INSIDE * dt * 2.2;
        const atSeat = Math.abs(me.lx - INTERIOR.seatX) < STATION_RANGE, atDoor = Math.abs(me.lx - INTERIOR.doorX) < STATION_RANGE;
        if (atSeat) {
          prompt = view.driver && view.driver !== this.myId ? 'Your partner is driving' : '<b>E</b> take the wheel';
          if (eHit && !view.driver) send({ t: 'seat' });
        } else if (atDoor) {
          if (c.ch) prompt = 'Wait until the camper is through the gap';
          else {
            prompt = '<b>E</b> climb out';
            if (eHit) {
              const out = this.#camperPoint(c, INTERIOR.doorX - 0.2, INTERIOR.floorY + 0.05);
              Object.assign(me, { mode: 'out', lane: c.lane, cross: null, x: out.x, y: out.y, vx: c.vx, vy: 1.5, onGround: false });
            }
          }
        } else prompt = '<b>A / D</b> walk · the wheel is at the front, the door at the back';
      }
    }

    if (now - this.lastSend > SEND_INTERVAL) {
      this.lastSend = now;
      send({ t: 'avatar', a: { mode: me.mode, lane: me.lane, cross: me.cross && { from: me.cross.from, to: me.cross.to, t: me.cross.t }, x: me.x, y: me.y, vx: me.vx, vy: me.vy, facing: me.facing, lx: me.lx, onGround: me.onGround, walkPhase: me.walkPhase, working } });
    }

    this.#render(dt, view, latestMe);
    this.#hud(view, latestMe, prompt);
    if (this.audio) {
      this.audio.listenerX = this.cam?.x ?? c.x;
      this.audio.setEngine(!!view.driver, Math.abs(latest.c.th || 0), c.vx, c.x);
      this.audio.tick?.({ day: 1, storm: 0 });
    }
    inp.endFrame();
  }

  #pitch(d) {
    this.pitchIndex = Math.max(0, Math.min(PITCHES.length - 1, this.pitchIndex + d));
    store.set('together:lanes:pitch', PITCHES[this.pitchIndex]);
    this.hud.toast(`Camera angle ${PITCHES[this.pitchIndex]}° ([ / ] to change)`);
  }

  #gapHint(c) {
    if (c.ch) return 'turning…';
    const parts = [];
    if (camperGapAt(this.world, c.lane, c.lane + 1, c.x)) parts.push(`<b>W</b> turn into the ${LANE_NAMES[c.lane + 1].toLowerCase()}`);
    if (camperGapAt(this.world, c.lane, c.lane - 1, c.x)) parts.push(`<b>S</b> turn into the ${LANE_NAMES[c.lane - 1].toLowerCase()}`);
    if (parts.length) return parts.join(' · ');
    // Otherwise point out the next gap ahead in the direction of travel.
    const ahead = [];
    for (const dir of [1, -1]) {
      const to = c.lane + dir;
      if (to < 0 || to >= LANE_COUNT) continue;
      const g = this.world.dividers[Math.min(c.lane, to)].find(s => DIVIDER_TYPES[s.type].camper && s.x0 > c.x);
      if (g) ahead.push(`gap to the ${LANE_NAMES[to].toLowerCase()} in ${Math.round(g.x0 - c.x)} m`);
    }
    return ahead.join(' · ') || 'no gaps ahead';
  }

  #context(view, latestMe, door) {
    const me = this.me, c = view.camper;
    if (view.tipped && me.lane === c.lane && Math.hypot(me.x - c.x, me.y - c.y) < PUSH_RANGE) return { prompt: 'Hold <b>E</b> to push the camper upright', push: true };
    if (me.lane === c.lane && !c.ch && Math.hypot(me.x - door.x, me.y - door.y) < DOOR_RANGE) {
      return { prompt: '<b>E</b> climb aboard', action: () => Object.assign(me, { mode: 'in', lx: INTERIOR.doorX + 0.3, vx: 0, vy: 0, cross: null }) };
    }
    for (const an of view.animals) {
      if (an.state !== 'stuck' || Math.abs(an.x - me.x) > RESCUE_RANGE) continue;
      const near = an.lane === me.lane || (BIRDS.has(an.kind) && Math.abs(an.lane - me.lane) === 1);
      if (!near) continue;
      const pct = an.p > 0 ? ` (${Math.round(an.p * 100)}%)` : '';
      return { prompt: `Hold <b>E</b> to ${ANIMAL_TROUBLE[an.kind] || 'help'}${pct}`, rescue: true };
    }
    const hints = [];
    for (const [key, dir] of [['W', 1], ['S', -1]]) {
      const to = me.lane + dir;
      if (to < 0 || to >= LANE_COUNT) continue;
      const r = footCrossing(this.world, this.terrains, me.lane, to, me.x, me.y);
      if (r.ok) hints.push(`<b>${key}</b> cross ${r.label} to the ${LANE_NAMES[to].toLowerCase()}`);
    }
    hints.push('<b>Mouse</b> dig · place soil');
    return { prompt: hints.join(' · ') };
  }

  #dig(now, latestMe) {
    const inp = this.input, me = this.me;
    const p = this.#pick();
    this.pick = p;
    if (!p || !inp.mouse.inside) return false;
    const inReach = (p.x - me.x) ** 2 + (p.y - me.y - 0.9) ** 2 <= REACH * REACH;
    p.ok = inReach;
    if (!inReach || now - this.lastTool < TOOL_MS) return false;
    const soil = latestMe?.soil || 0;
    if (inp.mouse.left && soil < SOIL_CAPACITY - 1e-3) { this.session.send({ t: 'dig', lane: me.lane, x: p.x, y: p.y }); this.lastTool = now; this.audio?.dig(p.x); return true; }
    if (inp.mouse.right && soil > 1e-3) { this.session.send({ t: 'fill', lane: me.lane, x: p.x, y: p.y }); this.lastTool = now; this.audio?.fill(p.x); return true; }
    return false;
  }

  // Where the mouse ray meets the vertical plane through the middle of my lane.
  #pick() {
    const m = this.input.mouse;
    if (!this.camera) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((m.x - rect.left) / rect.width) * 2 - 1, -((m.y - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(this.mouse, this.camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    const z = laneZ(this.me.lane);
    if (Math.abs(d.z) < 1e-5) return null;
    const t = (z - o.z) / d.z;
    return t > 0 ? { x: o.x + d.x * t, y: o.y + d.y * t, z } : null;
  }

  // ----- Rendering -----

  #frameCamera(dt, view) {
    const me = this.me, c = view.camper;
    const xs = [c.x];
    if (me.mode === 'out') xs.push(me.x);
    for (const p of view.players) if (p.id !== this.myId && p.connected && p.a.mode === 'out') xs.push(p.a.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const onFoot = me.mode === 'out' && Math.abs(me.x - c.x) > 1;
    const halfW = Math.max(onFoot ? 11 : 15, (maxX - minX) / 2 + 7);
    const cx = Math.max(halfW - 6, Math.min(this.world.length - halfW + 6, (minX + maxX) / 2));
    // Highest and lowest ground across the view, per lane.
    const span = (t, a, b) => { let lo = Infinity, hi = -Infinity; for (let x = a; x <= b; x += 2) { const v = t.surface[Math.max(0, Math.min(t.nx - 1, Math.round(x / 0.25)))]; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
    const [frontLo] = span(this.terrains[0], cx - halfW * 0.6, cx + halfW * 0.6);
    const [, backHi] = span(this.terrains[LANE_COUNT - 1], cx - halfW * 0.6, cx + halfW * 0.6);
    const pitch = PITCHES[this.pitchIndex] * Math.PI / 180;
    const cam = this.camera;
    const vf = cam.fov * Math.PI / 360 * 0.94;
    const hf = Math.atan(Math.tan(vf) * cam.aspect);
    // Fit a little of the front lane's cut face at the bottom and a strip of
    // hillside at the top; the camera angle stays fixed, only distance and
    // height change.
    const bottom = { y: frontLo - 0.9, z: FRONT };
    const top = { y: backHi + 3.5, z: BACK - 3 };
    const tz = (FRONT + BACK) / 2;
    const sp = Math.sin(pitch), cp = Math.cos(pitch);
    const angle = (P, ty, d) => {
      const cy = ty + d * sp, cz = tz + d * cp;
      const ry = P.y - cy, rz = P.z - cz;
      return Math.atan2(ry * cp - rz * sp, -ry * sp - rz * cp);   // up vs forward
    };
    const fit = d => {
      let ty = (bottom.y + top.y) / 2;
      for (let k = 0; k < 6; k++) ty += (angle(bottom, ty, d) + angle(top, ty, d)) / 2 * d;
      return { ty, ok: angle(top, ty, d) <= vf && angle(bottom, ty, d) >= -vf };
    };
    let lo = 8, hi = 220;
    for (let k = 0; k < 22; k++) { const m = (lo + hi) / 2; if (fit(m).ok) hi = m; else lo = m; }
    const dist = Math.max(hi, halfW / Math.tan(hf));
    const target = { x: cx, y: fit(dist).ty, z: tz, dist };
    if (!this.cam) this.cam = { ...target };
    const k = 1 - Math.exp(-dt * 3);
    for (const key of ['x', 'y', 'z', 'dist']) this.cam[key] += (target[key] - this.cam[key]) * k;
    const C = this.cam;
    cam.position.set(C.x, C.y + C.dist * Math.sin(pitch), C.z + C.dist * Math.cos(pitch));
    cam.lookAt(C.x, C.y, C.z);
  }

  #render(dt, view, latestMe) {
    const me = this.me, c = view.camper;
    this.#frameCamera(dt, view);
    this.#updateChunks(this.cam.x);

    // Lanes and dividers in front of me fade when they would hide me.
    const myLane = me.mode === 'out' ? this.#laneOf(me) : (c.ch ? lerp(c.ch.from, c.ch.to, smooth(c.ch.t)) : c.lane);
    const meX = me.mode === 'out' ? me.x : c.x, meY = (me.mode === 'out' ? me.y : c.y) + 1.2;
    const meZ = lerp(laneZ(Math.floor(myLane)), laneZ(Math.ceil(myLane)), myLane - Math.floor(myLane));
    const slope = Math.tan(PITCHES[this.pitchIndex] * Math.PI / 180);
    const sight = z => meY + (z - meZ) * slope;           // my line of sight to the camera at depth z
    const highest = (t, extra = 0) => { let hi = -Infinity; for (let x = meX - 7; x <= meX + 7; x += 1) hi = Math.max(hi, t.surface[Math.max(0, Math.min(t.nx - 1, Math.round(x / 0.25)))]); return hi + extra; };
    const laneHides = this.terrains.map((t, i) => i < myLane - 0.4 && highest(t) > sight(laneZ(i) - LANE_DEPTH / 2));
    const divHides = this.divMats.map((_, k) => {
      if (k + 1 > myLane - 0.4) return false;
      const seg = this.world.dividers[k].find(s => s.x1 > meX - 6 && s.x0 < meX + 6 && (s.type === 'hedge' || s.type === 'bank'));
      const lift = seg ? (seg.type === 'bank' ? 2 : 1.5) : 0.3;
      return Math.max(highest(this.terrains[k]), highest(this.terrains[k + 1])) + lift > sight((laneZ(k) + laneZ(k + 1)) / 2);
    });
    const fade = (mat, target) => {
      const o = mat.userData.o ?? 1;
      const v = o + (target - o) * (1 - Math.exp(-dt * 8));
      mat.userData.o = v;
      mat.opacity = v;
      const tr = v < 0.99;
      if (mat.transparent !== tr) { mat.transparent = tr; mat.depthWrite = !tr; mat.needsUpdate = true; }
    };
    this.laneMats.forEach((m, i) => fade(m, laneHides[i] ? 0.45 : 1));
    this.divMats.forEach((m, k) => fade(m, divHides[k] ? 0.45 : 1));
    for (const g of this.dividers.values()) for (const m of g.userData.mats || []) fade(m, divHides[g.userData.k] ? 0.4 : 1);

    // Camper.
    const cv = this.camperView;
    const dirSign = c.ch ? Math.sign(c.ch.to - c.ch.from) * (Math.abs(c.vx) > 0.3 ? Math.sign(c.vx) : 1) : 0;
    const yaw = c.ch ? Math.sin(Math.PI * c.ch.t) * 0.24 * dirSign : 0;
    cv.group.position.set(c.x, c.y, c.z);
    cv.group.rotation.set(0, yaw, c.a);
    for (let w = 0; w < 2; w++) {
      const dx = c.w[w * 3] - c.x, dy = c.w[w * 3 + 1] - c.y, ca = Math.cos(c.a), sa = Math.sin(c.a);
      cv.wheels[w].position.set(dx * ca + dy * sa, -dx * sa + dy * ca, 0);
      cv.wheels[w].rotation.z = c.w[w * 3 + 2] - c.a;
    }
    // See inside when I am aboard, or when the camper hides me from the camera.
    const hides = me.mode === 'out' && c.lane < myLane - 0.4 && Math.abs(me.x - c.x) < 5;
    const camperAlpha = me.mode === 'in' ? 0.28 : hides ? 0.35 : 1;
    for (const m of cv.materials) fade(m, camperAlpha);

    // Avatars.
    for (const p of view.players) {
      let v = this.avatars.get(p.id);
      if (!v) { v = makeAvatar(p.index ?? this.avatars.size); this.scene.add(v.group); this.avatars.set(p.id, v); }
      const a = p.id === this.myId ? me : p.a;
      v.group.visible = p.connected || p.id === this.myId;
      const side = (p.index ?? 0) % 2 ? -0.45 : 0.45;
      if (a.mode === 'in') {
        const lx = p.seat === 'cab' && p.id !== this.myId ? INTERIOR.seatX - 0.05 : a.lx;
        const q = this.#camperPoint(c, lx, INTERIOR.floorY - 0.02);
        v.group.position.set(q.x, q.y, c.z + side * 0.8);
        v.group.rotation.set(0, 0, c.a);
      } else {
        const lane = this.#laneOf(a);
        v.group.position.set(a.x, a.y, lerp(laneZ(Math.floor(lane)), laneZ(Math.ceil(lane)), lane - Math.floor(lane)) + side);
        v.group.rotation.set(0, 0, 0);
      }
      const walking = Math.abs(a.vx || 0) > 0.2 || a.cross;
      v.body.rotation.y = (a.facing || 1) > 0 ? 0 : Math.PI;
      v.body.position.y = walking ? Math.abs(Math.sin((a.walkPhase || 0) * 3)) * 0.06 : 0;
      v.body.rotation.z = a.working ? Math.sin(this.time * 14) * 0.12 : 0;
    }

    // Animals: stuck ones where they are; rescued ones ride on the roof.
    for (const an of view.animals) {
      const v = this.animalViews.get(an.id);
      if (!v) continue;
      if (an.state === 'riding') {
        const q = this.#camperPoint(c, -2.4 + (an.spot % 6) * 0.75, 1.85);
        v.group.position.set(q.x, q.y, c.z + (an.spot >= 6 ? -0.5 : 0.3));
        v.group.rotation.set(0, 0, c.a);
        v.marker.visible = false;
      } else {
        const bird = BIRDS.has(an.kind);
        v.group.position.set(an.x, an.y + (bird ? 0.5 : 0), laneZ(an.lane) - 0.5);
        v.marker.visible = true;
        v.marker.position.y = v.size * 2 + 1 + Math.sin(this.time * 3 + an.id) * 0.12;
        v.marker.rotation.y = this.time * 2;
        v.group.rotation.set(0, 0, Math.sin(this.time * 6 + an.id) * 0.05 * (1 + an.p * 4));
      }
    }

    // Dig cursor.
    const p = this.pick;
    this.cursor.visible = !!p && me.mode === 'out' && !me.cross && this.input.mouse.inside;
    if (this.cursor.visible) {
      this.cursor.position.set(p.x, p.y, p.z);
      this.cursor.material.color.setHex(p.ok ? 0xffffff : 0xd8574a);
    }
    this.renderer.render(this.scene, this.camera);
  }

  #hud(view, latestMe, prompt) {
    const me = this.me, c = view.camper;
    const lane = me.mode === 'out' ? (me.cross ? me.cross.to : me.lane) : c.lane;
    const x = me.mode === 'out' ? me.x : c.x;
    const area = areaAt(this.world, Math.max(0, Math.min(this.world.length - 1, x)));
    const label = `${LANE_NAMES[lane]} · ${area.name} · ${Math.round(c.x)} / ${this.world.length} m`;
    if (label !== this._label) { $('lane').textContent = label; this._label = label; }
    if (area.name !== this._area) { if (this._area) this.hud.toast(`Entering ${area.name.toLowerCase()}`); this._area = area.name; }
    const rescued = `Animals rescued: ${view.latest.rescued || 0}`;
    if (rescued !== this._rescued) { $('rescued').textContent = rescued; this._rescued = rescued; }
    $('soil-fill').style.width = Math.round((latestMe?.soil || 0) / SOIL_CAPACITY * 100) + '%';
    $('tipped').hidden = !view.tipped;
    if (prompt !== this._prompt) { $('prompt').innerHTML = prompt; $('prompt').hidden = !prompt; this._prompt = prompt; }
    const list = view.players.map(p => `${p.id === this.myId ? '● ' : ''}${esc(p.name)}${p.connected ? '' : ' (away)'} · ${p.a.mode === 'in' ? (p.seat === 'cab' ? 'driving' : 'aboard') : LANE_NAMES[p.a.lane].toLowerCase()}`).join(' &nbsp;·&nbsp; ');
    if (list !== this._list) { $('players').innerHTML = list; this._list = list; }
  }
}

const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
