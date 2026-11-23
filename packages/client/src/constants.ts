// Mirrors crates/sim/src/constants.rs, the odds in crates/sim/src/deal.rs and the level pool in
// crates/sim/src/layouts.rs (rules v5, docs/SPEC_V5.md on top of docs/SPEC.md). Change both
// together (CONTRACT log entry);
// the parity test (test/offline.test.ts) checks every value against the WASM `constants_json`.
// Units: 1 tick = 50 ms; distances in "sim units". The renderer scales sim units to world units.

export const RULES_VERSION = 6;

export const TICKS_PER_SEC = 20;
export const TICK_MS = 1000 / TICKS_PER_SEC;
/** SPEC §3: the time cap, 3:00. */
export const MATCH_TICKS = 180 * TICKS_PER_SEC;

/** SPEC §3: Fight 1 (one tower) and Fight 2 (two towers, the town hall behind them). */
export const STAGES = 2;
/** The last stage: when its towers fall (the breach), the Rush starts in place (no transit, no plant). */
export const FINAL_STAGE = STAGES - 1;
export const PLANT_TICKS = 3 * TICKS_PER_SEC;
export const TRANSIT_TICKS = 2 * TICKS_PER_SEC;
/** SPEC_V5 §2: the Rush lasts this long after the breach (`LaneView.rushTicks` counts it). Dudes
 *  that reach the town hall score LOOT_PER_UNIT each; dudes still on the lane when it runs out
 *  do not count, and the player is done at once. */
export const RUSH_TICKS = 70;
/** SPEC_V5 §4: the Champion meter fills 1 per Fight tick (`LaneView.champMeter`), full at
 *  CHAMP_TICKS (8 s); a called Champion is the next volley, worth CHAMP_COUNT dudes. */
export const CHAMP_TICKS = 8 * TICKS_PER_SEC;
export const CHAMP_COUNT = 8;
/** SPEC_V5 §6: whoever clears a fight on the lower match tick scores this. */
export const FIRST_BONUS = 50;
/** SPEC_V5 §5: Fight 2's small waves bring a giant enemy of GIANT_COUNT walking at GIANT_SPEED. */
export const GIANT_COUNT = 5;
export const GIANT_SPEED = 48;
/** SPEC_V5 §3: the timing gate steps ×1 → ×TIMING_MAX, one step every TIMING_STEP_TICKS of the
 *  lane's phase clock (`timingValue(phaseTick)`). */
export const TIMING_STEP_TICKS = TICKS_PER_SEC;
export const TIMING_MAX = 5;

/** SPEC §7: one volley of VOLLEY_SIZE dude every FIRE_TICKS. */
export const FIRE_TICKS = 8;
export const VOLLEY_SIZE = 1;

export const CRUISE_SPEED = 80;
export const LAUNCH_TICKS = 6;
export const LAUNCH_SPEED = CRUISE_SPEED * 3;

/** x across the lane, y from the cannon line (0) to the base edge. */
export const LANE_WIDTH = 3_000;
export const LANE_LENGTH = 12_000;
/** Towers sit on this line; a Rush cohort loots when it reaches VAULT_Y (the town hall spans
 *  the whole base). */
export const TOWER_Y = 11_000;
export const VAULT_Y = TOWER_Y;
/** Past the last gate row, Rush cohorts steer toward the town hall's centre. */
export const HALL_X = LANE_WIDTH / 2;
export const TOWER_HALF_W = 300;
/** A cohort this far outside a gate's (or crate's) edge still goes through it. */
export const GATE_GRACE = 100;
export const CLASH_REACH = 400;
export const CLASH_BAND = 400;
export const STEER_STEP = 40;
export const DETECT_Y = 4_000;
/** The cannon chases the aim by at most this per tick. */
export const CANNON_STEP = LANE_WIDTH / 5;

/** Live cohorts of yours / enemy cohorts, per lane. */
export const COHORT_CAP = 40;
export const ENEMY_CAP = 16;

/** SPEC §4 waves: first wave, the big → small → medium cycle, fatigue. */
export const FIRST_WAVE_TICKS = 10;
export const WAVE_GAPS = [130, 130, 80];
export const WAVE_PCT = [115, 85, 100];
export const FATIGUE_START = 15 * TICKS_PER_SEC;
export const FATIGUE_END = 45 * TICKS_PER_SEC;
export const FATIGUE_MIN_PM = 100;
export const TUTORIAL_WAVE_PCT = 50;

/** SPEC §5 gold. */
export const TOWER_BONUS = 50;
export const LOOT_PER_UNIT = 2;

/** SPEC §10: the bot defends when an enemy is this close to its cannon. */
export const DEFEND_Y = 3_000;

