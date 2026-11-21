// MatchView v0: everything the screen needs to draw one moment of a match.
// It mirrors the public Match account (plus the viewer's own private Peek/Rig).
// Changing it needs a CONTRACT entry in PROGRESS_LOG.md.

/**
 * 0 = player A (creator), 1 = player B. The renderer always draws `mySide` at the bottom.
 * Coordinates: every `x` (cannons, cohorts, gate columns, setAim) is an ABSOLUTE lane coordinate
 * as seen from side 0 (0 = side 0's left). When mySide = 1, the renderer mirrors x
 * (LANE_WIDTH - x) for drawing and input. Every `y` is measured from that cohort's own cannon.
 */
export type Side = 0 | 1;

export type MatchStatus = 'waiting' | 'plant' | 'playing' | 'ended';

export type GateOp =
  | { kind: 'mul'; value: number }
  | { kind: 'add'; value: number }
  | { kind: 'sub'; value: number }
  | { kind: 'div'; value: number };

export type Hint = 'none' | 'good' | 'bad' | 'gold';

export interface GateView {
  /** 0..8 = row * 3 + col; row 0 is nearest the owner's cannon. */
  cell: number;
  /**
   * Public hint while unrevealed ('none' = grey; always 'none' once revealed). During a plant
   * window every gate shows 'none' except gold. A rigged gate shows a fake 'good'.
   */
  hint: Hint;
  /** Set once the first cohort passes. Same for both players. */
  revealed: GateOp | null;
  gold: boolean;
}

export interface CohortView {
  /** Stable id for the life of the cohort, so the renderer can track its instances. */
  id: number;
  count: number;
  /** 0..LANE_WIDTH. */
  x: number;
  /** Distance from its own cannon toward the enemy, 0..LANE_LENGTH. */
  y: number;
  /** Ticks since it was fired (launch boost lasts LAUNCH_TICKS). */
  age: number;
}

export interface SideView {
  name: string;
  isBot: boolean;
  hp: number;
  /** Where the cannon actually is (volleys spawn here). */
  cannonX: number;
  /** Where the player is aiming (the cannon moves toward it at CANNON_STEP per tick). */
  aimX: number;
  cohorts: CohortView[];
  /** This side's own 9 gates (the ones its cohorts pass). */
  gates: GateView[];
  rigUsed: boolean;
  peekUsed: boolean;
}

export interface MatchResult {
  winner: Side | null; // null = draw
  ko: boolean;
  /** Lamports moved loser → winner, and the fee. 0 for free matches. */
  moved: number;
  fee: number;
}

export interface MatchView {
  matchId: string;
  tick: number;
  status: MatchStatus;
  /** 0, 1, 2 (re-deals at 0:40 and 1:20). */
  phase: number;
  surge: boolean;
  /** Matched stake in lamports (0 = free). */
  stake: number;
  sides: [SideView, SideView];
  result: MatchResult | null;
}

/** Private to the viewer: never visible to the opponent. */
export interface PrivateView {
  /** Opponent cell I rigged this phase. */
  myRig: number | null;
  /** My peek this phase: which cell and its true value. */
  myPeek: { cell: number; op: GateOp; gold: boolean } | null;
}

/** One-shot things that happened during a tick, for effects and sound. */
export type MatchEvent =
  | { type: 'volley'; side: Side; cohortId: number; x: number; count: number }
  | { type: 'reveal'; side: Side; cell: number; op: GateOp; gold: boolean }
  | { type: 'gate'; side: Side; cell: number; cohortId: number; before: number; after: number }
  /** `side`'s stream sprang the trap `riggedBy` planted on `side`'s cell. */
  | { type: 'gotcha'; side: Side; cell: number; riggedBy: Side }
  /** y is measured from side 0's cannon (unlike cohort y). killedA/B = units side 0/1 lost. */
  | { type: 'clash'; x: number; y: number; killedA: number; killedB: number }
  /** `side` is the cannon that was hit. */
  | { type: 'hit'; side: Side; damage: number; hp: number }
  | { type: 'plant'; phase: number }
  | { type: 'redeal'; phase: number }
  | { type: 'surge' }
  | { type: 'end'; result: MatchResult };
