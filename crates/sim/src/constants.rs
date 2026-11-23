//! Starting numbers (docs/SPEC.md v4 §12). Units: 1 tick = 50 ms; distances in "sim units".
//! Lane geometry must match the arena in apps/web (scale it, don't change the ratios alone).

/// Ticks per second (1 tick = 5 ER slots ≈ 50 ms).
pub const TICKS_PER_SEC: u32 = 20;
/// SPEC §3: the time cap, 3:00.
pub const MATCH_TICKS: u32 = 180 * TICKS_PER_SEC;

/// SPEC §3: Fight 1 (one tower) and Fight 2 (two towers, the town hall behind them).
pub const STAGES: usize = 2;
/// The last stage: when its towers fall, the town hall raid starts in place (SPEC §3).
pub const FINAL_STAGE: u8 = (STAGES - 1) as u8;

/// SPEC §3: stage phases.
pub const PLANT_TICKS: u32 = 3 * TICKS_PER_SEC;
pub const TRANSIT_TICKS: u32 = 2 * TICKS_PER_SEC;
/// SPEC_V5 §2: the Rush. Once the final stage's last tower falls (the breach) the cannon keeps
/// firing for this long and every dude that reaches the town hall scores; when it runs out,
/// dudes still on the lane do not count (Suparno, 23 Nov) and the player is done.
pub const RUSH_TICKS: u32 = 70;

/// SPEC_V5 §4: the Champion meter fills 1 per Fight tick; full at CHAMP_TICKS (8 s). A
/// Champion cohort starts at CHAMP_COUNT dudes and goes through gates like any cohort.
pub const CHAMP_TICKS: u32 = 8 * TICKS_PER_SEC;
pub const CHAMP_COUNT: u32 = 8;

/// SPEC_V5 §6: the player whose breach of a fight has the lower match tick scores this.
pub const FIRST_BONUS: u32 = 50;

/// SPEC_V5 §5: in the final stage, each tower's small wave (every third wave, k % 3 == 1)
/// comes with one giant enemy cohort of GIANT_COUNT that walks at GIANT_SPEED.
pub const GIANT_COUNT: u32 = 5;
pub const GIANT_SPEED: i32 = CRUISE_SPEED * 3 / 5;

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
/// (impl) The town hall (the old vault) spans the whole base: a raid cohort loots when it
/// reaches this line, anywhere across the lane.
pub const VAULT_Y: i32 = TOWER_Y;
/// SPEC §4: past the last gate row, raid cohorts steer toward the town hall's centre.
pub const HALL_X: i32 = LANE_WIDTH / 2;
pub const TOWER_HALF_W: i32 = 300;
/// SPEC §6: a cohort is a point in the sim but is drawn as a small crowd, and a gate has posts,
/// so a cohort this far outside a gate's (or a crate's) edge still goes through it.
pub const GATE_GRACE: i32 = 100;
/// SPEC_V5 §3: the timing gate's value steps ×1 → ×TIMING_MAX → ×1, one step every
/// TIMING_STEP_TICKS of the player's gate clock: `1 + (t / TIMING_STEP_TICKS) % TIMING_MAX`.
pub const TIMING_STEP_TICKS: u32 = TICKS_PER_SEC;
pub const TIMING_MAX: u32 = 5;
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
    assert!(STAGES == 2 && FINAL_STAGE == 1);
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
    // The Champion meter is a u8.
    assert!(CHAMP_TICKS <= u8::MAX as u32);
    assert!(GIANT_SPEED > 0 && GIANT_SPEED < CRUISE_SPEED);
};
