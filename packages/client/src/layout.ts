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

/** crates/sim `GateDef::x_at`: centre x `t` ticks into the player's Fight (ping-pong). The raid
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
 *  covering its span (crates/sim/src/layouts.rs `lock`). */
export function crateOfGate(st: C.StageDef, slot: number): number {
  const g = st.gates[slot];
  const rowY = g ? st.rows[g.row] : undefined;
  if (!g || rowY === undefined) return -1;
  return st.crates.findIndex((c) => Math.abs(c.x - g.x) * 2 <= g.width && c.y < rowY && rowY - c.y <= 500);
}

/** Gold a player has when the town hall raid starts: every tower's HP of every stage (1 gold per
 *  point of damage actually dealt) plus TOWER_BONUS per tower. The raid only starts once the
 *  final stage's last tower is down, so this is exact. */
export function fightGold(layout: number): number {
  const l = layoutDef(layout);
  let gold = 0;
  for (const st of l.stages) for (const t of st.towers) gold += t.hp + C.TOWER_BONUS;
  return gold;
}

/** SPEC §6: ×k → c·k, ÷k → floor(c/k). */
export function applyOp(op: GateOp, c: number): number {
  return op.kind === 'mul' ? c * op.value : op.value === 0 ? 0 : Math.floor(c / op.value);
}

/** Op byte of the codec / deals (k = ×k, 0x80 | k = ÷k); 0 = none (face-down). */
export const opFromByte = (b: number): GateOp | null =>
  b === 0 ? null : b & 0x80 ? { kind: 'div', value: b & 0x7f } : { kind: 'mul', value: b };

/** Signed op of the WASM flat layouts (+k = ×k, −k = ÷k); 0 = none. */
export const opFromSigned = (n: number): GateOp | null =>
  n === 0 ? null : n < 0 ? { kind: 'div', value: -n } : { kind: 'mul', value: n };
