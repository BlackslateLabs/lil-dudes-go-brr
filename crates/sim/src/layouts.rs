//! The level pool (SPEC §9, re-tuned for SPEC_V5 §3b and rebuilt on columns for SPEC_V5 §12,
//! rules v7). A layout is 2 stages: Fight 1 (one tower) and Fight 2 (two towers, the town hall
//! behind them, rushed on the same gates once they fall). Each stage lists its towers, gate
//! rows, gates, crates and divider walls. Both players get identical copies; the seed picks the
//! layout (`layout_for(seed)`, public once seeded).
//!
//! Gate slots: a stage's gates in list order (sorted by row, then x). Scout (peek) names a slot.
//! A crate sits just below the big gate it locks and covers that gate's span; locked gates never
//! move. Design rules (SPEC_V5 §12): every stage is built on at most 3 columns, 3 (centres 500 /
//! 1,500 / 2,500) or 2 (750 / 2,250); a gate sits on a column centre and fills its column edge
//! to edge (`COL3_W` / `COL2_W`, the column minus a wall's thickness); every row has a gate in
//! every column but for at most one empty cell per stage, so the lane reads as 2 or 3 clear
//! tracks; 3 rows from ~1,000 or 4 from ~900, ~900-1,000 apart, all in the front half of the
//! lane; exactly one timing gate per stage; at most one crate-locked big gate per layout, and an
//! exposed big gate sits early (row 1 or 2) and off-centre; divider walls only on column
//! boundaries, from `WALL_Y0` to `WALL_TAIL` past the last row, in half the layouts; a sliding
//! gate (none today: a gate that fills its column has no room to slide) only without walls and
//! inside its own column; towers on column centres, a fight's two towers in different columns.
//! `tests::layouts_follow_the_design_rules` checks all of it, plus the limits the rules rely on.

use crate::constants::{
    GATE_GRACE, LANE_WIDTH, LAYOUT_COUNT, STAGES, TIMING_MAX, TIMING_STEP_TICKS, WALL_HALF,
};

/// What a gate slot can hold (SPEC §6, SPEC_V5 §3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    /// Hidden: `deal::NORMAL_ODDS` (×2–×5, ÷2, ÷3, ±N from row 2).
    Normal,
    /// Hidden: ×6 30%, ×8 40%, ×10 30% (exposed early, or behind a crate).
    Big,
    /// Public: ×1 → ×5 by the player's gate clock (`timing_value`). One per stage.
    Timing,
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

/// SPEC_V5 §12: a divider wall on a column boundary. Its centre line is `x`, it is
/// `2 · WALL_HALF` thick and it stands for y in `[y0, y1]` (below `y0` the cannon and fresh
/// volleys move freely across the whole lane).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct WallDef {
    pub x: i16,
    pub y0: i16,
    pub y1: i16,
}

impl WallDef {
    /// The wall stands at `y` (edges included).
    pub fn active(&self, y: i32) -> bool {
        i32::from(self.y0) <= y && y <= i32::from(self.y1)
    }

    /// The nearest x just left of the wall's thickness.
    pub fn left(&self) -> i32 {
        i32::from(self.x)
            .saturating_sub(WALL_HALF)
            .saturating_sub(1)
    }

