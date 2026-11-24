use super::*;
use crate::constants::*;

/// A sliding gate (none of the layouts has one: the mechanism stays, see SPEC_V5 §12).
const fn slide(row: u8, x: i16, x_min: i16, x_max: i16, speed: i16) -> GateDef {
    GateDef {
        x_min,
        x_max,
        speed,
        ..gate(row, x)
    }
}

/// An empty stage to build test stages from.
const BARE: StageDef = StageDef {
    towers: &[],
    rows: &[],
    gates: &[],
    crates: &[],
    walls: &[],
    obstacles: &[],
    pads: &[],
    pipes: &[],
};

const G: i32 = OBSTACLE_GRACE;

/// The obstacle's box grown by the grace overlaps the rectangle (conservative for wedges).
fn box_overlaps(o: &ObstacleDef, x0: i32, y0: i32, x1: i32, y1: i32) -> bool {
    i32::from(o.x0) - G <= x1
        && x0 <= i32::from(o.x1) + G
        && i32::from(o.y0) - G <= y1
        && y0 <= i32::from(o.y1) + G
}

/// Coarse flood fill (SPEC_V5 §13: no sealed pocket): 50 × 50 cells, a cell is solid when its
/// centre is inside an obstacle (with the grace) or a standing wall's thickness. Returns which
/// cells are reachable from the cannon line.
const CELL: i32 = 50;
fn reachable(st: &StageDef) -> Vec<Vec<bool>> {
    let (nx, ny) = ((LANE_WIDTH / CELL) as usize, (TOWER_Y / CELL) as usize + 1);
    let centre = |i: usize, j: usize| (i as i32 * CELL + CELL / 2, j as i32 * CELL + CELL / 2);
    let solid = |i: usize, j: usize| {
        let (x, y) = centre(i, j);
        st.blocked(x, y).is_some()
            || st
                .walls
                .iter()
                .any(|w| w.active(y) && (x - i32::from(w.x)).abs() <= WALL_HALF)
    };
    let mut seen = vec![vec![false; ny]; nx];
    let mut todo: Vec<(usize, usize)> = (0..nx).filter(|&i| !solid(i, 0)).map(|i| (i, 0)).collect();
    for &(i, j) in &todo {
        seen[i][j] = true;
    }
    while let Some((i, j)) = todo.pop() {
        let mut next = vec![];
        if i > 0 {
            next.push((i - 1, j));
        }
        if i + 1 < nx {
            next.push((i + 1, j));
        }
        if j > 0 {
            next.push((i, j - 1));
        }
        if j + 1 < ny {
            next.push((i, j + 1));
        }
        for (a, b) in next {
            if !seen[a][b] && !solid(a, b) {
                seen[a][b] = true;
                todo.push((a, b));
            }
        }
    }
    seen
}

