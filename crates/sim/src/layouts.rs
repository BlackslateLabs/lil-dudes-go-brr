//! The level pool (SPEC §9; columns and walls SPEC_V5 §12, rules v7; obstacles, speed pads and
//! pipes SPEC_V5 §13, rules v8). A layout is 2 stages: Fight 1 (one tower) and Fight 2 (two
//! towers, the town hall behind them, rushed on the same gates once they fall). Each stage lists
//! its towers, gate rows, gates, crates (breakable blocks), divider walls, solid obstacles, speed
//! pads and pipes. Both players get identical copies; the seed picks the layout
//! (`layout_for(seed)`, public once seeded).
//!
//! Gate slots: a stage's gates in list order (sorted by row, then x). Scout (peek) names a slot.
//! A crate either locks a big gate (it sits `CRATE_GAP` below the gate's row and covers its
//! span) or stands alone anywhere on the lane; either way it absorbs what crosses its line inside
//! its span until it breaks.
//!
//! Design rules (SPEC_V5 §13): row 1 is a row of 2–3 near-touching gates right in front of the
//! cannon (y 900–1,100) that covers the whole lane; then one obstacle theme per stage; then one or
//! two gates beyond it. Exactly one timing gate and 3–5 hidden gates per stage, at most one
//! crate-locked big gate per layout. Obstacles, pads and pipes stay inside the lane, off the gate
//! rows; pipe exits are clear; and every launch x reaches a tower (no sealed pocket).
//! `tests::layouts_follow_the_design_rules` and the path tests in `step::tests` check it all.

use crate::constants::{
    CRATE_HOLD, GATE_GRACE, LANE_WIDTH, LAYOUT_COUNT, OBSTACLE_GRACE, SLIDE_STEP, STAGES,
    TIMING_MAX, TIMING_STEP_TICKS, WALL_HALF,
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

/// A breakable block (SPEC §4): it absorbs my cohorts crossing the line `y` inside its span
/// (`covers(x, self.x, width)`) until its HP is spent. It locks a big gate when it sits just
/// below it, or stands alone (rules v8).
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

/// SPEC_V5 §12: a divider wall. Its centre line is `x`, it is `2 · WALL_HALF` thick and it
/// stands for y in `[y0, y1]` (below `y0` the cannon and fresh volleys move freely across the
/// whole lane).
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

/// SPEC_V5 §13: the shape of a solid obstacle inside its box. A wedge is the right triangle
/// with its right angle at the named corner of the box: B = low y (the cannon side), T = high y,
/// L = `x0`, R = `x1`. Its open side (where it deflects crowds) faces away from that corner:
/// +x for the L wedges, −x for the R wedges.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Shape {
    Rect,
    /// (x0, y0), (x1, y0), (x0, y1).
    WedgeBL,
    /// (x1, y0), (x0, y0), (x1, y1).
    WedgeBR,
    /// (x0, y1), (x0, y0), (x1, y1).
    WedgeTL,
    /// (x1, y1), (x0, y1), (x1, y0).
    WedgeTR,
}

impl Shape {
    /// The name the client uses (`'rect'`, `'wedgeBL'`, …).
    pub fn name(self) -> &'static str {
        match self {
            Shape::Rect => "rect",
            Shape::WedgeBL => "wedgeBL",
            Shape::WedgeBR => "wedgeBR",
            Shape::WedgeTL => "wedgeTL",
            Shape::WedgeTR => "wedgeTR",
        }
    }
}

/// SPEC_V5 §13: a solid obstacle (a block, a comb arm, a pillar, a wedge) in the box
/// `x0 < x1`, `y0 < y1`. Crowds (mine and enemies) never move into it; they slide around it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ObstacleDef {
    pub x0: i16,
    pub y0: i16,
    pub x1: i16,
    pub y1: i16,
    pub shape: Shape,
}

/// SPEC_V5 §13: a speed pad (turbo tile). Each tick one of my cohorts' centre is on it (edges
/// included), its age resets to 0: LAUNCH_SPEED while on it and for LAUNCH_TICKS after.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PadDef {
    pub x0: i16,
    pub y0: i16,
    pub x1: i16,
    pub y1: i16,
}

