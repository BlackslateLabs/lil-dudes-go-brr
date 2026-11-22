// Rebuilds public/assets/models/*.glb from the raw Kenney kits (CC0). Not part of the app build.
//
// Each output GLB holds one flattened, non-skinned mesh per piece (node name = piece name), all
// sharing one material: the kit's colormap (textured kits) or vertex colours (nature kit, recoloured
// to the candy palette in packs.json). Characters get their "idle" pose baked in (arms down), faces
// that point straight down dropped, and a meshoptimizer simplify to stay under ~400 triangles.
//
// The kits are downloads from kenney.nl (see public/assets/CREDITS.md), unzipped side by side into
// <assetsDir> as kenney-mini-characters/, kenney-blaster-kit/, kenney-tower-defense-kit/,
// kenney-fantasy-town-kit/, kenney-nature-kit/. The tools are not app dependencies: copy this file
// and packs.json into a scratch folder, then there:
//   npm i @gltf-transform/core@4 @gltf-transform/functions@4 @gltf-transform/extensions@4 meshoptimizer
//   node build-models.mjs <assetsDir> <repo>/apps/web/public/assets/models [pack,pack]
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { weldPrimitive, simplifyPrimitive, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';

const [ASSETS, OUT] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const quiet = { warn() {}, info() {}, debug() {}, error: console.error };

const KITS = {
  mini: 'kenney-mini-characters/Models/GLB format',
  blaster: 'kenney-blaster-kit/Models/GLB format',
  td: 'kenney-tower-defense-kit/Models/GLB format',
  town: 'kenney-fantasy-town-kit/Models/GLB format',
  nature: 'kenney-nature-kit/Models/GLTF format',
};

// ---- small mat4 helpers (column-major, like glTF) ----
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function xfP(m, p) {
  return [0, 1, 2].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r]);
}
function xfN(m, n) {
  // fine for rotation + uniform/axis scale (Kenney pieces); renormalise
  const v = [0, 1, 2].map((r) => m[r] * n[0] + m[4 + r] * n[1] + m[8 + r] * n[2]);
  const l = Math.hypot(...v) || 1;
  return v.map((x) => x / l);
}
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

/** Flatten a source file into raw arrays in its own (scene) space. */
async function flatten(file, opts = {}) {
  const doc = await io.read(file);
  const P = [], N = [], U = [], C = [], I = [];
  let textured = false;
  // optional pose: sample one keyframe of a named animation into joint local transforms
  const poseLocal = new Map();
  if (opts.pose) {
    const anim = doc.getRoot().listAnimations().find((a) => a.getName() === opts.pose);
    for (const ch of anim.listChannels()) {
      const s = ch.getSampler(); const k = Math.min(opts.key ?? 0, s.getInput().getCount() - 1);
      const e = poseLocal.get(ch.getTargetNode()) || {}; e[ch.getTargetPath()] = s.getOutput().getElement(k, []);
      poseLocal.set(ch.getTargetNode(), e);
    }
  }
  const localOf = (node) => {
    const o = poseLocal.get(node);
    if (!o) return node.getMatrix();
    const t = o.translation ?? node.getTranslation(), r = o.rotation ?? node.getRotation(), sc = o.scale ?? node.getScale();
    const [x, y, z, w] = r;
    const m = [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w), 0,
      2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w), 0,
      2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y), 0, t[0], t[1], t[2], 1];
    for (let c = 0; c < 3; c++) for (let rr = 0; rr < 3; rr++) m[c * 4 + rr] *= sc[c];
    return m;
  };
  const worldOf = (node) => { const p = node.getParentNode(); return p ? mul(worldOf(p), localOf(node)) : localOf(node); };
  const visit = (node, parent) => {
    const m = mul(parent, node.getMatrix());
    const mesh = node.getMesh();
    if (mesh) {
      for (const prim of mesh.listPrimitives()) {
        const mat = prim.getMaterial();
        const tex = mat?.getBaseColorTexture();
        if (tex) textured = true;
        const hex = opts.colors?.[mat?.getName()];
        const f = hex ? [0, 2, 4].map((k) => srgbToLin(parseInt(hex.slice(1 + k, 3 + k), 16) / 255)) : mat ? mat.getBaseColorFactor() : [1, 1, 1, 1];
        const pos = prim.getAttribute('POSITION'), nor = prim.getAttribute('NORMAL'), uv = prim.getAttribute('TEXCOORD_0');
        const base = P.length / 3;
        // skinned meshes: Kenney characters' joints are pure translations matching the inverse
        // binds, so the mesh-space positions already are the rest pose; ignore the node matrix.
        const skin = node.getSkin();
        const skinM = skin && skin.listJoints().map((j, ji) => mul(worldOf(j), skin.getInverseBindMatrices().getElement(ji, [])));
        const J = prim.getAttribute('JOINTS_0'), W = prim.getAttribute('WEIGHTS_0');
        for (let i = 0; i < pos.getCount(); i++) {
          let mm = m;
          if (skin) {
            const j = J.getElement(i, []), w = W.getElement(i, []);
            mm = new Array(16).fill(0);
            for (let k = 0; k < 4; k++) if (w[k]) for (let e = 0; e < 16; e++) mm[e] += w[k] * skinM[j[k]][e];
          }
          P.push(...xfP(mm, pos.getElement(i, [])));
          N.push(...xfN(mm, nor ? nor.getElement(i, []) : [0, 1, 0]));
          U.push(...(uv ? uv.getElement(i, []) : [0, 0]));
          C.push(f[0], f[1], f[2]); // glTF factors are linear already
        }
        const idx = prim.getIndices();
        if (idx) for (const k of idx.getArray()) I.push(base + k);
        else for (let i = 0; i < pos.getCount(); i++) I.push(base + i);
      }
    }
    for (const c of node.listChildren()) visit(c, m);
  };
  const ident = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const n of doc.getRoot().getDefaultScene().listChildren()) visit(n, ident);
  let texImage = null;
  if (textured) {
    const t = doc.getRoot().listTextures()[0];
    texImage = t.getImage() ?? fs.readFileSync(path.join(path.dirname(file), t.getURI()));
  }
  if (opts.dropDown) {
    // drop faces pointing straight down (never seen from above)
    const keep = [];
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t], b = I[t + 1], c = I[t + 2];
      const ny = (N[a * 3 + 1] + N[b * 3 + 1] + N[c * 3 + 1]) / 3;
      if (ny > -0.9) keep.push(a, b, c);
    }
    I.length = 0; I.push(...keep);
  }
  return { P, N, U, C, I, textured, texImage };
}

