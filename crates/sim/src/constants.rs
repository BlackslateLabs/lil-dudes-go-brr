//! Starting numbers (docs/MVP.md §6). Units: 1 tick = 50 ms; distances in "sim units".
//! Lane geometry must match the arena in apps/web (scale it, don't change the ratios alone).

/// Ticks per second (1 tick = 5 ER slots ≈ 50 ms).
pub const TICKS_PER_SEC: u32 = 20;
/// 2:00 match.
pub const MATCH_TICKS: u32 = 120 * TICKS_PER_SEC;

/// Plant windows (cannons hold fire) start at 0:00, 0:40, 1:20 and last 3 s.
pub const PLANT_STARTS: [u32; 3] = [0, 40 * TICKS_PER_SEC, 80 * TICKS_PER_SEC];
pub const PLANT_TICKS: u32 = 3 * TICKS_PER_SEC;
/// Surge from 1:45.
pub const SURGE_TICK: u32 = 105 * TICKS_PER_SEC;

/// One volley every 8 ticks (0.4 s); every 4 in Surge.
pub const FIRE_TICKS: u32 = 8;
pub const FIRE_TICKS_SURGE: u32 = 4;
/// Units per volley.
pub const VOLLEY_SIZE: u32 = 4;
/// Max live cohorts per side.
pub const COHORT_CAP: usize = 40;

/// Three phases, one deal each (SPEC §3).
pub const PHASES: usize = 3;

/// Lane: x in [0, LANE_WIDTH), y measured from a side's own cannon (0) to the enemy cannon.
pub const COLS: usize = 3;
pub const ROWS: usize = 3;
/// Gates per side. Cell = row * COLS + col; row 0 is nearest the owner's cannon.
pub const CELLS: usize = ROWS * COLS;
pub const COL_WIDTH: i32 = 1_000;
pub const LANE_WIDTH: i32 = COL_WIDTH * COLS as i32;
pub const LANE_LENGTH: i32 = 12_000;
/// Gate span inside its column (~75%); a cohort in the gap passes the row unchanged.
pub const GATE_WIDTH: i32 = 750;
/// Gate rows, near the owner's cannon.
pub const ROW_Y: [i32; ROWS] = [1_500, 2_500, 3_500];
/// Clash zone = middle ~40% of the lane, where the fronts normally meet (SPEC §2). Opposing
/// cohorts subtract wherever they meet (SPEC §6); these two are for drawing.
pub const CLASH_START_Y: i32 = 3_600;
pub const CLASH_END_Y: i32 = 8_400;
/// Opposing cohorts meet when they have reached each other in y and their x differ by at most
/// this (SPEC §6). Half a column: same-column streams collide, neighbouring columns pass.
pub const CLASH_REACH: i32 = COL_WIDTH / 2;

/// Movement per tick.
pub const CRUISE_SPEED: i32 = 100;
pub const LAUNCH_TICKS: u32 = 6;
pub const LAUNCH_SPEED: i32 = CRUISE_SPEED * 3;
/// Cannon x moves toward aim by at most this per tick (crosses the lane in ~5 ticks).
pub const CANNON_STEP: i32 = LANE_WIDTH / 5;

/// Cannon HP: placeholder until the balance runner tunes it (target ~25% KO).
pub const HP_MAX: u32 = 2_200;

/// Chance (percent) that an unrevealed, unrigged, non-gold gate shows its true colour (SPEC §4).
pub const HINT_PCT: u64 = 60;

/// Payout (SPEC §7): the loser pays at least FLOOR_PM per mille of the level, and the fee is
/// FEE_BPS of the money moved.
pub const FLOOR_PM: u64 = 500;
pub const FEE_BPS: u64 = 500;

// Compile-time checks of the timeline and geometry the rules rely on.
const _: () = {
    assert!(MATCH_TICKS == 2_400);
    assert!(PLANT_STARTS[2] + PLANT_TICKS < SURGE_TICK && SURGE_TICK < MATCH_TICKS);
    assert!(FIRE_TICKS_SURGE * 2 == FIRE_TICKS);
    // Surge keeps the volley cadence: phase 3's play start → Surge is a whole number of volleys.
    assert!((SURGE_TICK - PLANT_STARTS[2] - PLANT_TICKS) % FIRE_TICKS == 0);
    // Gate rows sit before the clash zone; gates fit their columns.
    assert!(ROW_Y[2] < CLASH_START_Y && CLASH_END_Y < LANE_LENGTH);
    assert!(GATE_WIDTH <= COL_WIDTH);
    // A cohort crosses at most one row per tick, so rows apply in order.
    assert!(LAUNCH_SPEED < ROW_Y[1] - ROW_Y[0] && LAUNCH_SPEED < ROW_Y[2] - ROW_Y[1]);
    // Positions fit the i16 cohort fields.
    assert!(LANE_LENGTH + LAUNCH_SPEED < i16::MAX as i32);
    assert!(LANE_WIDTH < i16::MAX as i32);
};