impl PadDef {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        in_box(x, y, self.x0, self.y0, self.x1, self.y1)
    }
}

/// SPEC_V5 §13: a pipe. One of my cohorts whose centre is in the entrance box (edges included)
/// pops out at (`out_x`, `out_y`) with a fresh launch boost, past every gate row at or below
/// `out_y`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct PipeDef {
    pub x0: i16,
    pub y0: i16,
    pub x1: i16,
    pub y1: i16,
    pub out_x: i16,
    pub out_y: i16,
}

impl PipeDef {
    pub fn contains(&self, x: i32, y: i32) -> bool {
        in_box(x, y, self.x0, self.y0, self.x1, self.y1)
    }
}

fn in_box(x: i32, y: i32, x0: i16, y0: i16, x1: i16, y1: i16) -> bool {
    i32::from(x0) <= x && x <= i32::from(x1) && i32::from(y0) <= y && y <= i32::from(y1)
}

/// SPEC_V5 §13: the point (`x`, `y`) is inside obstacle `o` grown by `grace` (the rules use
/// OBSTACLE_GRACE): inside the box grown by `grace` on every side and, for a wedge, on the
/// inner side of its hypotenuse moved `grace` toward the open side (along x). Integer only;
/// packages/client `insideObstacle` mirrors it.
pub fn inside_obstacle(o: &ObstacleDef, x: i32, y: i32, grace: i32) -> bool {
    let (x0, y0) = (i64::from(o.x0), i64::from(o.y0));
    let (x1, y1) = (i64::from(o.x1), i64::from(o.y1));
    let (x, y, g) = (i64::from(x), i64::from(y), i64::from(grace));
    if x < x0.saturating_sub(g)
        || x > x1.saturating_add(g)
        || y < y0.saturating_sub(g)
        || y > y1.saturating_add(g)
    {
        return false;
    }
    let (w, h) = (x1.saturating_sub(x0), y1.saturating_sub(y0));
    // How far the point is from the right-angle corner along x (less the grace) and along y.
    let (ax, ay) = match o.shape {
        Shape::Rect => return true,
        Shape::WedgeBL => (x.saturating_sub(g).saturating_sub(x0), y.saturating_sub(y0)),
        Shape::WedgeBR => (x1.saturating_sub(x).saturating_sub(g), y.saturating_sub(y0)),
        Shape::WedgeTL => (x.saturating_sub(g).saturating_sub(x0), y1.saturating_sub(y)),
        Shape::WedgeTR => (x1.saturating_sub(x).saturating_sub(g), y1.saturating_sub(y)),
    };
    // ax / w + ay / h ≤ 1
    ax.saturating_mul(h).saturating_add(ay.saturating_mul(w)) <= w.saturating_mul(h)
}

