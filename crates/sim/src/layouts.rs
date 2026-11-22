//! The level pool (SPEC §9). A layout is 3 stages: Fight 1 (one tower), Fight 2 (two towers) and
//! the Raid (no towers). Each stage lists its towers, gate rows, gates and crates. Both players
//! get identical copies; the seed picks the layout (`layout_for(seed)`, public once seeded).
//!
//! Gate slots: a stage's gates in list order (sorted by row, then x). Rig and Peek name a slot.
//! A crate sits just below the big gate it locks and covers that gate's span; locked gates never
//! move. Design rules (SPEC §9): sparse rows with open lane between, first row ~1,400 from the
//! cannon, rows ~900–1,000 apart, at least one sliding row and one crate-locked big gate per
//! layout, the towers of a fight in different columns. `tests::layouts_follow_the_design_rules`
//! checks all of it, plus the limits the rules rely on.

use crate::constants::{LAYOUT_COUNT, STAGES};

/// What a gate slot can hold (SPEC §6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Slot {
    /// ×2 47%, ×3 34%, ×4 12%, ×5 4%, ×6 3%.
    Normal,
    /// ×6 30%, ×8 40%, ×10 30% (usually behind a crate).
    Big,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct GateDef {
    /// Index into the stage's `rows`.
    pub row: u8,
    /// Centre x at the start of the phase.
    pub x: i16,
    /// Full width; a cohort passes the gate if `|cohort.x − gate.x| · 2 ≤ width`.
    pub width: i16,
    pub slot: Slot,
    /// SPEC §6 moving gates: the centre slides between `x_min` and `x_max` (ping-pong) by
    /// `|speed|` per tick, starting toward +x if `speed > 0`. `speed == 0`: static.
    pub x_min: i16,
    pub x_max: i16,
    pub speed: i16,
}

impl GateDef {
    /// Centre x `t` ticks into the player's Fight/Raid phase (SPEC §6). Pure, so the bot can
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

/// One stage of a layout (out of range → the Raid of that layout).
pub fn stage(layout_id: u8, stage: u8) -> &'static StageDef {
    let l = layout(layout_id);
    l.stages
        .get(usize::from(stage))
        .unwrap_or(&l.stages[STAGES - 1])
}

// --- authoring helpers ------------------------------------------------------------------------

/// Normal gates are 600 wide, big gates 700 (impl).
const W: i16 = 600;
const BIG_W: i16 = 700;
/// A crate sits this far below the row of the gate it locks.
const CRATE_GAP: i16 = 300;

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

const ROWS3: [i16; 3] = [1_400, 2_400, 3_400];
const ROWS4: [i16; 4] = [1_400, 2_300, 3_200, 4_100];

