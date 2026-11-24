// Rules v8 level elements of a stage (obstacles, speed pads, pipes), read defensively so the web
// builds whether or not `packages/client` exposes them yet, plus the collision shapes the drawn
// crowds use to flow around them. Everything here is in sim units and purely cosmetic: the sim
// decides where a cohort goes; this only keeps each drawn dude out of the solid things.

import * as Client from '@lil-dudes/client';
import { LANE_WIDTH, stageDef } from '@lil-dudes/client';
import { WALL_HALF, wallsOf } from './columns';

export type ObstacleShape = 'rect' | 'wedgeBL' | 'wedgeBR' | 'wedgeTL' | 'wedgeTR';

/**
 * A solid block (sim units, x0 < x1, y0 < y1). A wedge is the right triangle inside the box with
 * its right angle at the named corner: B = the low-y side (toward the cannon), L = x0.
 */
export interface ObstacleDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  shape: ObstacleShape;
}

/** A speed pad: my dudes crossing it get a launch-speed boost. */
export interface PadDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A pipe: my cohort entering the entrance box comes out at (outX, outY). */
export interface PipeDef {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  outX: number;
  outY: number;
}

const NONE: readonly never[] = [];

type V8Stage = { obstacles?: readonly ObstacleDef[]; pads?: readonly PadDef[]; pipes?: readonly PipeDef[] };

export function obstaclesOf(layout: number, stage: number): readonly ObstacleDef[] {
  return (stageDef(layout, stage) as V8Stage).obstacles ?? NONE;
}

export function padsOf(layout: number, stage: number): readonly PadDef[] {
  return (stageDef(layout, stage) as V8Stage).pads ?? NONE;
}

export function pipesOf(layout: number, stage: number): readonly PipeDef[] {
  return (stageDef(layout, stage) as V8Stage).pipes ?? NONE;
}

/** The corners of an obstacle, counter-clockwise in sim (x right, y up the lane). */
export function obstacleCorners(o: ObstacleDef): [number, number][] {
  const { x0, y0, x1, y1 } = o;
  switch (o.shape) {
    case 'wedgeBL':
      return [[x0, y0], [x1, y0], [x0, y1]];
    case 'wedgeBR':
      return [[x0, y0], [x1, y0], [x1, y1]];
    case 'wedgeTL':
      return [[x0, y0], [x1, y1], [x0, y1]];
    case 'wedgeTR':
      return [[x1, y0], [x1, y1], [x0, y1]];
    default:
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  }
}

/**
 * Local copy of the client's `insideObstacle` (same meaning): (x, y) is inside the obstacle grown
 * by `grace` on every side. Used until `@lil-dudes/client` exports its own.
 */
function localInsideObstacle(o: ObstacleDef, x: number, y: number, grace: number): boolean {
  if (x < o.x0 - grace || x > o.x1 + grace || y < o.y0 - grace || y > o.y1 + grace) return false;
  if (o.shape === 'rect') return true;
  const w = o.x1 - o.x0;
  const h = o.y1 - o.y0;
  if (w <= 0 || h <= 0) return false;
  // Distance-free test against the hypotenuse, grown by grace along its normal.
  const u = o.shape === 'wedgeBL' || o.shape === 'wedgeTL' ? (x - o.x0) / w : (o.x1 - x) / w;
  const v = o.shape === 'wedgeBL' || o.shape === 'wedgeBR' ? (y - o.y0) / h : (o.y1 - y) / h;
  return (u + v - 1) * ((w * h) / Math.hypot(w, h)) <= grace;
}

/** The client's helper when it exists, else the local copy. */
export const insideObstacle: (o: ObstacleDef, x: number, y: number, grace: number) => boolean =
  (Client as unknown as { insideObstacle?: typeof localInsideObstacle }).insideObstacle ?? localInsideObstacle;

// ---- Collision shapes ---------------------------------------------------------------------------

/**
 * Every solid convex shape of a stage as half-planes: shape k has planes [start[k], start[k+1]),
 * each (nx, ny, c) with the outward normal n, inside iff n·p < c for all of them. Its box is
 * box[4k..4k+3] for a quick reject. `defs[k]` is the obstacle (null for a wall).
 */
export interface Solids {
  n: number;
  box: Float32Array;
  start: Int32Array;
  plane: Float32Array;
  defs: (ObstacleDef | null)[];
}

/** Walls are drawn ~1.6× their sim thickness (Walls.tsx), so the dudes keep off the drawn rail. */
const WALL_DRAWN_HALF = WALL_HALF * 1.6;

