import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Group, Sprite, Vector3 } from 'three';
import { CLASH_END_Y, CLASH_START_Y, type Side } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { Crowds } from './Crowds';
import { Fx } from './Fx';
import { Gates } from './Gates';
import { labelTexture } from './labelTexture';
import { CAM_FOV, CAM_POS, CAM_TARGET, HALF_L, HALF_W, LANE_L, LANE_W, PALETTE, SY, shortNum, wx, wz } from './layout';

interface ArenaProps {
  feed: MatchFeed;
  /** Gate taps (rig / peek). Off for the Home background. */
  interactive?: boolean;
}

const camBase = new Vector3(...CAM_POS);

/** The 3D arena. It only draws what the MatchSource says; it never decides outcomes. */
export function Arena({ feed, interactive = false }: ArenaProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ position: [...CAM_POS], fov: CAM_FOV, near: 1, far: 400 }}
      onCreated={({ camera }) => camera.lookAt(...CAM_TARGET)}
      gl={{ antialias: true }}
    >
      <color attach="background" args={[PALETTE.sky]} />
      <fog attach="fog" args={[PALETTE.sky, 110, 220]} />
      <hemisphereLight args={['#ffffff', '#6aa35c', 1.9]} />
      <directionalLight position={[10, 30, 16]} intensity={1.3} />

      <Predictor feed={feed} />
      <Ground />
      <Gates feed={feed} side={0} interactive={interactive} />
      <Gates feed={feed} side={1} interactive={interactive} />
      <Cannon feed={feed} side={0} />
      <Cannon feed={feed} side={1} />
      <Crowds feed={feed} />
      <Fx feed={feed} camBase={camBase} />
    </Canvas>
  );
}

/** Moves your predicted cannon every frame, before anything renders. */
function Predictor({ feed }: { feed: MatchFeed }) {
  useFrame((_, dt) => feed.predict(Math.min(dt, 0.1)), -1);
  return null;
}

function Ground() {
  // The clash zone is measured from either cannon; draw it from side 0's frame.
  const z0 = HALF_L - CLASH_START_Y * SY;
  const z1 = HALF_L - CLASH_END_Y * SY;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position-y={-0.05}>
        <planeGeometry args={[220, 260]} />
        <meshLambertMaterial color={PALETTE.grass} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[LANE_W, LANE_L + 4]} />
        <meshLambertMaterial color={PALETTE.lane} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (HALF_W + 0.3), 0.35, 0]}>
          <boxGeometry args={[0.6, 0.7, LANE_L + 4]} />
          <meshLambertMaterial color={PALETTE.laneEdge} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, (z0 + z1) / 2]}>
        <planeGeometry args={[LANE_W, Math.abs(z0 - z1)]} />
        <meshBasicMaterial color={PALETTE.clash} transparent opacity={0.28} />
      </mesh>
    </group>
  );
}

function Cannon({ feed, side }: { feed: MatchFeed; side: Side }) {
  const ref = useRef<Group>(null!);
  const barrel = useRef<Group>(null!);
  const hpLabel = useRef<Sprite>(null!);
  const shownHp = useRef<number | null>(null);
  const mine = side === feed.mySide;
  const facing = mine ? 1 : -1;
  const color = mine ? PALETTE.me : PALETTE.them;
  const kick = useRef(0);

  useEffect(
    () =>
      feed.onEvent((e) => {
        if (e.type === 'volley' && e.side === side) kick.current = 1;
      }),
    [feed, side],
  );

  useFrame((_, dt) => {
    const { prev, cur } = feed;
    if (!cur || !prev) return;
    const a = feed.alpha();
    const x = mine ? feed.myCannon : prev.sides[side].cannonX + (cur.sides[side].cannonX - prev.sides[side].cannonX) * a;
    ref.current.position.x = wx(x, feed.mySide);
    // Recoil on each volley (cosmetic).
    kick.current = Math.max(0, kick.current - dt * 6);
    barrel.current.position.z = facing * kick.current * 0.35;
    // HP label ticks smoothly toward the real value (no per-hit numbers).
    const hp = cur.sides[side].hp;
    shownHp.current = shownHp.current === null ? hp : shownHp.current + (hp - shownHp.current) * Math.min(1, dt * 8);
    const mat = hpLabel.current.material;
    const tex = labelTexture(shortNum(shownHp.current), { color: '#ffffff', outline: color, width: 256, height: 112 });
    if (mat.map !== tex) {
      mat.map = tex;
      mat.needsUpdate = true;
    }
  });

  return (
    <group ref={ref} position={[0, 0, wz(side, 0, feed.mySide) + facing * 1.2]}>
      <mesh position-y={0.9}>
        <boxGeometry args={[3.4, 1.8, 2.8]} />
        <meshLambertMaterial color={color} />
      </mesh>
      <group ref={barrel}>
        <mesh position={[0, 2.2, -facing * 0.9]} rotation-x={-facing * (Math.PI / 2 - 0.35)}>
          <cylinderGeometry args={[0.65, 0.85, 2.8, 18]} />
          <meshLambertMaterial color="#2b2b3a" />
        </mesh>
      </group>
      {/* Your HP label sits above your cannon; theirs sits in front of it, clear of the top bar. */}
      <sprite ref={hpLabel} position={mine ? [0, 4.6, 0] : [0, 3.2, 3.2]} scale={[5, 2.2, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}
