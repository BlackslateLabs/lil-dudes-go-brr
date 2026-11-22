import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import type { MatchFeed } from '../match/feed';
import { PALETTE, wx, wz } from './layout';

/** Your cannon on the cannon line: follows the predicted aim, kicks back on every volley. */
export function Cannon({ feed }: { feed: MatchFeed }) {
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
