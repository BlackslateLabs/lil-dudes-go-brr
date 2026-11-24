import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, CylinderGeometry, Group, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SphereGeometry } from 'three';
import type { MatchFeed } from '../match/feed';
import { S, wx, wz } from './layout';
import { WALL_HALF, wallsOf } from './columns';

/** Pool size: more than any stage's wall count. */
const MAX_WALLS = 8;
/** Drawn thicker than the sim's 2·WALL_HALF, so it reads from the high camera. */
const RADIUS = WALL_HALF * S * 1.6;
/** Stretched up to about 1.3 dudes tall (~1.5), so it reads as a wall, not a kerb. */
const SQUASH = 1.9;
const CREAM = '#fffaf2';

/**
 * Divider walls between the lane's columns (rules v7, `stageDef(...).walls`): chunky rounded candy
 * rails from y0 to y1, with a soft contact shadow. Only the current stage of your lane. Purely
 * drawn from the stage def; crowds are kept off them in Crowds.tsx.
 */
export function Walls({ feed }: { feed: MatchFeed }) {
  const parts = useMemo(
    () => ({
      body: new CylinderGeometry(RADIUS, RADIUS, 1, 18, 1, true).rotateX(Math.PI / 2),
      cap: new SphereGeometry(RADIUS, 18, 12),
      shade: new PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      mat: new MeshStandardMaterial({ color: CREAM, roughness: 0.38, metalness: 0 }),
      shadeMat: new MeshBasicMaterial({ map: softShade(), transparent: true, depthWrite: false }),
    }),
    [],
  );
  return (
    <group>
      {Array.from({ length: MAX_WALLS }, (_, i) => (
        <Wall key={i} feed={feed} index={i} parts={parts} />
      ))}
    </group>
  );
}

/** A soft warm contact shadow: dark in the middle, fading out to the sides and the ends. */
function softShade(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 64;
  const g = c.getContext('2d')!;
  const across = g.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, 'rgba(120,60,20,0)');
  across.addColorStop(0.5, 'rgba(120,60,20,0.5)');
  across.addColorStop(1, 'rgba(120,60,20,0)');
  g.fillStyle = across;
  g.fillRect(0, 4, 32, 56);
  return new CanvasTexture(c);
}

interface Parts {
  body: CylinderGeometry;
  cap: SphereGeometry;
  shade: PlaneGeometry;
  mat: MeshStandardMaterial;
  shadeMat: MeshBasicMaterial;
}

function Wall({ feed, index, parts }: { feed: MatchFeed; index: number; parts: Parts }) {
  const root = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const capA = useRef<Group>(null!);
  const capB = useRef<Group>(null!);
  const shade = useRef<Group>(null!);

  useFrame(() => {
    const lane = feed.me;
    const view = feed.cur;
    const w = lane && view ? wallsOf(view.layout, lane.stage)[index] : undefined;
    root.current.visible = !!w;
    if (!w) return;
    const len = Math.max(0, (w.y1 - w.y0) * S);
    const inner = Math.max(0, len - 2 * RADIUS);
    root.current.position.set(wx(w.x), 0, wz((w.y0 + w.y1) / 2));
    body.current.scale.set(1, 1, Math.max(0.001, inner));
    capA.current.position.z = inner / 2;
    capB.current.position.z = -inner / 2;
    shade.current.scale.set(RADIUS * 3.4, 1, len + RADIUS * 1.6);
  });

  return (
    <group ref={root} visible={false}>
      <group ref={shade} position-y={0.015}>
        <mesh geometry={parts.shade} material={parts.shadeMat} userData={{ noShadow: true }} />
      </group>
      <group position-y={RADIUS * SQUASH} scale-y={SQUASH}>
        <group ref={body}>
          <mesh geometry={parts.body} material={parts.mat} castShadow receiveShadow />
        </group>
        <group ref={capA}>
          <mesh geometry={parts.cap} material={parts.mat} castShadow receiveShadow />
        </group>
        <group ref={capB}>
          <mesh geometry={parts.cap} material={parts.mat} castShadow receiveShadow />
        </group>
      </group>
    </group>
  );
}
