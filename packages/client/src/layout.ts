// Pure helpers over the level pool (constants.ts LAYOUTS), mirroring crates/sim/src/layouts.rs.
import * as C from './constants';
import type { GateOp } from './types';

/** The layout with this id (out of range → layout 0, like the sim). */
export const layoutDef = (id: number): C.LayoutDef => C.LAYOUTS[id] ?? C.LAYOUTS[0]!;

/** One stage of a layout (out of range → that layout's Raid, like the sim). */
export function stageDef(layout: number, stage: number): C.StageDef {
  const l = layoutDef(layout);
  return l.stages[stage] ?? l.stages[C.STAGES - 1]!;
}

/** crates/sim `GateDef::x_at`: centre x `t` ticks into the player's Fight/Raid (ping-pong). */
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

/** The crate that locks gate `slot` of a stage, or -1: a crate just below a big gate's row,
 *  covering its span (crates/sim/src/layouts.rs `lock`). */
export function crateOfGate(st: C.StageDef, slot: number): number {
  const g = st.gates[slot];
  const rowY = g ? st.rows[g.row] : undefined;
  if (!g || rowY === undefined) return -1;
  return st.crates.findIndex((c) => Math.abs(c.x - g.x) * 2 <= g.width && c.y < rowY && rowY - c.y <= 500);
}

/** Gold a player has when entering the Raid: every fight tower's HP (1 gold per point of damage
 *  actually dealt) plus TOWER_BONUS per tower. A fight only ends when all its towers are down. */
export function fightGold(layout: number): number {
  const l = layoutDef(layout);
  let gold = 0;
  for (const st of l.stages.slice(0, C.RAID_STAGE)) for (const t of st.towers) gold += t.hp + C.TOWER_BONUS;
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
