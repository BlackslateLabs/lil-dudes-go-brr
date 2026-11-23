// The crowd character: a chunky little dude that reads at 30 px. Big white eyes, a team helmet,
// running legs and swinging arms (vertex-animated on the GPU), and a dark cartoon outline.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type PartOpts = { color: string; team: number; limb?: number };

function part(geo: THREE.BufferGeometry, o: PartOpts) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.deleteAttribute('uv');
  const n = g.attributes.position!.count;
  const c = new THREE.Color(o.color);
  const col = new Float32Array(n * 3), team = new Float32Array(n), limb = new Float32Array(n);
  for (let i = 0; i < n; i++) { col.set([c.r, c.g, c.b], i * 3); team[i] = o.team; limb[i] = o.limb ?? 0; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aTeam', new THREE.BufferAttribute(team, 1));
  g.setAttribute('aLimb', new THREE.BufferAttribute(limb, 1));
  return g;
}

/**
 * ~0.8 u tall. Faces world -z (up the lane). Limb codes: 1/-1 legs (left/right), 2/-2 arms.
 * Team parts take the instance colour (shaded light/dark through the vertex colour); the rest keep theirs.
 */
export function dudeGeometry() {
  const P: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry, o: PartOpts) => P.push(part(g, o));
  // legs (dark shorts + shoes)
  for (const s of [-1, 1]) {
    const leg = new THREE.CapsuleGeometry(0.07, 0.12, 3, 8); leg.translate(s * 0.09, 0.12, 0);
    add(leg, { color: '#2a2f55', team: 0, limb: s });
    const shoe = new THREE.SphereGeometry(0.075, 8, 6); shoe.scale(1, 0.7, 1.3); shoe.translate(s * 0.09, 0.03, -0.03);
    add(shoe, { color: '#1b1d33', team: 0, limb: s });
  }
  // body: team shirt
  const body = new THREE.SphereGeometry(0.2, 14, 10); body.scale(1, 1.05, 0.9); body.translate(0, 0.32, 0);
  add(body, { color: '#d6d6e2', team: 1 });
  const belt = new THREE.TorusGeometry(0.17, 0.035, 6, 16); belt.rotateX(Math.PI / 2); belt.translate(0, 0.22, 0);
  add(belt, { color: '#2a2f55', team: 0 });
  // arms (team colour, slightly darker) with hands
  for (const s of [-1, 1]) {
    const arm = new THREE.CapsuleGeometry(0.055, 0.12, 3, 6); arm.rotateZ(s * 0.5); arm.translate(s * 0.23, 0.36, 0);
    add(arm, { color: '#c8c8c8', team: 1, limb: 2 * s });
    const hand = new THREE.SphereGeometry(0.06, 8, 6); hand.translate(s * 0.28, 0.27, 0);
    add(hand, { color: '#ffd9b8', team: 0, limb: 2 * s });
  }
  const pack = new THREE.SphereGeometry(0.13, 10, 8); pack.scale(1.1, 1.1, 0.7); pack.translate(0, 0.36, 0.17);
  add(pack, { color: '#ffcf3f', team: 0 });
  // head: skin, big eyes
  const head = new THREE.SphereGeometry(0.22, 16, 12); head.translate(0, 0.64, 0);
  add(head, { color: '#ffd9b8', team: 0 });
  for (const s of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.075, 10, 8); eye.scale(0.9, 1.15, 0.5); eye.translate(s * 0.085, 0.66, -0.185);
    add(eye, { color: '#ffffff', team: 0 });
    const pupil = new THREE.SphereGeometry(0.042, 8, 6); pupil.scale(0.9, 1.2, 0.5); pupil.translate(s * 0.08, 0.65, -0.215);
    add(pupil, { color: '#14112a', team: 0 });
    const cheek = new THREE.SphereGeometry(0.035, 6, 5); cheek.scale(1.2, 0.7, 0.4); cheek.translate(s * 0.15, 0.58, -0.17);
    add(cheek, { color: '#ff9aa8', team: 0 });
  }
  // helmet: team dome + brim + white stripe + top knob
  const dome = new THREE.SphereGeometry(0.235, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.52); dome.translate(0, 0.68, 0.01);
  add(dome, { color: '#ffffff', team: 1 });
  const brim = new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16); brim.translate(0, 0.68, -0.01);
  add(brim, { color: '#c4c4d4', team: 1 });
  const stripe = new THREE.TorusGeometry(0.215, 0.04, 4, 16, Math.PI); stripe.rotateY(Math.PI / 2); stripe.translate(0, 0.7, 0);
  add(stripe, { color: '#f4f8ff', team: 0 });
  const knob = new THREE.SphereGeometry(0.05, 8, 6); knob.translate(0, 0.92, 0.01);
  add(knob, { color: '#ffe066', team: 0 });
  const g = mergeGeometries(P)!;
  g.computeVertexNormals();
  return g;
}

/** Shared vertex code: team tint + limb swing. Needs uTime; phase comes from the instance position. */
function patchVertex(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, time: { value: number }, outline = 0) {
  shader.uniforms.uTime = time;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
      attribute float aTeam; attribute float aLimb; uniform float uTime;`)
    .replace('#include <color_vertex>', `
      #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        vColor = vec4(1.0);
        #ifdef USE_COLOR
          vColor.rgb *= color.rgb;
        #endif
        #ifdef USE_INSTANCING_COLOR
          vColor.rgb = mix(vColor.rgb, vColor.rgb * instanceColor.rgb, aTeam);
        #endif
      #endif`)
    .replace('#include <begin_vertex>', `
      vec3 transformed = vec3(position);
      #ifdef USE_INSTANCING
        vec2 ip = instanceMatrix[3].xz;
        float ph = dot(ip, vec2(1.71, 2.37)) * 3.0;
      #else
        float ph = 0.0;
      #endif
      float run = uTime * 14.0 + ph;
      float leg = step(0.5, abs(aLimb)) * step(abs(aLimb), 1.5);
      float arm = step(1.5, abs(aLimb));
      float sgn = sign(aLimb);
      transformed.z += leg * sgn * sin(run) * 0.09;
      transformed.y += leg * max(0.0, sgn * cos(run)) * 0.05;
      transformed.z -= arm * sgn * sin(run) * 0.08;
      transformed.y += arm * 0.02 * cos(run * 2.0);
      ${outline ? `transformed += normal * ${outline.toFixed(3)};` : ''}`);
}

export function dudeMaterials(matcap: THREE.Texture, time: { value: number }) {
  const body = new THREE.MeshMatcapMaterial({ matcap, vertexColors: true });
  body.onBeforeCompile = (s) => patchVertex(s as never, time);
  const line = new THREE.MeshBasicMaterial({ color: '#1d2350', side: THREE.BackSide });
  line.onBeforeCompile = (s) => patchVertex(s as never, time, 0.02);
  return { body, line };
}
