// Pure helpers over the level pool (constants.ts LAYOUTS), mirroring crates/sim/src/layouts.rs.
import * as C from './constants';
import type { GateOp } from './types';

/** The layout with this id (out of range → layout 0, like the sim). */
export const layoutDef = (id: number): C.LayoutDef => C.LAYOUTS[id] ?? C.LAYOUTS[0]!;

/** One stage of a layout (out of range → that layout's last stage, like the sim). */
export function stageDef(layout: number, stage: number): C.StageDef {
  const l = layoutDef(layout);
  return l.stages[stage] ?? l.stages[C.STAGES - 1]!;
}

/** crates/sim `GateDef::x_at`: centre x `t` ticks into the player's Fight (ping-pong). The Rush
 *  keeps counting the Fight's ticks, so pass the lane's `phaseTick` there too. */
export function gateXAt(g: C.GateDef, t: number): number {
  const range = g.xMax - g.xMin;
  if (g.speed === 0 || range <= 0) return g.x;
  const period = range * 2;
  const off = Math.min(Math.max(g.x - g.xMin, 0), range);
  const start = g.speed > 0 ? off : period - off;
  const u = (start + Math.abs(g.speed) * t) % period;
  return g.xMin + (u <= range ? u : period - u);
}

export const gateMoving = (g: C.GateDef): boolean => g.speed !== 0 && g.xMax > g.xMin;

/** crates/sim `covers` (SPEC §6): `x` is inside a gate (or crate) of `width` centred on `centre`,
 *  edges included, plus GATE_GRACE on each side: |x − centre| · 2 ≤ width + 2 · GATE_GRACE. */
export const covers = (x: number, centre: number, width: number): boolean =>
  Math.abs(x - centre) * 2 <= Math.abs(width + 2 * C.GATE_GRACE);

/** crates/sim `StageDef::gate_at`: the gate slot of `row` a cohort at `x` goes through, or -1 in a
 *  gap. Of the gates that cover `x`, the nearest centre wins, the lower slot on ties.
 *  `gateX(slot, def)` is that gate's centre right now (default: its start x). */
export function gateAt(st: C.StageDef, row: number, x: number, gateX: (slot: number, def: C.GateDef) => number = (_, d) => d.x): number {
  let best = -1;
  let bestD = Infinity;
  st.gates.forEach((def, slot) => {
    if (def.row !== row) return;
    const centre = gateX(slot, def);
    const d = Math.abs(x - centre);
    if (covers(x, centre, def.width) && d < bestD) {
      best = slot;
      bestD = d;
    }
  });
  return best;
}

/** The crate that locks gate `slot` of a stage, or -1: a crate just below a big gate's row,
 *  covering its span (crates/sim/src/layouts.rs `lock`). Rules v8: other crates stand alone. */
export function crateOfGate(st: C.StageDef, slot: number): number {
  const g = st.gates[slot];
  const rowY = g ? st.rows[g.row] : undefined;
  if (!g || !g.big || rowY === undefined) return -1;
  return st.crates.findIndex((c) => Math.abs(c.x - g.x) * 2 <= g.width && c.y < rowY && rowY - c.y <= 500);
}

/** Score from the fights alone once the final stage is cleared: every tower's HP of every stage
 *  (1 per point of damage actually dealt) plus TOWER_BONUS per tower (FIRST comes on top). */
export function fightGold(layout: number): number {
  const l = layoutDef(layout);
  let gold = 0;
  for (const st of l.stages) for (const t of st.towers) gold += t.hp + C.TOWER_BONUS;
  return gold;
}

/** SPEC_V5 §3: the timing gate's value `t` ticks into a Fight (the lane's `phaseTick`; the
 *  Rush keeps counting it): ×1 → ×TIMING_MAX, one step every TIMING_STEP_TICKS. */
export const timingValue = (t: number): number => 1 + (Math.floor(Math.max(0, t) / C.TIMING_STEP_TICKS) % C.TIMING_MAX);

/** SPEC_V5 §3: ×k → c·k, ÷k → floor(c/k), +n → c+n, −n → max(0, c−n). */
export function applyOp(op: GateOp, c: number): number {
  switch (op.kind) {
    case 'mul':
      return c * op.value;
    case 'div':
      return op.value === 0 ? 0 : Math.floor(c / op.value);
    case 'add':
      return c + op.value;
    case 'sub':
      return Math.max(0, c - op.value);
  }
}

/** ÷ and − hurt the cohort (the "bad" reveal). */
export const opBad = (op: GateOp): boolean => op.kind === 'div' || op.kind === 'sub';

/** Short label: ×3, ÷2, +15, −5. */
export const opLabel = (op: GateOp): string =>
  ({ mul: '×', div: '÷', add: '+', sub: '−' })[op.kind] + String(op.value);

/** Op byte of the codec, the WASM views and the deals: the kind in the top two bits, the value
 *  below (k = ×k, 0x40 | n = +n, 0x80 | k = ÷k, 0xC0 | n = −n); 0 = none (face-down). */
