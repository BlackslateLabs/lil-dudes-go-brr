//! Starting numbers (docs/SPEC.md v3 §12). Units: 1 tick = 50 ms; distances in "sim units".
//! Lane geometry must match the arena in apps/web (scale it, don't change the ratios alone).

/// Ticks per second (1 tick = 5 ER slots ≈ 50 ms).
pub const TICKS_PER_SEC: u32 = 20;
/// SPEC §3: the time cap, 3:00.
pub const MATCH_TICKS: u32 = 180 * TICKS_PER_SEC;

/// SPEC §3: Fight 1, Fight 2, Raid.
pub const STAGES: usize = 3;
/// The Raid is the last stage.
pub const RAID_STAGE: u8 = (STAGES - 1) as u8;

/// SPEC §3: stage phases.
pub const PLANT_TICKS: u32 = 3 * TICKS_PER_SEC;
pub const TRANSIT_TICKS: u32 = 2 * TICKS_PER_SEC;
/// SPEC §3: the raid fires for this long; dudes already on the way still count.
pub const RAID_TICKS: u32 = 8 * TICKS_PER_SEC;

/// SPEC §7: one volley every 8 ticks (0.4 s) of one dude.
pub const FIRE_TICKS: u32 = 8;
pub const VOLLEY_SIZE: u32 = 1;

/// SPEC §7: movement per tick (3× cruise for the first LAUNCH_TICKS ticks).
pub const CRUISE_SPEED: i32 = 80;
pub const LAUNCH_TICKS: u32 = 6;
pub const LAUNCH_SPEED: i32 = CRUISE_SPEED * 3;

/// SPEC §2: x across the lane, y from the cannon line (0) to the base edge.
pub const LANE_WIDTH: i32 = 3_000;
pub const LANE_LENGTH: i32 = 12_000;
/// SPEC §4: towers sit on this line.
pub const TOWER_Y: i32 = 11_000;
/// (impl) The vault spans the whole base: a raid cohort loots when it reaches this line.
pub const VAULT_Y: i32 = TOWER_Y;
pub const TOWER_HALF_W: i32 = 300;
/// SPEC §4: opposing cohorts meet within this x distance once crossed in y.
pub const CLASH_REACH: i32 = 400;
/// (impl) ...and only while they are at most this far past each other in y. Larger than the
/// fastest closing speed per tick (launch + cruise), so no crossing pair can skip the window.
pub const CLASH_BAND: i32 = 400;
/// SPEC §4: sideways homing per tick, and how far ahead (in y) units look for a target.
pub const STEER_STEP: i32 = 40;
pub const DETECT_Y: i32 = 4_000;
/// SPEC §2: the cannon chases the aim by at most this per tick (crosses the lane in 5 ticks).
pub const CANNON_STEP: i32 = LANE_WIDTH / 5;

/// SPEC §7: live cohorts of yours / enemy cohorts, per lane.
pub const COHORT_CAP: usize = 40;
pub const ENEMY_CAP: usize = 16;

/// SPEC §4: first wave 0.5 s into the fight, then the big → small → medium cycle.
pub const FIRST_WAVE_TICKS: u32 = 10;
pub const WAVE_GAPS: [u32; 3] = [130, 130, 80];
pub const WAVE_PCT: [u32; 3] = [115, 85, 100];
/// SPEC §4 fatigue: 1000‰ until FATIGUE_START, linear down to FATIGUE_MIN_PM at FATIGUE_END.
pub const FATIGUE_START: u32 = 15 * TICKS_PER_SEC;
pub const FATIGUE_END: u32 = 45 * TICKS_PER_SEC;
pub const FATIGUE_MIN_PM: u32 = 100;
/// SPEC §10: in the tutorial, side 0's Fight 1 waves are at this percent.
pub const TUTORIAL_WAVE_PCT: u32 = 50;

/// SPEC §5: gold.
pub const TOWER_BONUS: u32 = 50;
pub const LOOT_PER_UNIT: u32 = 2;

/// SPEC §10: the bot defends when an enemy cohort is this close to its cannon.
pub const DEFEND_Y: i32 = 3_000;

/// SPEC §8: fee = 5% of the money moved.
pub const FEE_BPS: u64 = 500;

/// Layout limits (fixed-size arrays in the state). SPEC §9: 1–3 gates per row.
pub const ROWS_MAX: usize = 4;
pub const GATES_MAX: usize = 8;
pub const TOWERS_MAX: usize = 2;
pub const CRATES_MAX: usize = 2;
/// SPEC §9: the MVP layout pool.
pub const LAYOUT_COUNT: usize = 6;

// Compile-time checks of the timeline and geometry the rules rely on.
const _: () = {
    assert!(MATCH_TICKS == 3_600);
    assert!(STAGES == 3);
    // A crossing pair always spends a tick inside the clash band.
    assert!(LAUNCH_SPEED + CRUISE_SPEED < CLASH_BAND);
    assert!(FATIGUE_START < FATIGUE_END);
    assert!(TOWER_Y < LANE_LENGTH && VAULT_Y <= TOWER_Y);
    // Positions fit the i16 fields.
    assert!(LANE_LENGTH + LAUNCH_SPEED < i16::MAX as i32);
    assert!(LANE_WIDTH < i16::MAX as i32);
    // One bit per slot in the u64 masks the rules use.
    assert!(COHORT_CAP <= 64 && ENEMY_CAP <= 64);
    // Phase timers fit u16.
    assert!(MATCH_TICKS < u16::MAX as u32);
};
