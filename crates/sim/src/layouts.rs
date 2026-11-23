//! The level pool (SPEC §9, SPEC_V5 §3b, the v6 feel pass). A layout is 2 stages: Fight 1 (one
//! tower) and Fight 2 (two towers, the town hall behind them, rushed on the same gates once they
//! fall). Each stage lists its towers, rows, gates and crates. Both players get identical copies;
//! the seed picks the layout (`layout_for(seed)`, public once seeded).
//!
//! Slots: a stage's gates in list order (sorted by row, then x). Scout (peek) names a slot. Hidden
//! slots (normal, big) are dealt from the seed; public slots are the timing gate, sliding hazards
//! (they wipe a cohort they touch) and turbo pads (they re-launch it). A crate either locks the big
//! gate just above it, or stands alone in the back half as a wall to chew through.
//!
//! Design rules (v6, from the genre's measured chunks): the first gate row at ~1,900, rows
//! 1,100–1,400 apart, the growth zone (hidden and timing gates) up front and walls / hazards /
//! turbo pads behind it; sparse rows with open lane between (at least `MIN_GAP`, at most two
//! thirds of the lane covered, edges included); everything inside `GATE_BAND`; 3–5 hidden gates and
//! exactly one timing gate per stage; at most 2 specials (wall, hazard, turbo row) per stage;
//! something moves in every layout; at most one crate-locked big gate per layout; an exposed big
//! gate sits early (row 1 or 2) and off-centre; the towers of a fight in different columns.
//! `tests::layouts_follow_the_design_rules` checks all of it, plus the limits the rules rely on.

use crate::constants::{GATE_GRACE, LAYOUT_COUNT, STAGES, TIMING_MAX, TIMING_STEP_TICKS};

/// What a gate slot can hold (SPEC §6, SPEC_V5 §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    /// Hidden: `deal::NORMAL_ODDS` (×2–×5, ÷2, ÷3, ±N from row 2).
    Normal,
    /// Hidden: ×6 30%, ×8 40%, ×10 30% (exposed early, or behind a crate).
    Big,
    /// Public: ×1 → ×5 by the player's gate clock (`timing_value`). One per stage.
    Timing,
    /// Public (v6): a sliding sweeper; a cohort crossing its row inside its span is wiped.
    Hazard,
    /// Public (v6): a turbo pad; a cohort crossing it is launched again (LAUNCH_SPEED for
    /// LAUNCH_TICKS).
    Turbo,
}

impl Slot {
    /// Face-down until passed, dealt from the seed, Scout-able.
    pub fn hidden(self) -> bool {
        matches!(self, Slot::Normal | Slot::Big)
    }
}

