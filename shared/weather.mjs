import { mulberry32 } from './rng.mjs';

// Time of day and storms, simulated on the server and shared in snapshots.
//
// tod runs 0..1 over DAY_SECONDS: dawn around 0.97–0.07, day until 0.62,
// dusk to 0.72, night until 0.95. Storms roll in on their own schedule,
// building up and dying away; their intensity (0..1) drives rain, slick
// ground and slumping, and lightning in the heaviest part.

export const DAY_SECONDS = 720;
export const START_TOD = 0.14;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// 1 at full day, 0 at full night.
export function daylight(tod) {
  const t = ((tod % 1) + 1) % 1;
  if (t < 0.07) return smooth(-0.03, 0.07, t);
  if (t < 0.62) return 1;
  if (t < 0.72) return 1 - smooth(0.62, 0.72, t);
  if (t < 0.95) return 0;
  return smooth(0.95, 1.05, t);
}

export function phaseName(tod) {
  const t = ((tod % 1) + 1) % 1;
  if (t < 0.07 || t >= 0.95) return 'Dawn';
  if (t < 0.55) return 'Day';
  if (t < 0.72) return 'Dusk';
  return 'Night';
}

export class Weather {
  constructor(seed) {
    this.rand = mulberry32(seed ^ 0x57093);
    this.tod = START_TOD;
    this.storm = 0;             // current intensity
    this.target = 0;
    this.forced = null;         // testing override: true / false / null
    this.nextStorm = 240 + this.rand() * 180;   // seconds until the next storm
    this.stormLeft = 0;
    this.lightning = 0;         // tick of the last strike
    this.nextStrike = 0;
  }

  step(dt, tick) {
    this.tod = (this.tod + dt / DAY_SECONDS) % 1;
    if (this.forced === null) {
      if (this.stormLeft > 0) {
        this.stormLeft -= dt;
        this.target = 1;
        if (this.stormLeft <= 0) this.nextStorm = 300 + this.rand() * 240;
      } else {
        this.target = 0;
        this.nextStorm -= dt;
        if (this.nextStorm <= 0) this.stormLeft = 90 + this.rand() * 90;
      }
    } else this.target = this.forced ? 1 : 0;
    // Build up over ~15 s, die away over ~20 s.
    const rate = this.target > this.storm ? 1 / 15 : 1 / 20;
    this.storm += Math.sign(this.target - this.storm) * Math.min(Math.abs(this.target - this.storm), rate * dt);
    if (this.storm > 0.7) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) { this.lightning = tick; this.nextStrike = 5 + this.rand() * 10; }
    }
  }

  get wet() { return this.storm > 0.3; }

  // Testing: force a storm on or off (R).
  setForced(on) {
    this.forced = on;
    if (!on) { this.stormLeft = 0; this.nextStorm = 300 + this.rand() * 240; }
  }

  // Testing: jump to the next dusk or dawn (N).
  skipPhase() {
    const t = this.tod;
    this.tod = t >= 0.55 && t < 0.92 ? 0.94 : 0.66;
  }
}
