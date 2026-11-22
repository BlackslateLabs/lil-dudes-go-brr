// Maps sim coordinates (packages/client constants) to world space, plus look constants.
//
// Sim: x is absolute across the lane as seen from side 0 (0..LANE_WIDTH); y is measured from each
// cohort's own cannon (0..LANE_LENGTH). The viewer's side (mySide) is always drawn at the bottom
// (+Z, near the camera); if mySide = 1, x is mirrored so "left" is the viewer's left.

import { COL_WIDTH, LANE_LENGTH, LANE_WIDTH, type GateOp, type Side } from '@lil-dudes/client';

/**
 * World units per sim unit. The lane is drawn 1.5× wider than its sim proportions (3000 × 12000 is
 * 1:4) so it fills a portrait screen under the static telephoto camera. Visual only; rules unchanged.
 */
export const SX = 18 / LANE_WIDTH;
export const SY = 48 / LANE_LENGTH;
export const LANE_W = LANE_WIDTH * SX;
export const LANE_L = LANE_LENGTH * SY;
export const HALF_W = LANE_W / 2;
export const HALF_L = LANE_L / 2;

export function wx(x: number, mySide: Side): number {
  const ax = mySide === 0 ? x : LANE_WIDTH - x;
  return (ax - LANE_WIDTH / 2) * SX;
}

export function wz(side: Side, y: number, mySide: Side): number {
  return side === mySide ? HALF_L - y * SY : -HALF_L + y * SY;
}

export const colCenter = (col: number) => col * COL_WIDTH + COL_WIDTH / 2;

/**
 * Static camera (TECH §5): pitch 44°, FOV 30°, whole lane cannon to cannon. Solved so your cannon
 * sits at ~77% of screen height and theirs at ~10% (below the HUD).
 */
export const CAM_FOV = 30;
export const CAM_POS = [0, 58.35, 68.22] as const;
export const CAM_TARGET = [0, 0, 7.8] as const;

/** Bright toy world. On your screen you are always blue and they are always red (MVP §5). */
export const PALETTE = {
  sky: '#8fd3ff',
  grass: '#79c96a',
  lane: '#ffe9c2',
  laneEdge: '#ffffff',
  clash: '#ff8fa3',
  me: '#2f7cff',
  them: '#e8413c',
  post: '#ffffff',
  good: '#3aa0ff',
  bad: '#ff4d5e',
  gold: '#ffc21a',
  unknown: '#a9a3c9',
  outline: '#1b1530',
} as const;

export function opLabel(op: GateOp): string {
  switch (op.kind) {
    case 'mul':
      return `×${op.value}`;
    case 'add':
      return `+${op.value}`;
    case 'sub':
      return `−${op.value}`;
    case 'div':
      return `÷${op.value}`;
  }
}

export const isGoodOp = (op: GateOp) => op.kind === 'mul' || op.kind === 'add';

/** `2.2K` style, one decimal above 1,000 (genre-standard HP label). */
export function shortNum(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);
}