export function opFromByte(b: number): GateOp | null {
  if (!b) return null;
  const value = b & 0x3f;
  switch (b & 0xc0) {
    case 0x40:
      return { kind: 'add', value };
    case 0x80:
      return { kind: 'div', value };
    case 0xc0:
      return { kind: 'sub', value };
    default:
      return { kind: 'mul', value };
  }
}

// --- rules v8 / v10 geometry (crates/sim/src/layouts.rs StageDef methods; integer, exact mirrors) -

/** crates/sim `inside_obstacle`: (x, y) is inside obstacle `o` grown by `grace` (the rules use
 *  OBSTACLE_GRACE): inside the box grown by `grace` on every side and, for a wedge, on the inner
 *  side of its hypotenuse moved `grace` toward the open side (along x). */
export function insideObstacle(o: C.ObstacleDef, x: number, y: number, grace: number): boolean {
  if (x < o.x0 - grace || x > o.x1 + grace || y < o.y0 - grace || y > o.y1 + grace) return false;
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  let ax: number;
  let ay: number;
  switch (o.shape) {
    case 'rect':
      return true;
    case 'wedgeBL':
      [ax, ay] = [x - grace - o.x0, y - o.y0];
      break;
    case 'wedgeBR':
      [ax, ay] = [o.x1 - x - grace, y - o.y0];
      break;
    case 'wedgeTL':
      [ax, ay] = [x - grace - o.x0, o.y1 - y];
      break;
    case 'wedgeTR':
      [ax, ay] = [o.x1 - x - grace, o.y1 - y];
      break;
  }
  return ax * h + ay * w <= w * h;
}

const wallActive = (w: C.WallDef, y: number) => w.y0 <= y && y <= w.y1;

/** crates/sim `StageDef::wall_push`: inside a standing wall's thickness → the nearer side (ties left). */
export function wallPush(st: C.StageDef, x: number, y: number): number {
  for (const w of st.walls) {
    if (wallActive(w, y) && Math.abs(x - w.x) <= C.WALL_HALF) x = x <= w.x ? w.x - C.WALL_HALF - 1 : w.x + C.WALL_HALF + 1;
  }
  return x;
}

/** crates/sim `StageDef::column_at`: the x range between the walls standing at `y` around `x`. */
export function columnAt(st: C.StageDef, x: number, y: number): [number, number] {
  let lo = 0;
  let hi = C.LANE_WIDTH - 1;
  for (const w of st.walls) {
    if (!wallActive(w, y)) continue;
    if (w.x < x) lo = Math.max(lo, w.x + C.WALL_HALF + 1);
    else hi = Math.min(hi, w.x - C.WALL_HALF - 1);
  }
  return [lo, hi];
}

/** crates/sim `StageDef::blocked`: the first obstacle (list order) (x, y) is inside, or -1. */
export const obstacleAt = (st: C.StageDef, x: number, y: number): number =>
  st.obstacles.findIndex((o) => insideObstacle(o, x, y, C.OBSTACLE_GRACE));

const stepToward = (x: number, target: number, step: number) => x + Math.min(Math.max(target - x, -step), step);

/** crates/sim `StageDef::slide`: where a crowd at (x, y) blocked by obstacle `ix` slides to. */
export function slideX(st: C.StageDef, ix: number, x: number, y: number): number {
  const o = st.obstacles[ix];
  if (!o) return x;
  const [lo, hi] = columnAt(st, x, y);
  const left = o.x0 - C.OBSTACLE_GRACE - 1;
  const right = o.x1 + C.OBSTACLE_GRACE + 1;
  const canL = left >= lo;
  const canR = right <= hi;
  const openRight = o.shape === 'wedgeBL' || o.shape === 'wedgeTL';
  let target: number;
  if (o.shape === 'rect' && canL && canR) target = right - x < x - left ? right : left;
  else if (!openRight && canL) target = left;
  else if (canR) target = right;
  else if (openRight && canL) target = left;
  else return x;
  const to = stepToward(x, target, C.SLIDE_STEP);
  return st.obstacles.some((p, i) => i !== ix && insideObstacle(p, to, y, C.OBSTACLE_GRACE)) ? x : to;
}

/** crates/sim `StageDef::advance`: one tick of a crowd moving `dy` in y (mine up, enemies down).
 *  Blocked at the end point or halfway → no y, a slide instead. Returns the new [x, y]. */
export function advance(st: C.StageDef, x: number, y: number, dy: number): [number, number] {
  const to = y + dy;
  const mid = y + Math.trunc(dy / 2);
  let ix = obstacleAt(st, x, mid);
  if (ix < 0) ix = obstacleAt(st, x, to);
  return ix >= 0 ? [slideX(st, ix, x, y), y] : [x, to];
}

const inBox = (b: { x0: number; y0: number; x1: number; y1: number }, x: number, y: number) =>
  b.x0 <= x && x <= b.x1 && b.y0 <= y && y <= b.y1;

/** crates/sim `StageDef::on_pad`: a speed pad under (x, y). */
export const onPad = (st: C.StageDef, x: number, y: number): boolean => st.pads.some((p) => inBox(p, x, y));

