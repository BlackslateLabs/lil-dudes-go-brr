// Sound effects: short CC0 recordings by Kenney (www.kenney.nl), credited in
// public/assets/CREDITS.md. Each cue is a mono MP3 in /assets/sfx/, trimmed and loudness-matched
// offline (loudest 100 ms at about -14 dBFS), so the gains below are purely about priority.
//
// Browsers only allow audio after a user gesture, so the context is created by `unlockSound()`
// (called from click handlers, and once from the first tap anywhere). Buffers are fetched and
// decoded once, on unlock. If a file fails to load or decode, that cue is silently skipped.
//
// Graph: AudioBufferSourceNode -> per-voice gain -> master gain -> speakers. Every play nudges the
// playback rate a few percent and avoids repeating the last variant, so a cue fired 2-10 times a
// second doesn't sound like a machine gun. Each cue caps its simultaneous voices: a 1,500-dude
// match drops extra hits instead of turning into noise.

const PREF_KEY = 'ldgb.sound';
const SFX_DIR = `${import.meta.env.BASE_URL}assets/sfx/`;

interface Cue {
  /** File stems in /assets/sfx/ (variants picked at random). */
  files: string[];
  /** Linear gain before the master. */
  gain: number;
  /** Max simultaneous voices of this cue; new plays are dropped beyond it. */
  voices: number;
  /** Random playback-rate spread, e.g. 0.06 = ±6 %. */
  jitter: number;
  /** Minimum ms between plays (0 = none). */
  throttle: number;
}

// Sources (Kenney packs): shot = interface drop_002/003/004 + impact impactSoft_medium (layered);
// gate good/bad = interface confirmation_001 / question_004; clash = impactPunch_medium;
// wave = impactPunch_heavy + impactSoft_heavy; hit = impactMining; crate = impactWood_medium /
// impactPlank_medium + impactWood_heavy; tower down / KO = impactPunch_heavy + impactMining or
// impactSoft_heavy + impactBell_heavy + casino chips-handle-5; loot = casino chips-stack / chip-lay;
// gotcha = digital phaserDown3; fight = impactBell_heavy_002; raid / win / lose = digital
// powerUp7 / powerUp1 / zapThreeToneDown; click = interface select_002.
const CUES = {
  shot: { files: ['shot-1', 'shot-2', 'shot-3'], gain: 0.26, voices: 2, jitter: 0.07, throttle: 0 },
  gateGood: { files: ['gate-good'], gain: 0.6, voices: 2, jitter: 0.03, throttle: 0 },
  gateBad: { files: ['gate-bad'], gain: 0.65, voices: 2, jitter: 0.03, throttle: 0 },
  clash: { files: ['clash-1', 'clash-2', 'clash-3'], gain: 0.3, voices: 2, jitter: 0.08, throttle: 120 },
  wave: { files: ['wave'], gain: 0.8, voices: 2, jitter: 0.04, throttle: 0 },
  hit: { files: ['hit-1', 'hit-2', 'hit-3'], gain: 0.42, voices: 3, jitter: 0.07, throttle: 90 },
  crateHit: { files: ['crate-hit'], gain: 0.45, voices: 2, jitter: 0.08, throttle: 90 },
  crateBreak: { files: ['crate-break'], gain: 0.85, voices: 2, jitter: 0.05, throttle: 0 },
  towerDown: { files: ['tower-down'], gain: 0.95, voices: 2, jitter: 0.04, throttle: 0 },
  ko: { files: ['ko'], gain: 1, voices: 1, jitter: 0.02, throttle: 0 },
  loot: { files: ['loot-1', 'loot-2', 'loot-3', 'loot-4'], gain: 0.8, voices: 3, jitter: 0.08, throttle: 80 },
  gotcha: { files: ['gotcha'], gain: 0.85, voices: 1, jitter: 0, throttle: 0 },
  fight: { files: ['fight'], gain: 0.6, voices: 1, jitter: 0, throttle: 0 },
  raid: { files: ['raid'], gain: 0.75, voices: 1, jitter: 0, throttle: 0 },
  win: { files: ['win'], gain: 0.8, voices: 1, jitter: 0, throttle: 0 },
  lose: { files: ['lose'], gain: 0.8, voices: 1, jitter: 0, throttle: 0 },
  click: { files: ['click'], gain: 0.45, voices: 2, jitter: 0.05, throttle: 40 },
} satisfies Record<string, Cue>;

type CueName = keyof typeof CUES;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let enabled = readPref();
let loading: Promise<void> | null = null;
const buffers = new Map<string, AudioBuffer>();
const playing = new Map<CueName, number>();
const lastAt = new Map<CueName, number>();
const lastFile = new Map<CueName, string>();

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
    try {
      ctx = new AudioContext();
    } catch {
      return; // no WebAudio: stay silent
    }
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  void ctx.resume().catch(() => {});
  loading ??= loadAll(ctx);
}

