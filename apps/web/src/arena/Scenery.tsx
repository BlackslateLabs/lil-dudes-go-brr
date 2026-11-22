import { Suspense, useMemo } from 'react';
import { BufferAttribute, type BufferGeometry } from 'three';
import { HALF_L, HALF_W } from './layout';
import { mergeParts, preloadPacks, toyMaterial, usePack, type Part } from './models/assets';

/**
 * Decoration around the lane (Kenney Nature Kit trees, bushes, rocks, flowers). Purely visual:
 * nothing here reads the match. Kept off the lane (and its kerbs) so it never hides gates, dudes
 * or towers. Placement is seeded, so every load looks the same; everything is merged into ONE
 * static vertex-coloured mesh: a single draw call and no per-frame work.
 */
export function Scenery() {
  return (
    <Suspense fallback={null}>
      <SceneryMesh />
    </Suspense>
  );
}

preloadPacks('nature');

/** Clear strip beside the lane (world units past the lane edge) where nothing tall grows. */
const KERB_CLEAR = 1.3;
const SEED = 0x1d6e5;

const TREES = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed', 'tree_cone', 'tree_pineRoundA', 'tree_blocks'];
const BUSHES = ['plant_bush', 'plant_bushLarge', 'plant_bushDetailed'];
const SMALL = ['grass', 'grass_large', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'mushroom_red', 'rock_smallA', 'rock_smallC', 'stone_smallC'];
const ROCKS = ['rock_largeA', 'rock_largeB', 'stone_largeB', 'stump_round', 'log'];

/** Mulberry32: tiny deterministic PRNG. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded layout in world units (pieces are ~1 unit, so `s` is the world size). */
function sceneryParts(): Part[] {
  const r = rng(SEED);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const P: Part[] = [];
  const edge = HALF_W + KERB_CLEAR;
  // Is (x, z) clear of the lane, the cannon apron and anything already placed?
  const taken: [number, number, number][] = [];
  const free = (x: number, z: number, rad: number) => taken.every(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 > (tr + rad) ** 2);
  const put = (piece: string, x: number, z: number, s: number, rad: number) => {
    if (!free(x, z, rad)) return false;
    taken.push([x, z, rad]);
    P.push({ piece, x, y: 0, z, q: Math.floor(r() * 4) + r() * 0.2, s });
    return true;
  };

  // Tree lines either side, thicker further out; along the whole lane and behind the base.
  for (let i = 0; i < 260; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const out = edge + 1.2 + Math.pow(r(), 1.6) * 34; // denser near the lane
    const z = -HALF_L - 26 + r() * (2 * HALF_L + 46);
    const s = 3.2 + r() * 2.6;
    put(pick(TREES), side * out, z, s, s * 0.32);
  }
  // Behind the base wall: a band of trees, kept low enough to sit under the HUD.
  for (let i = 0; i < 70; i++) {
    const x = (r() * 2 - 1) * (HALF_W + 30);
    const z = -HALF_L - 6 - r() * 22;
    const s = 3 + r() * 2.5;
    put(pick(TREES), x, z, s, s * 0.3);
  }
  // Bushes and rocks hugging the kerbs.
  for (let i = 0; i < 90; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const out = edge + r() * 6;
    const z = -HALF_L + r() * (2 * HALF_L + 14);
    if (r() < 0.6) put(pick(BUSHES), side * out, z, 2.2 + r() * 1.8, 0.7);
    else put(pick(ROCKS), side * out, z, 1.8 + r() * 1.6, 0.8);
  }
  // Grass tufts, flowers and pebbles: small, anywhere on the grass (incl. in front of the cannon).
  for (let i = 0; i < 320; i++) {
    const front = r() < 0.25;
    const x = front ? (r() * 2 - 1) * (HALF_W + 14) : (r() < 0.5 ? -1 : 1) * (HALF_W + 0.9 + r() * 22);
    const z = front ? HALF_L + 4.5 + r() * 14 : -HALF_L - 20 + r() * (2 * HALF_L + 40);
    put(pick(SMALL), x, z, 1.6 + r() * 1.4, 0.25);
  }
  return P;
}

function SceneryMesh() {
  const pack = usePack('nature');
  const { geo, mat } = useMemo(() => {
    const g = mergeParts(pack, sceneryParts());
    tintVariation(g);
    return { geo: g, mat: toyMaterial(null, { vertexColors: true, roughness: 0.75 }) };
  }, [pack]);
  return <mesh geometry={geo} material={mat} />;
}

/** A little seeded brightness variation per vertex cluster so repeated trees don't look stamped. */
function tintVariation(g: BufferGeometry) {
  const col = g.getAttribute('color') as BufferAttribute | undefined;
  const pos = g.getAttribute('position');
  if (!col) return;
  for (let i = 0; i < col.count; i++) {
    // Same factor for nearby vertices (hash of a coarse cell), so whole objects shift together.
    const h = Math.sin(Math.floor(pos.getX(i) / 2.5) * 12.9898 + Math.floor(pos.getZ(i) / 2.5) * 78.233) * 43758.5453;
    const k = 0.9 + (h - Math.floor(h)) * 0.2;
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  col.needsUpdate = true;
}
