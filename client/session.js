import { Sim } from '../shared/sim.mjs';
import { LaneSim } from '../shared/lanes/laneSim.mjs';
import { TICK_HZ, SNAPSHOT_HZ } from '../shared/constants.mjs';

// Both session types deliver the same messages to `onmessage`, so the game
// code does not care whether the simulation runs on the server or locally.

export class OnlineSession {
  constructor(code, name) {
    this.code = code;
    this.name = name;
    this.onmessage = () => {};
    this.onstatus = () => {};
    this.closed = false;
    this.retry = 0;
  }

  connect() {
    const key = 'together:token:' + this.code;
    let token = '';
    try { token = sessionStorage.getItem(key) || ''; } catch {}
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const q = new URLSearchParams({ room: this.code, name: this.name, token });
    const ws = new WebSocket(`${proto}//${location.host}/ws?${q}`);
    this.ws = ws;
    this.onstatus('connecting');
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.t === 'welcome') { try { sessionStorage.setItem(key, msg.token); } catch {} this.retry = 0; this.onstatus('online'); }
      if (msg.t === 'error') { this.closed = true; this.onstatus('error', msg.msg); }
      this.onmessage(msg);
    };
    ws.onclose = () => {
      if (this.closed) return;
      this.onstatus('reconnecting');
      setTimeout(() => this.connect(), Math.min(8000, 500 * 2 ** this.retry++));
    };
  }

  send(msg) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg)); }
  close() { this.closed = true; this.ws?.close(); }
}

export class LocalSession {
  constructor(name, mode = 'side') {
    this.name = name;
    this.mode = mode;
    this.onmessage = () => {};
    this.onstatus = () => {};
    this.code = null;
  }

  connect() {
    const seed = (Math.random() * 2 ** 32) >>> 0;
    this.sim = this.mode === 'lanes' ? new LaneSim(seed) : new Sim(seed);
    this.id = 'local';
    this.sim.addPlayer(this.id, this.name);
    this.onstatus('offline');
    this.onmessage(this.sim.welcome(this.id));
    const dt = 1 / TICK_HZ, every = Math.round(TICK_HZ / SNAPSHOT_HZ);
    let last = performance.now(), acc = 0;
    this.timer = setInterval(() => {
      const now = performance.now();
      acc += Math.min(0.25, (now - last) / 1000);
      last = now;
      while (acc >= dt) {
        acc -= dt;
        this.sim.step(dt);
        for (const m of this.sim.drain()) this.onmessage(m);
        if (this.sim.tick % every === 0) this.onmessage(this.sim.snapshot());
      }
    }, 1000 / TICK_HZ);
  }

  send(msg) { this.sim?.handle(this.id, msg); }
  close() { clearInterval(this.timer); }
}