    /// The nearest x just right of the wall's thickness.
    pub fn right(&self) -> i32 {
        i32::from(self.x)
            .saturating_add(WALL_HALF)
            .saturating_add(1)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageDef {
    pub towers: &'static [TowerDef],
    /// Gate row y, ascending.
    pub rows: &'static [i16],
    /// Gate slots, sorted by row then x.
    pub gates: &'static [GateDef],
    pub crates: &'static [CrateDef],
    /// SPEC_V5 §12 divider walls (none in half the layouts).
    pub walls: &'static [WallDef],
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

    /// SPEC_V5 §12 rule (b): a cohort at `x` inside the thickness of a wall standing at `y` is
    /// pushed out to the nearer side (ties go left). Otherwise `x` is unchanged.
    pub fn wall_push(&self, x: i32, y: i32) -> i32 {
        let mut x = x;
        for w in self.walls {
            if w.active(y) && x.abs_diff(i32::from(w.x)) <= WALL_HALF.unsigned_abs() {
                x = if x <= i32::from(w.x) {
                    w.left()
                } else {
                    w.right()
                };
            }
        }
        x
    }

    /// SPEC_V5 §12 rule (a): the x range of the column a cohort at `x` is in at `y`: between
    /// the nearest walls standing at `y` on either side (just outside their thickness), else the
    /// lane edges.
    pub fn column_at(&self, x: i32, y: i32) -> (i32, i32) {
        let (mut lo, mut hi) = (0, LANE_WIDTH.saturating_sub(1));
        for w in self.walls.iter().filter(|w| w.active(y)) {
            if i32::from(w.x) < x {
                lo = lo.max(w.right());
            } else {
                hi = hi.min(w.left());
            }
        }
        (lo, hi)
    }

    /// SPEC_V5 §12 rule (a): a sideways move from `from` to `to` at `y`, kept inside the column
    /// `from` is in (a standing wall is never crossed).
    pub fn wall_clamp(&self, from: i32, to: i32, y: i32) -> i32 {
        let (lo, hi) = self.column_at(from, y);
        to.max(lo).min(hi)
    }

    /// SPEC_V5 §12 rule (c): a wall standing at `y` lies strictly between `a` and `b`.
    pub fn wall_between(&self, a: i32, b: i32, y: i32) -> bool {
        let (lo, hi) = (a.min(b), a.max(b));
        self.walls
            .iter()
            .any(|w| w.active(y) && lo < i32::from(w.x) && i32::from(w.x) < hi)
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

/// SPEC_V5 §12 columns (at most 3): a 3-column stage has gate centres 500 / 1,500 / 2,500, a
/// 2-column stage 750 / 2,250. A gate fills its column edge to edge: its width is the column's
/// interior, the column minus a wall's thickness (so big gates are no wider, and a gate between
/// two walls touches both).
pub const COL3: [i16; 3] = [500, 1_500, 2_500];
pub const COL2: [i16; 2] = [750, 2_250];
pub const COL3_W: i16 = (LANE_WIDTH / 3 - 2 * WALL_HALF) as i16;
pub const COL2_W: i16 = (LANE_WIDTH / 2 - 2 * WALL_HALF) as i16;
/// Walls start past the cannon (so it moves freely across the lane) and end this far past the
/// last gate row.
pub const WALL_Y0: i16 = 500;
pub const WALL_TAIL: i16 = 700;
/// A crate sits this far below the row of the gate it locks.
const CRATE_GAP: i16 = 300;

/// The gate width of the column centred on `x` (2-column centres are 750 and 2,250).
const fn col_w(x: i16) -> i16 {
    if x == COL2[0] || x == COL2[1] {
        COL2_W
    } else {
        COL3_W
    }
}

const fn gate(row: u8, x: i16) -> GateDef {
    GateDef {
        row,
        x,
        width: col_w(x),
        slot: Slot::Normal,
        x_min: x,
        x_max: x,
        speed: 0,
    }
}

const fn big(row: u8, x: i16) -> GateDef {
    GateDef {
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

/// The crate locking a big gate at `x` in the row at `row_y` (as wide as the gate).
const fn lock(x: i16, row_y: i16, hp: u16) -> CrateDef {
    CrateDef {
        x,
        width: col_w(x),
        y: row_y.saturating_sub(CRATE_GAP),
        hp,
    }
}

/// A divider wall on the column boundary `x`, standing until WALL_TAIL past `last_row`.
const fn wall(x: i16, last_row: i16) -> WallDef {
    WallDef {
        x,
        y0: WALL_Y0,
        y1: last_row.saturating_add(WALL_TAIL),
    }
}

const fn tower(x: i16, hp: u16, wave_base: u16) -> TowerDef {
    TowerDef { x, hp, wave_base }
}

/// SPEC_V5 §12 rows, front-loaded: 3 rows ~1,000 apart (3 columns: 8 of the 9 cells hold a
/// gate) or 4 rows ~900 apart (2 columns); the back half of the lane is the clash zone.
const R3: [i16; 3] = [1_000, 2_000, 3_000];
const R4: [i16; 4] = [900, 1_800, 2_700, 3_600];
/// Walls between all three columns, or down the middle of two.
const WALLS3_R3: [WallDef; 2] = [wall(1_000, 3_000), wall(2_000, 3_000)];
const WALL2_R4: [WallDef; 1] = [wall(1_500, 3_600)];

/// Tower strength per layout: (Fight 1 HP, Fight 1 wave_base, Fight 2 HP per tower, Fight 2
/// wave_base). Tuned per layout with `cargo run -p lil-dudes-sim --example balance --release`
/// (driven by `tools/balance/tune_layouts.py`) so every layout plays about as long and as
/// dangerously as the others.
const TUNE: [(u16, u16, u16, u16); LAYOUT_COUNT] = [
    (968, 21, 746, 6),
    (1016, 22, 573, 9),
    (615, 13, 1039, 4),
    (1745, 32, 670, 10),
    (1634, 16, 405, 3),
    (554, 9, 853, 8),
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
    // 0. Twin Lanes (open): Fight 1 is two full lanes of hidden gates, the timing ring on the
    //    right; Fight 2 three columns with a locked jackpot in the middle.
    Layout {
        name: "Twin Lanes",
        stages: [
            StageDef {
                towers: &[f1(0, 2_250)],
                rows: &R4,
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    gate(1, 750),
                    timing(1, 2_250),
                    gate(2, 750),
                    gate(2, 2_250),
                    gate(3, 750),
                    gate(3, 2_250),
                ],
                crates: &[],
                walls: &[],
            },
            StageDef {
                towers: &[f2(0, 500), f2(0, 2_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    big(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 500),
                    timing(2, 1_500),
                ],
                crates: &[lock(1_500, 2_000, 30)],
                walls: &[],
            },
        ],
    },
    // 1. Three Ways (open): three columns in both fights; Fight 1 opens with an exposed big gate
    //    on the left, far from the tower; the timing ring moves column between the fights.
    Layout {
        name: "Three Ways",
        stages: [
            StageDef {
                towers: &[f1(1, 2_500)],
                rows: &R3,
                gates: &[
                    big(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    gate(1, 1_500),
                    timing(1, 2_500),
                    gate(2, 500),
                    gate(2, 2_500),
                ],
                crates: &[],
                walls: &[],
            },
            StageDef {
                towers: &[f2(1, 500), f2(1, 1_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    timing(1, 500),
                    gate(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 1_500),
                    gate(2, 2_500),
                ],
                crates: &[],
                walls: &[],
            },
        ],
    },
    // 2. Long Shot (walled): Fight 1 has three walled columns, the right one opening on a locked
    //    big gate (the gamble, away from the tower); Fight 2 is two walled lanes.
    Layout {
        name: "Long Shot",
        stages: [
            StageDef {
                towers: &[f1(2, 500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    big(0, 2_500),
                    gate(1, 500),
                    gate(1, 1_500),
                    gate(1, 2_500),
                    timing(2, 500),
                    gate(2, 2_500),
                ],
                crates: &[lock(2_500, 1_000, 20)],
                walls: &WALLS3_R3,
            },
            StageDef {
                towers: &[f2(2, 750), f2(2, 2_250)],
                rows: &R4,
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    gate(1, 750),
                    gate(1, 2_250),
                    timing(2, 750),
                    gate(2, 2_250),
                    gate(3, 750),
                    gate(3, 2_250),
                ],
                crates: &[],
                walls: &WALL2_R4,
            },
        ],
    },
    // 3. Funnel (open): Fight 1's middle column holds the timing ring and then a locked jackpot;
    //    Fight 2 is two short open lanes, the towers on the flanks.
    Layout {
        name: "Funnel",
        stages: [
            StageDef {
                towers: &[f1(3, 2_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    timing(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 500),
                    big(2, 1_500),
                ],
                crates: &[lock(1_500, 3_000, 40)],
                walls: &[],
            },
            StageDef {
                towers: &[f2(3, 750), f2(3, 2_250)],
                rows: &R3,
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    timing(1, 750),
                    gate(1, 2_250),
                    gate(2, 750),
                    gate(2, 2_250),
                ],
                crates: &[],
                walls: &[],
            },
        ],
    },
    // 4. Zigzag (walled): Fight 1 is two walled lanes, the left one opening on an exposed big
    //    gate and then a gap; Fight 2 three walled columns, the middle one starting open and
    //    then locked behind a crate.
    Layout {
        name: "Zigzag",
        stages: [
            StageDef {
                towers: &[f1(4, 750)],
                rows: &R4,
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    big(1, 750),
                    gate(1, 2_250),
                    gate(2, 2_250),
                    gate(3, 750),
                    timing(3, 2_250),
                ],
                crates: &[],
                walls: &WALL2_R4,
            },
            StageDef {
                towers: &[f2(4, 500), f2(4, 2_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 2_500),
                    gate(1, 500),
                    big(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 500),
                    timing(2, 1_500),
                    gate(2, 2_500),
                ],
                crates: &[lock(1_500, 2_000, 30)],
                walls: &WALLS3_R3,
            },
        ],
    },
    // 5. Pillars (walled): Fight 1 has three walled columns, the tower in the middle; in Fight 2
    //    a single wall splits off the right column, which opens on an exposed big gate.
    Layout {
        name: "Pillars",
        stages: [
            StageDef {
                towers: &[f1(5, 1_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    timing(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 500),
                    gate(2, 2_500),
                ],
                crates: &[],
                walls: &WALLS3_R3,
            },
            StageDef {
                towers: &[f2(5, 1_500), f2(5, 2_500)],
                rows: &R3,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    big(0, 2_500),
                    gate(1, 500),
                    timing(1, 1_500),
                    gate(1, 2_500),
                    gate(2, 500),
                    gate(2, 1_500),
                ],
                crates: &[],
                walls: &[wall(2_000, 3_000)],
            },
        ],
    },
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::*;

    /// A sliding gate (none of the layouts has one today: a gate that fills its column has no
    /// room to slide inside it).
    const fn slide(row: u8, x: i16, x_min: i16, x_max: i16, speed: i16) -> GateDef {
        GateDef {
            x_min,
            x_max,
            speed,
            ..gate(row, x)
        }
    }

    /// The stage's columns: (centres, gate width), from its gates' widths (all equal).
    fn columns(st: &StageDef, ctx: &str) -> (&'static [i16], i16) {
        let w = st.gates[0].width;
        assert!(
            st.gates.iter().all(|g| g.width == w),
            "{ctx}: one column width per stage"
        );
        match w {
            COL3_W => (&COL3, COL3_W),
            COL2_W => (&COL2, COL2_W),
            _ => panic!("{ctx}: gate width {w} is not a column width"),
        }
    }

    #[test]
    fn layouts_follow_the_design_rules() {
        let mut names = std::collections::HashSet::new();
        let mut walled_layouts = 0;
        for (id, l) in LAYOUTS.iter().enumerate() {
            assert!(names.insert(l.name), "duplicate name {}", l.name);
            let walled = l.stages.iter().any(|st| !st.walls.is_empty());
            walled_layouts += usize::from(walled);
            let mut locked = 0;
            for (s, st) in l.stages.iter().enumerate() {
                let ctx = format!("layout {id} ({}) stage {s}", l.name);
                let (centres, col_w) = columns(st, &ctx);
                // At most 3 columns, each `pitch` wide with its centre in the middle; a gate
                // fills its column edge to edge: at least the column's interior (the column
                // minus a wall's thickness), and no wider than the column.
                assert!((2..=3).contains(&centres.len()), "{ctx}: 2 or 3 columns");
                let pitch = LANE_WIDTH / centres.len() as i32;
                for (k, &c) in centres.iter().enumerate() {
                    assert_eq!(i32::from(c), pitch * k as i32 + pitch / 2, "{ctx}");
                }
                let interior = pitch - 2 * WALL_HALF;
                assert!(
                    i32::from(col_w) >= interior && i32::from(col_w) <= pitch,
                    "{ctx}: gates don't fill their column"
                );
                let on_centre = |x: i16| centres.contains(&x);
                let column_of = |x: i32| (x / pitch).clamp(0, centres.len() as i32 - 1);

                // Towers: 1 in Fight 1, 2 in Fight 2; on column centres, in different columns.
                assert_eq!(st.towers.len(), [1, 2][s], "{ctx}");
                for t in st.towers {
                    assert!(t.hp > 0 && t.wave_base > 0, "{ctx}");
                    assert!(on_centre(t.x), "{ctx}: tower off a column centre");
                }
                if let [a, b] = st.towers {
                    assert_ne!(a.x, b.x, "{ctx}: towers in one column");
                }

                // Rows, front-loaded: 3 from ~1,000 or 4 from ~900, 800–1,100 apart, the last in
                // the front half of the lane (the back half is the clash zone).
                assert!((3..=ROWS_MAX).contains(&st.rows.len()), "{ctx}");
                assert!((800..=1_100).contains(&st.rows[0]), "{ctx}");
                for w in st.rows.windows(2) {
                    assert!((800..=1_100).contains(&(w[1] - w[0])), "{ctx}");
                }
                let last = i32::from(*st.rows.last().unwrap());
                assert!(last <= TOWER_Y / 2, "{ctx}: rows not front-loaded");

                // Gates: ≤ GATES_MAX, sorted by row then x, exactly one timing gate, the rest
                // hidden.
                assert!(st.gates.len() <= GATES_MAX, "{ctx}");
                let timing = st.gates.iter().filter(|g| g.slot == Slot::Timing).count();
                assert_eq!(timing, 1, "{ctx}: one timing gate per stage");
                assert!(st.gates.len() - timing >= 4, "{ctx}: too few hidden gates");
                for w in st.gates.windows(2) {
                    assert!((w[0].row, w[0].x) < (w[1].row, w[1].x), "{ctx}: slot order");
                }
                for g in st.gates {
                    assert!(usize::from(g.row) < st.rows.len(), "{ctx}");
                    assert!(
                        g.slot == Slot::Normal || !g.moving(),
                        "{ctx}: only normal gates slide"
                    );
                    // Every x the gate's span covers over its sweep stays inside one column (a
                    // slider only slides inside its own column, never across a boundary).
                    let half = i32::from(g.width) / 2;
                    let (lo, hi) = (i32::from(g.x_min) - half, i32::from(g.x_max) + half);
                    let col = column_of(i32::from(g.x));
                    let (col_lo, col_hi) = (col * pitch, (col + 1) * pitch);
                    assert!(
                        col_lo <= lo && hi <= col_hi,
                        "{ctx}: gate at {} leaves its column ({lo}..{hi})",
                        g.x
                    );
                    if g.moving() {
                        // Sliders: only without walls.
                        assert!(!walled, "{ctx}: a sliding gate in a walled layout");
                        assert!(g.x_min <= g.x && g.x <= g.x_max, "{ctx}");
                        for t in 0..2_000 {
                            let x = g.x_at(t);
                            assert!(g.x_min <= x && x <= g.x_max, "{ctx}: t {t} x {x}");
                        }
                    } else {
                        // A static gate sits on its column's centre.
                        assert_eq!((g.x_min, g.x_max), (g.x, g.x), "{ctx}");
                        assert!(on_centre(g.x), "{ctx}: gate at {} off its column", g.x);
                    }
                    // SPEC_V5 §3b: an exposed big gate sits early and off-centre.
                    let crated = st.crates.iter().any(|c| c.x == g.x);
                    if g.slot == Slot::Big && !crated {
                        assert!(g.row <= 1, "{ctx}: exposed big gate past row 2");
                        assert_ne!(i32::from(g.x), LANE_WIDTH / 2, "{ctx}: exposed big centred");
                    }
                }
                // Full rows: at most one gate per column per row, and at most one empty cell
                // (row × column) in the whole stage, so it reads as 2 or 3 clear tracks.
                let mut empty = 0;
                for row in 0..st.rows.len() as u8 {
                    let mut cols: Vec<i32> = st
                        .gates
                        .iter()
                        .filter(|g| g.row == row)
                        .map(|g| column_of(i32::from(g.x)))
                        .collect();
                    let n = cols.len();
                    cols.dedup();
                    assert_eq!(cols.len(), n, "{ctx} row {row}: two gates in one column");
                    assert!(n >= 1, "{ctx} row {row}: empty row");
                    empty += centres.len() - n;
                }
                assert!(
                    empty <= 1,
                    "{ctx}: {empty} empty cells (at most one per stage)"
                );

                // Walls: on column boundaries, from WALL_Y0 (past the cannon and a fresh
                // volley's first tick) to WALL_TAIL past the last row; sorted, no two alike.
                for w in st.walls {
                    let x = i32::from(w.x);
                    assert!(
                        x % pitch == 0 && 0 < x && x < LANE_WIDTH,
                        "{ctx}: wall at {x} off a column boundary"
                    );
                    assert_eq!(w.y0, WALL_Y0, "{ctx}");
                    assert!(i32::from(w.y0) > LAUNCH_SPEED, "{ctx}");
                    assert_eq!(i32::from(w.y1), last + i32::from(WALL_TAIL), "{ctx}");
                    assert!(i32::from(w.y1) < TOWER_Y - CLASH_BAND, "{ctx}");
                }
                for w in st.walls.windows(2) {
                    assert!(w[0].x < w[1].x, "{ctx}: walls not sorted");
                }
                // A gate's span never reaches past the wall next to it (with the grace edges,
                // it may reach into the wall's thickness, never through it).
                for g in st.gates.iter().filter(|g| !g.moving()) {
                    let reach = i32::from(g.width) / 2 + GATE_GRACE;
                    for w in st.walls {
                        let d = (i32::from(g.x) - i32::from(w.x)).abs();
                        assert!(d >= reach - WALL_HALF, "{ctx}: gate through a wall");
                    }
                }

                // Crates: each locks one static big gate, just below its row, and covers its
                // whole span (both get the same GATE_GRACE edges).
                assert!(st.crates.len() <= CRATES_MAX, "{ctx}");
                for c in st.crates {
                    let g = st
                        .gates
                        .iter()
                        .find(|g| g.x == c.x && g.slot == Slot::Big)
                        .unwrap_or_else(|| panic!("{ctx}: crate without a big gate"));
                    assert!(!g.moving() && c.width >= g.width && c.hp > 0, "{ctx}");
                    assert_eq!(c.y, st.rows[usize::from(g.row)] - CRATE_GAP, "{ctx}");
                    locked += 1;
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
            assert!(
                locked <= 1,
                "layout {id}: more than one crate-locked big gate"
            );
        }
        // SPEC_V5 §12: about half the layouts have walls.
        assert_eq!(walled_layouts, LAYOUT_COUNT / 2, "walled layouts");
    }

    #[test]
    fn walls_push_clamp_and_separate() {
        const WALLS: [WallDef; 2] = [wall(1_000, 3_000), wall(2_000, 3_000)];
        let st = StageDef {
            towers: &[],
            rows: &R3,
            gates: &[],
            crates: &[],
            walls: &WALLS,
        };
        let (y0, y1) = (i32::from(WALL_Y0), 3_000 + i32::from(WALL_TAIL));
        assert_eq!((WALLS[0].left(), WALLS[0].right()), (939, 1_061));
        // (b) inside the thickness → the nearer side, ties left; only while the wall stands.
        assert_eq!(st.wall_push(940, y0), 939);
        assert_eq!(st.wall_push(999, 1_500), 939);
        assert_eq!(st.wall_push(1_000, 1_500), 939);
        assert_eq!(st.wall_push(1_001, 1_500), 1_061);
        assert_eq!(st.wall_push(1_060, y1), 1_061);
        assert_eq!(st.wall_push(939, 1_500), 939);
        assert_eq!(st.wall_push(1_061, 1_500), 1_061);
        assert_eq!(st.wall_push(2_030, 1_500), 2_061);
        assert_eq!(st.wall_push(1_000, y0 - 1), 1_000);
        assert_eq!(st.wall_push(1_000, y1 + 1), 1_000);
        // (a) a sideways move stays in its column while the walls stand, free outside them.
        assert_eq!(st.column_at(500, 1_500), (0, 939));
        assert_eq!(st.column_at(1_500, 1_500), (1_061, 1_939));
        assert_eq!(st.column_at(2_900, 1_500), (2_061, LANE_WIDTH - 1));
        assert_eq!(st.column_at(1_500, y1 + 1), (0, LANE_WIDTH - 1));
        assert_eq!(st.wall_clamp(900, 1_400, 1_500), 939);
        assert_eq!(st.wall_clamp(1_100, 600, 1_500), 1_061);
        assert_eq!(st.wall_clamp(1_100, 1_300, 1_500), 1_300);
        assert_eq!(st.wall_clamp(900, 1_400, y1 + 1), 1_400);
        // (c) a standing wall strictly between two x's.
        assert!(st.wall_between(939, 1_061, 1_500));
        assert!(st.wall_between(2_100, 500, 1_500));
        assert!(!st.wall_between(1_061, 1_939, 1_500));
        assert!(!st.wall_between(939, 1_061, y1 + 1));
        assert!(!st.wall_between(1_000, 1_000, 1_500));
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
        const GATES: [GateDef; 2] = [
            GateDef {
                width: 600,
                ..gate(0, 1_000)
            },
            GateDef {
                width: 600,
                ..gate(0, 1_700)
            },
        ];
        let st = StageDef {
            towers: &[],
            rows: &[1_400],
            gates: &GATES,
            crates: &[],
            walls: &[],
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
    fn a_full_row_of_column_gates_covers_the_lane() {
        // SPEC_V5 §12: with a gate in every column there is no gap; the choice is which column.
        for (centres, w) in [(&COL3[..], COL3_W), (&COL2[..], COL2_W)] {
            let gates: Vec<GateDef> = centres
                .iter()
                .map(|&x| GateDef {
                    width: w,
                    ..gate(0, x)
                })
                .collect();
            let gates: &'static [GateDef] = Box::leak(gates.into_boxed_slice());
            let st = StageDef {
                towers: &[],
                rows: &[1_000],
                gates,
                crates: &[],
                walls: &[],
            };
            for x in 0..LANE_WIDTH {
                assert!(
                    st.gate_at(0, x, |_, g| i32::from(g.x)).is_some(),
                    "gap at {x}"
                );
            }
        }
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