/// `x` moved toward `target` by at most `step`.
fn step_toward(x: i32, target: i32, step: i32) -> i32 {
    let gap = target.saturating_sub(x);
    x.saturating_add(gap.clamp(step.saturating_neg(), step))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StageDef {
    pub towers: &'static [TowerDef],
    /// Gate row y, ascending.
    pub rows: &'static [i16],
    /// Gate slots, sorted by row then x.
    pub gates: &'static [GateDef],
    pub crates: &'static [CrateDef],
    /// SPEC_V5 §12 divider walls.
    pub walls: &'static [WallDef],
    /// SPEC_V5 §13 solid obstacles (list order breaks ties: the first one a crowd runs into).
    pub obstacles: &'static [ObstacleDef],
    /// SPEC_V5 §13 speed pads (my cohorts only).
    pub pads: &'static [PadDef],
    /// SPEC_V5 §13 pipes (my cohorts only).
    pub pipes: &'static [PipeDef],
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

    /// SPEC_V5 §13: the index of the first obstacle (list order) that (`x`, `y`) is inside,
    /// OBSTACLE_GRACE included.
    pub fn blocked(&self, x: i32, y: i32) -> Option<usize> {
        self.obstacles
            .iter()
            .position(|o| inside_obstacle(o, x, y, OBSTACLE_GRACE))
    }

    /// The y band where obstacles can block anything (`(i32::MAX, i32::MIN)` without any): a
    /// crowd whose move stays outside it never needs the per-obstacle tests.
    pub fn obstacle_band(&self) -> (i32, i32) {
        self.obstacles
            .iter()
            .fold((i32::MAX, i32::MIN), |(lo, hi), o| {
                (
                    lo.min(i32::from(o.y0).saturating_sub(OBSTACLE_GRACE)),
                    hi.max(i32::from(o.y1).saturating_add(OBSTACLE_GRACE)),
                )
            })
    }

    /// SPEC_V5 §13 slide: a crowd at (`x`, `y`) blocked by obstacle `ix` moves sideways by at most
    /// SLIDE_STEP toward a free side of it: the box edge plus OBSTACLE_GRACE and 1 on that side,
    /// if it is reachable (inside the lane and inside the column, so no standing wall is
    /// crossed). A rect goes to the nearer reachable side (ties left); a wedge to its open side
    /// (+x for the L wedges, −x for the R ones), else the other side. It never slides into
    /// another obstacle, and stays put when neither side is reachable.
    pub fn slide(&self, ix: usize, x: i32, y: i32) -> i32 {
        let Some(o) = self.obstacles.get(ix) else {
            return x;
        };
        let (lo, hi) = self.column_at(x, y);
        let left = i32::from(o.x0)
            .saturating_sub(OBSTACLE_GRACE)
            .saturating_sub(1);
        let right = i32::from(o.x1)
            .saturating_add(OBSTACLE_GRACE)
            .saturating_add(1);
        let (can_l, can_r) = (left >= lo, right <= hi);
        let target = match o.shape {
            Shape::Rect if can_l && can_r => {
                if right.saturating_sub(x) < x.saturating_sub(left) {
                    right
                } else {
                    left
                }
            }
            Shape::Rect | Shape::WedgeBR | Shape::WedgeTR if can_l => left,
            _ if can_r => right,
            Shape::WedgeBL | Shape::WedgeTL if can_l => left,
            _ => return x,
        };
        let to = step_toward(x, target, SLIDE_STEP);
        let other = self
            .obstacles
            .iter()
            .enumerate()
            .any(|(i, o)| i != ix && inside_obstacle(o, to, y, OBSTACLE_GRACE));
        if other {
            x
        } else {
            to
        }
    }

    /// SPEC_V5 §13: one tick of a crowd at (`x`, `y`) moving `dy` in y (mine up, enemies down).
    /// If the end point or the halfway point is inside an obstacle, it does not advance in y and
    /// slides instead (`slide`); otherwise it moves straight. Returns the new (x, y).
    pub fn advance(&self, x: i32, y: i32, dy: i32) -> (i32, i32) {
        let to = y.saturating_add(dy);
        let mid = y.saturating_add(dy / 2);
        match self.blocked(x, mid).or_else(|| self.blocked(x, to)) {
            Some(ix) => (self.slide(ix, x, y), y),
            None => (x, to),
        }
    }

    /// SPEC_V5 §13: a speed pad under (`x`, `y`).
    pub fn on_pad(&self, x: i32, y: i32) -> bool {
        self.pads.iter().any(|p| p.contains(x, y))
    }

    /// SPEC_V5 §13: the pipe whose entrance (`x`, `y`) is in, with its index.
    pub fn pipe_at(&self, x: i32, y: i32) -> Option<(u8, &PipeDef)> {
        (0u8..).zip(self.pipes).find(|(_, p)| p.contains(x, y))
    }

    /// SPEC_V5 §15 (rules v10) crate hold: an enemy at (`x`, `y`) about to move down to `to`
    /// stops at `crate.y + CRATE_HOLD` instead if that move would cross the line of a live crate
    /// (`hp[i] > 0`) inside its span (`covers`, edges count), so it waits behind the crate until
    /// it breaks. It never moves back up (an enemy already inside the gap stays put). Returns
    /// the new y. packages/client `crateHold` mirrors it.
    pub fn crate_hold(&self, hp: &[u16], x: i32, y: i32, to: i32) -> i32 {
        let mut to = to;
        for (&h, c) in hp.iter().zip(self.crates) {
            let line = i32::from(c.y);
            let stop = line.saturating_add(CRATE_HOLD);
            if h > 0 && y > line && to < stop && covers(x, i32::from(c.x), c.width) {
                to = to.max(stop.min(y));
            }
        }
        to
    }

    /// SPEC_V5 §15 (rules v10): a live crate's line lies between an enemy at `foe_y` and my
    /// cohort at `my_y` (`foe_y < line ≤ my_y`) with `x` inside its span: nothing clashes
    /// through it, as through a standing wall.
    pub fn crate_between(&self, hp: &[u16], x: i32, my_y: i32, foe_y: i32) -> bool {
        hp.iter().zip(self.crates).any(|(&h, c)| {
            let line = i32::from(c.y);
            h > 0 && foe_y < line && line <= my_y && covers(x, i32::from(c.x), c.width)
        })
    }

    /// SPEC_V5 §13: the number of rows at or below `y` (a pipe's exit skips them).
    pub fn rows_through(&self, y: i32) -> u8 {
        let n = self.rows.iter().filter(|&&r| i32::from(r) <= y).count();
        u8::try_from(n).unwrap_or(u8::MAX)
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

/// Gate centres and widths: three near-touching gates across the lane (centres 500 / 1,500 /
/// 2,500, 880 wide) or two (750 / 2,250, 1,380 wide). With the GATE_GRACE edges a full row
/// covers the whole lane, and a gate between two walls (or a wall and the lane edge) touches
/// both.
pub const COL3: [i16; 3] = [500, 1_500, 2_500];
pub const COL2: [i16; 2] = [750, 2_250];
pub const COL3_W: i16 = (LANE_WIDTH / 3 - 2 * WALL_HALF) as i16;
pub const COL2_W: i16 = (LANE_WIDTH / 2 - 2 * WALL_HALF) as i16;
/// A crate that locks a big gate sits this far below its row.
pub const CRATE_GAP: i16 = 300;

/// The gate width for a gate centred on `x` (2-across centres are 750 and 2,250).
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

/// A stand-alone breakable block (rules v8).
const fn block(x: i16, y: i16, width: i16, hp: u16) -> CrateDef {
    CrateDef { x, width, y, hp }
}

const fn wall(x: i16, y0: i16, y1: i16) -> WallDef {
    WallDef { x, y0, y1 }
}

const fn rect(x0: i16, y0: i16, x1: i16, y1: i16) -> ObstacleDef {
    ObstacleDef {
        x0,
        y0,
        x1,
        y1,
        shape: Shape::Rect,
    }
}

const fn wedge(shape: Shape, x0: i16, y0: i16, x1: i16, y1: i16) -> ObstacleDef {
    ObstacleDef {
        x0,
        y0,
        x1,
        y1,
        shape,
    }
}

/// A square pillar of side `PILLAR` centred on (`x`, `y`).
const fn pillar(x: i16, y: i16) -> ObstacleDef {
    let r = PILLAR / 2;
    rect(
        x.saturating_sub(r),
        y.saturating_sub(r),
        x.saturating_add(r),
        y.saturating_add(r),
    )
}

/// The same obstacle mirrored across the lane's centre line (x → LANE_WIDTH − x).
const fn mirror(o: ObstacleDef) -> ObstacleDef {
    let w = LANE_WIDTH as i16;
    let shape = match o.shape {
        Shape::Rect => Shape::Rect,
        Shape::WedgeBL => Shape::WedgeBR,
        Shape::WedgeBR => Shape::WedgeBL,
        Shape::WedgeTL => Shape::WedgeTR,
        Shape::WedgeTR => Shape::WedgeTL,
    };
    ObstacleDef {
        x0: w.saturating_sub(o.x1),
        y0: o.y0,
        x1: w.saturating_sub(o.x0),
        y1: o.y1,
        shape,
    }
}

const fn pad(x0: i16, y0: i16, x1: i16, y1: i16) -> PadDef {
    PadDef { x0, y0, x1, y1 }
}

const fn mirror_pad(p: PadDef) -> PadDef {
    let w = LANE_WIDTH as i16;
    pad(w.saturating_sub(p.x1), p.y0, w.saturating_sub(p.x0), p.y1)
}

const fn pipe(x0: i16, y0: i16, x1: i16, y1: i16, out_x: i16, out_y: i16) -> PipeDef {
    PipeDef {
        x0,
        y0,
        x1,
        y1,
        out_x,
        out_y,
    }
}

const fn tower(x: i16, hp: u16, wave_base: u16) -> TowerDef {
    TowerDef { x, hp, wave_base }
}

/// Row 1 sits right in front of the cannon.
const R1: i16 = 1_000;

/// Tower strength per layout: (Fight 1 HP, Fight 1 wave_base, Fight 2 HP per tower, Fight 2
/// wave_base). Tuned per layout with `cargo run -p lil-dudes-sim --example balance --release`
/// (driven by `tools/balance/tune_layouts.py`) so every layout plays about as long and as
/// dangerously as the others.
const TUNE: [(u16, u16, u16, u16); LAYOUT_COUNT] = [
    (239, 8, 320, 4),
    (312, 5, 251, 6),
    (212, 8, 290, 2),
    (260, 11, 280, 5),
    (320, 6, 705, 4),
    (178, 8, 293, 4),
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

// --- 0. Three Lanes: two long walls make three lanes. ---

const THREE_WALLS: [WallDef; 2] = [wall(1_000, 600, 4_400), wall(2_000, 600, 4_400)];
const THREE_ROWS: [i16; 2] = [R1, 3_400];

// --- 1. Funnel / Diamond: wedges. ---

/// Two wedges on the lane edges, narrow at the cannon end and widest at the top, squeeze the
/// crowd into the middle 1,000.
const FUNNEL: [ObstacleDef; 2] = [
    wedge(Shape::WedgeTL, 0, 1_900, 1_000, 3_500),
    wedge(Shape::WedgeTR, 2_000, 1_900, 3_000, 3_500),
];
/// Four wedges form a diamond (centre 1,500 / 3,000, 1,400 wide, 1,600 tall) that splits the
/// crowd left and right.
const DIAMOND: [ObstacleDef; 4] = [
    wedge(Shape::WedgeTR, 800, 2_200, 1_500, 3_000),
    wedge(Shape::WedgeTL, 1_500, 2_200, 2_200, 3_000),
    wedge(Shape::WedgeBR, 800, 3_000, 1_500, 3_800),
    wedge(Shape::WedgeBL, 1_500, 3_000, 2_200, 3_800),
];

// --- 2. Speed Comb: a centre wall; one half is a comb with a speed pad in every pocket. ---

const COMB_WALL: [WallDef; 1] = [wall(1_500, 600, 4_800)];
const COMB_ROWS: [i16; 3] = [R1, 2_700, 4_500];
/// The comb in the left half: 120-tall arms alternating between the lane edge and the wall,
/// each leaving a gap of ≥ 500 at its other end, so the crowd zigzags.
const COMB_L: [ObstacleDef; 4] = [
    rect(0, 1_600, 850, 1_720),
    rect(600, 2_300, 1_440, 2_420),
    rect(0, 3_000, 850, 3_120),
    rect(600, 3_700, 1_440, 3_820),
];
const COMB_R: [ObstacleDef; 4] = [
    mirror(COMB_L[0]),
    mirror(COMB_L[1]),
    mirror(COMB_L[2]),
    mirror(COMB_L[3]),
];
/// One speed pad in each pocket of the left comb, where the crowd walks through it.
const COMB_PADS_L: [PadDef; 3] = [
    pad(900, 1_850, 1_440, 2_150),
    pad(0, 2_550, 560, 2_850),
    pad(900, 3_250, 1_440, 3_550),
];
const COMB_PADS_R: [PadDef; 3] = [
    mirror_pad(COMB_PADS_L[0]),
    mirror_pad(COMB_PADS_L[1]),
    mirror_pad(COMB_PADS_L[2]),
];

// --- 3. Pipes: a walled centre corridor of gates; the side lanes break a block and take a pipe. ---

const PIPE_WALLS: [WallDef; 2] = [wall(1_000, 600, 5_200), wall(2_000, 600, 5_200)];
const PIPE_ROWS: [i16; 3] = [R1, 2_600, 4_000];
const PIPE_GATES: [GateDef; 5] = [
    gate(0, 500),
    gate(0, 1_500),
    gate(0, 2_500),
    gate(1, 1_500),
    timing(2, 1_500),
];
const PIPE_BLOCKS: [CrateDef; 2] = [
    block(500, 1_500, COL3_W, 10),
    block(2_500, 1_500, COL3_W, 10),
];
/// Each side lane's pipe spans the lane (so a crowd pressed to the wall still drops in) and
/// pops out in the same lane past the walls' end, near the towers.
const PIPES: [PipeDef; 2] = [
    pipe(0, 3_000, 939, 3_400, 500, 5_600),
    pipe(2_061, 3_000, 2_999, 3_400, 2_500, 5_600),
];

// --- 4. Pillars: a checkerboard field of small pillars. ---

const PILLAR: i16 = 260;
const PILLAR_ROWS: [i16; 2] = [R1, 4_400];
/// Four rows of four, 700 apart across (440 gaps) and 600 apart up the lane, every other row
/// shifted by half a step.
const PILLARS: [ObstacleDef; 16] = [
    pillar(350, 2_030),
    pillar(1_050, 2_030),
    pillar(1_750, 2_030),
    pillar(2_450, 2_030),
    pillar(700, 2_630),
    pillar(1_400, 2_630),
    pillar(2_100, 2_630),
    pillar(2_800, 2_630),
    pillar(350, 3_230),
    pillar(1_050, 3_230),
    pillar(1_750, 3_230),
    pillar(2_450, 3_230),
    pillar(700, 3_830),
    pillar(1_400, 3_830),
    pillar(2_100, 3_830),
    pillar(2_800, 3_830),
];

// --- 5. Island / Fortress. ---

const ISLAND: [ObstacleDef; 1] = [rect(950, 2_100, 2_050, 3_400)];
/// Two wedges in front of the towers funnel the crowd into the middle 800.
const FORTRESS: [ObstacleDef; 2] = [
    wedge(Shape::WedgeTL, 0, 5_000, 1_100, 6_000),
    wedge(Shape::WedgeTR, 1_900, 5_000, 3_000, 6_000),
];

pub const LAYOUTS: [Layout; LAYOUT_COUNT] = [
    // 0. Three Lanes: walls split the lane in three. Fight 1: a breakable block in the middle
    //    lane on the way to the tower, gates further up the side lanes. Fight 2: the middle lane
    //    holds a crate-locked jackpot instead.
    Layout {
        name: "Three Lanes",
        stages: [
            StageDef {
                towers: &[f1(0, 1_500)],
                rows: &THREE_ROWS,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    timing(1, 2_500),
                ],
                crates: &[block(1_500, 2_600, COL3_W, 20)],
                walls: &THREE_WALLS,
                obstacles: &[],
                pads: &[],
                pipes: &[],
            },
            StageDef {
                towers: &[f2(0, 500), f2(0, 2_500)],
                rows: &THREE_ROWS,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 500),
                    big(1, 1_500),
                    timing(1, 2_500),
                ],
                crates: &[lock(1_500, 3_400, 30)],
                walls: &THREE_WALLS,
                obstacles: &[],
                pads: &[],
                pipes: &[],
            },
        ],
    },
    // 1. Funnel: Fight 1's edge wedges squeeze the crowd into the middle and onto the timing
    //    gate. Fight 2 (Diamond): a diamond of four wedges splits it left and right.
    Layout {
        name: "Funnel",
        stages: [
            StageDef {
                towers: &[f1(1, 1_500)],
                rows: &[R1, 4_100],
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    timing(1, 1_500),
                ],
                crates: &[],
                walls: &[],
                obstacles: &FUNNEL,
                pads: &[],
                pipes: &[],
            },
            StageDef {
                towers: &[f2(1, 500), f2(1, 2_500)],
                rows: &[R1, 4_400],
                gates: &[gate(0, 750), gate(0, 2_250), gate(1, 750), timing(1, 2_250)],
                crates: &[],
                walls: &[],
                obstacles: &DIAMOND,
                pads: &[],
                pipes: &[],
            },
        ],
    },
    // 2. Speed Comb: a centre wall. One half is a comb the crowd zigzags through, a speed pad
    //    in every pocket; the other is open, with a breakable block. Fight 2 mirrors the
    //    obstacles; its timing gate tops the comb half (rules v10).
    Layout {
        name: "Speed Comb",
        stages: [
            StageDef {
                towers: &[f1(2, 750)],
                rows: &COMB_ROWS,
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    gate(1, 2_250),
                    gate(2, 750),
                    timing(2, 2_250),
                ],
                crates: &[block(2_250, 2_000, 700, 15)],
                walls: &COMB_WALL,
                obstacles: &COMB_L,
                pads: &COMB_PADS_L,
                pipes: &[],
            },
            StageDef {
                towers: &[f2(2, 750), f2(2, 2_250)],
                rows: &COMB_ROWS,
                // Rules v10: the timing gate tops the comb half (as in Fight 1, where the comb's
                // `?` is the risk and the open half ends on the timing gate, the open half here
                // carries the risk): a `÷` on each path left only lone dudes and fights at 3:00.
                gates: &[
                    gate(0, 750),
                    gate(0, 2_250),
                    gate(1, 750),
                    gate(2, 750),
                    timing(2, 2_250),
                ],
                crates: &[block(750, 2_000, 700, 15)],
                walls: &COMB_WALL,
                obstacles: &COMB_R,
                pads: &COMB_PADS_R,
                pipes: &[],
            },
        ],
    },
    // 3. Pipes: a walled centre corridor of three gate rows; each side lane breaks a block and
    //    drops into a pipe that pops out near the towers. Fight 2: two towers in the corridor.
    Layout {
        name: "Pipes",
        stages: [
            StageDef {
                towers: &[f1(3, 1_500)],
                rows: &PIPE_ROWS,
                gates: &PIPE_GATES,
                crates: &PIPE_BLOCKS,
                walls: &PIPE_WALLS,
                obstacles: &[],
                pads: &[],
                pipes: &PIPES,
            },
            StageDef {
                towers: &[f2(3, 1_200), f2(3, 1_800)],
                rows: &PIPE_ROWS,
                gates: &PIPE_GATES,
                crates: &PIPE_BLOCKS,
                walls: &PIPE_WALLS,
                obstacles: &[],
                pads: &[],
                pipes: &PIPES,
            },
        ],
    },
    // 4. Pillars: a checkerboard field of pillars between a full first row and a row of two.
    //    Fight 2 opens with an exposed big gate on the left and speed pads on both flanks.
    Layout {
        name: "Pillars",
        stages: [
            StageDef {
                towers: &[f1(4, 1_500)],
                rows: &PILLAR_ROWS,
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 750),
                    timing(1, 2_250),
                ],
                crates: &[],
                walls: &[],
                obstacles: &PILLARS,
                pads: &[],
                pipes: &[],
            },
            StageDef {
                towers: &[f2(4, 750), f2(4, 2_250)],
                rows: &PILLAR_ROWS,
                gates: &[
                    big(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    timing(1, 750),
                    gate(1, 2_250),
                ],
                crates: &[],
                walls: &[],
                obstacles: &PILLARS,
                pads: &[pad(0, 1_250, 600, 1_650), pad(2_400, 1_250, 3_000, 1_650)],
                pipes: &[],
            },
        ],
    },
    // 5. Island: a big central block splits the lane: a speed pad on the left path, a breakable
    //    block on the right. Fight 2 (Fortress): wedges in front of the towers funnel the crowd
    //    into the middle; speed pads on the flanks.
    Layout {
        name: "Island",
        stages: [
            StageDef {
                towers: &[f1(5, 1_500)],
                rows: &[R1, 4_000],
                gates: &[gate(0, 750), gate(0, 2_250), gate(1, 750), timing(1, 2_250)],
                crates: &[block(2_525, 2_700, 700, 15)],
                walls: &[],
                obstacles: &ISLAND,
                pads: &[pad(100, 2_300, 800, 2_900)],
                pipes: &[],
            },
            StageDef {
                towers: &[f2(5, 750), f2(5, 2_250)],
                rows: &[R1, 3_800],
                gates: &[
                    gate(0, 500),
                    gate(0, 1_500),
                    gate(0, 2_500),
                    gate(1, 750),
                    timing(1, 2_250),
                ],
                crates: &[],
                walls: &[],
                obstacles: &FORTRESS,
                pads: &[pad(0, 2_600, 600, 3_200), pad(2_400, 2_600, 3_000, 3_200)],
                pipes: &[],
            },
        ],
    },
];

#[cfg(test)]
mod tests;
