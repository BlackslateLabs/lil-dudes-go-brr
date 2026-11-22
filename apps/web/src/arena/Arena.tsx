import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  BackSide,
  CanvasTexture,
  Color,
  type DirectionalLight,
  type Material,
  type Mesh,
  NeutralToneMapping,
  NoToneMapping,
  PMREMGenerator,
  RepeatWrapping,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { MatchFeed } from '../match/feed';
import { Base } from './Base';
import { Cannon } from './Cannon';
import { Crowds } from './Crowds';
import { Fx } from './Fx';
import { Gates } from './Gates';
import { Post } from './Post';
import { fxTier } from './quality';
import { Scenery } from './Scenery';
import { CAM_FOV, CAM_POS, CAM_TARGET, HALF_L, HALF_W, LANE_L, LANE_W, PALETTE, wz } from './layout';

interface ArenaProps {
  feed: MatchFeed;
  /** Gate taps (peek). Off for the Home background. */
  interactive?: boolean;
}

const camBase = new Vector3(...CAM_POS);

/** Your lane in 3D. It only draws what the MatchSource says; it never decides outcomes. */
export function Arena({ feed, interactive = false }: ArenaProps) {
  const tier = fxTier();
  return (
    <Canvas
      dpr={[1, 2]}
      shadows="percentage"
      flat={tier === 'high'}
      camera={{ position: [...CAM_POS], fov: CAM_FOV, near: 1, far: 400 }}
      onCreated={({ camera, gl }) => {
        camera.lookAt(...CAM_TARGET);
        // High tier tone-maps in the post pass; low tier lets the renderer do it.
        gl.toneMapping = tier === 'high' ? NoToneMapping : NeutralToneMapping;
        gl.toneMappingExposure = 1;
      }}
      gl={{ antialias: tier === 'low', powerPreference: 'high-performance' }}
    >
      <color attach="background" args={[PALETTE.skyHorizon]} />
      <fog attach="fog" args={[PALETTE.skyHorizon, 95, 230]} />
      <Lights high={tier === 'high'} />
      <Environment />
      <ShadowCasters />
      <Sky />

      <Predictor feed={feed} />
      <Ground />
      <Scenery />
      <Base feed={feed} />
      <Gates feed={feed} interactive={interactive} />
      <Cannon feed={feed} />
      <Crowds feed={feed} />
      <Fx feed={feed} camBase={camBase} />
      {tier === 'high' && <Post />}
    </Canvas>
  );
}

/** Moves your predicted cannon every frame, before anything renders. */
function Predictor({ feed }: { feed: MatchFeed }) {
  useFrame((_, dt) => feed.predict(Math.min(dt, 0.1)), -1);
  return null;
}

/**
 * Candy daylight: a bright sky/grass hemisphere fill so shadows stay soft and coloured, a warm key
 * from the front right that casts the shadows, and a cool back light for a little rim on tops.
 * The shadow camera is fitted tightly around the lane (plus the base wall and the cannon).
 */
function Lights({ high }: { high: boolean }) {
  const key = useRef<DirectionalLight>(null!);
  useEffect(() => {
    const cam = key.current.shadow.camera;
    cam.left = -17;
    cam.right = 17;
    cam.top = 32;
    cam.bottom = -30;
    cam.near = 10;
    cam.far = 90;
    cam.updateProjectionMatrix();
  }, []);
  const map = high ? 2048 : 1024;
  return (
    <>
      <hemisphereLight args={['#dff1ff', '#8fcf6f', 1.0]} />
      <directionalLight
        ref={key}
        position={[-20, 30, 6]}
        color="#fff0d6"
        intensity={2.3}
        castShadow
        shadow-mapSize={[map, map]}
        shadow-radius={high ? 4 : 2}
        shadow-intensity={0.62}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[14, 14, -40]} color="#cfe6ff" intensity={0.4} />
    </>
  );
}

/**
 * A soft studio environment: gives glossy (standard-material) models their candy highlights. Kept
 * low because three.js also uses it as fill light on Lambert/Phong materials, which would wash out
 * the key light and its shadows.
 */
function Environment() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  useEffect(() => {
    const pmrem = new PMREMGenerator(gl);
    const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.25;
    pmrem.dispose();
    return () => {
      scene.environment = null;
      env.dispose();
    };
  }, [gl, scene]);
  return null;
}

