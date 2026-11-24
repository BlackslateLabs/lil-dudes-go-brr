// Crowd pops → effects. The crowd layer (crowdSim.ts) pushes one record per dude that pops, and
// Fx.tsx drains the queue once a frame into pooled particle bursts. A typed ring buffer: no
// allocation per pop, and when it is full the newest pops are dropped (Fx aggregates anyway).
// Also two tiny shared signals the buildings read: a per-tower / hall "pulse" set by pop waves.

/** Why a dude popped (picks the burst). */
export const PopKind = {
  /** No burst (a stage ending wipes the crowds: they just vanish). */
  None: 0,
  /** Lingered at a tower and popped against it. */
  Tower: 1,
  /** Lingered at the town hall in the Rush. */
  Hall: 2,
  /** Lost on the contact front with the other team's crowd. */
  Clash: 3,
  /** Hit a crate or block. */
  Crate: 4,
  /** Lost to a bad gate (÷ / −) or anything else. */
  Gate: 5,
} as const;
export type PopKind = (typeof PopKind)[keyof typeof PopKind];

export class PopQueue {
  readonly kind: Uint8Array;
  /** 0 = mine (blue), 1 = the base's troops (red). */
  readonly team: Uint8Array;
  /** Building / crate index for Tower and Crate pops (−1 otherwise). */
  readonly ix: Int8Array;
  /** Sim units. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  private head = 0;
  private size = 0;
  dropped = 0;

  constructor(readonly cap: number) {
    this.kind = new Uint8Array(cap);
    this.team = new Uint8Array(cap);
    this.ix = new Int8Array(cap);
    this.x = new Float32Array(cap);
    this.y = new Float32Array(cap);
  }

  get length() {
    return this.size;
  }

  push(kind: PopKind, team: number, x: number, y: number, ix = -1) {
    if (this.size >= this.cap) {
      this.dropped++;
      return;
    }
    const i = (this.head + this.size) % this.cap;
    this.kind[i] = kind;
    this.team[i] = team;
    this.ix[i] = ix;
    this.x[i] = x;
    this.y[i] = y;
    this.size++;
  }

  /** Slot of the oldest record (read its fields), then `shift()` it. */
  peek(): number {
    return this.head;
  }

  shift() {
    if (this.size === 0) return;
    this.head = (this.head + 1) % this.cap;
    this.size--;
  }

  clear() {
    this.head = 0;
    this.size = 0;
  }
}

/** The one queue both crowds (mine and the troops) push into. */
export const pops = new PopQueue(4096);

/** Hit pulses for the buildings (0..1, set by Fx on each wave of pops, decayed by Base.tsx). */
export const towerPulse = new Float32Array(4);
export const hallPulse = new Float32Array(1);
