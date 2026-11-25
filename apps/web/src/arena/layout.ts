// Maps lane coordinates (packages/client constants) to world space, plus look constants.
//
// v3: each player has their own lane. x runs across it (0..LANE_WIDTH), y from the cannon line (0)
// up to the base edge (LANE_LENGTH). The viewer's lane is drawn full size with the cannon near the
// camera (+Z) and the base at the far end (−Z). No mirroring.

import { LANE_LENGTH, LANE_WIDTH, TOWER_Y, type GateOp } from '@lil-dudes/client';

/**
 * World units per sim unit, the same on both axes: the lane is drawn at its true sim proportions,
 * 15 world units wide. One linear scale for everything (gates, gaps, cohorts, towers, walls), so
 * what you see is what the sim decides.
 */
export const S = 15 / LANE_WIDTH;
export const SX = S;
export const SY = S;
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

/** Your cannon sits just behind the cannon line, on its rail. */
export const CANNON_Z = wz(0) + 1.2;

/**
 * Static camera (TECH §5): FOV 30° and a pitch of ~44° (the genre's measured values). It is solved
 * per viewport aspect so that, in portrait, your cannon sits at CAM_CANNON_AT of the screen height,
 * the lane at the cannon row fills CAM_FILL of the width, and the tower line lands near
 * CAM_TOWER_AT (just below the top bar).
 *
 * Two constraints fix the camera's height and distance; the pitch is the third knob. Tall phones
 * tilt up to CAM_PITCH_MAX to lift the towers to the target; wide screens (or a long lane) keep
 * CAM_PITCH and back off instead, so the towers never go under the HUD.
 */
export const CAM_FOV = 30;
export const CAM_PITCH = 44;
export const CAM_PITCH_MAX = 48;
export const CAM_CANNON_AT = 0.77;
export const CAM_TOWER_AT = 0.13;
export const CAM_FILL = 0.94;

export interface CamPose {
  position: [number, number, number];
  target: [number, number, number];
  pitch: number;
}

const RAD = Math.PI / 180;

/** d/h for a ground point at screen height `at` (0 top … 1 bottom) under `pitch`. */
function ratioAt(at: number, pitch: number): number {
  const ndc = 1 - 2 * at;
  const t = Math.tan((CAM_FOV * RAD) / 2);
  const s = Math.sin(pitch * RAD);
  const c = Math.cos(pitch * RAD);
  return (c + ndc * s * t) / (s - ndc * c * t);
}

/** Screen height (0 top … 1 bottom) of a ground point `d` ahead of a camera `h` up. */
function screenAt(d: number, h: number, pitch: number): number {
  const t = Math.tan((CAM_FOV * RAD) / 2);
  const s = Math.sin(pitch * RAD);
  const c = Math.cos(pitch * RAD);
  return (1 - (d * s - h * c) / ((h * s + d * c) * t)) / 2;
}

export function solveCamera(aspect: number): CamPose {
  const t = Math.tan((CAM_FOV * RAD) / 2);
  const len = CANNON_Z - wz(TOWER_Y);
  const pose = (pitch: number, h: number, d: number): CamPose => {
    const z = CANNON_Z + d;
    return { position: [0, h, z], target: [0, 0, z - h / Math.tan(pitch * RAD)], pitch };
  };
  // Fit the width: depth of the cannon row so the lane spans CAM_FILL of the screen width.
  const depth = HALF_W / (CAM_FILL * t * aspect);
  const fit = (pitch: number) => {
    const r = ratioAt(CAM_CANNON_AT, pitch);
    const h = depth / (Math.sin(pitch * RAD) + r * Math.cos(pitch * RAD));
    return { h, d: r * h };
  };
  let best: CamPose | null = null;
  for (let p = CAM_PITCH; p <= CAM_PITCH_MAX + 1e-6; p += 0.25) {
    const { h, d } = fit(p);
    const at = screenAt(d + len, h, p);
    if (at < CAM_TOWER_AT - 0.01 && p === CAM_PITCH) break; // towers too high: back off below
    best = pose(p, h, d);
    if (at <= CAM_TOWER_AT + 0.005) return best;
  }
  if (best) return best; // a very tall screen: max pitch, towers a little low
  // Wide screen or long lane: keep the pitch, solve height and distance for cannon + tower rows.
  const rC = ratioAt(CAM_CANNON_AT, CAM_PITCH);
  const rT = ratioAt(CAM_TOWER_AT, CAM_PITCH);
  const h = len / (rT - rC);
  return pose(CAM_PITCH, h, rC * h);
}

/** Bright candy-toy world. Your dudes are blue, the base's troops red, rewards gold (MVP §5). */
export const PALETTE = {
  sky: '#8fd3ff',
  skyTop: '#3fa9ff',
  skyHorizon: '#dff4ff',
  grass: '#6fcf5a',
  grassDark: '#57b84a',
  grassLight: '#8fe06e',
  lane: '#ffcf98',
  laneTile: '#ffc88a',
  laneGrout: '#efab6c',
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

/** Gate colours: a bold saturated body and a bright rim, per gate state. */
export const GLASS = {
  unknown: { body: '#7a2ff0', rim: '#e4d2ff' },
  good: { body: '#0f6cf2', rim: '#bfe6ff' },
  gold: { body: '#ff9d00', rim: '#fff0a6' },
  bad: { body: '#f0182f', rim: '#ffc4ca' },
} as const;

export function opLabel(op: GateOp): string {
  return ({ mul: '×', div: '÷', add: '+', sub: '−' } as const)[op.kind] + String(op.value);
}

/** `1.2K` style, one decimal above 1,000 (genre-standard HP label). */
export function shortNum(n: number): string {
  const v = Math.max(0, Math.round(n));
  return v >= 1000 ? `${(v / 1000).toFixed(1)}K` : String(v);
}
