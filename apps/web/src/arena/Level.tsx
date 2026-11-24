import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  type Material,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  ShaderMaterial,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type BufferGeometry,
} from 'three';
import type { MatchFeed } from '../match/feed';
import { HALF_L, S, wx, wz } from './layout';
import { obstacleCorners, obstaclesOf, padsOf, pipesOf, type ObstacleDef, type PadDef, type PipeDef } from './levelDefs';

/**
 * Rules v8 level elements of your lane's current stage, drawn in our candy style from the stage
 * def (`stageDef(...).obstacles / pads / pipes`): chunky stone blocks, wedges and pillars, glowing
 * speed pads with running chevrons, and bent pipes. Purely drawn; the crowds keep off the solid
 * ones in crowdSim.ts. Rebuilt only when the stage changes.
 */
export function Level({ feed }: { feed: MatchFeed }) {
  const [key, setKey] = useState<{ layout: number; stage: number } | null>(null);
  const last = useRef('');
  useFrame(() => {
    const lane = feed.me;
    const view = feed.cur;
    const k = lane && view ? `${view.layout}|${lane.stage}` : '';
    if (k === last.current) return;
    last.current = k;
    setKey(lane && view ? { layout: view.layout, stage: lane.stage } : null);
  });
  if (!key) return null;
  return <StageElements key={`${key.layout}|${key.stage}`} layout={key.layout} stage={key.stage} />;
}

function StageElements({ layout, stage }: { layout: number; stage: number }) {
  const obstacles = obstaclesOf(layout, stage);
  const pads = padsOf(layout, stage);
  const pipes = pipesOf(layout, stage);
  return (
    <group>
      {obstacles.map((o, i) => (
        <Obstacle key={i} o={o} />
      ))}
      {pads.map((p, i) => (
        <Pad key={i} p={p} />
      ))}
      {pipes.map((p, i) => (
        <Pipe key={i} p={p} />
      ))}
    </group>
  );
}

// ---- Obstacles ----------------------------------------------------------------------------------

/** A block is ~1.2 dudes tall; a pillar (a small block) a little taller. */
const BLOCK_H = 1.5;
const PILLAR_H = 1.95;
const PILLAR_MAX = 340; // sim: both sides at most this → a pillar
const BEVEL = 0.16;
/** Cream tops (like the divider walls) over soft lilac stone sides: cool against the apricot lane. */
const STONE_TOP = '#fffaf2';
const STONE_SIDE = '#c6b5ee';

let stoneMats: Material[] | null = null;
function stone(): Material[] {
  stoneMats ??= [
    new MeshStandardMaterial({ color: STONE_TOP, roughness: 0.42, metalness: 0 }),
    new MeshStandardMaterial({ color: STONE_SIDE, roughness: 0.5, metalness: 0 }),
  ];
  return stoneMats;
}

/** Shape-plane coords for a sim point: after rotateX(−π/2), (sx, sy) lands on world (sx, −sy). */
const shX = (x: number) => wx(x);
const shY = (y: number) => y * S - HALF_L;

