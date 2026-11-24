// Vertex animation textures (VAT) for the crowds: the Mini Characters' real walk and sprint cycles,
// baked per vertex by `tools/bake-anim.mjs` into public/assets/models/dudes-anim.bin.
//
// Each piece (`dude`, `troop`) becomes one float texture: width = the piece's vertex count (the
// same vertex order as dudes.glb), one row per baked frame of positions, then the same rows again
// for normals. The crowd materials are patched (onBeforeCompile) to read the vertex's row by
// gl_VertexID, blending two frames, so a skinned walk costs a few texel fetches per vertex and no
// bones. Each instance carries `aAnim` = (loop phase 0..1, sprint weight 0..1), written by the CPU
// every frame (crowdSim.ts / Crowds.tsx). If the file is missing, the meshes stay static.

import { use } from 'react';
import {
  type BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  FloatType,
  InstancedBufferAttribute,
  MeshDepthMaterial,
  type MeshStandardMaterial,
  NearestFilter,
  RGBAFormat,
  type WebGLProgramParametersWithUniforms,
} from 'three';

const URL_ = `${import.meta.env.BASE_URL}assets/models/dudes-anim.bin`;

export interface VatClip {
  name: string;
  frames: number;
  duration: number;
  /** First row of this clip in the texture. */
  row: number;
}

export interface Vat {
  clips: VatClip[];
  /** Rows per attribute (sum of the clips' frames); normals start at this row. */
  rows: number;
  tex: Record<string, DataTexture>;
}

interface Header {
  clips: { name: string; frames: number; duration: number }[];
  pieces: Record<string, { verts: number; min: number[]; max: number[]; pos: number; nrm: number }>;
}

function parse(buf: ArrayBuffer): Vat {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'VAT1') throw new Error('dudes-anim.bin: bad magic');
  const len = dv.getUint32(4, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 8, len))) as Header;
  const base = 8 + len;
  let row = 0;
  const clips = head.clips.map((c) => {
    const out = { ...c, row };
    row += c.frames;
    return out;
  });
  const rows = row;
  const tex: Record<string, DataTexture> = {};
  for (const [name, p] of Object.entries(head.pieces)) {
    const n = p.verts * rows;
    const pos = new Int16Array(buf, base + p.pos, n * 3);
    const nrm = new Int8Array(buf, base + p.nrm, n * 3);
    const data = new Float32Array(p.verts * rows * 2 * 4);
    const span = [0, 1, 2].map((c) => (p.max[c]! - p.min[c]!) / 65535);
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 3; c++) {
        data[i * 4 + c] = p.min[c]! + (pos[i * 3 + c]! + 32768) * span[c]!;
        data[(n + i) * 4 + c] = nrm[i * 3 + c]! / 127;
      }
    }
    const t = new DataTexture(data, p.verts, rows * 2, RGBAFormat, FloatType);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    tex[name] = t;
  }
  return { clips, rows, tex };
}

let loading: Promise<Vat | null> | null = null;

/** Loads the baked cycles once (null if the file is missing or broken: crowds then stay static). */
export function loadVat(): Promise<Vat | null> {
  loading ??= fetch(URL_)
    .then((r) => (r.ok ? r.arrayBuffer() : null))
    .then((b) => (b ? parse(b) : null))
    .catch(() => null);
  return loading;
}

export function useVat(): Vat | null {
  return use(loadVat());
}

const decl = /* glsl */ `
uniform highp sampler2D uVat;
uniform vec4 uVatClip; // walk frames, sprint frames, sprint first row, normal row offset
attribute vec2 aAnim;  // loop phase 0..1, sprint weight 0..1
void vatSample(float ph, float frames, float row0, out vec3 p, out vec3 n) {
  float f = fract(ph) * frames;
  float f0 = floor(f);
  float t = f - f0;
  int r0 = int(row0 + mod(f0, frames));
  int r1 = int(row0 + mod(f0 + 1.0, frames));
  int no = int(uVatClip.w);
  p = mix(texelFetch(uVat, ivec2(gl_VertexID, r0), 0).xyz, texelFetch(uVat, ivec2(gl_VertexID, r1), 0).xyz, t);
  n = mix(texelFetch(uVat, ivec2(gl_VertexID, r0 + no), 0).xyz, texelFetch(uVat, ivec2(gl_VertexID, r1 + no), 0).xyz, t);
}
void vatAnimate(out vec3 p, out vec3 n) {
  float w = aAnim.y;
  vec3 pw = vec3(0.0), nw = vec3(0.0, 1.0, 0.0), ps = vec3(0.0), ns = vec3(0.0, 1.0, 0.0);
  if (w < 0.999) vatSample(aAnim.x, uVatClip.x, 0.0, pw, nw);
  if (w > 0.001) vatSample(aAnim.x, uVatClip.y, uVatClip.z, ps, ns);
  p = w <= 0.001 ? pw : (w >= 0.999 ? ps : mix(pw, ps, w));
  n = normalize(w <= 0.001 ? nw : (w >= 0.999 ? ns : mix(nw, ns, w)));
}
`;

function patcher(vat: Vat, tex: DataTexture, normals: boolean) {
  const walk = vat.clips.find((c) => c.name === 'walk') ?? vat.clips[0]!;
  const sprint = vat.clips.find((c) => c.name === 'sprint') ?? walk;
  return (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uVat = { value: tex };
    shader.uniforms.uVatClip = { value: [walk.frames, sprint.frames, sprint.row, vat.rows] };
    let v = shader.vertexShader.replace('#include <common>', `#include <common>\n${decl}`);
    if (normals) {
      v = v
        .replace('#include <beginnormal_vertex>', 'vec3 vatP; vec3 vatN; vatAnimate(vatP, vatN);\nvec3 objectNormal = vatN;')
        .replace('#include <begin_vertex>', 'vec3 transformed = vatP;');
    } else {
      v = v.replace('#include <begin_vertex>', 'vec3 vatP; vec3 vatN; vatAnimate(vatP, vatN);\nvec3 transformed = vatP;');
    }
    shader.vertexShader = v;
  };
}

/**
 * Turns `mat` (an instanced crowd material) into a VAT material for `piece` in place, and returns
 * the matching shadow depth material (set it as the mesh's `customDepthMaterial`). Without a VAT
 * both are left alone (null depth material).
 */
export function animateMaterial(vat: Vat | null, piece: string, mat: MeshStandardMaterial): MeshDepthMaterial | null {
  const tex = vat?.tex[piece];
  if (!vat || !tex) return null;
  mat.onBeforeCompile = patcher(vat, tex, true);
  mat.customProgramCacheKey = () => 'vat1';
  mat.needsUpdate = true;
  const depth = new MeshDepthMaterial();
  depth.onBeforeCompile = patcher(vat, tex, false);
  depth.customProgramCacheKey = () => 'vat1-depth';
  return depth;
}

/** A per-instance copy of `geo` with an `aAnim` attribute (phase, sprint weight) for `count` instances. */
export function animatedGeometry(geo: BufferGeometry, count: number): { geo: BufferGeometry; anim: InstancedBufferAttribute } {
  const g = geo.clone();
  const anim = new InstancedBufferAttribute(new Float32Array(count * 2), 2).setUsage(DynamicDrawUsage);
  g.setAttribute('aAnim', anim);
  return { geo: g, anim };
}