/// SPEC_V5 §3: the timing gate's value `t` ticks into the player's Fight (the gate clock, which
/// the Rush keeps counting): `1 + (t / TIMING_STEP_TICKS) % TIMING_MAX`.
pub fn timing_value(t: u32) -> u8 {
    let step = t.checked_div(TIMING_STEP_TICKS).unwrap_or(0);
    let v = step.checked_rem(TIMING_MAX).unwrap_or(0).saturating_add(1);
    u8::try_from(v).unwrap_or(1)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GateDef {
    /// Index into the stage's `rows`.
    pub row: u8,
    /// Centre x at the start of the phase.
    pub x: i16,
    /// Full width; a cohort passes the gate if `covers(cohort.x, gate.x, width)`.
    pub width: i16,
    pub slot: Slot,
    /// SPEC §6 moving gates: the centre slides between `x_min` and `x_max` (ping-pong) by
    /// `|speed|` per tick, starting toward +x if `speed > 0`. `speed == 0`: static.
    pub x_min: i16,
    pub x_max: i16,
    pub speed: i16,
}

impl GateDef {
    /// Centre x `t` ticks into the player's Fight (the Raid keeps the Fight's clock, SPEC §6). Pure, so the bot can
    /// predict it.
    pub fn x_at(&self, t: u32) -> i16 {
        let (lo, hi) = (i64::from(self.x_min), i64::from(self.x_max));
        let range = hi.saturating_sub(lo);
        if self.speed == 0 || range <= 0 {
            return self.x;
        }
        let period = range.saturating_mul(2);
        let off = i64::from(self.x).saturating_sub(lo).clamp(0, range);
        let start = if self.speed > 0 {
            off
        } else {
            period.saturating_sub(off)
        };
        let travel = i64::from(self.speed.unsigned_abs()).saturating_mul(i64::from(t));
        let u = start
            .saturating_add(travel)
            .checked_rem_euclid(period)
            .unwrap_or(0);
        let d = if u <= range {
            u
        } else {
            period.saturating_sub(u)
        };
        i16::try_from(lo.saturating_add(d)).unwrap_or(self.x)
    }

    pub fn moving(&self) -> bool {
        self.speed != 0 && self.x_max > self.x_min
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct CrateDef {
    pub x: i16,
    pub width: i16,
    pub y: i16,
    pub hp: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TowerDef {
    pub x: i16,
    pub hp: u16,
    /// SPEC §4: wave size before the cycle % and fatigue.
    pub wave_base: u16,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageDef {
    pub towers: &'static [TowerDef],
    /// Gate row y, ascending.
    pub rows: &'static [i16],
    /// Gate slots, sorted by row then x.
    pub gates: &'static [GateDef],
    pub crates: &'static [CrateDef],
}

impl StageDef {
    /// SPEC §6: the gate of `row` a cohort at `x` goes through, where `gate_x(slot, def)` is
    /// that gate's centre right now. Of the gates that cover `x` (edges count, see `covers`),
    /// the nearest centre wins, the lower slot on ties. `None` in a gap.
    pub fn gate_at(&self, row: u8, x: i32, gate_x: impl Fn(usize, &GateDef) -> i32) -> Option<u8> {
        let mut best: Option<(u32, u8)> = None;
        for (slot, def) in (0u8..).zip(self.gates) {
            if def.row != row {
                continue;
            }
            let centre = gate_x(usize::from(slot), def);
            let d = x.abs_diff(centre);
            if covers(x, centre, def.width) && best.is_none_or(|(bd, _)| d < bd) {
                best = Some((d, slot));
            }
        }
        best.map(|(_, slot)| slot)
    }
}

/// SPEC §6: `x` is inside a gate (or crate) of `width` centred on `centre`, edges included:
/// `|x − centre| · 2 ≤ width + 2 · GATE_GRACE`.
pub fn covers(x: i32, centre: i32, width: i16) -> bool {
    let reach = i32::from(width).saturating_add(GATE_GRACE.saturating_mul(2));
    x.abs_diff(centre).saturating_mul(2) <= reach.unsigned_abs()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub name: &'static str,
    pub stages: [StageDef; STAGES],
}

/// SPEC §9: `layout = seed % LAYOUTS`.
pub fn layout_for(seed: u64) -> u8 {
    seed.checked_rem(LAYOUT_COUNT as u64).unwrap_or(0) as u8
}

/// The layout with this id (an out-of-range id falls back to layout 0; never panics).
pub fn layout(id: u8) -> &'static Layout {
    LAYOUTS.get(usize::from(id)).unwrap_or(&LAYOUTS[0])
}

/// One stage of a layout (out of range → the final stage of that layout).
pub fn stage(layout_id: u8, stage: u8) -> &'static StageDef {
    let l = layout(layout_id);
    l.stages
        .get(usize::from(stage))
        .unwrap_or(&l.stages[STAGES - 1])
}

// --- authoring helpers ------------------------------------------------------------------------

/// Normal and timing gates are 600 wide (some layouts use 500 or 700), big gates 1,000 (impl).
const W: i16 = 600;
const BIG_W: i16 = 1_000;
/// A crate sits this far below the row of the gate it locks.
const CRATE_GAP: i16 = 300;
/// The least open lane between two gates of a row (edge to edge, over their whole sweep): the
/// GATE_GRACE of both edges plus 200 that no gate's edge reaches.
pub const MIN_GAP: i32 = 2 * GATE_GRACE + 200;
/// SPEC_V5 §3b PvP readability: every gate's span stays inside this band of the lane over its
/// whole sweep.
pub const GATE_BAND: (i32, i32) = (300, 2_700);

const fn gate(row: u8, x: i16) -> GateDef {
    GateDef {
        row,
        x,
        width: W,
        slot: Slot::Normal,
        x_min: x,
        x_max: x,
        speed: 0,
    }
}

const fn narrow(row: u8, x: i16, width: i16) -> GateDef {
    GateDef {
        width,
        ..gate(row, x)
    }
}

const fn big(row: u8, x: i16) -> GateDef {
    GateDef {
        width: BIG_W,
        slot: Slot::Big,
        ..gate(row, x)
    }
}

/// SPEC_V5 §3: the stage's timing gate (static: the cycling value is the skill).
const fn timing(row: u8, x: i16) -> GateDef {
    GateDef {
        slot: Slot::Timing,
        ..gate(row, x)
    }
}

const fn slide(row: u8, x: i16, x_min: i16, x_max: i16, speed: i16) -> GateDef {
    GateDef {
        x_min,
        x_max,
        speed,
        ..gate(row, x)
    }
}

/// The crate locking a big gate at `x` in the row at `row_y`.
const fn lock(x: i16, row_y: i16, hp: u16) -> CrateDef {
    CrateDef {
        x,
        width: BIG_W,
        y: row_y.saturating_sub(CRATE_GAP),
        hp,
    }
}

const fn tower(x: i16, hp: u16, wave_base: u16) -> TowerDef {
    TowerDef { x, hp, wave_base }
}

/// A sliding hazard of `width` sweeping `x_min..x_max` (v6).
const fn hazard(row: u8, x: i16, x_min: i16, x_max: i16, speed: i16, width: i16) -> GateDef {
    GateDef {
        slot: Slot::Hazard,
        width,
        ..slide(row, x, x_min, x_max, speed)
    }
}

/// A turbo pad (v6).
const fn turbo(row: u8, x: i16) -> GateDef {
    GateDef {
        slot: Slot::Turbo,
        ..gate(row, x)
    }
}

/// A free-standing wall in the back half (v6): a crate that locks nothing.
const fn wall(x: i16, width: i16, y: i16, hp: u16) -> CrateDef {
    CrateDef { x, width, y, hp }
}

/// v6: gate rows from ~1,900, ~1,300 apart; the back-half row for specials at 5,600–5,700.
const ROWS3: [i16; 3] = [1_900, 3_200, 4_500];
const ROWS4: [i16; 4] = [1_900, 3_200, 4_400, 5_600];
const ROWS4B: [i16; 4] = [1_900, 3_200, 4_500, 5_700];

/// Tower strength per layout: (Fight 1 HP, Fight 1 wave_base, Fight 2 HP per tower, Fight 2
/// wave_base). Tuned per layout with the balance runner so every layout plays about as long and
/// as dangerously as the others.
const TUNE: [(u16, u16, u16, u16); LAYOUT_COUNT] = [
    (906, 111, 497, 24),
    (1565, 335, 1312, 725),
    (855, 70, 1790, 226),
    (374, 47, 900, 33),
    (842, 59, 524, 31),
    (1108, 1147, 2086, 80),
];

// Compile-time only (inside the LAYOUTS initializer): a bad index is a build error.
#[allow(clippy::indexing_slicing)]
const fn f1(layout: usize, x: i16) -> TowerDef {
    tower(x, TUNE[layout].0, TUNE[layout].1)
}

#[allow(clippy::indexing_slicing)]
const fn f2(layout: usize, x: i16) -> TowerDef {
    tower(x, TUNE[layout].2, TUNE[layout].3)
}

pub const LAYOUTS: [Layout; LAYOUT_COUNT] = [
    // 0. Twin choice up front, the timing ring in the middle, turbo rails / a guarded jackpot
    //    and a sweeper at the back.
    Layout {
        name: "Twin Choice",
        stages: [
            StageDef {
                towers: &[f1(0, 1_500)],
                rows: &ROWS4B,
                gates: &[
                    gate(0, 900),
                    gate(0, 2_100),
                    timing(1, 1_500),
                    slide(2, 1_500, 900, 2_100, 25),
                    turbo(3, 800),
                    turbo(3, 2_200),
                ],
                crates: &[wall(1_500, 1_200, 6_300, 40)],
            },
            StageDef {
                towers: &[f2(0, 700), f2(0, 2_300)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 800),
                    gate(0, 2_200),
                    timing(1, 1_500),
                    gate(2, 800),
                    big(2, 2_100),
                    hazard(3, 1_500, 700, 2_300, 30, 800),
                ],
                crates: &[lock(2_100, 4_400, 30)],
            },
        ],
    },
    // 1. The jackpot is exposed on the right, with a sweeper patrolling the next row on that side.
    //    Fight 2: three lanes, then a back wall with a gap in the middle.
    Layout {
        name: "Sweeper Bait",
        stages: [
            StageDef {
                towers: &[f1(1, 1_500)],
                rows: &ROWS4B,
                gates: &[
                    gate(0, 900),
                    big(0, 2_200),
                    gate(1, 600),
                    hazard(1, 2_000, 1_600, 2_400, 35, 600),
                    timing(2, 1_500),
                    gate(3, 900),
                    gate(3, 2_100),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(1, 600), f2(1, 2_400)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 600),
                    big(0, 2_150),
                    timing(1, 1_500),
                    slide(2, 1_500, 1_000, 2_000, 30),
                ],
                crates: &[wall(800, 900, 5_400, 35), wall(2_200, 900, 5_400, 35)],
            },
        ],
    },
    // 2. A ladder up the left edge, turbo at the back. Fight 2: an exposed flank jackpot with a
    //    sweeper behind it.
    Layout {
        name: "Ladder",
        stages: [
            StageDef {
                towers: &[f1(2, 1_000)],
                rows: &ROWS4B,
                gates: &[
                    gate(0, 700),
                    gate(0, 2_100),
                    gate(1, 700),
                    timing(1, 2_100),
                    slide(2, 1_500, 1_000, 2_300, 30),
                    turbo(3, 700),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(2, 700), f2(2, 2_200)],
                rows: &ROWS4,
                gates: &[
                    big(0, 800),
                    gate(0, 2_200),
                    timing(1, 1_500),
                    gate(2, 1_000),
                    gate(2, 2_000),
                    hazard(3, 800, 600, 1_400, 25, 600),
                ],
                crates: &[],
            },
        ],
    },
    // 3. Three lanes and a centre gate, a wall at the back. Fight 2: a door row of three narrow
    //    gates after a sliding prize.
    Layout {
        name: "Three Lanes",
        stages: [
            StageDef {
                towers: &[f1(3, 2_300)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 600),
                    gate(0, 2_400),
                    gate(1, 1_500),
                    timing(2, 1_500),
                ],
                crates: &[wall(1_500, 1_000, 5_800, 30)],
            },
            StageDef {
                towers: &[f2(3, 600), f2(3, 2_400)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 1_500),
                    timing(1, 900),
                    slide(1, 2_150, 1_900, 2_400, 20),
                    narrow(2, 700, 400),
                    narrow(2, 1_500, 400),
                    narrow(2, 2_300, 400),
                ],
                crates: &[],
            },
        ],
    },
    // 4. A calm centre spine with walls on both flanks. Fight 2: twin gates, a guarded jackpot and
    //    a sweeper across the middle.
    Layout {
        name: "Spine",
        stages: [
            StageDef {
                towers: &[f1(4, 1_500)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 1_500),
                    timing(1, 1_500),
                    gate(2, 900),
                    gate(2, 2_100),
                ],
                crates: &[wall(700, 800, 6_300, 30), wall(2_300, 800, 6_300, 30)],
            },
            StageDef {
                towers: &[f2(4, 1_000), f2(4, 2_300)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 900),
                    gate(0, 2_100),
                    timing(1, 1_500),
                    gate(2, 800),
                    big(2, 2_100),
                    hazard(3, 1_500, 900, 2_100, 35, 600),
                ],
                crates: &[lock(2_100, 4_400, 30)],
            },
        ],
    },
    // 5. A flank jackpot and a big wall to break. Fight 2: the jackpot comes early beside the
    //    timing ring, then turbo rails into the towers.
    Layout {
        name: "Bonus Burst",
        stages: [
            StageDef {
                towers: &[f1(5, 1_500)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 800),
                    big(0, 2_200),
                    timing(1, 1_500),
                    slide(2, 1_500, 900, 2_100, 30),
                ],
                crates: &[wall(1_500, 1_600, 5_600, 40)],
            },
            StageDef {
                towers: &[f2(5, 800), f2(5, 2_200)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 800),
                    gate(0, 2_200),
                    timing(1, 800),
                    big(1, 2_200),
                    slide(2, 1_500, 1_000, 2_000, 40),
                    turbo(3, 1_000),
                    turbo(3, 2_000),
                ],
                crates: &[],
            },
        ],
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    fn span(x: i16, w: i16) -> (i32, i32) {
        (
            i32::from(x) - i32::from(w) / 2,
            i32::from(x) + i32::from(w) / 2,
        )
    }

    /// Every x a gate's span can cover over its sweep.
    fn sweep(g: &GateDef) -> (i32, i32) {
        let (lo, _) = span(g.x_min.min(g.x), g.width);
        let (_, hi) = span(g.x_max.max(g.x), g.width);
        (lo, hi)
    }

    #[test]
    fn layouts_follow_the_design_rules() {
        let mut names = std::collections::HashSet::new();
        for (id, l) in LAYOUTS.iter().enumerate() {
            assert!(names.insert(l.name), "duplicate name {}", l.name);
            let (mut moving, mut locked) = (0, 0);
            for (s, st) in l.stages.iter().enumerate() {
                let ctx = format!("layout {id} ({}) stage {s}", l.name);
                // Towers: 1 in Fight 1, 2 in Fight 2; different columns.
                assert_eq!(st.towers.len(), [1, 2][s], "{ctx}");
                for t in st.towers {
                    assert!(t.hp > 0 && t.wave_base > 0, "{ctx}");
                    assert!((300..=2_700).contains(&i32::from(t.x)), "{ctx}");
                }
                if let [a, b] = st.towers {
                    assert!((a.x - b.x).abs() >= 1_000, "{ctx}: towers too close");
                }
                // Rows: 3..=ROWS_MAX, the first ~1,900, 1,100–1,400 apart, all well before the
                // towers.
                assert!((3..=ROWS_MAX).contains(&st.rows.len()), "{ctx}");
                assert!((1_700..=2_100).contains(&st.rows[0]), "{ctx}");
                for w in st.rows.windows(2) {
                    assert!((1_100..=1_400).contains(&(w[1] - w[0])), "{ctx}");
                }
                let last = i32::from(*st.rows.last().unwrap());
                assert!(last <= TOWER_Y - 1_200, "{ctx}");
                // Slots: ≤ GATES_MAX, sorted, 3–5 hidden, exactly one timing gate.
                assert!(st.gates.len() <= GATES_MAX, "{ctx}");
                let timing = st.gates.iter().filter(|g| g.slot == Slot::Timing).count();
                assert_eq!(timing, 1, "{ctx}: one timing gate per stage");
                let hidden = st.gates.iter().filter(|g| g.slot.hidden()).count();
                assert!((3..=5).contains(&hidden), "{ctx}: {hidden} hidden gates");
                for w in st.gates.windows(2) {
                    assert!((w[0].row, w[0].x) < (w[1].row, w[1].x), "{ctx}: slot order");
                }
                // Growth zone first: no hidden or timing gate behind a turbo row; turbo pads
                // and walls sit in the back half.
                let growth_last = st
                    .gates
                    .iter()
                    .filter(|g| g.slot.hidden() || g.slot == Slot::Timing)
                    .map(|g| g.row)
                    .max()
                    .unwrap();
                for g in st.gates.iter().filter(|g| g.slot == Slot::Turbo) {
                    assert!(g.row > growth_last, "{ctx}: turbo pad inside the growth zone");
                    assert!(!g.moving(), "{ctx}");
                }
                // Specials: walls, hazards, turbo rows; at most 2 per stage.
                let walls = st
                    .crates
                    .iter()
                    .filter(|c| !st.gates.iter().any(|g| g.slot == Slot::Big && g.x == c.x))
                    .count();
                let hazards = st.gates.iter().filter(|g| g.slot == Slot::Hazard).count();
                let turbo_rows = st
                    .gates
                    .iter()
                    .filter(|g| g.slot == Slot::Turbo)
                    .map(|g| g.row)
                    .collect::<std::collections::HashSet<_>>()
                    .len();
                assert!(walls + hazards + turbo_rows <= 2, "{ctx}: too many specials");
                for row in 0..st.rows.len() as u8 {
                    let in_row: Vec<_> = st.gates.iter().filter(|g| g.row == row).collect();
                    assert!(in_row.len() <= 3, "{ctx} row {row}");
                    for (i, a) in in_row.iter().enumerate() {
                        for b in &in_row[i + 1..] {
                            let (a, b) = (sweep(a), sweep(b));
                            let gap = (b.0 - a.1).max(a.0 - b.1);
                            assert!(gap >= MIN_GAP, "{ctx} row {row}: gap {gap}");
                        }
                    }
                    let covered: i32 = in_row
                        .iter()
                        .map(|g| i32::from(g.width) + 2 * GATE_GRACE)
                        .sum();
                    assert!(
                        covered <= LANE_WIDTH * 2 / 3,
                        "{ctx} row {row}: no open lane"
                    );
                }
                for g in st.gates {
                    assert!(usize::from(g.row) < st.rows.len(), "{ctx}");
                    let (lo, hi) = sweep(g);
                    assert!(
                        lo >= GATE_BAND.0 && hi <= GATE_BAND.1,
                        "{ctx}: gate outside the band ({lo}..{hi})"
                    );
                    assert!(g.width >= 400, "{ctx}");
                    match g.slot {
                        Slot::Big => assert_eq!(g.width, BIG_W, "{ctx}"),
                        Slot::Timing | Slot::Turbo => assert_eq!(g.width, W, "{ctx}"),
                        Slot::Normal | Slot::Hazard => {}
                    }
                    if g.moving() {
                        moving += 1;
                        assert!(
                            matches!(g.slot, Slot::Normal | Slot::Hazard),
                            "{ctx}: only normal gates and hazards slide"
                        );
                        assert!(g.x_min <= g.x && g.x <= g.x_max, "{ctx}");
                        for t in 0..2_000 {
                            let x = g.x_at(t);
                            assert!(g.x_min <= x && x <= g.x_max, "{ctx}: t {t} x {x}");
                        }
                    } else {
                        assert_eq!((g.x_min, g.x_max), (g.x, g.x), "{ctx}");
                    }
                    let crated = st.crates.iter().any(|c| c.x == g.x);
                    if g.slot == Slot::Big && !crated {
                        assert!(g.row <= 1, "{ctx}: exposed big gate past row 2");
                        let off = (i32::from(g.x) - LANE_WIDTH / 2).abs();
                        assert!(off >= 500, "{ctx}: exposed big gate centred");
                    }
                }
                // Crates: ≤ CRATES_MAX; a lock sits just below its static big gate and covers
                // its span; a wall stands in the back half, past the growth zone.
                assert!(st.crates.len() <= CRATES_MAX, "{ctx}");
                for c in st.crates {
                    assert!(c.hp > 0 && c.width >= 400, "{ctx}");
                    let (lo, hi) = span(c.x, c.width);
                    assert!(lo >= GATE_BAND.0 && hi <= GATE_BAND.1, "{ctx}: crate outside");
                    match st.gates.iter().find(|g| g.x == c.x && g.slot == Slot::Big) {
                        Some(g) => {
                            assert!(!g.moving() && c.width >= g.width, "{ctx}");
                            assert_eq!(c.y, st.rows[usize::from(g.row)] - CRATE_GAP, "{ctx}");
                            locked += 1;
                        }
                        None => {
                            let growth_y = st.rows[usize::from(growth_last)];
                            assert!(c.y > growth_y + 500, "{ctx}: wall inside the growth zone");
                            assert!(i32::from(c.y) < TOWER_Y - 600, "{ctx}: wall at the towers");
                        }
                    }
                }
                // At most one line (crate or row) crossed per tick, even at launch speed.
                let mut lines: Vec<i32> = st.rows.iter().map(|&y| i32::from(y)).collect();
                lines.extend(st.crates.iter().map(|c| i32::from(c.y)));
                lines.sort();
                assert!(lines[0] > LAUNCH_SPEED, "{ctx}");
                for w in lines.windows(2) {
                    assert!(w[1] - w[0] > LAUNCH_SPEED, "{ctx}: lines too close");
                }
            }
            assert!(moving >= 1, "layout {id}: nothing moves");
            assert!(locked <= 1, "layout {id}: more than one crate-locked big gate");
        }
    }

    #[test]
    fn timing_gate_cycles_one_to_five_once_a_second() {
        // SPEC_V5 §3: value = 1 + (phase_ticks / 20) % 5.
        let v: Vec<u8> = (0..220).step_by(10).map(timing_value).collect();
        assert_eq!(
            v,
            [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 1, 1]
        );
        assert_eq!(timing_value(19), 1);
        assert_eq!(timing_value(99), 5);
        assert_eq!(timing_value(100), 1);
        assert!((1..=5).contains(&timing_value(u32::MAX)));
    }

    #[test]
    fn overlapping_gates_go_to_the_nearest_centre() {
        // SPEC §6: edges count (GATE_GRACE); where two gates cover x the nearest centre wins,
        // the lower slot on ties. Spans with the grace: 600..=1,400 and 1,300..=2,100.
        const GATES: [GateDef; 2] = [gate(0, 1_000), gate(0, 1_700)];
        let st = StageDef {
            towers: &[],
            rows: &[1_400],
            gates: &GATES,
            crates: &[],
        };
        let at = |x| st.gate_at(0, x, |_, g| i32::from(g.x));
        assert_eq!(GATE_GRACE, 100);
        assert_eq!(at(599), None);
        assert_eq!(at(600), Some(0));
        assert_eq!(at(1_340), Some(0));
        assert_eq!(at(1_350), Some(0));
        assert_eq!(at(1_360), Some(1));
        assert_eq!(at(2_100), Some(1));
        assert_eq!(at(2_101), None);
        assert_eq!(st.gate_at(1, 1_000, |_, g| i32::from(g.x)), None);
        // The centre can come from elsewhere (a sliding gate's x right now).
        assert_eq!(
            st.gate_at(0, 2_400, |slot, g| i32::from(g.x) + 500 * slot as i32),
            Some(1)
        );
        assert!(covers(1_000, 700, 400) && !covers(1_001, 700, 400));
    }

    #[test]
    fn layouts_differ() {
        for (i, a) in LAYOUTS.iter().enumerate() {
            for b in &LAYOUTS[i + 1..] {
                assert_ne!(a.stages, b.stages);
            }
        }
    }

    #[test]
    fn ping_pong_gate_moves_as_documented() {
        let g = slide(0, 1_500, 1_000, 2_000, 100);
        assert_eq!(g.x_at(0), 1_500);
        assert_eq!(g.x_at(5), 2_000);
        assert_eq!(g.x_at(6), 1_900);
        assert_eq!(g.x_at(15), 1_000);
        assert_eq!(g.x_at(20), 1_500);
        assert_eq!(g.x_at(25), 2_000);
        let back = slide(0, 1_500, 1_000, 2_000, -100);
        assert_eq!(back.x_at(1), 1_400);
        assert_eq!(back.x_at(5), 1_000);
        assert_eq!(back.x_at(10), 1_500);
        assert_eq!(gate(0, 700).x_at(12_345), 700);
        assert_eq!(g.x_at(u32::MAX), g.x_at(u32::MAX));
    }

    #[test]
    fn lookups_never_panic() {
        assert_eq!(layout(200).name, LAYOUTS[0].name);
        assert_eq!(stage(0, 9), &LAYOUTS[0].stages[STAGES - 1]);
        assert_eq!(layout_for(7), 1);
    }
}
