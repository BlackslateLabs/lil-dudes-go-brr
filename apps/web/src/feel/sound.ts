// Sound effects: short CC0 recordings by Kenney (www.kenney.nl), credited in
// public/assets/CREDITS.md. Each cue is a mono MP3 in /assets/sfx/, trimmed and loudness-matched
// offline (loudest 100 ms at about -14 dBFS), so the gains below are purely about priority.
//
// Browsers only allow audio after a user gesture, so the context is created by `unlockSound()`
// (called from click handlers, and once from the first tap anywhere). Buffers are fetched and
// decoded once, on unlock. If a file fails to load or decode, that cue is silently skipped.
//
// Graph: AudioBufferSourceNode -> per-voice gain -> bus -> master gain -> speakers. Three buses:
// `battle` (shots, clash, gates, hits, waves, crates, loot), `ui` (stingers, UI, the end sequence)
// and `music` (music.ts). Every play nudges the playback rate a few percent and avoids repeating
// the last variant, so a cue fired 2-10 times a second doesn't sound like a machine gun. Each cue
// caps its simultaneous voices: a 1,500-dude match drops extra hits instead of turning into noise.
//
// Mix rules: loudness follows importance (frequent sounds quiet and throttled, big moments loud);
// every count-up climbs a pitch ladder; battle sounds duck under the end sequence
// (`setBattleDuck`); music sits about 9 dB under the effects and dips 12 dB for ~0.6 s whenever a
// stinger plays. Haptics live in haptics.ts and music in music.ts; both are re-exported here so
// callers import everything from '../feel/sound'.

import { attachMusic, musicStingPlaying, setMusicTrack, type MusicTrack } from './music';

export { haptic, setVibeEnabled, vibeEnabled, vibeSupported, type HapticKind } from './haptics';
export { MUSIC, type MusicTrack } from './music';

const PREF_KEY = 'ldgb.sound';
const SFX_DIR = `${import.meta.env.BASE_URL}assets/sfx/`;

type Bus = 'battle' | 'ui';

interface Cue {
  /** File stems in /assets/sfx/ (variants picked at random). */
  files: string[];
  /** Mix bus: `battle` is ducked during the end sequence. */
  bus: Bus;
  /** A big moment: dips the music for a beat. */
  stinger?: boolean;
  /** Linear gain before the bus. */
  gain: number;
  /** Max simultaneous voices of this cue; new plays are dropped beyond it. */
  voices: number;
  /** Random playback-rate spread, e.g. 0.06 = ±6 %. */
  jitter: number;
  /** Minimum ms between plays (0 = none). */
  throttle: number;
}