/**
 * Every opaque mesh casts a shadow, including models that load later, so the model files don't
 * need to know about lighting. Opt out with `mesh.userData.noShadow = true`. Transparent things
 * (gate glass, labels, particles) never cast.
 */
function ShadowCasters() {
  const next = useRef(0);
  useFrame(({ scene, clock }) => {
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.5;
    scene.traverse((o) => {
      const m = o as Mesh;
      if (!m.isMesh || m.castShadow || m.userData.noShadow) return;
      const mats: Material[] = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.every((x) => !x.transparent)) m.castShadow = true;
    });
  });
  return null;
}

/** Gradient sky dome (only its lower part shows above the base, but it sets the horizon tint). */
function Sky() {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new Color(PALETTE.skyTop) },
      uHorizon: { value: new Color(PALETTE.skyHorizon) },
    }),
    [],
  );
  return (
    <mesh renderOrder={-10} userData={{ noShadow: true }}>
      <sphereGeometry args={[320, 24, 12]} />
      <shaderMaterial
        side={BackSide}
        depthWrite={false}
        fog={false}
        uniforms={uniforms}
        vertexShader={
          /* glsl */ `varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`
        }
        fragmentShader={
          /* glsl */ `uniform vec3 uTop; uniform vec3 uHorizon; varying vec3 vDir;
          void main() {
            float h = clamp(vDir.y * 2.2, 0.0, 1.0);
            gl_FragColor = vec4(mix(uHorizon, uTop, pow(h, 0.8)), 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`
        }
      />
    </mesh>
  );
}

// ---------- Ground textures (drawn once, in code) ----------

let grassTex: CanvasTexture | null = null;
let laneTex: CanvasTexture | null = null;
let kerbTex: CanvasTexture | null = null;
let edgeTex: CanvasTexture | null = null;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function toTexture(c: HTMLCanvasElement, repeat = true): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Seeded so every match has the same lawn. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Mown-lawn stripes along the lane, soft blotches, a few tufts and tiny flowers. Covers 16 × 16 units. */
function getGrassTexture(): CanvasTexture {
  if (grassTex) return grassTex;
  const [c, g] = canvas(512, 512);
  const r = rng(7);
  for (let i = 0; i < 4; i++) {
    g.fillStyle = i % 2 ? PALETTE.grass : '#79d663';
    g.fillRect(i * 128, 0, 128, 512);
  }
  for (let i = 0; i < 70; i++) {
    const x = r() * 512;
    const y = r() * 512;
    const rad = 20 + r() * 60;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    const col = r() < 0.5 ? '87,184,74' : '143,224,110';
    grd.addColorStop(0, `rgba(${col},0.35)`);
    grd.addColorStop(1, `rgba(${col},0)`);
    g.fillStyle = grd;
    for (const ox of [-512, 0, 512]) for (const oy of [-512, 0, 512]) {
      g.save();
      g.translate(ox, oy);
      g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      g.restore();
    }
  }
  g.lineCap = 'round';
  for (let i = 0; i < 160; i++) {
    const x = r() * 512;
    const y = r() * 512;
    g.strokeStyle = r() < 0.5 ? 'rgba(70,160,60,0.55)' : 'rgba(160,235,120,0.6)';
    g.lineWidth = 2.5;
    g.beginPath();
    g.moveTo(x - 4, y + 3);
    g.lineTo(x - 2, y - 5);
    g.moveTo(x, y + 3);
    g.lineTo(x + 1, y - 7);
    g.moveTo(x + 4, y + 3);
    g.lineTo(x + 5, y - 4);
    g.stroke();
  }
  for (let i = 0; i < 26; i++) {
    const x = r() * 512;
    const y = r() * 512;
    g.fillStyle = ['#ffffff', '#fff27a', '#ffb3d9'][i % 3]!;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      g.beginPath();
      g.arc(x + Math.cos(a) * 3, y + Math.sin(a) * 3, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffb21a';
    g.beginPath();
    g.arc(x, y, 1.8, 0, Math.PI * 2);
    g.fill();
  }
  grassTex = toTexture(c);
  return grassTex;
}

/** Rounded candy tiles with grout and a soft bevel; 2 × 2 tiles of 3 units each. */
function getLaneTexture(): CanvasTexture {
  if (laneTex) return laneTex;
  const [c, g] = canvas(256, 256);
  g.fillStyle = PALETTE.laneGrout;
  g.fillRect(0, 0, 256, 256);
  const T = 128;
  const gap = 5;
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      const x = i * T + gap / 2;
      const y = j * T + gap / 2;
      const s = T - gap;
      g.fillStyle = (i + j) % 2 ? PALETTE.lane : PALETTE.laneTile;
      g.beginPath();
      g.roundRect(x, y, s, s, 14);
      g.fill();
      const hi = g.createLinearGradient(x, y, x + s, y + s);
      hi.addColorStop(0, 'rgba(255,255,255,0.55)');
      hi.addColorStop(0.35, 'rgba(255,255,255,0)');
      hi.addColorStop(0.8, 'rgba(214,150,90,0)');
      hi.addColorStop(1, 'rgba(214,150,90,0.22)');
      g.fillStyle = hi;
      g.beginPath();
      g.roundRect(x, y, s, s, 14);
      g.fill();
    }
  }
  laneTex = toTexture(c);
  return laneTex;
}