#[test]
fn layouts_follow_the_design_rules() {
    let mut names = std::collections::HashSet::new();
    for (id, l) in LAYOUTS.iter().enumerate() {
        assert!(names.insert(l.name), "duplicate name {}", l.name);
        let mut locked = 0;
        for (s, st) in l.stages.iter().enumerate() {
            let ctx = format!("layout {id} ({}) stage {s}", l.name);

            // Towers: 1 in Fight 1, 2 in Fight 2, inside the lane, apart.
            assert_eq!(st.towers.len(), [1, 2][s], "{ctx}");
            for t in st.towers {
                assert!(t.hp > 0 && t.wave_base > 0, "{ctx}");
                let x = i32::from(t.x);
                assert!(
                    (TOWER_HALF_W..=LANE_WIDTH - TOWER_HALF_W).contains(&x),
                    "{ctx}"
                );
            }
            if let [a, b] = st.towers {
                assert!((a.x - b.x).abs() >= 2 * TOWER_HALF_W as i16, "{ctx}");
            }

            // Rows: 2..=ROWS_MAX, row 1 right in front of the cannon, ascending, all well
            // short of the towers.
            assert!((2..=ROWS_MAX).contains(&st.rows.len()), "{ctx}");
            assert!(
                (900..=1_100).contains(&st.rows[0]),
                "{ctx}: row 1 at {}",
                st.rows[0]
            );
            for w in st.rows.windows(2) {
                assert!(w[1] - w[0] > 1_000, "{ctx}: rows too close");
            }
            let last = i32::from(*st.rows.last().unwrap());
            assert!(last <= 5_000, "{ctx}: last row too late");

            // Gates: ≤ GATES_MAX, sorted by row then x, static, inside the lane, exactly one
            // timing gate and 3–5 hidden ones.
            assert!(st.gates.len() <= GATES_MAX, "{ctx}");
            let timing = st.gates.iter().filter(|g| g.slot == Slot::Timing).count();
            assert_eq!(timing, 1, "{ctx}: one timing gate per stage");
            let hidden = st.gates.len() - timing;
            assert!((3..=5).contains(&hidden), "{ctx}: {hidden} hidden gates");
            for w in st.gates.windows(2) {
                assert!((w[0].row, w[0].x) < (w[1].row, w[1].x), "{ctx}: slot order");
            }
            for g in st.gates {
                let row_y = i32::from(st.rows[usize::from(g.row)]);
                assert!(
                    !g.moving() && (g.x_min, g.x_max) == (g.x, g.x),
                    "{ctx}: no sliders"
                );
                let (lo, hi) = (i32::from(g.x - g.width / 2), i32::from(g.x + g.width / 2));
                assert!(
                    0 <= lo && hi <= LANE_WIDTH,
                    "{ctx}: gate at {} off the lane",
                    g.x
                );
                // SPEC_V5 §3b: an exposed big gate sits early and off-centre.
                let crated = st
                    .crates
                    .iter()
                    .any(|c| c.x == g.x && i32::from(c.y) < row_y);
                if g.slot == Slot::Big && !crated {
                    assert!(g.row <= 1, "{ctx}: exposed big gate past row 2");
                    assert_ne!(i32::from(g.x), LANE_WIDTH / 2, "{ctx}: exposed big centred");
                }
                // Never through a standing wall (the grace edges may reach into its thickness).
                let reach = i32::from(g.width) / 2 + GATE_GRACE;
                for w in st.walls.iter().filter(|w| w.active(row_y)) {
                    let d = (i32::from(g.x) - i32::from(w.x)).abs();
                    assert!(
                        d >= reach - WALL_HALF,
                        "{ctx}: gate at {} through a wall",
                        g.x
                    );
                }
                // No obstacle on the gate's span.
                for x in (lo..=hi).step_by(10) {
                    assert!(
                        st.blocked(x, row_y).is_none(),
                        "{ctx}: obstacle on gate {}",
                        g.x
                    );
                }
            }
            // Gates of one row don't overlap; row 1 is 2–3 near-touching gates over the lane.
            for row in 0..st.rows.len() as u8 {
                let gs: Vec<&GateDef> = st.gates.iter().filter(|g| g.row == row).collect();
                assert!(!gs.is_empty(), "{ctx}: empty row {row}");
                for w in gs.windows(2) {
                    assert!(w[0].x + w[0].width / 2 <= w[1].x - w[1].width / 2, "{ctx}");
                }
            }
            let first = st.gates.iter().filter(|g| g.row == 0).count();
            assert!((2..=3).contains(&first), "{ctx}: row 1 has {first} gates");
            for x in 0..LANE_WIDTH {
                assert!(
                    st.gate_at(0, x, |_, g| i32::from(g.x)).is_some(),
                    "{ctx}: gap at {x}"
                );
            }

            // Crates: inside the lane; one that sits just below a gate (and covers it) locks it,
            // so that gate is big, the crate CRATE_GAP below it and at least as wide.
            assert!(st.crates.len() <= CRATES_MAX, "{ctx}");
            for c in st.crates {
                assert!(c.hp > 0, "{ctx}");
                let (lo, hi) = (i32::from(c.x - c.width / 2), i32::from(c.x + c.width / 2));
                assert!(0 <= lo && hi <= LANE_WIDTH, "{ctx}: crate off the lane");
                for g in st.gates {
                    let row_y = st.rows[usize::from(g.row)];
                    let below = c.y < row_y && row_y - c.y <= 500;
                    if below && (c.x - g.x).abs() * 2 <= g.width {
                        assert_eq!(g.slot, Slot::Big, "{ctx}: a crate under a small gate");
                        assert_eq!(c.y, row_y - CRATE_GAP, "{ctx}");
                        assert!(c.width >= g.width, "{ctx}");
                        locked += 1;
                    }
                }
                let lo = i32::from(c.x - c.width / 2);
                for x in (lo..=hi).step_by(10) {
                    assert!(
                        st.blocked(x, i32::from(c.y)).is_none(),
                        "{ctx}: crate in a block"
                    );
                }
            }
            // At most one line (crate or row) crossed per tick, even at launch speed.
            let mut lines: Vec<i32> = st.rows.iter().map(|&y| i32::from(y)).collect();
            lines.extend(st.crates.iter().map(|c| i32::from(c.y)));
            lines.sort();
            // (Crates side by side on one line are one line.)
            lines.dedup();
            assert!(lines[0] > LAUNCH_SPEED, "{ctx}");
            for w in lines.windows(2) {
                assert!(w[1] - w[0] > LAUNCH_SPEED, "{ctx}: lines too close");
            }

            // Walls: inside the lane, past the cannon (it and fresh volleys move freely),
            // ending before the clash zone at the towers; sorted.
            for w in st.walls {
                let x = i32::from(w.x);
                assert!(0 < x && x < LANE_WIDTH, "{ctx}");
                assert!(i32::from(w.y0) > LAUNCH_SPEED && w.y0 < st.rows[0], "{ctx}");
                assert!(
                    w.y0 < w.y1 && i32::from(w.y1) < TOWER_Y - 4 * CLASH_BAND,
                    "{ctx}"
                );
            }
            for w in st.walls.windows(2) {
                assert!(w[0].x < w[1].x, "{ctx}: walls not sorted");
            }

            // Obstacles: proper boxes inside the lane, past row 1 and short of the towers, thick
            // enough that no move (even at launch speed) jumps one.
            for o in st.obstacles {
                assert!(o.x0 < o.x1 && o.y0 < o.y1, "{ctx}: {o:?}");
                assert!(0 <= o.x0 && i32::from(o.x1) <= LANE_WIDTH, "{ctx}: {o:?}");
                assert!(o.y0 > st.rows[0] + 200, "{ctx}: {o:?} before row 1");
                assert!(
                    i32::from(o.y1) + G < TOWER_Y - 2 * CLASH_BAND,
                    "{ctx}: {o:?}"
                );
                assert!(
                    i32::from(o.y1 - o.y0) + 2 * G > LAUNCH_SPEED,
                    "{ctx}: {o:?} too thin"
                );
            }
            // Speed pads: inside the lane, off the obstacles.
            for p in st.pads {
                assert!(p.x0 < p.x1 && p.y0 < p.y1, "{ctx}");
                assert!(0 <= p.x0 && i32::from(p.x1) <= LANE_WIDTH, "{ctx}");
                assert!(
                    p.y0 > st.rows[0] && i32::from(p.y1) < TOWER_Y - 2 * CLASH_BAND,
                    "{ctx}"
                );
                for o in st.obstacles {
                    let (x0, y0, x1, y1) = (p.x0.into(), p.y0.into(), p.x1.into(), p.y1.into());
                    assert!(!box_overlaps(o, x0, y0, x1, y1), "{ctx}: pad on {o:?}");
                }
            }
            // Pipes: the entrance inside the lane and too tall to jump, no gate row or crate
            // inside it; the exit further up, on the lane, clear of obstacles and walls.
            for p in st.pipes {
                assert!(
                    p.x0 < p.x1 && 0 <= p.x0 && i32::from(p.x1) < LANE_WIDTH,
                    "{ctx}"
                );
                assert!(
                    i32::from(p.y1 - p.y0) > LAUNCH_SPEED && p.y0 > st.rows[0],
                    "{ctx}"
                );
                for &line in &lines {
                    assert!(
                        !(i32::from(p.y0)..=i32::from(p.y1)).contains(&line),
                        "{ctx}"
                    );
                }
                let (ox, oy) = (i32::from(p.out_x), i32::from(p.out_y));
                assert!((0..LANE_WIDTH).contains(&ox), "{ctx}");
                assert!(p.out_y > p.y1 && oy < TOWER_Y - 2 * CLASH_BAND, "{ctx}");
                assert!(
                    st.blocked(ox, oy).is_none(),
                    "{ctx}: pipe exit in an obstacle"
                );
                assert_eq!(st.wall_push(ox, oy), ox, "{ctx}: pipe exit in a wall");
                assert!(st.pipe_at(ox, oy).is_none(), "{ctx}");
            }

            // No sealed pocket: every tower is reachable from the cannon line, and every
            // cannon x on the line is open (the coarse grid; the path tests in step::tests
            // follow the real movement rules).
            let seen = reachable(st);
            for t in st.towers {
                let (i, j) = ((t.x as i32 / CELL) as usize, (TOWER_Y / CELL) as usize - 1);
                assert!(seen[i][j], "{ctx}: tower at {} sealed off", t.x);
            }
        }
        assert!(
            locked <= 1,
            "layout {id}: more than one crate-locked big gate"
        );
    }
}