const solidsCache = new Map<string, Solids>();

/** The obstacles and divider walls of a stage as collision shapes (cached per stage). */
export function solidsOf(layout: number, stage: number): Solids {
  const key = `${layout}|${stage}`;
  const hit = solidsCache.get(key);
  if (hit) return hit;
  const polys: { corners: [number, number][]; def: ObstacleDef | null }[] = [];
  for (const o of obstaclesOf(layout, stage)) polys.push({ corners: obstacleCorners(o), def: o });
  for (const w of wallsOf(layout, stage)) {
    const x0 = w.x - WALL_DRAWN_HALF;
    const x1 = w.x + WALL_DRAWN_HALF;
    polys.push({ corners: [[x0, w.y0], [x1, w.y0], [x1, w.y1], [x0, w.y1]], def: null });
  }
  const n = polys.length;
  const box = new Float32Array(n * 4);
  const start = new Int32Array(n + 1);
  let planes = 0;
  for (const p of polys) planes += p.corners.length;
  const plane = new Float32Array(planes * 3);
  let k = 0;
  polys.forEach((p, i) => {
    start[i] = k;
    let bx0 = Infinity;
    let by0 = Infinity;
    let bx1 = -Infinity;
    let by1 = -Infinity;
    const cs = p.corners;
    for (let j = 0; j < cs.length; j++) {
      const [ax, ay] = cs[j]!;
      const [bx, by] = cs[(j + 1) % cs.length]!;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const nx = dy / len;
      const ny = -dx / len;
      plane[k * 3] = nx;
      plane[k * 3 + 1] = ny;
      plane[k * 3 + 2] = nx * ax + ny * ay;
      k++;
      bx0 = Math.min(bx0, ax);
      by0 = Math.min(by0, ay);
      bx1 = Math.max(bx1, ax);
      by1 = Math.max(by1, ay);
    }
    box[i * 4] = bx0;
    box[i * 4 + 1] = by0;
    box[i * 4 + 2] = bx1;
    box[i * 4 + 3] = by1;
  });
  start[n] = k;
  const s: Solids = { n, box, start, plane, defs: polys.map((p) => p.def) };
  solidsCache.set(key, s);
  return s;
}

/**
 * Pushes a point of radius `r` out of shape `k` along the nearest edge's normal. Returns the
 * push length (0 if it was clear); the normal is written to `out`.
 */
export function pushOut(s: Solids, k: number, x: number, y: number, r: number, out: { x: number; y: number; nx: number; ny: number }): number {
  const b = s.box;
  if (x < b[k * 4]! - r || x > b[k * 4 + 2]! + r || y < b[k * 4 + 1]! - r || y > b[k * 4 + 3]! + r) return 0;
  const def = s.defs[k];
  if (def && !insideObstacle(def, x, y, r)) return 0;
  let best = Infinity;
  let bi = -1;
  const p = s.plane;
  for (let j = s.start[k]!; j < s.start[k + 1]!; j++) {
    const pen = p[j * 3 + 2]! + r - (p[j * 3]! * x + p[j * 3 + 1]! * y);
    if (pen <= 0) return 0; // outside this edge: clear
    if (pen < best) {
      best = pen;
      bi = j;
    }
  }
  if (bi < 0) return 0;
  out.nx = p[bi * 3]!;
  out.ny = p[bi * 3 + 1]!;
  out.x = x + out.nx * best;
  out.y = y + out.ny * best;
  return best;
}

/**
 * Narrows a free span [lo, hi] (sim x) at height y by the obstacles beside x: one wholly left of x
 * raises lo, one wholly right lowers hi. One straddling x is ignored (the crowd flows round it).
 */
export function narrowSpan(s: Solids, x: number, y: number, band: number, span: { lo: number; hi: number }) {
  const b = s.box;
  for (let k = 0; k < s.n; k++) {
    if (!s.defs[k]) continue; // walls are already in the span
    if (y < b[k * 4 + 1]! - band || y > b[k * 4 + 3]! + band) continue;
    if (b[k * 4 + 2]! <= x) span.lo = Math.max(span.lo, b[k * 4 + 2]!);
    else if (b[k * 4]! >= x) span.hi = Math.min(span.hi, b[k * 4]!);
  }
  if (span.hi - span.lo < 100) {
    const mid = (span.lo + span.hi) / 2;
    span.lo = Math.max(0, mid - 50);
    span.hi = Math.min(LANE_WIDTH, mid + 50);
  }
}
