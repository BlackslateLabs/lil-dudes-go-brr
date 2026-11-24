// MatchView v5: everything the screen needs to draw one moment of a match (SPEC v4 + SPEC_V5).
// It mirrors the public Match account (plus the viewer's own private Scout result).
// Changing it needs a CONTRACT entry in PROGRESS_LOG.md.

/**
 * 0 = player A (creator), 1 = player B. Each player plays their OWN identical copy of the level
 * (a "lane"): `sides[s]` is side s's lane. The renderer draws `sides[mySide]` full size and the
 * other lane as a progress line (SPEC_V5 §8).
 * Coordinates inside a lane: `x` across the lane, 0..LANE_WIDTH; `y` from that lane's cannon line
 * (0) up to the base edge (LANE_LENGTH). The player's dudes move +y, the base's troops −y.
 * No mirroring: both lanes use the same frame.
 */
export type Side = 0 | 1;

export type MatchStatus = 'waiting' | 'playing' | 'ended';

/** Where one player is in their own level (SPEC_V5 §2): plant → fight (stage 0) → transit →
 *  plant → fight (stage 1) → rush → done. The Rush starts in place when Fight 2's last tower
 *  falls (the breach: same stage, same field) and lasts RUSH_TICKS. 'dead' can come at any point. */
export type LanePhase = 'plant' | 'fight' | 'transit' | 'rush' | 'done' | 'dead';

/** SPEC_V5 §3: ×k → c·k, ÷k → floor(c/k), +n → c+n, −n → max(0, c−n). ÷ and − are the bad ones. */
export type GateOp =
  | { kind: 'mul'; value: number }
  | { kind: 'div'; value: number }
  | { kind: 'add'; value: number }
  | { kind: 'sub'; value: number };

export interface GateView {
  /** Index within the current stage (what Scout takes). */
  slot: number;
  /** Current centre x (moving gates slide; the sim's x for this tick). */
  x: number;
  y: number;
  width: number;
  /** A "big" slot (×6–×10), usually behind a crate. */
  big: boolean;
  /** The timing gate (SPEC_V5 §3): always face-up, never `revealed`; its value right now is
   *  `timingValue(lane.phaseTick)` (×1 → ×5, one step per second) and `value` below. */
  timing: boolean;
  /** Slides left/right (ping-pong). */
  moving: boolean;
  /** Set once this lane's first cohort passes (hidden gates only). */
  revealed: GateOp | null;
  /** What a cohort crossing now would get, if public: the revealed op, or the timing gate's
   *  value this tick. null = still face-down. */
  value: GateOp | null;
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
  /** One of my cohorts is a Champion (SPEC_V5 §4): draw one giant with a ×count badge. */
  champion: boolean;
  /** An enemy cohort is a giant (SPEC_V5 §5): slower, worth GIANT_COUNT. */
  giant: boolean;
}

/** One player's copy of the level. */
export interface LaneView {
  name: string;
  isBot: boolean;
  /** 0 = fight 1, 1 = fight 2 (FINAL_STAGE; its rush phase follows the breach). */
  stage: number;
  phase: LanePhase;
  /** Ticks since the current phase started (moving gates, the timing gate and wave timers count
   *  from fight start). The Rush keeps counting the Fight's ticks, so gates slide on smoothly. */
  phaseTick: number;
  /** Ticks since the breach (0 before it; RUSH_TICKS once done). The 3-2-1 clock. */
  rushTicks: number;
  /** The score (SPEC_V5 §6): damage + towers + FIRST + Rush. */
  gold: number;
  /** Score from the Rush so far (dudes into the hall, LOOT_PER_UNIT each; part of `gold`). */
  rushGold: number;
  /** `first[stage]`: this player cleared that fight first and scored FIRST_BONUS (part of `gold`). */
  first: [boolean, boolean];
  /** Match tick each fight was cleared at (0 = not yet), e.g. for "+50 FIRST" timing. */
  breachTick: [number, number];
  /** Champion meter, 0..CHAMP_TICKS (fills in Fights, carries over). Full = can call it. */
  champMeter: number;
  /** A called Champion waits for the next volley. */
  champPending: boolean;
  /** Where the cannon actually is (volleys spawn here). */
  cannonX: number;
  /** Where the player is aiming (the cannon moves toward it at CANNON_STEP per tick). */
  aimX: number;
  /** The player's dudes. */
  cohorts: CohortView[];
  /** The base's troops coming down this lane. */
  enemies: CohortView[];
  /** Towers of the current stage (all at 0 HP in the Rush: they fell, the town hall is next). */
  towers: TowerView[];
  /** Gates of the current stage. */
  gates: GateView[];
  crates: CrateView[];
  /** Scout used in the current stage. */
  peekUsed: boolean;
}

export interface MatchResult {
  winner: Side | null; // null = draw
  /** Who died (an enemy reached their cannon line), or null if nobody or both did. */
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
  /** My Scout in my current stage: which slot and its true value. */
  myPeek: { stage: number; slot: number; op: GateOp } | null;
}

/** One-shot things that happened during a tick, for effects and sound. `side` = whose lane. */
export type MatchEvent =
  | { type: 'volley'; side: Side; cohortId: number; x: number; count: number; champion: boolean }
  /** A hidden gate flipped face-up (the first pass). Never for the timing gate. */
  | { type: 'reveal'; side: Side; stage: number; slot: number; op: GateOp }
  /** A cohort went through gate `slot` and got `op` (the timing gate: its value that tick). */
  | { type: 'gate'; side: Side; slot: number; cohortId: number; op: GateOp; before: number; after: number }
  | { type: 'crate'; side: Side; index: number; hp: number; broken: boolean }
  | { type: 'wave'; side: Side; tower: number; cohortId: number; count: number }
  /** `killed` units on each side of the clash (they're equal: 1:1). */
  | { type: 'clash'; side: Side; x: number; y: number; killed: number }
  | { type: 'towerHit'; side: Side; tower: number; damage: number; hp: number; gold: number }
  | { type: 'towerDown'; side: Side; tower: number; gold: number }
  /** Rush: `count` dudes reached the town hall for `gold`. */
  | { type: 'loot'; side: Side; count: number; gold: number }
  /** `side` cleared fight `stage` first (SPEC_V5 §6). */
  | { type: 'first'; side: Side; stage: number; gold: number }
  /** `side`'s Rush ran out: `lost` dudes still on the lane did not count; `side` is done. */
  | { type: 'rushEnd'; side: Side; lost: number }
  /** Rules v8: cohort `cohortId` dropped into pipe `pipeIx` (`stageDef(...).pipes[pipeIx]`) and
   *  popped out at its exit (outX, outY) this tick. */
  | { type: 'pipe'; side: Side; cohortId: number; pipeIx: number }
  | { type: 'stage'; side: Side; stage: number; phase: LanePhase }
  | { type: 'death'; side: Side }
  | { type: 'end'; result: MatchResult };
