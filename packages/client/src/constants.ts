// Mirrors crates/sim/src/constants.rs, the odds in crates/sim/src/deal.rs and the level pool in
// crates/sim/src/layouts.rs (rules v8, docs/SPEC_V5.md on top of docs/SPEC.md). Change both
// together (CONTRACT log entry);
// the parity test (test/offline.test.ts) checks every value against the WASM `constants_json`.
// Units: 1 tick = 50 ms; distances in "sim units". The renderer scales sim units to world units.

export const RULES_VERSION = 9;

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
export const GIANT_SPEED = 36;
/** SPEC_V5 §3: the timing gate steps ×1 → ×TIMING_MAX, one step every TIMING_STEP_TICKS of the
 *  lane's phase clock (`timingValue(phaseTick)`). */
export const TIMING_STEP_TICKS = TICKS_PER_SEC;
export const TIMING_MAX = 5;

/** SPEC §7: one volley of VOLLEY_SIZE dude every FIRE_TICKS. */
export const FIRE_TICKS = 8;
export const VOLLEY_SIZE = 1;

/** Rules v7: 60 (the lane is ~35% shorter, so the walk to the tower stays ~5.5 s). */
export const CRUISE_SPEED = 60;
export const LAUNCH_TICKS = 6;
export const LAUNCH_SPEED = CRUISE_SPEED * 3;

/** x across the lane, y from the cannon line (0) to the base edge (rules v7: shorter lane). */
export const LANE_WIDTH = 3_000;
export const LANE_LENGTH = 8_200;
/** Towers sit on this line; a Rush cohort loots when it reaches VAULT_Y (the town hall spans
 *  the whole base). */
export const TOWER_Y = 7_200;
export const VAULT_Y = TOWER_Y;
/** Past the last gate row, Rush cohorts steer toward the town hall's centre. */
export const HALL_X = LANE_WIDTH / 2;
export const TOWER_HALF_W = 300;
/** A cohort this far outside a gate's (or crate's) edge still goes through it. */
export const GATE_GRACE = 100;
export const CLASH_REACH = 400;
export const CLASH_BAND = 400;
/** Past the last gate row, a cohort steers at most STEER_STEP a tick toward an enemy it engages. */
export const STEER_STEP = 40;
/** Rules v9: a cohort engages an enemy only when it is ahead by at most ENGAGE_Y and at most
 *  ENGAGE_X sideways (`homing`); otherwise it walks straight. */
export const ENGAGE_Y = 1_200;
export const ENGAGE_X = 900;
/** Rules v9 late turn (`turnDue`): toward a tower (the hall's centre in the Rush) a cohort walks
 *  straight until `TOWER_Y − y ≤ |dx| · CRUISE_SPEED / TOWER_STEER + TURN_MARGIN`, then steers
 *  TOWER_STEER a tick. */
export const TOWER_STEER = 60;
export const TURN_MARGIN = 250;
/** The cannon chases the aim by at most this per tick. */
export const CANNON_STEP = LANE_WIDTH / 5;
/** Rules v7 divider walls (`StageDef.walls`): a wall's centre line is `x`, it is `2 · WALL_HALF`
 *  thick and it stands for y in [y0, y1]. While a cohort (yours or an enemy) is inside a wall's
 *  span it never crosses it, one entering the span inside the wall is pushed to the nearer side
 *  (ties left), and nothing clashes through a standing wall. Below y0 (the cannon, fresh volleys)
 *  and past y1 the lane is open. */
export const WALL_HALF = 60;
/** Rules v8 solid obstacles (`StageDef.obstacles`): a crowd's centre this close to one is inside
 *  it (`insideObstacle(o, x, y, OBSTACLE_GRACE)`). Crowds never move into an obstacle: a blocked
 *  crowd does not advance that tick and slides sideways by at most SLIDE_STEP toward a free side
 *  (rects: the nearer reachable one, ties left; wedges: their open side). */
export const OBSTACLE_GRACE = 60;
export const SLIDE_STEP = 150;

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
export const DEFEND_Y = 2_000;

