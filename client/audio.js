// Synthesised sound: no audio files. Every effect is built from oscillators
// and filtered noise. Positional effects pan and fade with distance from the
// camera centre.

export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.listenerX = 0;
  }

  // Must be called from a user gesture (browsers block audio until then).
  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = this.ctx = new Ctx();
    this.master = ctx.createGain();
    this.master.gain.value = 1;
    this.master.connect(ctx.destination);
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.#startAmbience();
    this.#startEngine();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 1, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  // ----- building blocks -----

  #out(x, vol = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    const dx = x === undefined ? 0 : x - this.listenerX;
    g.gain.value = vol * Math.max(0, 1 - Math.abs(dx) / 40);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.9, Math.min(0.9, dx / 18));
      g.connect(p); p.connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  #noise(dest, { type = 'lowpass', freq = 1000, q = 1, dur = 0.2, attack = 0.005, vol = 1, delay = 0, sweep }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
  }

  #tone(dest, { type = 'sine', freq = 200, to, dur = 0.2, attack = 0.004, vol = 1, delay = 0 }) {
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ----- effects -----

  dig(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.55);
    this.#noise(o, { freq: 500 + Math.random() * 300, dur: 0.16, vol: 0.9, sweep: 200 });
    this.#tone(o, { freq: 110, to: 60, dur: 0.12, vol: 0.5 });
  }

  fill(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.45);
    this.#noise(o, { freq: 350, dur: 0.2, vol: 0.8, attack: 0.02, sweep: 150 });
  }

  chop(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.8);
    this.#tone(o, { type: 'triangle', freq: 220 + Math.random() * 30, to: 95, dur: 0.18, vol: 0.9 });
    this.#noise(o, { type: 'highpass', freq: 1800, dur: 0.05, vol: 0.6 });
  }

  fell(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.9);
    this.#tone(o, { type: 'sawtooth', freq: 160, to: 70, dur: 1.0, attack: 0.3, vol: 0.12 });   // creak
    this.#noise(o, { freq: 300, dur: 1.4, vol: 0.9, delay: 1.05, sweep: 80 });                // crash
    this.#tone(o, { freq: 70, to: 35, dur: 0.6, vol: 0.9, delay: 1.05 });
    this.#noise(o, { type: 'bandpass', freq: 2500, q: 0.7, dur: 0.6, vol: 0.25, delay: 1.1 });  // leaves
  }

  saw(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.35);
    this.#noise(o, { type: 'bandpass', freq: 2200 + Math.random() * 600, q: 3, dur: 0.11, attack: 0.03, vol: 1 });
  }

  hammer(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.7);
    for (const d of [0, 0.16]) {
      this.#tone(o, { type: 'triangle', freq: 900, to: 600, dur: 0.07, vol: 0.6, delay: d });
      this.#tone(o, { freq: 160, to: 90, dur: 0.1, vol: 0.5, delay: d });
    }
  }

  snap(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 1);
    this.#noise(o, { type: 'highpass', freq: 1200, dur: 0.12, vol: 1 });
    this.#tone(o, { type: 'triangle', freq: 300, to: 80, dur: 0.25, vol: 0.6 });
    this.#noise(o, { freq: 400, dur: 0.5, vol: 0.5, delay: 0.25, sweep: 120 });
  }

  thud(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.6);
    this.#tone(o, { freq: 90, to: 45, dur: 0.2, vol: 0.8 });
    this.#noise(o, { freq: 300, dur: 0.15, vol: 0.4 });
  }

  bark(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.6);
    for (const d of [0, 0.22]) {
      this.#tone(o, { type: 'sawtooth', freq: 420, to: 230, dur: 0.12, vol: 0.35, delay: d });
      this.#noise(o, { type: 'bandpass', freq: 900, q: 2, dur: 0.1, vol: 0.5, delay: d });
    }
  }

  chime() {
    if (!this.ctx) return;
    const o = this.#out(undefined, 0.45);
    [523, 659, 784, 1047].forEach((f, k) => this.#tone(o, { type: 'triangle', freq: f, dur: 0.5, vol: 0.5, delay: k * 0.09 }));
  }

  step(x, soft) {
    if (!this.ctx) return;
    const o = this.#out(x, soft ? 0.12 : 0.2);
    this.#noise(o, { freq: 700 + Math.random() * 500, dur: 0.07, vol: 0.8 });
  }

  creak(x) {
    if (!this.ctx) return;
    const o = this.#out(x, 0.25);
    this.#tone(o, { type: 'sawtooth', freq: 110 + Math.random() * 40, to: 90, dur: 0.5, attack: 0.15, vol: 0.18 });
  }

  // ----- continuous -----

  #startEngine() {
    const ctx = this.ctx;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; b.type = 'square';
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const g = ctx.createGain(); g.gain.value = 0;
    a.connect(f); b.connect(f); f.connect(g);
    this.engineOut = this.#out(undefined, 1);
    g.connect(this.engineOut);
    a.start(); b.start();
    this.engine = { a, b, f, g };
  }

  // running: someone at the wheel; load 0..1 from throttle; speed in m/s.
  setEngine(running, load, speed, x) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, e = this.engine;
    const rpm = 38 + Math.min(1, Math.abs(speed) / 9) * 40 + load * 18;
    e.a.frequency.setTargetAtTime(rpm, t, 0.15);
    e.b.frequency.setTargetAtTime(rpm * 0.5, t, 0.15);
    e.f.frequency.setTargetAtTime(260 + load * 500, t, 0.2);
    e.g.gain.setTargetAtTime(running ? 0.06 + load * 0.07 : 0.0, t, 0.3);
    const dx = x - this.listenerX;
    this.engineOut.gain.setTargetAtTime(Math.max(0.15, 1 - Math.abs(dx) / 40), t, 0.2);
  }

  #startAmbience() {
    const ctx = this.ctx;
    // Wind: low noise with a slow swell.
    const wind = ctx.createBufferSource(); wind.buffer = this.noise; wind.loop = true;
    const wf = ctx.createBiquadFilter(); wf.type = 'lowpass'; wf.frequency.value = 380;
    const wg = ctx.createGain(); wg.gain.value = 0.07;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.035;
    lfo.connect(lg); lg.connect(wg.gain);
    wind.connect(wf); wf.connect(wg); wg.connect(this.master);
    wind.start(); lfo.start();
    // Rain: bright hiss, off until it rains.
    const rain = ctx.createBufferSource(); rain.buffer = this.noise; rain.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1400;
    const rg = ctx.createGain(); rg.gain.value = 0;
    rain.connect(rf); rf.connect(rg); rg.connect(this.master);
    rain.start();
    this.rainGain = rg;
    this.nextBird = ctx.currentTime + 1.5;
  }

  setRain(on) {
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(on ? 0.09 : 0, this.ctx.currentTime, 0.8);
  }

  // Called every frame: schedules birdsong.
  tick(wet) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    if (ctx.currentTime < this.nextBird) return;
    this.nextBird = ctx.currentTime + (wet ? 6 : 1.5) + Math.random() * (wet ? 10 : 5);
    const o = this.#out(this.listenerX + (Math.random() - 0.5) * 50, 0.25 + Math.random() * 0.15);
    const kind = Math.floor(Math.random() * 3);
    const base = 2200 + Math.random() * 1800;
    const notes = kind === 0 ? 3 + Math.floor(Math.random() * 4) : kind === 1 ? 2 : 6;
    for (let k = 0; k < notes; k++) {
      const d = k * (kind === 2 ? 0.07 : 0.14);
      const f = kind === 1 ? base * (k ? 0.8 : 1.1) : base * (1 + (Math.random() - 0.5) * 0.25);
      this.#tone(o, { freq: f, to: f * (kind === 2 ? 1.3 : 0.75), dur: kind === 2 ? 0.05 : 0.11, vol: 0.5, delay: d });
    }
  }
}
