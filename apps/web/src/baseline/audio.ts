// Tiny Web Audio player for the baseline: decoded buffers, per-sound throttle, random variants.
const BASE = `${import.meta.env.BASE_URL}assets/`;
const SFX: Record<string, { files: string[]; vol: number; gap: number }> = {
  shot: { files: ['shot-1', 'shot-2', 'shot-3'], vol: 0.25, gap: 0.05 },
  gate: { files: ['gate-good'], vol: 0.35, gap: 0.09 },
  clash: { files: ['clash-1', 'clash-2', 'clash-3'], vol: 0.3, gap: 0.06 },
  hit: { files: ['hit-1', 'hit-2', 'hit-3'], vol: 0.3, gap: 0.07 },
  crate: { files: ['crate-hit'], vol: 0.35, gap: 0.08 },
  crateBreak: { files: ['crate-break'], vol: 0.7, gap: 0.2 },
  towerDown: { files: ['tower-down'], vol: 0.8, gap: 0.3 },
  wave: { files: ['wave'], vol: 0.5, gap: 0.5 },
  champ: { files: ['champ-launch'], vol: 0.7, gap: 0.3 },
  champReady: { files: ['champ-charged'], vol: 0.6, gap: 1 },
  win: { files: ['win'], vol: 0.8, gap: 1 },
  lose: { files: ['lose'], vol: 0.8, gap: 1 },
};

export class Audio {
  private ctx: AudioContext | null = null;
  private buf = new Map<string, AudioBuffer>();
  private last = new Map<string, number>();
  private master!: GainNode;
  private music: AudioBufferSourceNode | null = null;
  muted = false;

  /** Call from a user gesture. */
  async start() {
    if (this.ctx) { void this.ctx.resume(); return; }
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination);
    const names = new Set(Object.values(SFX).flatMap((s) => s.files));
    await Promise.all([...names].map(async (n) => {
      try { const r = await fetch(`${BASE}sfx/${n}.mp3`); this.buf.set(n, await this.ctx!.decodeAudioData(await r.arrayBuffer())); } catch { /* missing sound: skip */ }
    }));
    try {
      const r = await fetch(`${BASE}music/pixel-sprinter.mp3`);
      const b = await this.ctx.decodeAudioData(await r.arrayBuffer());
      const src = this.ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const g = this.ctx.createGain(); g.gain.value = 0.18; src.connect(g).connect(this.master); src.start(); this.music = src;
    } catch { /* no music */ }
  }

  play(name: keyof typeof SFX, pitch = 1) {
    const ctx = this.ctx, s = SFX[name];
    if (!ctx || !s || this.muted) return;
    const now = ctx.currentTime;
    if (now - (this.last.get(name) ?? -9) < s.gap) return;
    this.last.set(name, now);
    const b = this.buf.get(s.files[Math.floor(Math.random() * s.files.length)]!);
    if (!b) return;
    const src = ctx.createBufferSource(); src.buffer = b; src.playbackRate.value = pitch * (0.94 + Math.random() * 0.12);
    const g = ctx.createGain(); g.gain.value = s.vol; src.connect(g).connect(this.master); src.start();
  }

  toggle() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : 0.8; return this.muted; }
  get hasMusic() { return !!this.music; }
}