/** SPEC_V5 §7: fee = 5% of the money moved. */
export const FEE_BPS = 500;

/** Layout limits (fixed-size state): rows, gates, towers and crates per stage. */
export const ROWS_MAX = 4;
export const GATES_MAX = 8;
export const TOWERS_MAX = 2;
export const CRATES_MAX = 2;

/** SPEC_V5 §3 normal `?` odds: [op byte, percent]; ±N is written +0 (64) / −0 (192), with N =
 *  PM_BY_ROW[row]. Rules v7: row index 0 is always good (it draws from the × entries only).
 *  Rules v8: ±N is [0, 1, 1, 2]. */
export const NORMAL_ODDS = [[2, 30], [3, 20], [4, 8], [5, 2], [64, 12], [130, 14], [192, 12], [131, 2]];
export const PM_BY_ROW = [0, 1, 1, 2];
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

/** Rules v7 divider wall on a column boundary: centre line `x`, `2 · WALL_HALF` thick, standing
 *  for y in [y0, y1]. */
export interface WallDef {
  x: number;
  y0: number;
  y1: number;
}

/** Rules v8: the shape of an obstacle inside its box. A wedge is the right triangle with its right
 *  angle at the named corner (B = low y, the cannon side; T = high y; L = x0; R = x1); its open
 *  side faces away from that corner (+x for the L wedges, −x for the R ones). */
export type ObstacleShape = 'rect' | 'wedgeBL' | 'wedgeBR' | 'wedgeTL' | 'wedgeTR';

/** Rules v8 solid obstacle in the box x0 < x1, y0 < y1 (blocks, comb arms, pillars, wedges). */
export interface ObstacleDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shape: ObstacleShape;
}

/** Rules v8 speed pad: each tick a cohort's centre is on it (edges included) its launch boost
 *  starts again (LAUNCH_SPEED for LAUNCH_TICKS). Enemies ignore it. */
export interface PadDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Rules v8 pipe: a cohort whose centre enters the box pops out at (outX, outY) with a fresh launch
 *  boost, past every gate row at or below outY (a `pipe` MatchEvent). Enemies ignore it. */
export interface PipeDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  outX: number;
  outY: number;
}

export interface StageDef {
  towers: TowerDef[];
  /** Gate row y, ascending. */
  rows: number[];
  /** Gate slots (Scout names these), sorted by row then x. */
  gates: GateDef[];
  /** Breakable blocks: they lock a big gate when just below it (`crateOfGate`), or stand alone. */
  crates: CrateDef[];
  /** Rules v7: divider walls, sorted by x (`[]` if none). */
  walls: WallDef[];
  /** Rules v8: solid obstacles (`[]` if none). */
  obstacles: ObstacleDef[];
  /** Rules v8: speed pads (`[]` if none). */
  pads: PadDef[];
  /** Rules v8: pipes (`[]` if none); a `pipe` event names one by index. */
  pipes: PipeDef[];
}

export interface LayoutDef {
  name: string;
  /** Fight 1, Fight 2 (STAGES); the Rush happens in Fight 2's lane. */
  stages: StageDef[];
}