function obstacleGeometry(o: ObstacleDef): { geo: BufferGeometry; h: number } {
  const w = o.x1 - o.x0;
  const d = o.y1 - o.y0;
  const pillar = o.shape === 'rect' && w <= PILLAR_MAX && d <= PILLAR_MAX;
  const h = pillar ? PILLAR_H : BLOCK_H;
  const shape = new Shape();
  if (o.shape === 'rect') {
    // A rounded rectangle, inset by the bevel so the bevelled block keeps the sim's footprint.
    const x0 = shX(o.x0) + BEVEL;
    const x1 = shX(o.x1) - BEVEL;
    const y0 = shY(o.y0) + BEVEL;
    const y1 = shY(o.y1) - BEVEL;
    const r = Math.max(0.02, Math.min((x1 - x0) / 2, (y1 - y0) / 2, pillar ? 0.6 : 0.32) * (pillar ? 0.9 : 1));
    shape.moveTo(x0 + r, y0);
    shape.lineTo(x1 - r, y0);
    shape.quadraticCurveTo(x1, y0, x1, y0 + r);
    shape.lineTo(x1, y1 - r);
    shape.quadraticCurveTo(x1, y1, x1 - r, y1);
    shape.lineTo(x0 + r, y1);
    shape.quadraticCurveTo(x0, y1, x0, y1 - r);
    shape.lineTo(x0, y0 + r);
    shape.quadraticCurveTo(x0, y0, x0 + r, y0);
  } else {
    // A triangular prism: the wedge, shrunk toward its centroid by the bevel.
    const cs = obstacleCorners(o).map(([x, y]) => [shX(x), shY(y)] as const);
    const cx = (cs[0]![0] + cs[1]![0] + cs[2]![0]) / 3;
    const cy = (cs[0]![1] + cs[1]![1] + cs[2]![1]) / 3;
    const k = 1 - (BEVEL * 2.2) / Math.max(0.5, Math.min(w, d) * S);
    cs.forEach(([x, y], i) => {
      const px = cx + (x - cx) * k;
      const py = cy + (y - cy) * k;
      if (i === 0) shape.moveTo(px, py);
      else shape.lineTo(px, py);
    });
    shape.closePath();
  }
  const geo = new ExtrudeGeometry(shape, {
    depth: h - 2 * BEVEL,
    bevelEnabled: true,
    bevelSize: BEVEL,
    bevelThickness: BEVEL,
    bevelSegments: 3,
    curveSegments: 6,
  });
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, BEVEL, 0);
  return { geo, h };
}

function Obstacle({ o }: { o: ObstacleDef }) {
  const { geo } = useMemo(() => obstacleGeometry(o), [o]);
  useEffect(() => () => geo.dispose(), [geo]);
  return <mesh geometry={geo} material={stone()} castShadow receiveShadow />;
}

// ---- Speed pads ---------------------------------------------------------------------------------

const padUniforms = { uTime: { value: 0 } };
const PAD_A = new Color('#ff6a1a');
const PAD_B = new Color('#ffa21f');
const PAD_C = new Color('#fff36a');

function Pad({ p }: { p: PadDef }) {
  const w = (p.x1 - p.x0) * S;
  const h = (p.y1 - p.y0) * S;
  const mat = useMemo(
    () =>
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: {
          uTime: padUniforms.uTime,
          uSize: { value: [w, h] },
          uA: { value: PAD_A },
          uB: { value: PAD_B },
          uC: { value: PAD_C },
        },
        vertexShader: /* glsl */ `varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: /* glsl */ `uniform float uTime; uniform vec2 uSize; uniform vec3 uA; uniform vec3 uB; uniform vec3 uC;
          varying vec2 vUv;
          float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
          void main() {
            vec2 p = (vUv - 0.5) * uSize;
            float e = box(p, uSize * 0.5, 0.3);
            // Chevrons pointing up the lane, running forward.
            float v = p.y - abs(p.x) * 0.75 - uTime * 3.0;
            float ch = fract(v / 0.9);
            float stripe = smoothstep(0.0, 0.07, ch) * (1.0 - smoothstep(0.36, 0.43, ch));
            stripe *= 1.0 - smoothstep(-0.45, -0.3, e);
            vec3 col = mix(uA, uB, vUv.y);
            col = mix(col, uC, stripe);
            col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(-0.2, -0.1, e));
            float alpha = 1.0 - smoothstep(-0.02, 0.02, e);
            gl_FragColor = vec4(col * 1.08, alpha);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    [w, h],
  );
  const geo = useMemo(() => new PlaneGeometry(w, h).rotateX(-Math.PI / 2), [w, h]);
  useEffect(
    () => () => {
      mat.dispose();
      geo.dispose();
    },
    [mat, geo],
  );
  useFrame(({ clock }) => {
    padUniforms.uTime.value = clock.elapsedTime;
  });
  return (
    <mesh
      geometry={geo}
      material={mat}
      position={[wx((p.x0 + p.x1) / 2), 0.03, wz((p.y0 + p.y1) / 2)]}
      renderOrder={2}
      userData={{ noShadow: true }}
    />
  );
}