// Sources (Kenney packs): shot = interface drop_002/003/004 + impact impactSoft_medium (layered);
// gate good/bad = interface confirmation_001 / question_004; gate tick = interface glass_005 /
// glass_002; clash = impactPunch_medium; wave = impactPunch_heavy + impactSoft_heavy;
// hit = impactMining; crate = impactWood_medium / impactPlank_medium + impactWood_heavy;
// tower down / KO = impactPunch_heavy + impactMining or impactSoft_heavy + impactBell_heavy +
// casino chips-handle-5; coins after a tower = casino chips-handle/collide/stack; loot = casino
// chips-stack / chip-lay; gotcha = digital phaserDown3; fight = impactBell_heavy_002;
// raid / win / lose = digital powerUp7 / powerUp1 / zapThreeToneDown; click = interface select_002.
// v5: breach = impactPunch_heavy + impactSoft_heavy + impactMetal_heavy + impactBell_heavy +
// digital powerUp9; countdown tick = interface bong_001 + select_007 + impactSoft_medium +
// impactBell_heavy; TIME = impactPunch_heavy + impactBell_heavy + bong_001; ladder = interface
// pluck_001; payout = 12 casino chip clips spread over 1.3 s + interface glass_004; whoosh =
// casino card-fan-1; VS hit = impactPunch_heavy + impactPlate_heavy + impactSoft_heavy; wipe in =
// impactSoft_heavy + card-slide-2; wipe out = card-shove-4; play = interface select_002 +
// confirmation_002 + digital phaserUp7; danger = impactSoft_heavy (low-passed, doubled);
// Champion charged = digital powerUp8 + interface glass_003; Champion launch = impactPunch_heavy +
// impactSoft_heavy + impactWood_heavy + digital lowDown.
const CUES = {
  // battle bus: frequent sounds stay quiet and throttled
  shot: { files: ['shot-1', 'shot-2', 'shot-3'], bus: 'battle', gain: 0.26, voices: 2, jitter: 0.03, throttle: 0 },
  gateGood: { files: ['gate-good'], bus: 'battle', gain: 0.7, voices: 2, jitter: 0.03, throttle: 0 },
  gateBad: { files: ['gate-bad'], bus: 'battle', gain: 0.75, voices: 2, jitter: 0.03, throttle: 0 },
  gateTick: { files: ['gate-tick-1', 'gate-tick-2'], bus: 'battle', gain: 0.14, voices: 1, jitter: 0.04, throttle: 100 },
  clash: { files: ['clash-1', 'clash-2', 'clash-3'], bus: 'battle', gain: 0.3, voices: 2, jitter: 0.08, throttle: 120 },
  wave: { files: ['wave'], bus: 'battle', gain: 0.8, voices: 2, jitter: 0.04, throttle: 0 },
  hit: { files: ['hit-1', 'hit-2', 'hit-3'], bus: 'battle', gain: 0.42, voices: 3, jitter: 0.07, throttle: 90 },
  crateHit: { files: ['crate-hit'], bus: 'battle', gain: 0.45, voices: 2, jitter: 0.08, throttle: 90 },
  crateBreak: { files: ['crate-break'], bus: 'battle', gain: 0.85, voices: 2, jitter: 0.05, throttle: 0 },
  loot: { files: ['loot-1', 'loot-2', 'loot-3', 'loot-4'], bus: 'battle', gain: 0.8, voices: 3, jitter: 0.08, throttle: 80 },
  // ui bus: big moments, the end sequence and menus
  towerDown: { files: ['tower-down'], bus: 'ui', gain: 0.95, voices: 2, jitter: 0.04, throttle: 0 },
  towerCoins: { files: ['coins-short'], bus: 'ui', gain: 0.6, voices: 2, jitter: 0.06, throttle: 0 },
  ko: { files: ['ko'], bus: 'ui', stinger: true, gain: 1, voices: 1, jitter: 0.02, throttle: 0 },
  gotcha: { files: ['gotcha'], bus: 'ui', gain: 0.85, voices: 1, jitter: 0, throttle: 0 },
  fight: { files: ['fight'], bus: 'ui', gain: 0.6, voices: 1, jitter: 0, throttle: 0 },
  raid: { files: ['raid'], bus: 'ui', gain: 0.75, voices: 1, jitter: 0, throttle: 0 },
  win: { files: ['win'], bus: 'ui', stinger: true, gain: 0.8, voices: 1, jitter: 0, throttle: 0 },
  lose: { files: ['lose'], bus: 'ui', stinger: true, gain: 0.8, voices: 1, jitter: 0, throttle: 0 },
  click: { files: ['click'], bus: 'ui', gain: 0.45, voices: 2, jitter: 0.05, throttle: 40 },
  breach: { files: ['breach'], bus: 'ui', stinger: true, gain: 1, voices: 1, jitter: 0, throttle: 500 },
  countTick: { files: ['count-tick'], bus: 'ui', stinger: true, gain: 0.85, voices: 2, jitter: 0, throttle: 200 },
  countTime: { files: ['count-time'], bus: 'ui', stinger: true, gain: 1, voices: 1, jitter: 0, throttle: 500 },
  ladder: { files: ['ladder'], bus: 'ui', gain: 0.5, voices: 4, jitter: 0, throttle: 60 },
  payout: { files: ['payout'], bus: 'ui', stinger: true, gain: 1, voices: 1, jitter: 0, throttle: 500 },
  whoosh: { files: ['whoosh'], bus: 'ui', gain: 0.6, voices: 2, jitter: 0.04, throttle: 80 },
  vsHit: { files: ['vs-hit'], bus: 'ui', stinger: true, gain: 0.9, voices: 1, jitter: 0, throttle: 300 },
  wipeIn: { files: ['wipe-in'], bus: 'ui', gain: 0.7, voices: 1, jitter: 0.03, throttle: 200 },
  wipeOut: { files: ['wipe-out'], bus: 'ui', gain: 0.55, voices: 1, jitter: 0.03, throttle: 200 },
  playButton: { files: ['play'], bus: 'ui', gain: 0.7, voices: 1, jitter: 0, throttle: 250 },
  danger: { files: ['danger'], bus: 'ui', gain: 0.5, voices: 1, jitter: 0.02, throttle: 2000 },
  champCharged: { files: ['champ-charged'], bus: 'ui', stinger: true, gain: 0.8, voices: 1, jitter: 0, throttle: 500 },
  champLaunch: { files: ['champ-launch'], bus: 'ui', gain: 0.9, voices: 1, jitter: 0.03, throttle: 300 },
} satisfies Record<string, Cue>;

