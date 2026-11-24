// Model packs (Kenney kits, CC0; see public/assets/CREDITS.md) and the helpers that turn them into
// plain geometry + materials for the arena.
//
// Every pack GLB was pre-built by `tools/build-models.mjs`: one flattened, non-skinned mesh per piece
// (node name = piece name), all sharing ONE material (the kit's colormap, or vertex colours for the
// nature kit). So a piece is just a BufferGeometry, and a structure (tower, town hall, scenery) is
// those geometries merged into one mesh: one draw call each.

import { use, useMemo } from 'react';
import {
  BufferGeometry,
  CanvasTexture,
  Color,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  NearestFilter,
  SRGBColorSpace,
  Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadVat } from './vat';

const BASE = `${import.meta.env.BASE_URL}assets/models/`;

export const MODELS = {
  /** Mini Characters: `dude` (knight, us) and `troop` (robot, the base's troops). */
  dudes: `${BASE}dudes.glb`,
  /** Blaster Kit: `launcher` (the cannon's blaster) and `crate`. */
  blaster: `${BASE}blaster.glb`,
  /** Tower Defense Kit: `tower-bottom`, `tower-roof`. */
  towers: `${BASE}towers.glb`,
  /** Fantasy Town Kit pieces for the town hall and the base wall. */
  hall: `${BASE}hall.glb`,
  /** Nature Kit, vertex-coloured: trees, bushes, rocks, flowers. */
  nature: `${BASE}nature.glb`,
} as const;

export type PackName = keyof typeof MODELS;

export interface Pack {
  /** Piece geometry by name (shared: never mutate, clone first). */
  geo: Record<string, BufferGeometry>;
  /** The pack's one material as loaded (colormap or vertex colours). */
  material: MeshStandardMaterial;
}

const packs = new Map<PackName, Promise<Pack>>();
let loader: GLTFLoader | null = null;

/** Load and unpack a pack once (cached promise; later calls get the same one). */
export function loadPack(name: PackName): Promise<Pack> {
  let p = packs.get(name);
  if (!p) {
    loader ??= new GLTFLoader();
    p = loader.loadAsync(MODELS[name]).then((gltf) => {
      const geo: Record<string, BufferGeometry> = {};
      let material: MeshStandardMaterial | null = null;
      // Each piece is a top-level node holding one single-primitive mesh, which GLTFLoader turns
      // into a Mesh object with the node's name.
      for (const node of gltf.scene.children) {
        const m = node as Mesh;
        if (!m.isMesh) continue;
        geo[node.name] = m.geometry;
        material ??= m.material as MeshStandardMaterial;
      }
      const mat = material ?? new MeshStandardMaterial();
      if (mat.map) {
        mat.map.colorSpace = SRGBColorSpace;
        mat.map.magFilter = NearestFilter;
      }
      return { geo, material: mat };
    });
    packs.set(name, p);
  }
  return p;
}

/** Load a pack (suspends until it is ready). Mount the caller under a Suspense boundary. */
export function usePack(name: PackName): Pack {
  return use(loadPack(name));
}

/** Start loading packs now (module load), so they are ready by the time the arena mounts. */
export function preloadPacks(...names: PackName[]) {
  for (const n of names) void loadPack(n).catch(() => undefined);
}

/**
 * Resolves once every model pack is loaded and unpacked: the match waits for it before it starts
 * ticking, so the first frames never stall on a GLB parse. Rejects if a pack fails to load.
 */
export function modelsReady(): Promise<void> {
  // The baked walk cycles (vat.ts) load alongside; a missing file only leaves the crowds static.
  return Promise.all([...(Object.keys(MODELS) as PackName[]).map(loadPack), loadVat()]).then(() => undefined);
}

// ---- Team recolouring -------------------------------------------------------------------------
// Kenney colormaps are a grid of flat colour swatches (16 columns × 4 rows of 32 × 128 px, each a
// soft vertical gradient). A piece's UVs point into swatches, so recolouring a swatch recolours
// every face that uses it. We copy the kit's colormap into a canvas and repaint chosen swatches
// with a team colour from PALETTE, keeping each swatch's gradient (relative brightness), so the
// colour stays in sync with layout.ts and no extra PNGs ship.

/** One repaint rule: swatches [column, row] → colour; `ref` = swatch whose mean brightness maps to the colour. */
export interface TintRule {
  cells: readonly (readonly [number, number])[];
  color: string;
  ref?: readonly [number, number];
}

const CELL_W = 32;
const CELL_H = 128;
const tinted = new Map<string, Texture>();

function lum(d: Uint8ClampedArray, i: number) {
  return 0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!;
}

