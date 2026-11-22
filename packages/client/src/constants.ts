// Mirrors crates/sim/src/constants.rs, the odds in crates/sim/src/deal.rs and the level pool in
// crates/sim/src/layouts.rs (rules v4, docs/SPEC.md). Change both together (CONTRACT log entry);
// the parity test (test/offline.test.ts) checks every value against the WASM `constants_json`.
// Units: 1 tick = 50 ms; distances in "sim units". The renderer scales sim units to world units.

export const RULES_VERSION = 4;

export const TICKS_PER_SEC = 20;
export const TICK_MS = 1000 / TICKS_PER_SEC;
/** SPEC §3: the time cap, 3:00. */
export const MATCH_TICKS = 180 * TICKS_PER_SEC;

/** SPEC §3: Fight 1 (one tower) and Fight 2 (two towers, the town hall behind them). */
export const STAGES = 2;
/** The last stage: when its towers fall, the town hall raid starts in place (no transit, no plant). */
export const FINAL_STAGE = STAGES - 1;
export const PLANT_TICKS = 3 * TICKS_PER_SEC;
export const TRANSIT_TICKS = 2 * TICKS_PER_SEC;
/** The raid fires for this long once the final stage's last tower falls (`LaneView.raidTicks`
 *  counts it); dudes already on the way still count. */
export const RAID_TICKS = 8 * TICKS_PER_SEC;

/** SPEC §7: one volley of VOLLEY_SIZE dude every FIRE_TICKS. */
export const FIRE_TICKS = 8;
export const VOLLEY_SIZE = 1;

export const CRUISE_SPEED = 80;
export const LAUNCH_TICKS = 6;
export const LAUNCH_SPEED = CRUISE_SPEED * 3;

/** x across the lane, y from the cannon line (0) to the base edge. */
export const LANE_WIDTH = 3_000;
export const LANE_LENGTH = 12_000;
/** Towers sit on this line; a raid cohort loots when it reaches VAULT_Y (the town hall spans
 *  the whole base). */
export const TOWER_Y = 11_000;
export const VAULT_Y = TOWER_Y;
/** Past the last gate row, raid cohorts steer toward the town hall's centre. */
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

/** SPEC §8: fee = 5% of the money moved. */
export const FEE_BPS = 500;

/** Layout limits (fixed-size state): rows, gates, towers and crates per stage. */
export const ROWS_MAX = 4;
export const GATES_MAX = 8;
export const TOWERS_MAX = 2;
export const CRATES_MAX = 2;

/** SPEC §6 gate odds: [multiplier, percent]. */
export const NORMAL_ODDS = [[2, 47], [3, 34], [4, 12], [5, 4], [6, 3]];
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
  /** Gate slots (rig/peek name these), sorted by row then x. */
  gates: GateDef[];
  crates: CrateDef[];
}

export interface LayoutDef {
  name: string;
  /** Fight 1, Fight 2 (STAGES); the town hall raid happens in Fight 2's lane. */
  stages: StageDef[];
}