type CueName = keyof typeof CUES;

const MASTER = 0.5;
const MUSIC_LEVEL = 0.35; // about -9 dB under the effects
const MUSIC_DUCK = 0.25; // a further -12 dB under stingers, for ~0.6 s
const BATTLE_DUCK = 0.25; // battle bus level during the end sequence

let ctx: AudioContext | null = null;
let buses: Record<Bus, GainNode> | null = null;
let musicDuck: GainNode | null = null;
let battleDucked = false;
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
  else void ctx?.suspend().catch(() => {}); // pauses the music too; it resumes where it was
}

/** Call from a click/tap handler. */
export function unlockSound() {
  if (!enabled) return;
  if (!ctx) {
    let ac: AudioContext;
    try {
      ac = new AudioContext();
    } catch {
      return; // no WebAudio: stay silent
    }
    ctx = ac;
    const master = ac.createGain();
    master.gain.value = MASTER;
    master.connect(ac.destination);
    const bus = (level: number, to: AudioNode) => {
      const g = ac.createGain();
      g.gain.value = level;
      g.connect(to);
      return g;
    };
    buses = { battle: bus(battleDucked ? BATTLE_DUCK : 1, master), ui: bus(1, master) };
    musicDuck = bus(1, master);
    attachMusic(ac, bus(MUSIC_LEVEL, musicDuck), undoMusicDuck);
  }
  void ctx.resume().catch(() => {});
  loading ??= loadAll(ctx);
}

// The first tap anywhere also unlocks (e.g. after a reload straight into a match), and any later
// tap revives a context the OS interrupted (iOS does this on calls and the lock screen).
if (typeof window !== 'undefined') {
  const gesture = () => {
    if (enabled && !document.hidden && (!ctx || ctx.state !== 'running')) unlockSound();
  };
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);
  // Pause everything (music included) while the tab is hidden; pick up where it was on return.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else if (enabled) void ctx.resume().catch(() => {});
  });
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

/** Dip the music for a beat under a stinger (not under a win/lose sting: that *is* the music). */
function duckMusic(ac: AudioContext) {
  if (!musicDuck || musicStingPlaying()) return;
  const g = musicDuck.gain;
  const now = ac.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(MUSIC_DUCK, now + 0.04);
  g.setValueAtTime(MUSIC_DUCK, now + 0.6);
  g.linearRampToValueAtTime(1, now + 1);
}

function undoMusicDuck() {
  if (!ctx || !musicDuck) return;
  const g = musicDuck.gain;
  g.cancelScheduledValues(ctx.currentTime);
  g.setValueAtTime(1, ctx.currentTime);
}

function play(name: CueName, opts: { rate?: number; gain?: number; delay?: number } = {}) {
  if (!enabled || !ctx || !buses || ctx.state !== 'running') return;
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
  src.connect(g).connect(buses[cue.bus]);
  playing.set(name, busy + 1);
  lastAt.set(name, now);
  lastFile.set(name, file);
  src.onended = () => {
    playing.set(name, Math.max(0, (playing.get(name) ?? 1) - 1));
    src.disconnect();
    g.disconnect();
  };
  src.start(ctx.currentTime + (opts.delay ?? 0));
  if (cue.stinger) duckMusic(ctx);
}

