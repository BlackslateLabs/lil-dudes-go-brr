// Loader for our own v6 model packs (apps/web/public/assets/models/v6/*.glb, built by tools/art).
// One top-level node per piece (node name = piece name); each becomes a plain BufferGeometry with
// the node's rotation and scale applied (not its position: pieces are authored at the origin).
import { use } from 'react';
import { Matrix4, type BufferGeometry, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const BASE = `${import.meta.env.BASE_URL}assets/models/v6/`;
export const V6 = ['dudes', 'gates', 'fortress', 'lane', 'cannon', 'scenery'] as const;
export type V6Pack = (typeof V6)[number];
export type Pieces = Record<string, BufferGeometry>;

const cache = new Map<V6Pack, Promise<Pieces>>();
let loader: GLTFLoader | null = null;

export function loadV6(name: V6Pack): Promise<Pieces> {
  let p = cache.get(name);
  if (!p) {
    loader ??= new GLTFLoader();
    p = loader.loadAsync(`${BASE}${name}.glb`).then((gltf) => {
      const out: Pieces = {};
      for (const node of gltf.scene.children) {
        const parts: BufferGeometry[] = [];
        node.updateMatrixWorld(true);
        // Strip the node's own position: pieces are authored around the origin.
        const inv = new Matrix4().makeTranslation(-node.position.x, -node.position.y, -node.position.z);
        node.traverse((o: Object3D) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const g = m.geometry.clone();
          g.applyMatrix4(new Matrix4().multiplyMatrices(inv, m.matrixWorld));
          // Keep only what the toy material reads.
          for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
          parts.push(g);
        });
        if (parts.length) out[node.name] = parts.length === 1 ? parts[0]! : mergeGeometries(parts)!;
      }
      return out;
    });
    cache.set(name, p);
  }
  return p;
}

/** Suspends until the pack is in (wrap users in <Suspense>). */
export function useV6(name: V6Pack): Pieces {
  return use(loadV6(name));
}

/** Start every v6 download now (the match waits for them before ticking). */
export function preloadV6(): Promise<unknown> {
  return Promise.all(V6.map((n) => loadV6(n)));
}

/** Bounding-box height of a piece (for labels above models). */
export function heightOf(g: BufferGeometry): number {
  g.computeBoundingBox();
  return g.boundingBox!.max.y;
}

