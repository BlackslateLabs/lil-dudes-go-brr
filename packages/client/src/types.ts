// MatchView v3: everything the screen needs to draw one moment of a match (SPEC v3).
// It mirrors the public Match account (plus the viewer's own private Peek/Rig).
// Changing it needs a CONTRACT entry in PROGRESS_LOG.md.

/**
 * 0 = player A (creator), 1 = player B. Each player plays their OWN identical copy of the level
 * (a "lane"): `sides[s]` is side s's lane. The renderer draws `sides[mySide]` full size and the
 * other lane as a mini-view.
 * Coordinates inside a lane: `x` across the lane, 0..LANE_WIDTH; `y` from that lane's cannon line
 * (0) up to the base edge (LANE_LENGTH). The player's dudes move +y, the base's troops −y.
 * No mirroring: both lanes use the same frame.
 */
export type Side = 0 | 1;

export type MatchStatus = 'waiting' | 'playing' | 'ended';

/** Where one player is in their own level (SPEC §3). */
export type LanePhase = 'plant' | 'fight' | 'transit' | 'raid' | 'done' | 'dead';

/** v3 gates only multiply; a sprung rig acts as ÷2. */
export type GateOp = { kind: 'mul'; value: number } | { kind: 'div'; value: number };

export interface GateView {
  /** Index within the current stage (what rig/peek take). */
  slot: number;
  /** Current centre x (moving gates slide; the sim's x for this tick). */
  x: number;
  y: number;
  width: number;
  /** A "big" slot (×6–×10), usually behind a crate. */
  big: boolean;
  /** Slides left/right (ping-pong). */
  moving: boolean;
  /** Set once this lane's first cohort passes; `div` = a sprung trap. */
  revealed: GateOp | null;
  /** Behind a crate that isn't broken yet (cohorts hit the crate first). */
  locked: boolean;
}

export interface CrateView {
  index: number;
  x: number;
  y: number;
  width: number;
  hp: number;
  maxHp: number;
}

export interface TowerView {
  index: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
}

export interface CohortView {
  /** Stable id for the life of the cohort, so the renderer can track its instances. */
  id: number;
  count: number;
  /** 0..LANE_WIDTH. */
  x: number;
  /** From the lane's cannon line (0) toward the base. */
  y: number;
  /** Ticks since it was fired / released (launch boost lasts LAUNCH_TICKS). */
  age: number;
}

/** One player's copy of the level. */
export interface LaneView {
  name: string;
  isBot: boolean;
  /** 0 = fight 1, 1 = fight 2, 2 = raid. */
  stage: number;
  phase: LanePhase;
  /** Ticks since the current phase started (moving gates and wave timers count from fight start). */
  phaseTick: number;
  gold: number;
  /** Gold earned in the raid so far (part of `gold`). */
  raidGold: number;
  /** Where the cannon actually is (volleys spawn here). */
  cannonX: number;
  /** Where the player is aiming (the cannon moves toward it at CANNON_STEP per tick). */
  aimX: number;
  /** The player's dudes. */
  cohorts: CohortView[];
  /** The base's troops coming down this lane. */
  enemies: CohortView[];
  /** Towers of the current stage (empty in the raid). */
  towers: TowerView[];
  /** Gates of the current stage. */
  gates: GateView[];
  crates: CrateView[];
  /** Used in the current stage. */
  rigUsed: boolean;
  peekUsed: boolean;
}

export interface MatchResult {
  winner: Side | null; // null = draw
  /** Who died (an enemy reached their cannon line), or null if both survived. */
  died: Side | null;
  gold: [number, number];
  /** Lamports moved loser → winner, and the fee. 0 for free matches. */
  moved: number;
  fee: number;
}

export interface MatchView {
  matchId: string;
  tick: number;
  status: MatchStatus;
  /** Which hand-designed layout this match uses (both lanes). */
  layout: number;
  layoutName: string;
  /** Matched stake in lamports (0 = free). */
  stake: number;
  sides: [LaneView, LaneView];
  result: MatchResult | null;
}

/** Private to the viewer: never visible to the opponent. */
export interface PrivateView {
  /** The trap I planted this stage of mine: which opponent stage and gate slot. */
  myRig: { stage: number; slot: number } | null;
  /** My peek in my current stage: which slot and its true value (`div` = rigged). */
  myPeek: { stage: number; slot: number; op: GateOp } | null;
}

/** One-shot things that happened during a tick, for effects and sound. `side` = whose lane. */
export type MatchEvent =
  | { type: 'volley'; side: Side; cohortId: number; x: number; count: number }
  | { type: 'reveal'; side: Side; stage: number; slot: number; op: GateOp }
  | { type: 'gate'; side: Side; slot: number; cohortId: number; before: number; after: number }
  /** `side`'s dudes sprang the trap `riggedBy` planted in `side`'s lane. */
  | { type: 'gotcha'; side: Side; stage: number; slot: number; riggedBy: Side }
  | { type: 'crate'; side: Side; index: number; hp: number; broken: boolean }
  | { type: 'wave'; side: Side; tower: number; cohortId: number; count: number }
  /** `killed` units on each side of the clash (they're equal: 1:1). */
  | { type: 'clash'; side: Side; x: number; y: number; killed: number }
  | { type: 'towerHit'; side: Side; tower: number; damage: number; hp: number; gold: number }
  | { type: 'towerDown'; side: Side; tower: number; gold: number }
  | { type: 'loot'; side: Side; count: number; gold: number }
  | { type: 'stage'; side: Side; stage: number; phase: LanePhase }
  | { type: 'death'; side: Side }
  | { type: 'end'; result: MatchResult };
