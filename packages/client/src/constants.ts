// Mirrors crates/sim/src/constants.rs. Change both together (CONTRACT log entry).
// Units: 1 tick = 50 ms; distances in "sim units". The renderer scales sim units to world units.

export const TICKS_PER_SEC = 20;
export const TICK_MS = 1000 / TICKS_PER_SEC;
export const MATCH_TICKS = 120 * TICKS_PER_SEC;

export const PLANT_STARTS = [0, 40 * TICKS_PER_SEC, 80 * TICKS_PER_SEC] as const;
export const PLANT_TICKS = 3 * TICKS_PER_SEC;
export const SURGE_TICK = 105 * TICKS_PER_SEC;

export const FIRE_TICKS = 8;
export const FIRE_TICKS_SURGE = 4;
export const VOLLEY_SIZE = 4;
export const COHORT_CAP = 40;

export const COLS = 3;
export const ROWS = 3;
export const COL_WIDTH = 1000;
export const LANE_WIDTH = COL_WIDTH * COLS;
export const LANE_LENGTH = 12000;
export const GATE_WIDTH = 750;
/** Gate rows, measured from the owner's cannon. */
export const ROW_Y = [1500, 2500, 3500] as const;
export const CLASH_START_Y = 3600;
export const CLASH_END_Y = 8400;

export const CRUISE_SPEED = 100;
export const LAUNCH_TICKS = 6;
export const LAUNCH_SPEED = CRUISE_SPEED * 3;
export const CANNON_STEP = LANE_WIDTH / 5;

export const HP_MAX = 2200;

/** Cell index 0..8 = row * COLS + col. Row 0 is nearest the owner's cannon. */
export const cellOf = (row: number, col: number) => row * COLS + col;
