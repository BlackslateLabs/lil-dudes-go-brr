// The town hall, assembled from Kenney Fantasy Town Kit pieces (1-unit tiles).
//
// Piece conventions (measured from the kit): a wall piece is a thin slab on its tile's +X edge
// (x 0.4..0.5) whose outside faces −X, so a quarter turn (q = 1) makes it face the camera (+Z).
// `roof-high` is a lean-to rising toward +X; `roof-high-corner` is the hip corner, high only at
// (+X, −Z). Everything here is in tile units around the hall's centre; front face at z = +1.

import type { Part } from './assets';

/** Tiles either side of the centre: the hall is 2·HALF+1 tiles wide and 2 deep. */
const HALF = 2;

/** Front wall outer face in tile units (z), so the caller can put it on the loot line. */
export const HALL_FRONT_Z = 1.0;
/** Door opening (tile units): centre and size, for the vault-glow plane behind it. */
export const HALL_DOOR = { y: 0.4, z: 0.97, w: 0.6, h: 0.8 } as const;
/** Top of the central spire (tile units). */
export const HALL_TOP = 4.0;

export function hallParts(): Part[] {
  const P: Part[] = [];
  const front = (piece: string, x: number, y: number) => P.push({ piece, x, y, z: 1.45, q: 1 });
  const back = (piece: string, x: number, y: number) => P.push({ piece, x, y, z: -1.45, q: -1 });
  const left = (piece: string, z: number, y: number) => P.push({ piece, x: -HALF - 0.95, y, z, q: 0 });
  const right = (piece: string, z: number, y: number) => P.push({ piece, x: HALF + 0.95, y, z, q: 2 });

  // Two storeys: the arched vault door in the middle, windows and banners either side.
  const floor1 = ['wall-window-glass', 'wall', 'wall-doorway-round', 'wall', 'wall-window-glass'];
  const floor2 = ['wall-window-round', 'wall-window-shutters', 'wall', 'wall-window-shutters', 'wall-window-round'];
  for (let i = -HALF; i <= HALF; i++) {
    front(floor1[i + HALF]!, i, 0);
    front(floor2[i + HALF]!, i, 1);
    back('wall', i, 0);
    back('wall', i, 1);
  }
  for (const z of [-0.5, 0.5])
    for (const y of [0, 1]) {
      left(y ? 'wall-window-round' : 'wall', z, y);
      right(y ? 'wall-window-round' : 'wall', z, y);
    }
  front('banner-red', -1, 0.05);
  front('banner-red', 1, 0.05);
  for (const sx of [-1, 1])
    for (const sz of [-1, 1]) for (const y of [0, 1]) P.push({ piece: 'pillar-stone', x: sx * (HALF + 0.5), y, z: sz });

  // Hipped roof over the 5×2 footprint.
  for (let i = -HALF + 1; i <= HALF - 1; i++) {
    P.push({ piece: 'roof-high', x: i, y: 2, z: 0.5, q: 1 }, { piece: 'roof-high', x: i, y: 2, z: -0.5, q: -1 });
  }
  P.push(
    { piece: 'roof-high-corner', x: -HALF, y: 2, z: 0.5, q: 0 },
    { piece: 'roof-high-corner', x: HALF, y: 2, z: 0.5, q: 1 },
    { piece: 'roof-high-corner', x: -HALF, y: 2, z: -0.5, q: -1 },
    { piece: 'roof-high-corner', x: HALF, y: 2, z: -0.5, q: 2 },
  );

  // Central tower over the door: a third storey and a pointed roof.
  P.push(
    { piece: 'wall-window-round', x: 0, y: 2, z: 1.45, q: 1 },
    { piece: 'wall', x: 0, y: 2, z: -0.45, q: -1 },
    { piece: 'wall', x: -0.95, y: 2, z: 0.5, q: 0 },
    { piece: 'wall', x: 0.95, y: 2, z: 0.5, q: 2 },
    { piece: 'roof-high-point', x: 0, y: 3, z: 0.5 },
  );
  for (const sx of [-0.5, 0.5]) for (const sz of [0, 1]) P.push({ piece: 'pillar-stone', x: sx, y: 2, z: sz });

  // Lanterns either side of the door.
  P.push({ piece: 'lantern', x: -0.64, y: 0, z: 1.22, s: 0.62 }, { piece: 'lantern', x: 0.64, y: 0, z: 1.22, s: 0.62 });
  return P;
}

/** The base wall across the far end of the lane: a row of stone blocks (tile units, centred). */
export function wallParts(blocks: number): Part[] {
  const P: Part[] = [];
  for (let i = 0; i < blocks; i++) P.push({ piece: 'wall-block', x: i - (blocks - 1) / 2, y: 0, z: 0 });
  return P;
}