// The first tap anywhere also unlocks (e.g. after a reload straight into a match).
if (typeof window !== 'undefined') {
  const firstGesture = () => {
    unlockSound();
    if (ctx) {
      window.removeEventListener('pointerdown', firstGesture);
      window.removeEventListener('keydown', firstGesture);
    }
  };
  window.addEventListener('pointerdown', firstGesture);
  window.addEventListener('keydown', firstGesture);
}

function loadAll(ac: AudioContext): Promise<void> {
  const stems = new Set(Object.values(CUES).flatMap((c) => c.files));
  return Promise.all(
    [...stems].map(async (stem) => {
      try {
        const res = await fetch(`${SFX_DIR}${stem}.mp3`);
        if (!res.ok) return;
        buffers.set(stem, await ac.decodeAudioData(await res.arrayBuffer()));
      } catch {
        /* missing or undecodable: this variant just stays silent */
      }
    }),
  ).then(() => undefined);
}

function play(name: CueName, opts: { rate?: number; gain?: number } = {}) {
  if (!enabled || !ctx || !master || ctx.state !== 'running') return;
  const cue: Cue = CUES[name];
  const now = performance.now();
  if (cue.throttle && now - (lastAt.get(name) ?? -Infinity) < cue.throttle) return;
  const busy = playing.get(name) ?? 0;
  if (busy >= cue.voices) return;

  // Random variant, never the same one twice in a row.
  const ready = cue.files.filter((f) => buffers.has(f));
  if (ready.length === 0) return;
  const fresh = ready.length > 1 ? ready.filter((f) => f !== lastFile.get(name)) : ready;
  const file = fresh[Math.floor(Math.random() * fresh.length)]!;
  const buffer = buffers.get(file)!;

  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * cue.jitter);
  const g = ctx.createGain();
  g.gain.value = cue.gain * (opts.gain ?? 1);
  src.connect(g).connect(master);
  playing.set(name, busy + 1);
  lastAt.set(name, now);
  lastFile.set(name, file);
  src.onended = () => {
    playing.set(name, Math.max(0, (playing.get(name) ?? 1) - 1));
    src.disconnect();
    g.disconnect();
  };
  src.start();
}

export const sfx = {
  /** Your own volley: a soft pop-thump (every 0.4 s, so keep it quiet). */
  shot() {
    play('shot');
  },
  /** Crowds grinding at the clash front. Throttled. */
  clash() {
    play('clash');
  },
  /** First reveal of a gate: bright rising blip if good, falling two-note if bad. */
  gate(good: boolean) {
    play(good ? 'gateGood' : 'gateBad');
  },
  /** Units reaching a tower/cannon: stone knocks. Throttled so a stream doesn't turn into noise. */
  hit(mine: boolean) {
    play('hit', { rate: mine ? 0.85 : 1 });
  },
  /** A tower releases a wave in your lane: a low warning thump. */
  wave() {
    play('wave');
  },
  /** Raid loot landing in the vault: chips clinking. Throttled. */
  loot() {
    play('loot');
  },
  /** A rigged gate springs: a descending "womp". */
  gotcha() {
    play('gotcha');
  },
  /** Big knockout: a cannon dies (also used for a tower until `towerDown` is wired). */
  ko() {
    play('ko');
  },
  /** A crate in your lane is hit (`broken` = it just smashed). */
  crate(broken: boolean) {
    play(broken ? 'crateBreak' : 'crateHit');
  },
  /** One of the enemy towers collapses. */
  towerDown() {
    play('towerDown');
  },
  /** A new fight stage begins: a bell. */
  fight() {
    play('fight');
  },
  /** The town hall raid starts. */
  raid() {
    play('raid');
  },
  /** Match result sting. */
  win() {
    play('win');
  },
  lose() {
    play('lose');
  },
  /** UI button press. */
  click() {
    play('click');
  },

  // --- v5 cues (contract for the flow/HUD work; implemented in the sound pass) -----------------
  /** BREACH! stamp when your last Fight 2 tower falls. */
  breach() {},
  /** Rush countdown tick: n = 3, 2, 1, then 0 for "TIME!". */
  countdown(_n: number) {},
  /** One rung of a rising count-up ladder (step 0, 1, 2, … gets higher). */
  ladder(_step: number) {},
  /** The payout landing in your pill: coin shower. */
  payout() {},
  /** VS screen: cards slide in (whoosh) and the "VS" impact. */
  whoosh() {},
  vsHit() {},
  /** Logo wipe closing / opening. */
  wipeIn() {},
  wipeOut() {},
  /** The big PLAY / Quick Match press (longer than a click). */
  playButton() {},
  /** Enemies are getting close to your cannon line (call at most every 2 s). */
  danger() {},
  /** Champion meter full / Champion launched. */
  champCharged() {},
  champLaunch() {},
};

/** v5 mix: duck battle sounds during the end sequence and result (contract; implemented in the sound pass). */
export function setBattleDuck(_on: boolean) {}

/** Music beds (contract; implemented in the sound pass). `null` stops the music. */
export function playMusic(_track: 'menu' | 'match' | 'win' | 'lose' | null) {}

/** Phone vibration on big moments only (contract; implemented in the sound pass). */
export function haptic(_kind: 'tap' | 'charged' | 'big') {}