#[test]
fn rects_are_inside_with_the_grace() {
    let o = rect(1_000, 2_000, 1_200, 2_100);
    assert!(inside_obstacle(&o, 1_100, 2_050, G));
    assert!(inside_obstacle(&o, 1_000 - G, 2_000 - G, G));
    assert!(inside_obstacle(&o, 1_200 + G, 2_100 + G, G));
    assert!(!inside_obstacle(&o, 1_000 - G - 1, 2_050, G));
    assert!(!inside_obstacle(&o, 1_100, 2_100 + G + 1, G));
    assert!(!inside_obstacle(&o, 999, 2_050, 0) && inside_obstacle(&o, 1_000, 2_050, 0));
}

#[test]
fn wedges_are_the_right_triangle_at_their_corner() {
    // A 1,000 × 1,000 box at (1,000, 2,000): each wedge holds its right-angle corner and not the
    // opposite one; the hypotenuse's midpoint is on the edge (inside); just past it toward the
    // open side, more than the grace away, is outside.
    let (x0, y0, x1, y1) = (1_000, 2_000, 2_000, 3_000);
    let corners = [(x0, y0), (x1, y0), (x0, y1), (x1, y1)];
    for (shape, corner, far) in [
        (Shape::WedgeBL, 0, 3),
        (Shape::WedgeBR, 1, 2),
        (Shape::WedgeTL, 2, 1),
        (Shape::WedgeTR, 3, 0),
    ] {
        let o = wedge(shape, x0 as i16, y0 as i16, x1 as i16, y1 as i16);
        let (cx, cy) = corners[corner];
        let (fx, fy) = corners[far];
        assert!(inside_obstacle(&o, cx, cy, 0), "{shape:?}");
        assert!(!inside_obstacle(&o, fx, fy, 0), "{shape:?}");
        assert!(inside_obstacle(&o, 1_500, 2_500, 0), "{shape:?}");
        // The open side: +x for the L wedges, −x for the R ones.
        let open = if matches!(shape, Shape::WedgeBL | Shape::WedgeTL) {
            1
        } else {
            -1
        };
        assert!(inside_obstacle(&o, 1_500 + open * G, 2_500, G), "{shape:?}");
        assert!(
            !inside_obstacle(&o, 1_500 + open * (G + 2), 2_500, G),
            "{shape:?}"
        );
    }
    // WedgeTL: narrow at the bottom (x0 at y0), widest at the top.
    let o = wedge(Shape::WedgeTL, 0, 1_900, 1_000, 3_500);
    assert!(inside_obstacle(&o, 0, 1_900, 0) && !inside_obstacle(&o, 100, 1_900, 0));
    assert!(inside_obstacle(&o, 999, 3_500, 0));
}