/** SPEC_V5 §7: fee = 5% of the money moved. */
export const FEE_BPS = 500;

/** Layout limits (fixed-size state): rows, gates, towers and crates per stage. */
export const ROWS_MAX = 4;
export const GATES_MAX = 8;
export const TOWERS_MAX = 2;
export const CRATES_MAX = 2;

/** SPEC_V5 §3 normal `?` odds: [op byte, percent]; ±N is written +0 (64) / −0 (192), with N =
 *  PM_BY_ROW[row] (row index 0 has no ±N: re-drawn as × or ÷). */
export const NORMAL_ODDS = [[2, 30], [3, 20], [4, 8], [5, 2], [64, 12], [130, 14], [192, 12], [131, 2]];
export const PM_BY_ROW = [0, 5, 15, 30];
export const BIG_ODDS = [[6, 30], [8, 40], [10, 30]];

// --- the level pool (SPEC §9) ----------------------------------------------------------------

export interface TowerDef {
  x: number;
  hp: number;
  /** Wave size before the cycle % and fatigue. */
  waveBase: number;
}

export interface GateDef {
  /** Index into the stage's `rows`. */
  row: number;
  /** Centre x at the start of the Fight (and all through Plant and Transit). */
  x: number;
  width: number;
  /** A "big" slot (×6–×10), usually behind a crate. */
  big: boolean;
  /** The stage's timing gate: public, its value cycles ×1 → ×5 (`timingValue`). */
  timing: boolean;
  /** Sliding gates ping-pong between xMin and xMax by |speed| per tick (toward +x if speed > 0). */
  xMin: number;
  xMax: number;
  speed: number;
}

export interface CrateDef {
  x: number;
  width: number;
  y: number;
  hp: number;
}

export interface StageDef {
  towers: TowerDef[];
  /** Gate row y, ascending. */
  rows: number[];
  /** Gate slots (Scout names these), sorted by row then x. */
  gates: GateDef[];
  crates: CrateDef[];
}

export interface LayoutDef {
  name: string;
  /** Fight 1, Fight 2 (STAGES); the Rush happens in Fight 2's lane. */
  stages: StageDef[];
}

