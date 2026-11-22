import { useEffect, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import type { MatchFeed } from '../match/feed';
import { Base } from './Base';
import { Crowds } from './Crowds';
import { Fx } from './Fx';
import { Gates } from './Gates';
import { CAM_FOV, CAM_POS, CAM_TARGET, HALF_L, HALF_W, LANE_L, LANE_W, PALETTE, wx, wz } from './layout';

interface ArenaProps {
  feed: MatchFeed;
  /** Gate taps (peek). Off for the Home background. */
  interactive?: boolean;
}

const camBase = new Vector3(...CAM_POS);

/** Your lane in 3D. It only draws what the MatchSource says; it never decides outcomes. */
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
      <Base feed={feed} />
      <Gates feed={feed} interactive={interactive} />
      <Cannon feed={feed} />
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
      {/* Your cannon line: an enemy crossing it ends your run. */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.03, wz(0) - 0.6]}>
        <planeGeometry args={[LANE_W, 0.25]} />
        <meshBasicMaterial color={PALETTE.enemy} transparent opacity={0.6} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.02, -HALF_L + 0.6]}>
        <planeGeometry args={[LANE_W, 1.2]} />
        <meshBasicMaterial color={PALETTE.base} transparent opacity={0.25} />
      </mesh>
    </group>
  );
}

function Cannon({ feed }: { feed: MatchFeed }) {
  const ref = useRef<Group>(null!);
  const barrel = useRef<Group>(null!);
  const kick = useRef(0);

  useEffect(
    () =>
      feed.onEvent((e) => {
        if (e.type === 'volley' && e.side === feed.mySide) kick.current = 1;
      }),
    [feed],
  );

  useFrame((_, dt) => {
    ref.current.position.x = wx(feed.myCannon);
    kick.current = Math.max(0, kick.current - dt * 6);
    barrel.current.position.z = kick.current * 0.35;
  });

  return (
    <group ref={ref} position={[0, 0, wz(0) + 1.2]}>
      <mesh position-y={0.9}>
        <boxGeometry args={[3.4, 1.8, 2.8]} />
        <meshLambertMaterial color={PALETTE.me} />
      </mesh>
      <group ref={barrel}>
        <mesh position={[0, 2.2, -0.9]} rotation-x={-(Math.PI / 2 - 0.35)}>
          <cylinderGeometry args={[0.65, 0.85, 2.8, 18]} />
          <meshLambertMaterial color="#2b2b3a" />
        </mesh>
      </group>
    </group>
  );
}