/// Tower strength per layout: (Fight 1 HP, Fight 1 wave_base, Fight 2 HP per tower, Fight 2
/// wave_base). Tuned per layout with `cargo run -p lil-dudes-sim --example balance --release`
/// so every layout plays about as long and as dangerously as the others.
const TUNE: [(u16, u16, u16, u16); LAYOUT_COUNT] = [
    (370, 38, 200, 13),
    (120, 28, 120, 13),
    (190, 27, 290, 15),
    (70, 20, 250, 25),
    (140, 17, 150, 6),
    (190, 13, 90, 7),
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
    // 0. Two clean lanes left and right; the middle slides (fight 1) or hides a locked jackpot.
    Layout {
        name: "Twin Lanes",
        stages: [
            StageDef {
                towers: &[f1(0, 1_500)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 700),
                    gate(0, 2_300),
                    gate(1, 700),
                    gate(1, 2_300),
                    slide(2, 1_500, 900, 2_100, 25),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(0, 700), f2(0, 2_300)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 700),
                    gate(0, 2_300),
                    big(1, 1_500),
                    gate(2, 700),
                    gate(2, 2_300),
                ],
                crates: &[lock(1_500, 2_400, 25)],
            },
            StageDef {
                towers: &[],
                rows: &ROWS3,
                gates: &[
                    gate(0, 700),
                    gate(0, 2_300),
                    slide(1, 1_500, 600, 2_400, 30),
                    big(2, 700),
                    gate(2, 2_300),
                ],
                crates: &[lock(700, 3_400, 40)],
            },
        ],
    },
    // 1. Almost everything slides: timing over aiming.
    Layout {
        name: "Conveyor",
        stages: [
            StageDef {
                towers: &[f1(1, 2_200)],
                rows: &ROWS3,
                gates: &[
                    slide(0, 800, 500, 2_500, 30),
                    gate(1, 2_200),
                    slide(2, 1_500, 500, 2_500, -40),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(1, 600), f2(1, 2_400)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 1_500),
                    slide(1, 700, 400, 1_100, 30),
                    slide(1, 2_300, 1_900, 2_600, -30),
                    big(2, 1_500),
                    slide(3, 1_500, 400, 2_600, 50),
                ],
                crates: &[lock(1_500, 3_200, 30)],
            },
            StageDef {
                towers: &[],
                rows: &ROWS3,
                gates: &[
                    slide(0, 600, 400, 2_600, 35),
                    gate(1, 900),
                    big(1, 2_350),
                    slide(2, 1_500, 500, 2_500, -45),
                ],
                crates: &[lock(2_350, 2_400, 45)],
            },
        ],
    },
    // 2. The gamble: a locked big gate far off to the side, away from the safe middle path.
    Layout {
        name: "Long Shot",
        stages: [
            StageDef {
                towers: &[f1(2, 1_000)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 1_300),
                    big(0, 2_600),
                    gate(1, 1_000),
                    slide(2, 1_500, 700, 2_300, 30),
                ],
                crates: &[lock(2_600, 1_400, 20)],
            },
            StageDef {
                towers: &[f2(2, 500), f2(2, 2_000)],
                rows: &ROWS3,
                gates: &[
                    big(0, 400),
                    gate(0, 1_500),
                    gate(1, 1_500),
                    narrow(1, 2_650, 500),
                    slide(2, 1_000, 500, 2_000, 35),
                ],
                crates: &[lock(400, 1_400, 30)],
            },
            StageDef {
                towers: &[],
                rows: &ROWS3,
                gates: &[
                    gate(0, 1_500),
                    gate(1, 1_200),
                    big(1, 2_600),
                    slide(2, 1_500, 500, 2_500, 40),
                ],
                crates: &[lock(2_600, 2_400, 50)],
            },
        ],
    },
    // 3. Everything funnels through the middle; the towers sit out on the flanks.
    Layout {
        name: "Funnel",
        stages: [
            StageDef {
                towers: &[f1(3, 2_500)],
                rows: &ROWS3,
                gates: &[
                    narrow(0, 1_500, 700),
                    narrow(1, 1_100, 500),
                    narrow(1, 1_900, 500),
                    big(2, 1_500),
                ],
                crates: &[lock(1_500, 3_400, 25)],
            },
            StageDef {
                towers: &[f2(3, 500), f2(3, 2_500)],
                rows: &ROWS3,
                gates: &[
                    narrow(0, 1_100, 500),
                    narrow(0, 1_900, 500),
                    slide(1, 1_500, 900, 2_100, 20),
                    narrow(2, 1_500, 700),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[],
                rows: &ROWS4,
                gates: &[
                    narrow(0, 1_500, 700),
                    narrow(1, 1_000, 500),
                    narrow(1, 2_000, 500),
                    big(2, 1_500),
                    slide(3, 1_500, 700, 2_300, 40),
                ],
                crates: &[lock(1_500, 3_200, 45)],
            },
        ],
    },
    // 4. Rows alternate sides: no straight line through, pick which rows to take.
    Layout {
        name: "Zigzag",
        stages: [
            StageDef {
                towers: &[f1(4, 500)],
                rows: &ROWS3,
                gates: &[
                    gate(0, 600),
                    gate(1, 2_400),
                    slide(2, 1_500, 600, 2_400, 30),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(4, 1_500), f2(4, 2_600)],
                rows: &ROWS3,
                gates: &[gate(0, 2_400), gate(1, 600), big(1, 1_800), gate(2, 2_400)],
                crates: &[lock(1_800, 2_400, 30)],
            },
            StageDef {
                towers: &[],
                rows: &ROWS3,
                gates: &[
                    gate(0, 600),
                    gate(0, 2_400),
                    slide(1, 1_500, 600, 2_400, -35),
                    big(2, 600),
                    gate(2, 2_400),
                ],
                crates: &[lock(600, 3_400, 40)],
            },
        ],
    },
    // 5. A diagonal staircase of single gates: chase it across the lane.
    Layout {
        name: "Stairway",
        stages: [
            StageDef {
                towers: &[f1(5, 2_600)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 500),
                    gate(1, 1_200),
                    gate(2, 1_900),
                    slide(3, 2_300, 1_800, 2_650, 25),
                ],
                crates: &[],
            },
            StageDef {
                towers: &[f2(5, 400), f2(5, 1_800)],
                rows: &ROWS4,
                gates: &[
                    gate(0, 2_500),
                    gate(1, 1_800),
                    big(2, 1_100),
                    slide(3, 600, 400, 1_400, 25),
                ],
                crates: &[lock(1_100, 3_200, 30)],
            },
            StageDef {
                towers: &[],
                rows: &ROWS3,
                gates: &[
                    gate(0, 500),
                    gate(0, 2_500),
                    slide(1, 1_500, 500, 2_500, 40),
                    big(2, 1_500),
                ],
                crates: &[lock(1_500, 3_400, 60)],
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
            let (mut sliding, mut locked) = (0, 0);
            for (s, st) in l.stages.iter().enumerate() {
                let ctx = format!("layout {id} ({}) stage {s}", l.name);
                // Towers: 1 in Fight 1, 2 in Fight 2, none in the Raid; different columns.
                assert_eq!(st.towers.len(), [1, 2, 0][s], "{ctx}");
                for t in st.towers {
                    assert!(t.hp > 0 && t.wave_base > 0, "{ctx}");
                    assert!((300..=2_700).contains(&i32::from(t.x)), "{ctx}");
                }
                if let [a, b] = st.towers {
                    assert!((a.x - b.x).abs() >= 1_000, "{ctx}: towers too close");
                }
                // Rows: ascending, first ~1,400, 900–1,000 apart, in the third nearest the cannon.
                assert!(!st.rows.is_empty() && st.rows.len() <= ROWS_MAX, "{ctx}");
                assert_eq!(st.rows[0], 1_400, "{ctx}");
                for w in st.rows.windows(2) {
                    assert!((900..=1_100).contains(&(w[1] - w[0])), "{ctx}");
                }
                assert!(
                    i32::from(*st.rows.last().unwrap()) < LANE_LENGTH / 3 + 200,
                    "{ctx}"
                );
                // Gates: ≤ GATES_MAX, sorted by row then x, 1–3 per row, on the lane, no overlap.
                assert!(!st.gates.is_empty() && st.gates.len() <= GATES_MAX, "{ctx}");
                for w in st.gates.windows(2) {
                    assert!((w[0].row, w[0].x) < (w[1].row, w[1].x), "{ctx}: slot order");
                }
                for row in 0..st.rows.len() as u8 {
                    let in_row: Vec<_> = st.gates.iter().filter(|g| g.row == row).collect();
                    assert!((1..=3).contains(&in_row.len()), "{ctx} row {row}");
                    for (i, a) in in_row.iter().enumerate() {
                        for b in &in_row[i + 1..] {
                            let (a, b) = (sweep(a), sweep(b));
                            assert!(a.1 < b.0 || b.1 < a.0, "{ctx} row {row}: gates overlap");
                        }
                    }
                    // Open lane: the row leaves at least a third of the lane uncovered.
                    let covered: i32 = in_row.iter().map(|g| i32::from(g.width)).sum();
                    assert!(
                        covered <= LANE_WIDTH * 2 / 3,
                        "{ctx} row {row}: no open lane"
                    );
                }
                for g in st.gates {
                    assert!(usize::from(g.row) < st.rows.len(), "{ctx}");
                    let (lo, hi) = sweep(g);
                    assert!(lo >= 0 && hi <= LANE_WIDTH, "{ctx}: gate off the lane");
                    assert!(g.width >= 400, "{ctx}");
                    if g.moving() {
                        sliding += 1;
                        assert!(g.x_min <= g.x && g.x <= g.x_max, "{ctx}");
                        for t in 0..2_000 {
                            let x = g.x_at(t);
                            assert!(g.x_min <= x && x <= g.x_max, "{ctx}: t {t} x {x}");
                        }
                    } else {
                        assert_eq!((g.x_min, g.x_max), (g.x, g.x), "{ctx}");
                    }
                }
                // Crates: each locks one static big gate, just below its row.
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
            assert!(sliding >= 1, "layout {id}: no sliding gate");
            assert!(locked >= 1, "layout {id}: no crate-locked big gate");
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
        assert_eq!(stage(0, 9), &LAYOUTS[0].stages[2]);
        assert_eq!(layout_for(7), 1);
    }
}