/** `LAYOUTS[id]`, id = seed % LAYOUTS.length (MatchView.layout). */
export const LAYOUTS: readonly LayoutDef[] = [
  {
    name: 'Three Lanes',
    stages: [
      {
        towers: [{ x: 1500, hp: 411, waveBase: 6 }],
        rows: [1000, 3400],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 1, x: 2500, width: 880, big: false, timing: true, xMin: 2500, xMax: 2500, speed: 0 },
        ],
        crates: [
          { x: 1500, width: 880, y: 2600, hp: 20 },
        ],
        walls: [
          { x: 1000, y0: 600, y1: 4400 },
          { x: 2000, y0: 600, y1: 4400 },
        ],
        obstacles: [],
        pads: [],
        pipes: [],
      },
      {
        towers: [{ x: 500, hp: 400, waveBase: 5 }, { x: 2500, hp: 400, waveBase: 5 }],
        rows: [1000, 3400],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 1, x: 1500, width: 880, big: true, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 1, x: 2500, width: 880, big: false, timing: true, xMin: 2500, xMax: 2500, speed: 0 },
        ],
        crates: [
          { x: 1500, width: 880, y: 3100, hp: 30 },
        ],
        walls: [
          { x: 1000, y0: 600, y1: 4400 },
          { x: 2000, y0: 600, y1: 4400 },
        ],
        obstacles: [],
        pads: [],
        pipes: [],
      },
    ],
  },
  {
    name: 'Funnel',
    stages: [
      {
        towers: [{ x: 1500, hp: 372, waveBase: 13 }],
        rows: [1000, 4100],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 1500, width: 880, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [],
        walls: [],
        obstacles: [
          { x0: 0, y0: 1900, x1: 1000, y1: 3500, shape: 'wedgeTL' },
          { x0: 2000, y0: 1900, x1: 3000, y1: 3500, shape: 'wedgeTR' },
        ],
        pads: [],
        pipes: [],
      },
      {
        towers: [{ x: 500, hp: 372, waveBase: 5 }, { x: 2500, hp: 372, waveBase: 5 }],
        rows: [1000, 4400],
        gates: [
          { row: 0, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 0, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: true, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [],
        walls: [],
        obstacles: [
          { x0: 800, y0: 2200, x1: 1500, y1: 3000, shape: 'wedgeTR' },
          { x0: 1500, y0: 2200, x1: 2200, y1: 3000, shape: 'wedgeTL' },
          { x0: 800, y0: 3000, x1: 1500, y1: 3800, shape: 'wedgeBR' },
          { x0: 1500, y0: 3000, x1: 2200, y1: 3800, shape: 'wedgeBL' },
        ],
        pads: [],
        pipes: [],
      },
    ],
  },
  {
    name: 'Speed Comb',
    stages: [
      {
        towers: [{ x: 750, hp: 273, waveBase: 10 }],
        rows: [1000, 2700, 4500],
        gates: [
          { row: 0, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 0, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
          { row: 2, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 2, x: 2250, width: 1380, big: false, timing: true, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [
          { x: 2250, width: 700, y: 2000, hp: 15 },
        ],
        walls: [
          { x: 1500, y0: 600, y1: 4800 },
        ],
        obstacles: [
          { x0: 0, y0: 1600, x1: 850, y1: 1720, shape: 'rect' },
          { x0: 600, y0: 2300, x1: 1440, y1: 2420, shape: 'rect' },
          { x0: 0, y0: 3000, x1: 850, y1: 3120, shape: 'rect' },
          { x0: 600, y0: 3700, x1: 1440, y1: 3820, shape: 'rect' },
        ],
        pads: [
          { x0: 900, y0: 1850, x1: 1440, y1: 2150 },
          { x0: 0, y0: 2550, x1: 560, y1: 2850 },
          { x0: 900, y0: 3250, x1: 1440, y1: 3550 },
        ],
        pipes: [],
      },
      {
        towers: [{ x: 750, hp: 250, waveBase: 5 }, { x: 2250, hp: 250, waveBase: 5 }],
        rows: [1000, 2700, 4500],
        gates: [
          { row: 0, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 0, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 2, x: 750, width: 1380, big: false, timing: true, xMin: 750, xMax: 750, speed: 0 },
          { row: 2, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [
          { x: 750, width: 700, y: 2000, hp: 15 },
        ],
        walls: [
          { x: 1500, y0: 600, y1: 4800 },
        ],
        obstacles: [
          { x0: 2150, y0: 1600, x1: 3000, y1: 1720, shape: 'rect' },
          { x0: 1560, y0: 2300, x1: 2400, y1: 2420, shape: 'rect' },
          { x0: 2150, y0: 3000, x1: 3000, y1: 3120, shape: 'rect' },
          { x0: 1560, y0: 3700, x1: 2400, y1: 3820, shape: 'rect' },
        ],
        pads: [
          { x0: 1560, y0: 1850, x1: 2100, y1: 2150 },
          { x0: 2440, y0: 2550, x1: 3000, y1: 2850 },
          { x0: 1560, y0: 3250, x1: 2100, y1: 3550 },
        ],
        pipes: [],
      },
    ],
  },
  {
    name: 'Pipes',
    stages: [
      {
        towers: [{ x: 1500, hp: 407, waveBase: 26 }],
        rows: [1000, 2600, 4000],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 2, x: 1500, width: 880, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [
          { x: 500, width: 880, y: 1500, hp: 10 },
          { x: 2500, width: 880, y: 1500, hp: 10 },
        ],
        walls: [
          { x: 1000, y0: 600, y1: 5200 },
          { x: 2000, y0: 600, y1: 5200 },
        ],
        obstacles: [],
        pads: [],
        pipes: [
          { x0: 0, y0: 3000, x1: 939, y1: 3400, outX: 500, outY: 5600 },
          { x0: 2061, y0: 3000, x1: 2999, y1: 3400, outX: 2500, outY: 5600 },
        ],
      },
      {
        towers: [{ x: 1200, hp: 330, waveBase: 14 }, { x: 1800, hp: 330, waveBase: 14 }],
        rows: [1000, 2600, 4000],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 2, x: 1500, width: 880, big: false, timing: true, xMin: 1500, xMax: 1500, speed: 0 },
        ],
        crates: [
          { x: 500, width: 880, y: 1500, hp: 10 },
          { x: 2500, width: 880, y: 1500, hp: 10 },
        ],
        walls: [
          { x: 1000, y0: 600, y1: 5200 },
          { x: 2000, y0: 600, y1: 5200 },
        ],
        obstacles: [],
        pads: [],
        pipes: [
          { x0: 0, y0: 3000, x1: 939, y1: 3400, outX: 500, outY: 5600 },
          { x0: 2061, y0: 3000, x1: 2999, y1: 3400, outX: 2500, outY: 5600 },
        ],
      },
    ],
  },
  {
    name: 'Pillars',
    stages: [
      {
        towers: [{ x: 1500, hp: 403, waveBase: 7 }],
        rows: [1000, 4400],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: true, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [],
        walls: [],
        obstacles: [
          { x0: 220, y0: 1900, x1: 480, y1: 2160, shape: 'rect' },
          { x0: 920, y0: 1900, x1: 1180, y1: 2160, shape: 'rect' },
          { x0: 1620, y0: 1900, x1: 1880, y1: 2160, shape: 'rect' },
          { x0: 2320, y0: 1900, x1: 2580, y1: 2160, shape: 'rect' },
          { x0: 570, y0: 2500, x1: 830, y1: 2760, shape: 'rect' },
          { x0: 1270, y0: 2500, x1: 1530, y1: 2760, shape: 'rect' },
          { x0: 1970, y0: 2500, x1: 2230, y1: 2760, shape: 'rect' },
          { x0: 2670, y0: 2500, x1: 2930, y1: 2760, shape: 'rect' },
          { x0: 220, y0: 3100, x1: 480, y1: 3360, shape: 'rect' },
          { x0: 920, y0: 3100, x1: 1180, y1: 3360, shape: 'rect' },
          { x0: 1620, y0: 3100, x1: 1880, y1: 3360, shape: 'rect' },
          { x0: 2320, y0: 3100, x1: 2580, y1: 3360, shape: 'rect' },
          { x0: 570, y0: 3700, x1: 830, y1: 3960, shape: 'rect' },
          { x0: 1270, y0: 3700, x1: 1530, y1: 3960, shape: 'rect' },
          { x0: 1970, y0: 3700, x1: 2230, y1: 3960, shape: 'rect' },
          { x0: 2670, y0: 3700, x1: 2930, y1: 3960, shape: 'rect' },
        ],
        pads: [],
        pipes: [],
      },
      {
        towers: [{ x: 750, hp: 1119, waveBase: 4 }, { x: 2250, hp: 1119, waveBase: 4 }],
        rows: [1000, 4400],
        gates: [
          { row: 0, x: 500, width: 880, big: true, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: true, xMin: 750, xMax: 750, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [],
        walls: [],
        obstacles: [
          { x0: 220, y0: 1900, x1: 480, y1: 2160, shape: 'rect' },
          { x0: 920, y0: 1900, x1: 1180, y1: 2160, shape: 'rect' },
          { x0: 1620, y0: 1900, x1: 1880, y1: 2160, shape: 'rect' },
          { x0: 2320, y0: 1900, x1: 2580, y1: 2160, shape: 'rect' },
          { x0: 570, y0: 2500, x1: 830, y1: 2760, shape: 'rect' },
          { x0: 1270, y0: 2500, x1: 1530, y1: 2760, shape: 'rect' },
          { x0: 1970, y0: 2500, x1: 2230, y1: 2760, shape: 'rect' },
          { x0: 2670, y0: 2500, x1: 2930, y1: 2760, shape: 'rect' },
          { x0: 220, y0: 3100, x1: 480, y1: 3360, shape: 'rect' },
          { x0: 920, y0: 3100, x1: 1180, y1: 3360, shape: 'rect' },
          { x0: 1620, y0: 3100, x1: 1880, y1: 3360, shape: 'rect' },
          { x0: 2320, y0: 3100, x1: 2580, y1: 3360, shape: 'rect' },
          { x0: 570, y0: 3700, x1: 830, y1: 3960, shape: 'rect' },
          { x0: 1270, y0: 3700, x1: 1530, y1: 3960, shape: 'rect' },
          { x0: 1970, y0: 3700, x1: 2230, y1: 3960, shape: 'rect' },
          { x0: 2670, y0: 3700, x1: 2930, y1: 3960, shape: 'rect' },
        ],
        pads: [
          { x0: 0, y0: 1250, x1: 600, y1: 1650 },
          { x0: 2400, y0: 1250, x1: 3000, y1: 1650 },
        ],
        pipes: [],
      },
    ],
  },
  {
    name: 'Island',
    stages: [
      {
        towers: [{ x: 1500, hp: 218, waveBase: 12 }],
        rows: [1000, 4000],
        gates: [
          { row: 0, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 0, x: 2250, width: 1380, big: false, timing: false, xMin: 2250, xMax: 2250, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: true, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [
          { x: 2525, width: 700, y: 2700, hp: 15 },
        ],
        walls: [],
        obstacles: [
          { x0: 950, y0: 2100, x1: 2050, y1: 3400, shape: 'rect' },
        ],
        pads: [
          { x0: 100, y0: 2300, x1: 800, y1: 2900 },
        ],
        pipes: [],
      },
      {
        towers: [{ x: 750, hp: 423, waveBase: 6 }, { x: 2250, hp: 423, waveBase: 6 }],
        rows: [1000, 3800],
        gates: [
          { row: 0, x: 500, width: 880, big: false, timing: false, xMin: 500, xMax: 500, speed: 0 },
          { row: 0, x: 1500, width: 880, big: false, timing: false, xMin: 1500, xMax: 1500, speed: 0 },
          { row: 0, x: 2500, width: 880, big: false, timing: false, xMin: 2500, xMax: 2500, speed: 0 },
          { row: 1, x: 750, width: 1380, big: false, timing: false, xMin: 750, xMax: 750, speed: 0 },
          { row: 1, x: 2250, width: 1380, big: false, timing: true, xMin: 2250, xMax: 2250, speed: 0 },
        ],
        crates: [],
        walls: [],
        obstacles: [
          { x0: 0, y0: 5000, x1: 1100, y1: 6000, shape: 'wedgeTL' },
          { x0: 1900, y0: 5000, x1: 3000, y1: 6000, shape: 'wedgeTR' },
        ],
        pads: [
          { x0: 0, y0: 2600, x1: 600, y1: 3200 },
          { x0: 2400, y0: 2600, x1: 3000, y1: 3200 },
        ],
        pipes: [],
      },
    ],
  },
];