/** `LAYOUTS[id]`, id = seed % LAYOUTS.length (MatchView.layout). */
export const LAYOUTS: readonly LayoutDef[] = [
  {
    name: 'Twin Lanes',
    stages: [
      {
        towers: [{ x: 1500, hp: 370, waveBase: 40 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 700, width: 600, big: false, xMin: 700, xMax: 700, speed: 0 },
          { row: 0, x: 2300, width: 600, big: false, xMin: 2300, xMax: 2300, speed: 0 },
          { row: 1, x: 700, width: 600, big: false, xMin: 700, xMax: 700, speed: 0 },
          { row: 1, x: 2300, width: 600, big: false, xMin: 2300, xMax: 2300, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, xMin: 900, xMax: 2100, speed: 25 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 700, hp: 200, waveBase: 11 }, { x: 2300, hp: 200, waveBase: 11 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 700, width: 600, big: false, xMin: 700, xMax: 700, speed: 0 },
          { row: 0, x: 2300, width: 600, big: false, xMin: 2300, xMax: 2300, speed: 0 },
          { row: 1, x: 1500, width: 1000, big: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 2, x: 700, width: 600, big: false, xMin: 700, xMax: 700, speed: 0 },
          { row: 2, x: 2300, width: 600, big: false, xMin: 2300, xMax: 2300, speed: 0 },
        ],
        crates: [{ x: 1500, width: 1000, y: 2100, hp: 25 }],
      },
    ],
  },
  {
    name: 'Conveyor',
    stages: [
      {
        towers: [{ x: 2200, hp: 120, waveBase: 30 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 800, width: 600, big: false, xMin: 500, xMax: 2500, speed: 30 },
          { row: 1, x: 2200, width: 600, big: false, xMin: 2200, xMax: 2200, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, xMin: 500, xMax: 2500, speed: -40 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 600, hp: 120, waveBase: 12 }, { x: 2400, hp: 120, waveBase: 12 }],
        rows: [1400, 2300, 3200, 4100],
        gates: [
          { row: 0, x: 1500, width: 600, big: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 700, width: 600, big: false, xMin: 400, xMax: 1000, speed: 30 },
          { row: 1, x: 2300, width: 600, big: false, xMin: 2000, xMax: 2600, speed: -30 },
          { row: 2, x: 1500, width: 1000, big: true, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 3, x: 1500, width: 600, big: false, xMin: 400, xMax: 2600, speed: 50 },
        ],
        crates: [{ x: 1500, width: 1000, y: 2900, hp: 30 }],
      },
    ],
  },
  {
    name: 'Long Shot',
    stages: [
      {
        towers: [{ x: 1000, hp: 190, waveBase: 45 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 1100, width: 600, big: false, xMin: 1100, xMax: 1100, speed: 0 },
          { row: 0, x: 2450, width: 1000, big: true, xMin: 2450, xMax: 2450, speed: 0 },
          { row: 1, x: 1000, width: 600, big: false, xMin: 1000, xMax: 1000, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, xMin: 700, xMax: 2300, speed: 30 },
        ],
        crates: [{ x: 2450, width: 1000, y: 1100, hp: 20 }],
      },
      {
        towers: [{ x: 500, hp: 290, waveBase: 38 }, { x: 2000, hp: 290, waveBase: 38 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 550, width: 1000, big: true, xMin: 550, xMax: 550, speed: 0 },
          { row: 0, x: 1750, width: 600, big: false, xMin: 1750, xMax: 1750, speed: 0 },
          { row: 1, x: 1500, width: 600, big: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 2650, width: 500, big: false, xMin: 2650, xMax: 2650, speed: 0 },
          { row: 2, x: 1000, width: 600, big: false, xMin: 500, xMax: 2000, speed: 35 },
        ],
        crates: [{ x: 550, width: 1000, y: 1100, hp: 30 }],
      },
    ],
  },
  {
    name: 'Funnel',
    stages: [
      {
        towers: [{ x: 2500, hp: 70, waveBase: 17 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 1500, width: 700, big: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 1050, width: 500, big: false, xMin: 1050, xMax: 1050, speed: 0 },
          { row: 1, x: 1950, width: 500, big: false, xMin: 1950, xMax: 1950, speed: 0 },
          { row: 2, x: 1500, width: 1000, big: true, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [{ x: 1500, width: 1000, y: 3100, hp: 25 }],
      },
      {
        towers: [{ x: 500, hp: 250, waveBase: 24 }, { x: 2500, hp: 250, waveBase: 24 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 1050, width: 500, big: false, xMin: 1050, xMax: 1050, speed: 0 },
          { row: 0, x: 1950, width: 500, big: false, xMin: 1950, xMax: 1950, speed: 0 },
          { row: 1, x: 1500, width: 600, big: false, xMin: 900, xMax: 2100, speed: 20 },
          { row: 2, x: 1500, width: 700, big: false, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [],
      },
    ],
  },
  {
    name: 'Zigzag',
    stages: [
      {
        towers: [{ x: 500, hp: 140, waveBase: 19 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 600, width: 600, big: false, xMin: 600, xMax: 600, speed: 0 },
          { row: 1, x: 2400, width: 600, big: false, xMin: 2400, xMax: 2400, speed: 0 },
          { row: 2, x: 1500, width: 600, big: false, xMin: 600, xMax: 2400, speed: 30 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 1500, hp: 150, waveBase: 7 }, { x: 2600, hp: 150, waveBase: 7 }],
        rows: [1400, 2400, 3400],
        gates: [
          { row: 0, x: 2400, width: 600, big: false, xMin: 2400, xMax: 2400, speed: 0 },
          { row: 1, x: 600, width: 600, big: false, xMin: 600, xMax: 600, speed: 0 },
          { row: 1, x: 1850, width: 1000, big: true, xMin: 1850, xMax: 1850, speed: 0 },
          { row: 2, x: 2400, width: 600, big: false, xMin: 2400, xMax: 2400, speed: 0 },
        ],
        crates: [{ x: 1850, width: 1000, y: 2100, hp: 30 }],
      },
    ],
  },
  {
    name: 'Stairway',
    stages: [
      {
        towers: [{ x: 2600, hp: 190, waveBase: 52 }],
        rows: [1400, 2300, 3200, 4100],
        gates: [
          { row: 0, x: 500, width: 600, big: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 1, x: 1200, width: 600, big: false, xMin: 1200, xMax: 1200, speed: 0 },
          { row: 2, x: 1900, width: 600, big: false, xMin: 1900, xMax: 1900, speed: 0 },
          { row: 3, x: 2300, width: 600, big: false, xMin: 1800, xMax: 2650, speed: 25 },
        ],
        crates: [],
      },
      {
        towers: [{ x: 400, hp: 90, waveBase: 26 }, { x: 1800, hp: 90, waveBase: 26 }],
        rows: [1400, 2300, 3200, 4100],
        gates: [
          { row: 0, x: 2500, width: 600, big: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 1800, width: 600, big: false, xMin: 1800, xMax: 1800, speed: 0 },
          { row: 2, x: 1100, width: 1000, big: true, xMin: 1100, xMax: 1100, speed: 0 },
          { row: 3, x: 600, width: 600, big: false, xMin: 400, xMax: 1400, speed: 25 },
        ],
        crates: [{ x: 1100, width: 1000, y: 2900, hp: 30 }],
      },
    ],
  },
];