const semis = (n: number) => 2 ** (n / 12);
// Count-up ladder: major pentatonic from a fourth below the clip's own pitch, up two octaves,
// then it holds the top note.
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

export const sfx = {
  /** Your own volley: a soft pop-thump (every 0.4 s, so keep it quiet). */
  shot() {
    play('shot');
  },
  /** Crowds grinding at the clash front. Throttled. */
  clash() {
    play('clash');
  },
  /** First reveal of a gate: a loud stinger, bright rising blip if good, falling two-note if bad. */
  gate(good: boolean) {
    play(good ? 'gateGood' : 'gateBad');
  },
  /** Later units passing an already revealed gate: a quiet glassy tick (1 voice, 100 ms throttle). */
  gateTick(good = true) {
    play('gateTick', { rate: good ? 1 : 0.84 });
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
  /** Big knockout: a cannon dies. */
  ko() {
    play('ko');
  },
  /** A crate in your lane is hit (`broken` = it just smashed). */
  crate(broken: boolean) {
    play(broken ? 'crateBreak' : 'crateHit');
  },
  /** One of the enemy towers collapses; coins spill out a beat after the crash. */
  towerDown() {
    play('towerDown');
    play('towerCoins', { delay: 0.1 });
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

  // --- v5 cues ------------------------------------------------------------------------------
  /** BREACH! stamp when your last Fight 2 tower falls. Pair with `setBattleDuck(true)`. */
  breach() {
    play('breach');
  },
  /** Rush countdown tick: n = 3, 2, 1 (each a step higher), then 0 for the bigger "TIME!" hit. */
  countdown(n: number) {
    if (n <= 0) play('countTime');
    else play('countTick', { rate: semis(n >= 3 ? 0 : n === 2 ? 4 : 7) });
  },
  /** One rung of a rising count-up ladder (step 0, 1, 2, … gets higher; 4 voices, 60 ms throttle). */
  ladder(step: number) {
    const i = Math.max(0, Math.min(LADDER.length - 1, Math.floor(step) || 0));
    play('ladder', { rate: semis(LADDER[i]! - 5) });
  },
  /** The payout landing in your pill: a 1.5 s coin shower (run `ladder` over it as it counts). */
  payout() {
    play('payout');
  },
  /** VS screen: cards slide in (whoosh) and the "VS" impact. */
  whoosh() {
    play('whoosh');
  },
  vsHit() {
    play('vsHit');
  },
  /** Logo wipe: `wipeIn` as it starts closing (soft slam), `wipeOut` as it opens (swish). */
  wipeIn() {
    play('wipeIn');
  },
  wipeOut() {
    play('wipeOut');
  },
  /** The big PLAY / Quick Match press: a 0.6 s charge-up (play it instead of the click there). */
  playButton() {
    play('playButton');
  },
  /** Enemies are getting close to your cannon line: a low soft double pulse (throttled to 2 s). */
  danger() {
    play('danger');
  },
  /** Champion meter full / Champion launched. */
  champCharged() {
    play('champCharged');
  },
  champLaunch() {
    play('champLaunch');
  },
};

/**
 * End-sequence mix: `true` ramps the battle bus (shots, clash, gates, hits, waves, crates, loot)
 * down to 25 % over 150 ms; `false` brings it back. Safe to call before sound is unlocked.
 */
export function setBattleDuck(on: boolean) {
  battleDucked = on;
  if (!ctx || !buses) return;
  const g = buses.battle.gain;
  const now = ctx.currentTime;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(on ? BATTLE_DUCK : 1, now + 0.15);
}

/**
 * Music: 'menu' / 'match' loop (0.5 s crossfade between them); 'win' / 'lose' play once, then
 * silence; `null` fades out. Follows the sound toggle and can be called before the first gesture
 * (a bed starts on unlock; a sting asked for while silent is skipped). Tracks: `MUSIC` in music.ts.
 */
export function playMusic(track: MusicTrack | null) {
  setMusicTrack(track);
}
