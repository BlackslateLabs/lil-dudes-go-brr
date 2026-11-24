// Bakes the Mini Characters' skeletal walk cycles into vertex animation data for the crowds
// (public/assets/models/dudes-anim.bin). Not part of the app build.
//
// The runtime crowd meshes are the flattened, simplified pieces in dudes.glb (build-models.mjs).
// For each of their vertices this finds the source vertex it came from (the simplifier only drops
// vertices, never moves them, so every runtime vertex is bit-identical to one source vertex in the
// idle pose), then skins the source character at each sampled frame of a clip and keeps just those
// vertices. So the remap is found once and reused for every frame, and the vertex order is exactly
// dudes.glb's: the shader reads frame data by gl_VertexID.
//
// Output (little endian): 'VAT1', u32 header length, a JSON header (space padded to 4 bytes), then
// per piece: positions as Int16 xyz quantised to the piece's bounding box, every frame of every clip
// in order, followed by normals as Int8 xyz (snorm) in the same order. The header has the offsets.
//
// Rerun after rebuilding dudes.glb (same scratch folder as build-models.mjs, with its npm deps):
//   node bake-anim.mjs <assetsDir> <repo>/apps/web/public/assets/models
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { flatten, KIT_DIRS } from './build-models.mjs';

const [ASSETS, OUT] = process.argv.slice(2);
if (!ASSETS || !OUT) throw new Error('usage: node bake-anim.mjs <assetsDir> <modelsOutDir>');

/** Clips to bake: name in the kit, frames per loop. Frame f samples f/frames of the loop. */
const CLIPS = [
  { name: 'walk', frames: 16 },
  { name: 'sprint', frames: 12 },
];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const cfg = JSON.parse(fs.readFileSync(new URL('./packs.json', import.meta.url), 'utf8')).dudes;
const runtime = await io.read(path.join(OUT, 'dudes.glb'));

const f32 = Math.fround;
const keyOf = (p, n, u) => [p[0], p[1], p[2], u[0], u[1], n[0], n[1], n[2]].map(f32).join(',');

const header = { clips: [], pieces: {} };
const blobs = [];
let offset = 0;
const push = (buf) => {
  const at = offset;
  blobs.push(buf);
  offset += buf.byteLength;
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    blobs.push(new Uint8Array(pad));
    offset += pad;
  }
  return at;
};

for (const [piece, src] of cfg.pieces) {
  const file = path.join(ASSETS, KIT_DIRS[cfg.kit], src + '.glb');
  const prim = runtime.getRoot().listMeshes().find((m) => m.getName() === piece)?.listPrimitives()[0];
  if (!prim) throw new Error(`dudes.glb has no piece ${piece}`);
  const RP = prim.getAttribute('POSITION'), RN = prim.getAttribute('NORMAL'), RU = prim.getAttribute('TEXCOORD_0');
  const nv = RP.getCount();

  // Remap: runtime vertex → source vertex (same pose and arithmetic as build-models.mjs).
  const rest = await flatten(file, { pose: 'idle' });
  const bySrc = new Map();
  for (let i = 0; i < rest.P.length / 3; i++) {
    const k = keyOf(rest.P.slice(i * 3, i * 3 + 3), rest.N.slice(i * 3, i * 3 + 3), rest.U.slice(i * 2, i * 2 + 2));
    if (!bySrc.has(k)) bySrc.set(k, i);
  }
  const remap = new Int32Array(nv);
  let nearest = 0;
  let worst = 0;
  for (let v = 0; v < nv; v++) {
    const p = RP.getElement(v, []), n = RN.getElement(v, []), u = RU.getElement(v, []);
    const hit = bySrc.get(keyOf(p, n, u));
    if (hit !== undefined) {
      remap[v] = hit;
      continue;
    }
    // Fallback (should not happen): the nearest source vertex with the same uv.
    let best = -1, bd = Infinity;
    for (let i = 0; i < rest.P.length / 3; i++) {
      const d = Math.hypot(rest.P[i * 3] - p[0], rest.P[i * 3 + 1] - p[1], rest.P[i * 3 + 2] - p[2]) + Math.hypot(rest.U[i * 2] - u[0], rest.U[i * 2 + 1] - u[1]);
      if (d < bd) (bd = d), (best = i);
    }
    remap[v] = best;
    nearest++;
    worst = Math.max(worst, bd);
  }

  // Sample every clip; skin, keep the remapped vertices.
  const frames = [];
  for (const clip of CLIPS) {
    const doc = await io.read(file);
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === clip.name);
    if (!anim) throw new Error(`${src} has no ${clip.name}`);
    let dur = 0;
    for (const ch of anim.listChannels()) dur = Math.max(dur, ch.getSampler().getInput().getMax([])[0]);
    clip.duration = dur;
    for (let f = 0; f < clip.frames; f++) {
      const g = await flatten(file, { pose: clip.name, time: (f / clip.frames) * dur });
      const P = new Float32Array(nv * 3), N = new Float32Array(nv * 3);
      for (let v = 0; v < nv; v++) for (let c = 0; c < 3; c++) {
        P[v * 3 + c] = g.P[remap[v] * 3 + c];
        N[v * 3 + c] = g.N[remap[v] * 3 + c];
      }
      frames.push({ P, N });
    }
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { P } of frames) for (let i = 0; i < P.length; i++) {
    min[i % 3] = Math.min(min[i % 3], P[i]);
    max[i % 3] = Math.max(max[i % 3], P[i]);
  }
  const pos = new Int16Array(frames.length * nv * 3);
  const nrm = new Int8Array(frames.length * nv * 3);
  frames.forEach(({ P, N }, f) => {
    for (let i = 0; i < nv * 3; i++) {
      const c = i % 3;
      const u = (P[i] - min[c]) / Math.max(1e-9, max[c] - min[c]);
      pos[f * nv * 3 + i] = Math.round(u * 65535) - 32768;
      nrm[f * nv * 3 + i] = Math.max(-127, Math.min(127, Math.round(N[i] * 127)));
    }
  });
  header.pieces[piece] = { verts: nv, min, max, pos: push(new Uint8Array(pos.buffer)), nrm: push(new Uint8Array(nrm.buffer)) };
  console.log(piece, `${nv} verts, ${frames.length} frames`, nearest ? `(${nearest} matched by nearest, worst ${worst.toExponential(2)})` : '(all exact)');
}
header.clips = CLIPS.map((c) => ({ name: c.name, frames: c.frames, duration: +c.duration.toFixed(4) }));

let json = Buffer.from(JSON.stringify(header), 'utf8');
const pad = (4 - (json.length % 4)) % 4;
json = Buffer.concat([json, Buffer.alloc(pad, 0x20)]);
const head = Buffer.alloc(8);
head.write('VAT1', 0, 'ascii');
head.writeUInt32LE(json.length, 4);
const out = path.join(OUT, 'dudes-anim.bin');
fs.writeFileSync(out, Buffer.concat([head, json, ...blobs.map((b) => Buffer.from(b.buffer, b.byteOffset, b.byteLength))]));
console.log(out, fs.statSync(out).size, 'bytes', JSON.stringify(header.clips));
