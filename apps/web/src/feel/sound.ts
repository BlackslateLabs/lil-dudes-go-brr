// Synthesised sound effects (WebAudio, no audio files). Browsers only allow audio after a user
// gesture, so the context is created by `unlockSound()` from a click handler.

const PREF_KEY = 'ldgb.sound';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readPref();
let lastHit = 0;

function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function soundEnabled(): boolean {
  return enabled;
}

export function setSoundEnabled(on: boolean) {
  enabled = on;
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode etc.: fine, the toggle still works for this session */
  }
  if (on) unlockSound();
}

/** Call from a click/tap handler. */
export function unlockSound() {
  if (!enabled) return;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  void ctx.resume();
}

function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!enabled || !ctx || !master || ctx.state !== 'running') return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

let lastClash = 0;

export const sfx = {
  /** Your own volley: a soft pop (every 0.4 s, so keep it quiet). */
  shot() {
    tone(300, 0.05, 'triangle', 0.035, 180);
  },
  /** Crowds grinding at the clash front. Throttled. */
  clash() {
    const now = performance.now();
    if (now - lastClash < 120) return;
    lastClash = now;
    tone(140 + Math.random() * 80, 0.06, 'sawtooth', 0.03, 90);
  },
  /** First reveal of a gate: rising pop if good, falling if bad. */
  gate(good: boolean) {
    if (good) tone(520, 0.14, 'square', 0.08, 1040);
    else tone(420, 0.18, 'square', 0.08, 180);
  },
  /** Units reaching a cannon. Throttled so a stream doesn't turn into noise. */
  hit(mine: boolean) {
    const now = performance.now();
    if (now - lastHit < 90) return;
    lastHit = now;
    tone(mine ? 110 : 160, 0.09, 'triangle', 0.12, 60);
  },
  gotcha() {
    tone(880, 0.12, 'sawtooth', 0.07, 440);
    setTimeout(() => tone(660, 0.22, 'sawtooth', 0.07, 220), 110);
  },
  ko() {
    tone(220, 0.8, 'sawtooth', 0.12, 40);
  },
};
