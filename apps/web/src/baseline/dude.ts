// The crowd character, v3: one bright team colour, a chunky chibi silhouette (head ≈ body, two ear tufts,
// stubby arms held out, stubby legs), and a dynamic matcap: the matcap's R channel is the key light,
// G is a rim ring. The shader maps them to per-team shadow / lit / rim colours, so the crowd glows
// and every body separates from its neighbours without outlines. Legs and arms swing on the GPU.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type PartOpts = { shade: number; team: number; limb?: number; color?: string };

function part(geo: THREE.BufferGeometry, o: PartOpts) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position!.count;
  const c = new THREE.Color(o.color ?? '#ffffff').multiplyScalar(o.shade);
  const col = new Float32Array(n * 3), team = new Float32Array(n), limb = new Float32Array(n);
  for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); team[i] = o.team; limb[i] = o.limb ?? 0; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTeam', new THREE.BufferAttribute(team, 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 1));
  return g;
}

/** ~0.75 u tall at scale 1; faces world -z. Limb codes: ±1 legs, ±2 arms. */
export function dudeGeometry() {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, o: PartOpts) => P.push(part(g, o));
  for (const s of [-1, 1]) {
    const leg = new THREE.CapsuleGeometry(0.075, 0.08, 4, 8); leg.translate(s * 0.085, 0.1, 0);
    add(leg, { shade: 0.78, team: 1, limb: s });
    const arm = new THREE.CapsuleGeometry(0.06, 0.13, 4, 8); arm.rotateZ(s * 1.05); arm.translate(s * 0.235, 0.3, -0.02);
    add(arm, { shade: 0.92, team: 1, limb: 2 * s });
  }
  const body = new THREE.SphereGeometry(0.19, 16, 12); body.scale(1, 1.0, 0.88); body.translate(0, 0.26, 0);
  add(body, { shade: 0.9, team: 1 });
  const head = new THREE.SphereGeometry(0.23, 18, 14); head.scale(1.05, 0.95, 0.95); head.translate(0, 0.56, 0);
  add(head, { shade: 1, team: 1 });
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.085, 0.17, 10); ear.rotateZ(-s * 0.45); ear.translate(s * 0.15, 0.78, 0.0);
    add(ear, { shade: 1, team: 1 });
  }
  const tuft = new THREE.SphereGeometry(0.07, 10, 8); tuft.scale(0.8, 1.3, 0.8); tuft.translate(0, 0.8, 0.03);
  add(tuft, { shade: 1, team: 1 });
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.06, 10, 8); eye.scale(0.85, 1.15, 0.45); eye.translate(s * 0.085, 0.57, -0.205);
    add(eye, { shade: 1, team: 0, color: '#ffffff' });
    const pupil = new THREE.SphereGeometry(0.034, 8, 6); pupil.scale(0.9, 1.2, 0.5); pupil.translate(s * 0.08, 0.565, -0.23);
    add(pupil, { shade: 1, team: 0, color: '#1a1433' });
  }
  const g = mergeGeometries(P)!;
  g.computeVertexNormals();
  return g;
}

/** Our dynamic matcap: R = key light (upper left), G = rim ring, B = a small specular. Painted in code. */
export function dynamicMatcap() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(256, 256), d = img.data;
  const L = [-0.45, 0.6, 0.66], len = Math.hypot(L[0]!, L[1]!, L[2]!);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const nx = (x - 127.5) / 127.5, ny = (127.5 - y) / 127.5, r2 = nx * nx + ny * ny;
    const i = (y * 256 + x) * 4;
    const nz = Math.sqrt(Math.max(0, 1 - r2));
    const ndl = Math.max(0, (nx * L[0]! + ny * L[1]! + nz * L[2]!) / len);
    const key = Math.min(1, 0.15 + ndl * 0.95);
    const rim = Math.pow(Math.max(0, 1 - nz), 2.2) * (0.6 + 0.4 * Math.max(0, -ny * 0.5 + 0.5));
    const spec = Math.pow(ndl, 40);
    d[i] = Math.round(key * 255); d[i + 1] = Math.round(Math.min(1, rim) * 255); d[i + 2] = Math.round(spec * 255); d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace;
  return t;
}

export type TeamLook = { shadow: THREE.Color; lit: THREE.Color; rim: THREE.Color };
export const TEAM_LOOK: Record<'blue' | 'red' | 'gold', TeamLook> = {
  blue: { shadow: new THREE.Color('#0646c8'), lit: new THREE.Color('#14a2ff'), rim: new THREE.Color('#8fe6ff') },
  red: { shadow: new THREE.Color('#a8102a'), lit: new THREE.Color('#ff4d5e'), rim: new THREE.Color('#ffc2c8') },
  gold: { shadow: new THREE.Color('#c96a00'), lit: new THREE.Color('#ffd23a'), rim: new THREE.Color('#fff4b8') },
};

/** Crowd material for one team. Instance colour = (1, 1 - flash, 1): flash 0 normal, 1 pure white. */
export function dudeMaterial(matcap: THREE.Texture, time: { value: number }, look: TeamLook) {
  const m = new THREE.MeshMatcapMaterial({ matcap, vertexColors: true });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.uniforms.uShadow = { value: look.shadow }; s.uniforms.uLit = { value: look.lit }; s.uniforms.uRim = { value: look.rim };
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aTeam; attribute float aLimb; uniform float uTime; varying float vTeam; varying float vFlash;`)
      .replace('#include <color_vertex>', `
        #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
          vColor = vec4(1.0);
          #ifdef USE_COLOR
            vColor.rgb *= color.rgb;
          #endif
        #endif
        vTeam = aTeam;
        #ifdef USE_INSTANCING_COLOR
          vFlash = 1.0 - instanceColor.g;
        #else
          vFlash = 0.0;
        #endif`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        #ifdef USE_INSTANCING
          float ph = dot(instanceMatrix[3].xz, vec2(1.71, 2.37)) * 3.0;
        #else
          float ph = 0.0;
        #endif
        float run = uTime * 15.0 + ph;
        float leg = step(0.5, abs(aLimb)) * step(abs(aLimb), 1.5);
        float arm = step(1.5, abs(aLimb));
        float sgn = sign(aLimb);
        transformed.z += leg * sgn * sin(run) * 0.08;
        transformed.y += leg * max(0.0, sgn * cos(run)) * 0.05;
        transformed.y += arm * (0.03 + 0.03 * sin(run * 2.0 + sgn));
        transformed.z -= arm * sgn * sin(run) * 0.05;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uShadow; uniform vec3 uLit; uniform vec3 uRim; varying float vTeam; varying float vFlash;`)
      .replace('vec3 outgoingLight = diffuseColor.rgb * matcapColor.rgb;', `
        float shade = diffuseColor.r;
        vec3 teamC = mix(uShadow, uLit, matcapColor.r) * (0.55 + 0.45 * shade) + uRim * matcapColor.g * 0.6 + matcapColor.b * 0.2;
        vec3 ownC = diffuseColor.rgb * (0.55 + 0.6 * matcapColor.r) + matcapColor.b * 0.3;
        vec3 outgoingLight = mix(ownC, teamC, vTeam);
        outgoingLight = mix(outgoingLight, vec3(1.0), clamp(vFlash, 0.0, 1.0));`);
  };
  m.customProgramCacheKey = () => `dude-${look.lit.getHexString()}`;
  return m;
}