/** crates/sim `StageDef::pipe_at`: the index of the pipe whose entrance (x, y) is in, or -1. */
export const pipeAt = (st: C.StageDef, x: number, y: number): number => st.pipes.findIndex((p) => inBox(p, x, y));

/** crates/sim `StageDef::crate_hold` (rules v10): an enemy at (x, y) about to move down to `to`
 *  stops at `crate.y + CRATE_HOLD` instead if that move crosses the line of a live crate
 *  (`crates[i] > 0`, the lane's crate HP) inside its span (`covers`); it never moves back up.
 *  Returns the new y. The sim applies it after the obstacle slide and before the wall push. */
export function crateHold(st: C.StageDef, crates: readonly number[], x: number, y: number, to: number): number {
  st.crates.forEach((c, i) => {
    const stop = c.y + C.CRATE_HOLD;
    if ((crates[i] ?? 0) > 0 && y > c.y && to < stop && covers(x, c.x, c.width)) to = Math.max(to, Math.min(stop, y));
  });
  return to;
}

/** crates/sim `StageDef::crate_between` (rules v10): a live crate's line lies between an enemy at
 *  `foeY` and my cohort at `myY` (foeY < line ≤ myY) with `x` (the clash point) inside its span:
 *  no clash through it. */
export const crateBetween = (st: C.StageDef, crates: readonly number[], x: number, myY: number, foeY: number): boolean =>
  st.crates.some((c, i) => (crates[i] ?? 0) > 0 && foeY < c.y && c.y <= myY && covers(x, c.x, c.width));

/** crates/sim step.rs `move_enemies`: one tick of an enemy cohort (straight down at its speed,
 *  sliding round obstacles, held behind a live crate, pushed out of a wall it enters). Returns
 *  the new [x, y]. `crates` is the lane's crate HP after my cohorts moved this tick. */
export function enemyStep(st: C.StageDef, crates: readonly number[], x: number, y: number, giant: boolean): [number, number] {
  const [nx, ny] = advance(st, x, y, -(giant ? C.GIANT_SPEED : C.CRUISE_SPEED));
  const held = crateHold(st, crates, nx, y, ny);
  return [wallPush(st, nx, held), held];
}

/** crates/sim `StageDef::rows_through`: rows at or below `y` (a pipe's exit skips them). */
export const rowsThrough = (st: C.StageDef, y: number): number => st.rows.filter((r) => r <= y).length;

// --- rules v9 homing (crates/sim/src/step.rs `cohort_target`, `turn_due`, `steer`) ---------------

/** crates/sim step.rs `turn_due` (rules v9 late turn): a cohort at (x, y) heading for a tower (or
 *  the hall) at `tx` walks straight until the distance left to the tower line is just enough to
 *  close the gap at TOWER_STEER per cruise step, plus TURN_MARGIN. */
export const turnDue = (x: number, y: number, tx: number): boolean =>
  C.TOWER_Y - y <= Math.trunc((Math.abs(tx - x) * C.CRUISE_SPEED) / C.TOWER_STEER) + C.TURN_MARGIN;

/** crates/sim step.rs `cohort_target` (rules v9): where a cohort of mine past the last row steers
 *  this tick, as [target x, step], or null to walk straight. The nearest enemy ahead by at most
 *  ENGAGE_Y and at most ENGAGE_X sideways (STEER_STEP); else, once `turnDue`, the nearest live
 *  tower (HALL_X in the Rush) at TOWER_STEER. Ties go to the lower index. `towerHp` is the lane's
 *  tower HP, in the stage's tower order. */
export function homing(
  st: C.StageDef,
  x: number,
  y: number,
  enemies: readonly { x: number; y: number; count: number }[],
  towerHp: readonly number[],
  rush: boolean,
): [number, number] | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (const e of enemies) {
    const ahead = e.y - y;
    if (e.count === 0 || ahead <= 0 || ahead > C.ENGAGE_Y || Math.abs(e.x - x) > C.ENGAGE_X) continue;
    const d = (x - e.x) ** 2 + (y - e.y) ** 2;
    if (d < bestD) [best, bestD] = [e.x, d];
  }
  if (best !== null) return [best, C.STEER_STEP];
  let tx: number | null = rush ? C.HALL_X : null;
  if (!rush) {
    st.towers.forEach((t, i) => {
      const d = Math.abs(t.x - x);
      if ((towerHp[i] ?? 0) > 0 && d < bestD) [tx, bestD] = [t.x, d];
    });
  }
  return tx !== null && turnDue(x, y, tx) ? [tx, C.TOWER_STEER] : null;
}

/** crates/sim step.rs `steer`: `x` moved toward `target` by at most `step`, kept on the lane and,
 *  while a wall stands at `y`, inside its column. */
export function steerX(st: C.StageDef, x: number, target: number, step: number, y: number): number {
  const to = Math.min(Math.max(stepToward(x, target, step), 0), C.LANE_WIDTH - 1);
  const [lo, hi] = columnAt(st, x, y);
  return Math.min(Math.max(to, lo), hi);
}