/** Candy-cane stripes for the kerbs. */
function getKerbTexture(): CanvasTexture {
  if (kerbTex) return kerbTex;
  const [c, g] = canvas(16, 64);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 16, 64);
  g.fillStyle = PALETTE.kerbStripe;
  g.fillRect(0, 0, 16, 32);
  kerbTex = toTexture(c);
  return kerbTex;
}

/** Soft warm shade along the inside of the kerbs (fake contact shadow). */
function getEdgeTexture(): CanvasTexture {
  if (edgeTex) return edgeTex;
  const [c, g] = canvas(64, 4);
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, 'rgba(150,80,40,0.38)');
  grd.addColorStop(1, 'rgba(150,80,40,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 4);
  edgeTex = toTexture(c, false);
  return edgeTex;
}

const KERB_R = 0.42;

function Ground() {
  const grass = useMemo(() => {
    const t = getGrassTexture().clone();
    t.repeat.set(220 / 16, 260 / 16);
    t.needsUpdate = true;
    return t;
  }, []);
  const lane = useMemo(() => {
    const t = getLaneTexture().clone();
    t.repeat.set(LANE_W / 6, (LANE_L + 4) / 6);
    t.needsUpdate = true;
    return t;
  }, []);
  const kerb = useMemo(() => {
    const t = getKerbTexture().clone();
    t.repeat.set(1, (LANE_L + 4) / 2.4);
    t.needsUpdate = true;
    return t;
  }, []);
  const edge = getEdgeTexture();
  const flat = { noShadow: true };
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05} receiveShadow userData={flat}>
        <planeGeometry args={[220, 260]} />
        <meshLambertMaterial map={grass} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} receiveShadow userData={flat}>
        <planeGeometry args={[LANE_W, LANE_L + 4]} />
        <meshLambertMaterial map={lane} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`e${s}`} rotation-x={-Math.PI / 2} rotation-z={s < 0 ? 0 : Math.PI} position={[s * (HALF_W - 0.7), 0.01, 0]} userData={flat}>
          <planeGeometry args={[1.4, LANE_L + 4]} />
          <meshBasicMaterial map={edge} transparent depthWrite={false} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + KERB_R), 0.22, 0]} rotation-x={Math.PI / 2} receiveShadow>
          <cylinderGeometry args={[KERB_R, KERB_R, LANE_L + 4, 16, 1]} />
          <meshStandardMaterial map={kerb} roughness={0.32} metalness={0} />
        </mesh>
      ))}
      {/* Your cannon line: an enemy crossing it ends your run. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, wz(0) - 0.6]} userData={flat}>
        <planeGeometry args={[LANE_W, 0.9]} />
        <meshBasicMaterial color={PALETTE.enemy} transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.04, wz(0) - 0.6]} userData={flat}>
        <planeGeometry args={[LANE_W, 0.3]} />
        <meshBasicMaterial color={PALETTE.enemy} transparent opacity={0.95} depthWrite={false} />
      </mesh>
      {/* The base strip at the far end. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, -HALF_L + 0.6]} userData={flat}>
        <planeGeometry args={[LANE_W, 1.2]} />
        <meshBasicMaterial color={PALETTE.base} transparent opacity={0.4} depthWrite={false} />
      </mesh>
    </group>
  );
}