#[test]
fn a_blocked_crowd_slides_to_the_nearer_reachable_side() {
    const ONE: [ObstacleDef; 1] = [rect(1_000, 2_000, 1_400, 2_100)];
    let st = StageDef {
        obstacles: &ONE,
        ..BARE
    };
    // Free sides: 939 and 1,461. Nearer wins, ties left, SLIDE_STEP at most.
    assert_eq!(st.slide(0, 1_100, 1_900), 1_100 - SLIDE_STEP);
    assert_eq!(st.slide(0, 1_000, 1_900), 939);
    assert_eq!(st.slide(0, 1_200, 1_900), 1_200 - SLIDE_STEP);
    assert_eq!(st.slide(0, 1_201, 1_900), 1_201 + SLIDE_STEP);
    assert_eq!(st.slide(0, 1_400, 1_900), 1_461);
    // Blocked → no y, a slide; clear → straight up. The halfway point counts too.
    assert_eq!(st.advance(1_200, 1_900, 60), (1_050, 1_900));
    assert_eq!(st.advance(900, 1_900, 60), (900, 1_960));
    assert_eq!(st.advance(1_200, 1_700, 180), (1_200, 1_880));
    assert_eq!(st.advance(1_200, 1_800, 180), (1_050, 1_800));
    // Enemies come down onto its top the same way.
    assert_eq!(st.advance(1_420, 2_200, -60), (1_461, 2_200));
    // Against the lane edge or a standing wall, the other side.
    const EDGE: [ObstacleDef; 1] = [rect(0, 2_000, 850, 2_120)];
    const WALL: [WallDef; 1] = [wall(1_500, 600, 4_000)];
    const ARM: [ObstacleDef; 1] = [rect(600, 2_000, 1_440, 2_120)];
    let st = StageDef {
        obstacles: &EDGE,
        ..BARE
    };
    assert_eq!(st.slide(0, 100, 1_950), 250);
    let st = StageDef {
        obstacles: &ARM,
        walls: &WALL,
        ..BARE
    };
    assert_eq!(st.slide(0, 1_400, 1_950), 1_250);
    // With the wall gone the near side is free again.
    assert_eq!(st.slide(0, 1_400, 4_100), 1_501);
    // Never into another obstacle: then it waits.
    const TWO: [ObstacleDef; 2] = [
        rect(1_000, 2_000, 1_400, 2_100),
        rect(700, 1_800, 900, 1_950),
    ];
    let st = StageDef {
        obstacles: &TWO,
        ..BARE
    };
    assert_eq!(st.slide(0, 1_050, 1_900), 1_050);
}

