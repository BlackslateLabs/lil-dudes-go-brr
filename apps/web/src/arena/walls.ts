// Divider walls and columns of the current stage (rules v7), read defensively so the web builds
// whether or not `packages/client` exposes them yet.

import * as Client from '@lil-dudes/client';
import { LANE_WIDTH, stageDef } from '@lil-dudes/client';

/** A divider wall: its centre line `x`, active (crowds can't cross it) for y in [y0, y1]. Sim units. */
export interface WallDef {
  x: number;
  y0: number;
  y1: number;
}

/** Half the wall's thickness in sim units (`WALL_HALF` in the client constants). */
export const WALL_HALF: number = (Client as unknown as { WALL_HALF?: number }).WALL_HALF ?? 60;

const NONE: readonly WallDef[] = [];

/** The walls of one stage (none before rules v7). */
export function wallsOf(layout: number, stage: number): readonly WallDef[] {
  return (stageDef(layout, stage) as { walls?: readonly WallDef[] }).walls ?? NONE;
}

/** Gates fill ~84% of their column, so a column is the widest normal gate / 0.84 (2 or 3 per lane). */
const colCache = new Map<string, number>();
export function columnWidth(layout: number, stage: number): number {
  const key = `${layout}|${stage}`;
  const hit = colCache.get(key);
  if (hit !== undefined) return hit;
  let w = 0;
  for (const g of stageDef(layout, stage).gates) if (!g.big) w = Math.max(w, g.width);
  const col = Math.min(LANE_WIDTH / 2, Math.max(LANE_WIDTH / 3, w / 0.84));
  colCache.set(key, col);
  return col;
}

/**
 * The free span [lo, hi] (sim x) around a point: bounded by the nearest active wall on each side,
 * or, with no wall on a side, half a column out from `x`; always inside the lane. Writes into `out`.
 */
export function spanAt(walls: readonly WallDef[], col: number, x: number, y: number, out: { lo: number; hi: number }) {
  let lo = -Infinity;
  let hi = Infinity;
  for (const w of walls) {
    if (y < w.y0 || y > w.y1) continue;
    if (w.x <= x) lo = Math.max(lo, w.x + WALL_HALF);
    else hi = Math.min(hi, w.x - WALL_HALF);
  }
  if (lo === -Infinity) lo = x - col / 2;
  if (hi === Infinity) hi = x + col / 2;
  out.lo = Math.max(0, lo);
  out.hi = Math.min(LANE_WIDTH, hi);
}
