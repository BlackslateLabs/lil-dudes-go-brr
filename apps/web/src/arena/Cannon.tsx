import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
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

function CannonModel({ feed }: { feed: MatchFeed }) {
  const ref = useRef<Group>(null!);
  const barrel = useRef<Group>(null!);
  const kick = useRef(0);
  const towers = usePack('towers');
  const blaster = usePack('blaster');
  const baseMat = useTintedMaterial(towers, 'cannon-base', BASE_TINT);
  const launcherMat = useTintedMaterial(blaster, 'cannon-launcher', LAUNCHER_TINT, 0.45);
  const baseGeo = useMemo(() => mergeParts(towers, [{ piece: 'tower-bottom', x: 0, y: 0, z: 0, s: [1, 1.05, 1] }], BASE_SCALE), [towers]);

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
    const k = kick.current;
    // Recoil: slide back along the barrel and squash a little, like a toy.
    barrel.current.position.z = k * 0.45;
    barrel.current.scale.set(1 + k * 0.06, 1 + k * 0.06, 1 - k * 0.1);
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
    </group>
  );
}
