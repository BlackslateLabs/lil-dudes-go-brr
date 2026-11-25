import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { AdditiveBlending, CanvasTexture, Color, Group, type Mesh, type MeshBasicMaterial, type Sprite, type SpriteMaterial } from 'three';
import { CHAMP_TICKS } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { CANNON_Z, HALF_W, LANE_W, PALETTE, wx } from './layout';
import { mergeParts, preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';

/** Base: a Tower Defense round tower bottom, its red trim swatch repainted team blue. */
const BASE_TINT: readonly TintRule[] = [{ cells: [[15, 2], [14, 2]], ref: [15, 2], color: PALETTE.me }];
/** Launcher: Blaster Kit `blaster-b`, its orange shell swatch repainted team blue. */
const LAUNCHER_TINT: readonly TintRule[] = [{ cells: [[11, 2], [10, 2]], ref: [11, 2], color: PALETTE.me }];

const BASE_SCALE = 2.8; // 1-unit piece → 2.8 wide, ~1.7 tall
const LAUNCHER_SCALE = 9.6; // blaster-b is ~0.42 long → ~4
const LAUNCHER_PITCH = 0.32; // muzzle tilted up the lane

preloadPacks('towers', 'blaster');

/** Your cannon on the cannon line: follows the predicted aim, kicks back on every volley. */
export function Cannon({ feed }: { feed: MatchFeed }) {
  return (
    <>
      <Rail />
      <Suspense fallback={null}>
        <CannonModel feed={feed} />
      </Suspense>
    </>
  );
}

const RAIL_DARK = '#2d3a6b';
const RAIL_STEEL = '#dfe7f5';

/** The track the cannon slides on: across the whole lane at the cannon row, with end caps. */
function Rail() {
  return (
    <group position={[0, 0, CANNON_Z]}>
      {/* Sleeper bed. */}
      <mesh position-y={0.07} receiveShadow>
        <boxGeometry args={[LANE_W + 0.6, 0.14, 1.1]} />
        <meshStandardMaterial color={RAIL_DARK} roughness={0.55} />
      </mesh>
      {/* Two shiny rails. */}
      {[-0.32, 0.32].map((z) => (
        <mesh key={z} position={[0, 0.2, z]} rotation-z={Math.PI / 2}>
          <cylinderGeometry args={[0.09, 0.09, LANE_W + 0.4, 10]} />
          <meshStandardMaterial color={RAIL_STEEL} roughness={0.22} metalness={0.35} />
        </mesh>
      ))}
      {/* End caps: chunky team-blue stops with a white top. */}
      {[-1, 1].map((s) => (
        <group key={s} position-x={s * (HALF_W + 0.35)}>
          <mesh position-y={0.32}>
            <cylinderGeometry args={[0.5, 0.56, 0.64, 18]} />
            <meshStandardMaterial color={PALETTE.me} roughness={0.35} />
          </mesh>
          <mesh position-y={0.68}>
            <sphereGeometry args={[0.42, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <meshStandardMaterial color="#ffffff" roughness={0.3} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ---- Champion charge on the cannon (visual only) ----------------------------------------------
// Charging: a ring round the base fills purple and the shell takes on a faint purple tint.
// Full ("let go!"): the ring turns gold and pulses, the shell glows gold, a halo breathes behind
// the barrel, and the cannon punches once with a gold shockwave. Released: a white flash and a
// purple shockwave as the Champion goes. Everything is mounted from the first frame (at zero
// opacity), so no shader compiles mid-match, and nothing allocates per frame.

const GRAPE = new Color('#7c5cff');
const GOLD = new Color('#ffc21a');
const WHITE = new Color('#ffffff');
const BLACK = new Color('#000000');
const tint = new Color();

let haloTex: CanvasTexture | null = null;
/** A soft radial glow, drawn once. */
function getHalo(): CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  haloTex = new CanvasTexture(c);
  return haloTex;
}

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

/** The fill starts at the front of the cannon (toward the lane) and runs round. */
const RING_FRAG = /* glsl */ `
uniform float uFill;
uniform float uReady;
uniform float uRelease;
uniform float uTime;
uniform vec3 uGrape;
uniform vec3 uGold;
varying vec2 vP;
void main() {
  float a = atan(vP.x, vP.y) / 6.2831853 + 0.5;
  float on = step(a, uFill);
  float pulse = 0.5 + 0.5 * sin(uTime * 9.0);
  vec3 col = mix(vec3(0.106, 0.082, 0.188), uGrape, on);
  col = mix(col, uGold * (1.1 + 0.35 * pulse), uReady);
  col = mix(col, vec3(1.0), uRelease);
  float alpha = mix(0.35, 0.95, max(on, uReady));
  alpha *= step(0.001, uFill + uReady + uRelease);
  gl_FragColor = vec4(col, alpha);
}`;

function CannonModel({ feed }: { feed: MatchFeed }) {
  const ref = useRef<Group>(null!);
  const barrel = useRef<Group>(null!);
  const shock = useRef<Mesh>(null!);
  const halo = useRef<Sprite>(null!);
  const kick = useRef(0);
  const fx = useRef({ fill: 0, ready: 0, punch: 0, release: 0, shockT: 1, shockGold: true, wasFull: false, t: 0 });
  const towers = usePack('towers');
  const blaster = usePack('blaster');
  const baseMat = useTintedMaterial(towers, 'cannon-base', BASE_TINT);
  const launcherMat = useTintedMaterial(blaster, 'cannon-launcher', LAUNCHER_TINT, 0.45);
  const baseGeo = useMemo(() => mergeParts(towers, [{ piece: 'tower-bottom', x: 0, y: 0, z: 0, s: [1, 1.05, 1] }], BASE_SCALE), [towers]);
  const ringUniforms = useMemo(
    () => ({
      uFill: { value: 0 },
      uReady: { value: 0 },
      uRelease: { value: 0 },
      uTime: { value: 0 },
      uGrape: { value: GRAPE.clone() },
      uGold: { value: GOLD.clone() },
    }),
    [],
  );

  useEffect(
    () =>
      feed.onEvent((e) => {
        if (e.type !== 'volley' || e.side !== feed.mySide) return;
        kick.current = 1;
        if (e.champion) {
          const f = fx.current;
          f.release = 1;
          f.shockT = 0;
          f.shockGold = false;
        }
      }),
    [feed],
  );

  useFrame((_, dt) => {
    ref.current.position.x = wx(feed.myCannon);
    kick.current = Math.max(0, kick.current - dt * 6);
    const k = kick.current;
    const f = fx.current;
    f.t += dt;

    // The meter, read the way the HUD ring reads it.
    const lane = feed.me;
    const live = !!lane && lane.phase === 'fight';
    const meter = lane && live ? Math.min(1, Math.max(0, lane.champMeter / CHAMP_TICKS)) : 0;
    const full = live && !!lane && !lane.champPending && meter >= 1;
    if (full && !f.wasFull) {
      f.punch = 1;
      f.shockT = 0;
      f.shockGold = true;
    }
    f.wasFull = full;
    f.fill += (meter - f.fill) * Math.min(1, dt * 10);
    f.ready += ((full ? 1 : 0) - f.ready) * Math.min(1, dt * 8);
    f.punch = Math.max(0, f.punch - dt * 3);
    f.release = Math.max(0, f.release - dt * 2.5);
    f.shockT = Math.min(1, f.shockT + dt * 2.2);

    // Recoil: slide back along the barrel and squash a little, like a toy.
    barrel.current.position.z = k * 0.45;
    barrel.current.scale.set(1 + k * 0.06, 1 + k * 0.06, 1 - k * 0.1);

    // Ready: one punch, then a slow breathing pulse.
    const pulse = 0.5 + 0.5 * Math.sin(f.t * 9);
    ref.current.scale.setScalar(1 + Math.sin(f.punch * Math.PI) * 0.16 + f.ready * pulse * 0.035);

    // Shell tint: faint purple while charging, a gold glow when full, a white flash on release.
    tint.copy(GRAPE).lerp(GOLD, f.ready).lerp(WHITE, f.release);
    const glow = f.fill * f.fill * 0.28 * (1 - f.ready) + f.ready * (0.45 + 0.3 * pulse) + f.release * 0.9;
    const lit = glow > 0.002 ? tint : BLACK;
    launcherMat.emissive.copy(lit);
    baseMat.emissive.copy(lit);
    launcherMat.emissiveIntensity = glow;
    baseMat.emissiveIntensity = glow * 0.6;

    // The ring round the base.
    ringUniforms.uFill.value = f.fill;
    ringUniforms.uReady.value = f.ready;
    ringUniforms.uRelease.value = f.release;
    ringUniforms.uTime.value = f.t;

    // Halo behind the barrel while ready (and a flash on release).
    const hm = halo.current.material as SpriteMaterial;
    hm.color.copy(tint);
    hm.opacity = f.ready * (0.45 + 0.25 * pulse) + f.release * 0.6;
    const hs = 5.5 + f.ready * pulse * 0.8 + f.release * 2;
    halo.current.scale.set(hs, hs, 1);

    // Shockwave: gold when the meter fills, purple when the Champion goes.
    const sm = shock.current.material as MeshBasicMaterial;
    sm.color.copy(f.shockGold ? GOLD : GRAPE);
    sm.opacity = f.shockT < 1 ? (1 - f.shockT) * 0.9 : 0;
    shock.current.scale.setScalar(1.6 + f.shockT * 4.5);
  });

  return (
    <group ref={ref} position={[0, 0, CANNON_Z]}>
      <mesh geometry={baseGeo} material={baseMat} position-y={0.12} />
      <group ref={barrel} position-y={BASE_SCALE * 0.6 + 0.8}>
        <mesh
          geometry={blaster.geo.launcher!}
          material={launcherMat}
          rotation-x={LAUNCHER_PITCH}
          scale={LAUNCHER_SCALE}
        />
      </group>
      {/* Charge ring round the base, flat, just above the rail. */}
      <mesh rotation-x={-Math.PI / 2} position-y={0.34} renderOrder={2} userData={{ noShadow: true }}>
        <ringGeometry args={[1.75, 2.2, 64]} />
        <shaderMaterial vertexShader={RING_VERT} fragmentShader={RING_FRAG} uniforms={ringUniforms} transparent depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Shockwave (meter full / Champion released). */}
      <mesh ref={shock} rotation-x={-Math.PI / 2} position-y={0.36} renderOrder={3} userData={{ noShadow: true }}>
        <ringGeometry args={[0.92, 1, 64]} />
        <meshBasicMaterial color={GOLD} transparent opacity={0} depthWrite={false} toneMapped={false} />
      </mesh>
      {/* Halo behind the barrel. */}
      <sprite ref={halo} position={[0, BASE_SCALE * 0.6 + 1.2, 0.6]} renderOrder={1} userData={{ noShadow: true }}>
        <spriteMaterial map={getHalo()} color={GOLD} transparent opacity={0} depthWrite={false} blending={AdditiveBlending} toneMapped={false} />
      </sprite>
    </group>
  );
}
