// Music beds: looping tracks for Home and the match, one-shot stings for win / lose.
// CC0 tracks from OpenGameArt, credited in public/assets/CREDITS.md: "Flowerbed Fields" and
// "Pixel Sprinter" by Zane Little Music, "Victory" by celestialghost8, "Game over short jingle" by
// Kosmo The Cat and "Game Over Trumpet SFX" by 0new4y. Swapping a track is one line in `MUSIC`.
//
// Files live in /assets/music/ as stereo MP3s, loudness-normalised offline (about -16 LUFS).
// A looping file is the loop followed by a short copy of its first 0.3 s, and we loop
// [LOOP_START, LOOP_START + loopLen]: MP3 decoders differ in how much encoder delay they leave
// at the start (0 or ~25 ms), and with the copied head the seam is clean either way.
//
// This module owns no AudioContext: sound.ts creates it on the first gesture, then calls
// `attachMusic` with the music bus (which it ducks under stingers). Pause on tab hide and the
// sound on/off toggle are handled there too, by suspending the whole context.

export type MusicTrack = 'menu' | 'match' | 'win' | 'lose';

interface TrackDef {
  /** File stem in /assets/music/. */
  file: string;
  /** Optional intro file, played once before the loop starts. */
  intro?: string;
  /** Loop length in seconds (the source file's exact length). Omit for a one-shot sting. */
  loopLen?: number;
  /** Linear gain inside the music bus (1 = as encoded). */
  gain?: number;
}

export const MUSIC: Record<MusicTrack, TrackDef> = {
  menu: { file: 'flowerbed-fields', loopLen: 105.931043 },
  match: { file: 'pixel-sprinter', loopLen: 34.285714 },
  win: { file: 'victory' },
  lose: { file: 'game-over-jingle' }, // comic alternative (e.g. for an overrun): { file: 'game-over-trumpet' }
};

const MUSIC_DIR = `${import.meta.env.BASE_URL}assets/music/`;
const LOOP_START = 0.1; // s; must stay below the 0.3 s head copy in each loop file
const FADE = 1.0; // s, crossfade between beds
const FADE_IN = 1.4; // s, the first bed (or one after silence) fades in
const STING_LATE = 1.5; // s; a sting whose file isn't ready by then is dropped, not played late

interface Voice {
  track: MusicTrack;
  gain: GainNode;
  srcs: AudioBufferSourceNode[];
}

let ctx: AudioContext | null = null;
let bus: AudioNode | null = null;
let onSting: (() => void) | null = null;
let wanted: MusicTrack | null = null;
let wantedAt = 0;
let current: Voice | null = null;
const cache = new Map<string, Promise<AudioBuffer | null>>();

function load(stem: string): Promise<AudioBuffer | null> {
  let p = cache.get(stem);
  if (!p) {
    const ac = ctx!;
    p = fetch(`${MUSIC_DIR}${stem}.mp3`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((b) => ac.decodeAudioData(b))
      .catch(() => null); // missing or undecodable: that track just stays silent
    cache.set(stem, p);
  }
  return p;
}

const stems = (t: MusicTrack) => [MUSIC[t].intro, MUSIC[t].file].filter((s): s is string => !!s);

/** Called by sound.ts once the AudioContext exists. `stingStart` lifts any stinger duck. */
export function attachMusic(ac: AudioContext, musicBus: AudioNode, stingStart?: () => void) {
  if (ctx) return;
  ctx = ac;
  bus = musicBus;
  onSting = stingStart ?? null;
  if (wanted) switchTo(wanted);
  // Warm the rest in the background so later switches are instant (about 1.5 MB in all).
  const order: MusicTrack[] = ['menu', 'match', 'win', 'lose'];
  void order.reduce<Promise<unknown>>((p, t) => p.then(() => Promise.all(stems(t).map(load))), Promise.resolve());
}

/** True while a win/lose sting is wanted or sounding (sound.ts doesn't duck it under stingers). */
export function musicStingPlaying(): boolean {
  return !!wanted && !MUSIC[wanted].loopLen;
}

/** Crossfade to a bed, play a sting once, or stop (`null`). */
export function setMusicTrack(track: MusicTrack | null) {
  if (track === wanted && (track === null || current?.track === track)) return;
  wanted = track;
  wantedAt = performance.now();
  if (ctx) switchTo(track);
}

function fadeOut(v: Voice, secs: number) {
  const ac = ctx!;
  const now = ac.currentTime;
  const g = v.gain.gain;
  g.cancelScheduledValues(now);
  g.setValueAtTime(g.value, now);
  g.linearRampToValueAtTime(0, now + secs);
  for (const s of v.srcs) {
    try {
      s.stop(now + secs + 0.05);
    } catch {
      /* already stopped */
    }
  }
  setTimeout(() => v.gain.disconnect(), (secs + 0.2) * 1000);
}

function switchTo(track: MusicTrack | null) {
  const ac = ctx!;
  const cross = !!current;
  if (current && current.track !== track) {
    fadeOut(current, track && !MUSIC[track].loopLen ? 0.25 : FADE);
    current = null;
  }
  if (!track || current) return;
  const def = MUSIC[track];
  const sting = !def.loopLen;
  // A sting asked for while the context is paused (sound off, tab hidden) is simply skipped.
  if (sting && ac.state !== 'running') {
    wanted = null;
    return;
  }
  void Promise.all(stems(track).map(load)).then((bufs) => {
    if (wanted !== track || current) return;
    if (sting && performance.now() - wantedAt > STING_LATE * 1000) return;
    if (bufs.some((b) => !b)) return;
    start(track, def, bufs as AudioBuffer[], cross ? FADE : FADE_IN);
  });
}

/**
 * Starts a track, a bed fading in over `fade` s. On a context still waiting for its first gesture
 * the clock is stopped, so the fade-in plays out once the gesture resumes it.
 */
function start(track: MusicTrack, def: TrackDef, bufs: AudioBuffer[], fade: number) {
  const ac = ctx!;
  const now = ac.currentTime;
  const level = def.gain ?? 1;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(level, now + (def.loopLen ? fade : 0.02));
  gain.connect(bus!);

  const srcs: AudioBufferSourceNode[] = [];
  let at = now;
  const intro = def.intro ? bufs.shift()! : null;
  if (intro) {
    const s = ac.createBufferSource();
    s.buffer = intro;
    s.connect(gain);
    s.start(at);
    srcs.push(s);
    at += intro.duration;
  }
  const main = ac.createBufferSource();
  main.buffer = bufs[0]!;
  if (def.loopLen) {
    main.loop = true;
    main.loopStart = LOOP_START;
    main.loopEnd = Math.min(main.buffer.duration, LOOP_START + def.loopLen);
  }
  main.connect(gain);
  main.start(at);
  srcs.push(main);

  const voice: Voice = { track, gain, srcs };
  current = voice;
  if (!def.loopLen) {
    onSting?.(); // the result sting is the music: don't start it under the win/lose SFX duck
    // A sting plays once, then silence.
    main.onended = () => {
      if (current === voice) {
        current = null;
        if (wanted === track) wanted = null;
      }
      gain.disconnect();
    };
  }
}
