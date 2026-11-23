// Baseline layouts, in reference units ("u"): lane x in [-6.5, 6.5], z from the cannon (0) to the base (~31).
// Gates sit in the front third, attrition pieces (rails, blocks) in the back half, two towers, then the base.

export type GateDef = { x: number; z: number; w: number; mul: number; slide?: { min: number; max: number; speed: number } };
export type WallDef = { x: number; z: number; w: number; d: number; h?: number };
export type BlockDef = { x: number; z: number; size: number; hp: number };
export type Layout = { name: string; gates: GateDef[]; walls: WallDef[]; blocks: BlockDef[] };

const G = (x: number, z: number, mul: number, w = 3.4): GateDef => ({ x, z, w, mul });
const rail = (x: number, z0: number, z1: number): WallDef => ({ x, z: (z0 + z1) / 2, w: 0.55, d: z1 - z0 });
const bar = (x0: number, x1: number, z: number): WallDef => ({ x: (x0 + x1) / 2, z, w: x1 - x0, d: 0.55 });

export const LAYOUTS: Layout[] = [
  {
    name: 'Twin Choice',
    gates: [G(-3.2, 5.5, 2), G(3.2, 5.5, 3), G(-3.2, 10, 3), G(3.2, 10, 2), G(0, 14.5, 2, 3)],
    walls: [rail(-1.7, 16.5, 21.5), rail(1.7, 16.5, 21.5)],
    blocks: [{ x: -4.4, z: 19, size: 2.2, hp: 15 }, { x: 4.4, z: 19, size: 2.2, hp: 15 }],
  },
  {
    name: 'Jackpot Flank',
    gates: [G(0, 5, 2, 3.6), G(-3.6, 11, 5, 3), G(3.2, 9.5, 2), { x: 0, z: 18, w: 2.6, mul: 2 }],
    walls: [bar(-6.5, -1.3, 18), bar(1.3, 6.5, 18), rail(-1.9, 8.2, 12.2)],
    blocks: [{ x: -3.6, z: 8.2, size: 2.4, hp: 25 }],
  },
  {
    name: 'Ladder',
    gates: [G(3.4, 4.5, 2, 3), G(3.4, 8.5, 3, 3), G(3.4, 12.5, 4, 3), G(-3, 7, 2, 3.6), G(-3, 12, 2, 3.6)],
    walls: [rail(0.3, 3.5, 13.5), bar(-6.5, -3.5, 19), bar(3.5, 6.5, 19)],
    blocks: [{ x: 0, z: 20, size: 2.6, hp: 30 }],
  },
  {
    name: 'Sliders',
    gates: [
      { x: -3, z: 6, w: 3, mul: 3, slide: { min: -4.8, max: 4.8, speed: 2.4 } },
      { x: 3, z: 10.5, w: 3, mul: 4, slide: { min: -4.8, max: 4.8, speed: -2.4 } },
      G(0, 15, 2, 4),
    ],
    walls: [rail(-3.3, 17, 22), rail(3.3, 17, 22)],
    blocks: [{ x: 0, z: 20.5, size: 2.2, hp: 20 }],
  },
];

export const LANE = {
  half: 6.5, // lane half-width
  cannonZ: 0,
  cannonClamp: 5.3,
  towerZ: 26,
  towerX: 3.3,
  baseZ: 31,
  steerZ: 15, // past this, blues home on targets instead of walking straight
};
