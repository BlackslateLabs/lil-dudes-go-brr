// Maps lane coordinates (packages/client constants) to world space, plus look constants.
//
// v3: each player has their own lane. x runs across it (0..LANE_WIDTH), y from the cannon line (0)
// up to the base edge (LANE_LENGTH). The viewer's lane is drawn full size with the cannon near the
// camera (+Z) and the base at the far end (−Z). No mirroring.

import { LANE_LENGTH, LANE_WIDTH, type GateOp } from '@lil-dudes/client';

/**
 * World units per sim unit. The lane is drawn 1.5× wider than its sim proportions (3000 × 12000 is
 * 1:4) so it fills a portrait screen under the static telephoto camera. One linear scale per axis
 * for everything (gates, gaps, cohorts, towers), so what you see is what the sim decides.
 */
export const SX = 18 / LANE_WIDTH;
export const SY = 48 / LANE_LENGTH;
export const LANE_W = LANE_WIDTH * SX;
export const LANE_L = LANE_LENGTH * SY;
export const HALF_W = LANE_W / 2;
export const HALF_L = LANE_L / 2;

export function wx(x: number): number {
  return (x - LANE_WIDTH / 2) * SX;
}

export function wz(y: number): number {
  return HALF_L - y * SY;
}

/**
 * Static camera (TECH §5): pitch 44°, FOV 30°, the whole lane from your cannon to the base. Solved
 * so your cannon sits at ~77% of screen height and the base edge at ~10% (below the HUD).
 */
export const CAM_FOV = 30;
export const CAM_POS = [0, 58.35, 68.22] as const;
export const CAM_TARGET = [0, 0, 7.8] as const;

/** Bright candy-toy world. Your dudes are blue, the base's troops red, rewards gold (MVP §5). */
export const PALETTE = {
  sky: '#8fd3ff',
  skyTop: '#3fa9ff',
  skyHorizon: '#dff4ff',
  grass: '#6fcf5a',
  grassDark: '#57b84a',
  grassLight: '#8fe06e',
  lane: '#fff3e0',
  laneTile: '#ffe6c6',
  laneGrout: '#f3cfa3',
  laneEdge: '#ffffff',
  kerbStripe: '#ff7eb3',
  me: '#2a7bff',
  enemy: '#f2404f',
  base: '#c8343f',
  baseTrim: '#ffd9a0',
  tower: '#e0505a',
  crate: '#b5763a',
  post: '#ffffff',
  good: '#3aa0ff',
  bad: '#ff4d5e',
  gold: '#ffc21a',
  goldDark: '#b07400',
  hall: '#f3e3c8',
  unknown: '#b3a9ec',
  outline: '#1b1530',
} as const;

/** Glass gate colours: body tint and the glowing rim, per gate state. */
export const GLASS = {
  unknown: { body: '#9d92e8', rim: '#efeaff' },
  good: { body: '#2f8cff', rim: '#9fd6ff' },
  gold: { body: '#ffb300', rim: '#ffe48a' },
  bad: { body: '#ff3048', rim: '#ff9aa6' },
} as const;

export function opLabel(op: GateOp): string {
  return ({ mul: '×', div: '÷', add: '+', sub: '−' } as const)[op.kind] + String(op.value);
}

/** `1.2K` style, one decimal above 1,000 (genre-standard HP label). */
export function shortNum(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);
}