/** A recoloured copy of a colormap (cached by `key`). */
export function tintedMap(src: Texture, key: string, rules: readonly TintRule[]): Texture {
  const hit = tinted.get(key);
  if (hit) return hit;
  const img = src.image as CanvasImageSource & { width: number; height: number };
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const sx = img.width / 512;
  const sy = img.height / 512;
  const data = ctx.getImageData(0, 0, cv.width, cv.height);
  const d = data.data;
  const meanLum = ([c, r]: readonly [number, number]) => {
    let s = 0;
    let n = 0;
    for (let y = Math.floor(r * CELL_H * sy); y < Math.floor((r + 1) * CELL_H * sy); y++)
      for (let x = Math.floor(c * CELL_W * sx); x < Math.floor((c + 1) * CELL_W * sx); x++) {
        s += lum(d, (y * cv.width + x) * 4);
        n++;
      }
    return s / Math.max(1, n);
  };
  const col = new Color();
  for (const rule of rules) {
    // The canvas holds sRGB bytes; read the palette colour back as sRGB too.
    const { r: cr, g: cg, b: cb } = col.set(rule.color).getRGB({ r: 0, g: 0, b: 0 }, SRGBColorSpace);
    const [tr, tg, tb] = [cr * 255, cg * 255, cb * 255];
    const ref = meanLum(rule.ref ?? rule.cells[0]!);
    for (const [c, r] of rule.cells) {
      for (let y = Math.floor(r * CELL_H * sy); y < Math.floor((r + 1) * CELL_H * sy); y++)
        for (let x = Math.floor(c * CELL_W * sx); x < Math.floor((c + 1) * CELL_W * sx); x++) {
          const i = (y * cv.width + x) * 4;
          const k = Math.min(1.35, lum(d, i) / Math.max(1, ref));
          d[i] = Math.min(255, tr! * k);
          d[i + 1] = Math.min(255, tg! * k);
          d[i + 2] = Math.min(255, tb! * k);
        }
    }
  }
  ctx.putImageData(data, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.flipY = false; // glTF UV convention, like the source map
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.anisotropy = 4;
  tinted.set(key, tex);
  return tex;
}

/** A glossy-ish toy material on a (possibly recoloured) colormap. */
export function toyMaterial(map: Texture | null, opts: { vertexColors?: boolean; roughness?: number } = {}) {
  return new MeshStandardMaterial({
    map,
    vertexColors: opts.vertexColors ?? false,
    roughness: opts.roughness ?? 0.62,
    metalness: 0,
  });
}

/** Recoloured material for a pack, memoised per key. */
export function useTintedMaterial(pack: Pack, key: string, rules: readonly TintRule[], roughness?: number) {
  return useMemo(() => {
    const map = pack.material.map ? tintedMap(pack.material.map, key, rules) : null;
    return toyMaterial(map, { roughness });
    // `rules` are module constants named by `key`.
  }, [pack, key]); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---- Assembling pieces ------------------------------------------------------------------------

/** A piece placed in a structure: position, quarter turns about Y, optional uniform/xyz scale. */
export interface Part {
  piece: string;
  x: number;
  y: number;
  z: number;
  /** Quarter turns about +Y. */
  q?: number;
  s?: number | readonly [number, number, number];
}

const m4 = new Matrix4();
const r4 = new Matrix4();
const s4 = new Matrix4();

/** Merge placed pieces into one geometry (in units of the pieces, scaled by `unit`). */
export function mergeParts(pack: Pack, parts: readonly Part[], unit = 1): BufferGeometry {
  const list: BufferGeometry[] = [];
  for (const p of parts) {
    const g = pack.geo[p.piece];
    if (!g) throw new Error(`model piece missing: ${p.piece}`);
    const s = p.s ?? 1;
    const [sx, sy, sz] = typeof s === 'number' ? [s, s, s] : s;
    s4.makeScale(sx * unit, sy * unit, sz * unit);
    r4.makeRotationY(((p.q ?? 0) * Math.PI) / 2);
    m4.makeTranslation(p.x * unit, p.y * unit, p.z * unit).multiply(r4).multiply(s4);
    list.push(stripTo(g, pack).clone().applyMatrix4(m4));
  }
  const out = mergeGeometries(list, false);
  if (!out) throw new Error('mergeParts: incompatible geometries');
  for (const g of list) g.dispose();
  return out;
}

/** Keep only the attributes the pack's material uses, so pieces always merge. */
function stripTo(g: BufferGeometry, pack: Pack): BufferGeometry {
  const keep = new Set(['position', 'normal', pack.material.map ? 'uv' : 'color']);
  const out = new BufferGeometry();
  for (const k of Object.keys(g.attributes)) if (keep.has(k)) out.setAttribute(k, g.getAttribute(k));
  out.setIndex(g.getIndex());
  return out;
}