async function buildPack(name, kit, pieces, colors) {
  const doc = new Document();
  doc.setLogger(quiet);
  const buf = doc.createBuffer();
  const scene = doc.createScene(name);
  let mat = null;
  let stats = [];
  for (const [piece, src, opts = {}] of pieces) {
    const f = await flatten(path.join(ASSETS, KITS[kit], src + '.glb'), { ...opts, colors: colors ?? opts.colors });
    if (!mat) {
      mat = doc.createMaterial(f.textured ? 'colormap' : 'vcol').setMetallicFactor(0).setRoughnessFactor(1);
      if (f.textured) {
        const tex = doc.createTexture('colormap').setImage(f.texImage).setMimeType('image/png');
        mat.setBaseColorTexture(tex);
        mat.getBaseColorTextureInfo().setMagFilter(9728).setMinFilter(9987); // nearest mag keeps the flat colour cells crisp
      }
    }
    const prim = doc.createPrimitive().setMaterial(mat);
    prim.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(f.P)).setBuffer(buf));
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(f.N)).setBuffer(buf));
    if (f.textured) prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(f.U)).setBuffer(buf));
    else prim.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(new Float32Array(f.C)).setBuffer(buf));
    const nv = f.P.length / 3;
    prim.setIndices(doc.createAccessor().setType('SCALAR').setArray(nv > 65535 ? new Uint32Array(f.I) : new Uint16Array(f.I)).setBuffer(buf));
    let tris0 = f.I.length / 3;
    if (opts.simplify) {
      await MeshoptSimplifier.ready;
      weldPrimitive(prim, {});
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: opts.simplify, error: opts.error ?? 0.02, lockBorder: false });
    }
    const tris = prim.getIndices().getCount() / 3;
    stats.push(`${piece}:${tris0}->${tris}`);
    const mesh = doc.createMesh(piece).addPrimitive(prim);
    scene.addChild(doc.createNode(piece).setMesh(mesh));
  }
  await doc.transform(dedup(), prune());
  const out = path.join(OUT, name + '.glb');
  await io.write(out, doc);
  console.log(name, fs.statSync(out).size, 'bytes', stats.join(' '));
}

const cfg = JSON.parse(fs.readFileSync(new URL('./packs.json', import.meta.url), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
for (const [name, p] of Object.entries(cfg)) {
  if (process.argv[4] && !process.argv[4].split(',').includes(name)) continue;
  await buildPack(name, p.kit, p.pieces, p.colors);
}
