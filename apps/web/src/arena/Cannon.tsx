import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import type { MatchFeed } from '../match/feed';
import { PALETTE, wx, wz } from './layout';
import { mergeParts, preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';

/** Base: a Tower Defense round tower bottom, its red trim swatch repainted team blue. */
const BASE_TINT: readonly TintRule[] = [{ cells: [[15, 2], [14, 2]], ref: [15, 2], color: PALETTE.me }];
/** Launcher: Blaster Kit `blaster-b`, its orange shell swatch repainted team blue. */
const LAUNCHER_TINT: readonly TintRule[] = [{ cells: [[11, 2], [10, 2]], ref: [11, 2], color: PALETTE.me }];

const BASE_SCALE = 3.2; // 1-unit piece → 3.2 wide, ~1.9 tall
const LAUNCHER_SCALE = 11; // blaster-b is ~0.42 long → ~4.6
const LAUNCHER_PITCH = 0.32; // muzzle tilted up the lane

preloadPacks('towers', 'blaster');

/** Your cannon on the cannon line: follows the predicted aim, kicks back on every volley. */
export function Cannon({ feed }: { feed: MatchFeed }) {
  return (
    <Suspense fallback={null}>
      <CannonModel feed={feed} />
    </Suspense>
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
    <group ref={ref} position={[0, 0, wz(0) + 1.2]}>
      <mesh geometry={baseGeo} material={baseMat} />
      <group ref={barrel} position-y={BASE_SCALE * 0.6 + 0.75}>
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