#[test]
fn wedges_deflect_toward_their_open_side() {
    // The funnel pair: crowds slide toward the middle, whichever side is nearer.
    let st = StageDef {
        obstacles: &FUNNEL,
        ..BARE
    };
    assert_eq!(st.slide(0, 950, 3_400), 1_061);
    assert_eq!(st.slide(0, 300, 3_400), 450);
    assert_eq!(st.slide(1, 2_050, 3_400), 1_939);
    // The diamond splits a crowd left and right of its tip (list order breaks the tie).
    let st = StageDef {
        obstacles: &DIAMOND,
        ..BARE
    };
    assert_eq!(st.blocked(1_480, 2_160), Some(0));
    assert_eq!(st.slide(0, 1_480, 2_150), 1_330);
    // Right at the tip the first piece's grace wins; a little further right, the second's.
    assert_eq!(st.blocked(1_520, 2_160), Some(0));
    assert_eq!(st.blocked(1_570, 2_300), Some(1));
    assert_eq!(st.slide(1, 1_570, 2_250), 1_720);
    // Enemies coming down onto the top half go round it the same way.
    assert_eq!(st.slide(2, 1_000, 3_850), 850);
    assert_eq!(st.slide(3, 2_000, 3_850), 2_150);
}

#[test]
fn pads_pipes_and_rows_through() {
    let st = &LAYOUTS[3].stages[0];
    assert_eq!(st.pipe_at(500, 3_000).map(|(i, _)| i), Some(0));
    assert_eq!(st.pipe_at(2_999, 3_400).map(|(i, _)| i), Some(1));
    assert!(st.pipe_at(1_500, 3_200).is_none() && st.pipe_at(500, 3_401).is_none());
    assert_eq!(st.rows_through(5_600), 3);
    assert_eq!(st.rows_through(2_600), 2);
    assert_eq!(st.rows_through(999), 0);
    let st = &LAYOUTS[2].stages[0];
    assert!(st.on_pad(1_000, 2_000) && st.on_pad(900, 1_850) && !st.on_pad(899, 1_850));
    // Fight 2 mirrors Fight 1.
    let f2 = &LAYOUTS[2].stages[1];
    assert!(f2.on_pad(2_000, 2_000));
    assert_eq!(f2.obstacles[1], rect(1_560, 2_300, 2_400, 2_420));
    assert_eq!(
        mirror(wedge(Shape::WedgeTL, 0, 0, 100, 100)).shape,
        Shape::WedgeTR
    );
}

#[test]
fn walls_push_clamp_and_separate() {
    const WALLS: [WallDef; 2] = [wall(1_000, 500, 3_700), wall(2_000, 500, 3_700)];
    let st = StageDef {
        walls: &WALLS,
        ..BARE
    };
    let (y0, y1) = (500, 3_700);
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
        rows: &[1_400],
        gates: &GATES,
        ..BARE
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