/** `LAYOUTS[id]`, id = seed % LAYOUTS.length (MatchView.layout). */
export const LAYOUTS: readonly LayoutDef[] = [
  {
    name: 'Twin Lanes',
    stages: [
      {
        towers: [{ x: 1500, hp: 716, waveBase: 14 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 0, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 1, x: 1500, width: 600, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, timing: false, xMin: 900, xMax: 2100, speed: 25 },
          { row: 3, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 3, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 700, hp: 354, waveBase: 6 }, { x: 2300, hp: 354, waveBase: 6 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 0, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 1, x: 1500, width: 600, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 2, x: 1500, width: 1000, big: true, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 3, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 3, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
        ],
        crates: [{ x: 1500, width: 1000, y: 3800, hp: 25 }],
      },
    ],
  },
  {
    name: 'Conveyor',
    stages: [
      {
        towers: [{ x: 2200, hp: 533, waveBase: 26 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 1200, width: 600, big: false, timing: false, xMin: 600, xMax: 2400, speed: 30 },
          { row: 1, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 1, x: 2100, width: 600, big: false, timing: true, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, timing: false, xMin: 600, xMax: 2400, speed: -40 },
          { row: 3, x: 1500, width: 600, big: false, timing: false, xMin: 700, xMax: 2300, speed: 35 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 600, hp: 1798, waveBase: 103 }, { x: 2400, hp: 1798, waveBase: 103 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 0, x: 2150, width: 1000, big: true, timing: false, xMin: 2150, xMax: 2150, speed: 0 },
          { row: 1, x: 800, width: 600, big: false, timing: false, xMin: 600, xMax: 1000, speed: 30 },
          { row: 1, x: 2200, width: 600, big: false, timing: false, xMin: 2000, xMax: 2400, speed: -30 },
          { row: 2, x: 1500, width: 600, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 3, x: 1500, width: 600, big: false, timing: false, xMin: 700, xMax: 2300, speed: 50 },
        ],
        crates: [],
      },
    ],
  },
  {
    name: 'Long Shot',
    stages: [
      {
        towers: [{ x: 1000, hp: 655, waveBase: 27 }],
        rows: [1400, 2800, 4200, 5600],
        gates: [
          { row: 0, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 0, x: 2200, width: 1000, big: true, timing: false, xMin: 2200, xMax: 2200, speed: 0 },
          { row: 1, x: 1300, width: 600, big: false, timing: false, xMin: 1300, xMax: 1300, speed: 0 },
          { row: 2, x: 1000, width: 600, big: false, timing: true, xMin: 1000, xMax: 1000, speed: 0 },
          { row: 3, x: 1500, width: 600, big: false, timing: false, xMin: 700, xMax: 2300, speed: 30 },
        ],
        crates: [{ x: 2200, width: 1000, y: 1100, hp: 20 }],
      },
      {
        towers: [{ x: 500, hp: 696, waveBase: 13 }, { x: 2000, hp: 696, waveBase: 13 }],
        rows: [1400, 2800, 4200, 5600],
        gates: [
          { row: 0, x: 1500, width: 600, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 1, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 2, x: 2000, width: 600, big: false, timing: true, xMin: 2000, xMax: 2000, speed: 0 },
          { row: 3, x: 1000, width: 600, big: false, timing: false, xMin: 600, xMax: 1800, speed: 35 },
        ],
        crates: [],
      },
    ],
  },
  {
    name: 'Funnel',
    stages: [
      {
        towers: [{ x: 2500, hp: 304, waveBase: 10 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 1500, width: 700, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 1050, width: 500, big: false, timing: false, xMin: 1050, xMax: 1050, speed: 0 },
          { row: 1, x: 1950, width: 500, big: false, timing: false, xMin: 1950, xMax: 1950, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 3, x: 1500, width: 1000, big: true, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [{ x: 1500, width: 1000, y: 5200, hp: 25 }],
      },
      {
        towers: [{ x: 500, hp: 819, waveBase: 12 }, { x: 2500, hp: 819, waveBase: 12 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 1050, width: 500, big: false, timing: false, xMin: 1050, xMax: 1050, speed: 0 },
          { row: 0, x: 1950, width: 500, big: false, timing: false, xMin: 1950, xMax: 1950, speed: 0 },
          { row: 1, x: 1500, width: 600, big: false, timing: false, xMin: 900, xMax: 2100, speed: 20 },
          { row: 2, x: 1500, width: 700, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 3, x: 1500, width: 600, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [],
      },
    ],
  },
  {
    name: 'Zigzag',
    stages: [
      {
        towers: [{ x: 500, hp: 1811, waveBase: 30 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 1, x: 900, width: 1000, big: true, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 1, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 2, x: 900, width: 600, big: false, timing: true, xMin: 900, xMax: 900, speed: 0 },
          { row: 3, x: 1500, width: 600, big: false, timing: false, xMin: 700, xMax: 2300, speed: 30 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 1400, hp: 59, waveBase: 5 }, { x: 2600, hp: 59, waveBase: 5 }],
        rows: [1400, 2750, 4100, 5500],
        gates: [
          { row: 0, x: 2100, width: 600, big: false, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 1, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
          { row: 1, x: 2100, width: 1000, big: true, timing: false, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 2, x: 2100, width: 600, big: false, timing: true, xMin: 2100, xMax: 2100, speed: 0 },
          { row: 3, x: 900, width: 600, big: false, timing: false, xMin: 900, xMax: 900, speed: 0 },
        ],
        crates: [{ x: 2100, width: 1000, y: 2450, hp: 30 }],
      },
    ],
  },
  {
    name: 'Stairway',
    stages: [
      {
        towers: [{ x: 2400, hp: 411, waveBase: 19 }],
        rows: [1400, 2800, 4200, 5600],
        gates: [
          { row: 0, x: 800, width: 600, big: false, timing: false, xMin: 800, xMax: 800, speed: 0 },
          { row: 1, x: 1100, width: 600, big: false, timing: false, xMin: 1100, xMax: 1100, speed: 0 },
          { row: 1, x: 2200, width: 600, big: false, timing: true, xMin: 2200, xMax: 2200, speed: 0 },
          { row: 2, x: 1800, width: 600, big: false, timing: false, xMin: 1800, xMax: 1800, speed: 0 },
          { row: 3, x: 2100, width: 600, big: false, timing: false, xMin: 1700, xMax: 2400, speed: 25 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 600, hp: 276, waveBase: 6 }, { x: 1900, hp: 276, waveBase: 6 }],
        rows: [1400, 2800, 4200, 5600],
        gates: [
          { row: 0, x: 2200, width: 600, big: false, timing: false, xMin: 2200, xMax: 2200, speed: 0 },
          { row: 1, x: 700, width: 600, big: false, timing: true, xMin: 700, xMax: 700, speed: 0 },
          { row: 1, x: 1700, width: 600, big: false, timing: false, xMin: 1700, xMax: 1700, speed: 0 },
          { row: 2, x: 1200, width: 1000, big: true, timing: false, xMin: 1200, xMax: 1200, speed: 0 },
          { row: 3, x: 800, width: 600, big: false, timing: false, xMin: 600, xMax: 1400, speed: 25 },
        ],
        crates: [{ x: 1200, width: 1000, y: 3900, hp: 30 }],
      },
    ],
  },
];