// ---- Pipes --------------------------------------------------------------------------------------

const PIPE_BODY = '#12bfa6';
const PIPE_RIM = '#9cf7e6';
const PIPE_MOUTH = '#0b2b2b';

let pipeMats: { body: MeshStandardMaterial; rim: MeshStandardMaterial; mouth: MeshBasicMaterial } | null = null;
function pipeMaterials() {
  pipeMats ??= {
    body: new MeshStandardMaterial({ color: PIPE_BODY, roughness: 0.28, metalness: 0, side: DoubleSide }),
    rim: new MeshStandardMaterial({ color: PIPE_RIM, roughness: 0.25, metalness: 0 }),
    mouth: new MeshBasicMaterial({ color: PIPE_MOUTH }),
  };
  return pipeMats;
}

/**
 * A chunky bent pipe: its entrance mouth faces down the lane at the entrance box (dudes run
 * straight in), it humps low along the lane and comes down behind the exit, whose mouth faces up
 * the lane.
 */
function Pipe({ p }: { p: PipeDef }) {
  const mats = pipeMaterials();
  const parts = useMemo(() => {
    const boxW = (p.x1 - p.x0) * S;
    const boxD = (p.y1 - p.y0) * S;
    const R = Math.max(0.7, Math.min(1.25, Math.min(boxW, boxD) / 2));
    const ex = wx((p.x0 + p.x1) / 2);
    const ez = wz((p.y0 + p.y1) / 2);
    const ox = wx(p.outX);
    const oz = wz(p.outY);
    // A low, flat hump lying along the lane (a tall arch reads as an upright tube from the camera).
    const H = R + 0.75;
    const dir = oz <= ez ? -1 : 1; // which way along the lane the exit lies
    const run = Math.max(1.2, Math.min(2.2, Math.abs(oz - ez) / 4));
    const curve = new CatmullRomCurve3(
      [
        new Vector3(ex, R, ez),
        new Vector3(ex, R, ez + dir * run * 0.6),
        new Vector3(ex, H * 0.8, ez + dir * run * 1.4),
        new Vector3(ex + (ox - ex) * 0.25, H, ez + dir * run * 1.9 + (oz - ez - dir * run * 3.8) * 0.25),
        new Vector3(ex + (ox - ex) * 0.75, H, ez + dir * run * 1.9 + (oz - ez - dir * run * 3.8) * 0.75),
        new Vector3(ox, H * 0.8, oz - dir * run * 1.4),
        new Vector3(ox, R, oz - dir * run * 0.6),
        new Vector3(ox, R, oz),
      ],
      false,
      'centripetal',
    );
    const tube = new TubeGeometry(curve, 96, R * 0.92, 20, false);
    const rim = new TorusGeometry(R * 0.98, R * 0.2, 12, 28);
    const mouth = new CircleGeometry(R * 0.86, 24);
    return { tube, rim, mouth, R, ex, ez, ox, oz, dir };
  }, [p]);
  useEffect(
    () => () => {
      parts.tube.dispose();
      parts.rim.dispose();
      parts.mouth.dispose();
    },
    [parts],
  );
  const { R, ex, ez, ox, oz, dir } = parts;
  // The entrance faces away from the exit (toward the oncoming crowd); the exit faces onward.
  const inFace = dir < 0 ? 0 : Math.PI;
  const outFace = dir < 0 ? Math.PI : 0;
  return (
    <group>
      <mesh geometry={parts.tube} material={mats.body} castShadow receiveShadow />
      {[
        { x: ex, z: ez, face: inFace },
        { x: ox, z: oz, face: outFace },
      ].map((m, i) => (
        <group key={i} position={[m.x, R, m.z]} rotation-y={m.face}>
          <mesh geometry={parts.rim} material={mats.rim} castShadow />
          <mesh geometry={parts.mouth} material={mats.mouth} position-z={-0.12} userData={{ noShadow: true }} />
        </group>
      ))}
    </group>
  );
}
