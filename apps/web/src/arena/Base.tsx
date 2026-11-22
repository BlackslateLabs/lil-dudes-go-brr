import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, MeshLambertMaterial, Sprite } from 'three';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { HALF_L, LANE_W, PALETTE, SX, shortNum, wx, wz } from './layout';

const MAX_TOWERS = 4;
const MAX_CRATES = 6;

/** The enemy base at the far end: a wall across the lane, its towers, and (in the raid) the open vault. */
export function Base({ feed }: { feed: MatchFeed }) {
  const vault = useRef<Mesh>(null!);
  useFrame(({ clock }) => {
    const raid = feed.me?.phase === 'raid' || (feed.me?.stage === 2 && feed.me?.phase === 'plant');
    vault.current.visible = !!raid;
    if (raid) {
      const m = vault.current.material as MeshLambertMaterial;
      m.emissiveIntensity = 0.5 + 0.4 * Math.sin(clock.elapsedTime * 6);
    }
  });
  return (
    <group>
      {/* Wall across the far end of the lane. */}
      <mesh position={[0, 1.6, -HALF_L - 1.2]}>
        <boxGeometry args={[LANE_W + 2, 3.2, 2]} />
        <meshLambertMaterial color={PALETTE.base} />
      </mesh>
      <mesh position={[0, 3.3, -HALF_L - 1.2]}>
        <boxGeometry args={[LANE_W + 2.4, 0.4, 2.4]} />
        <meshLambertMaterial color={PALETTE.baseTrim} />
      </mesh>
      {/* The vault: glows open during the raid. */}
      <mesh ref={vault} position={[0, 1.4, -HALF_L - 0.1]} visible={false}>
        <boxGeometry args={[LANE_W * 0.8, 2.6, 0.4]} />
        <meshLambertMaterial color={PALETTE.gold} emissive={PALETTE.gold} emissiveIntensity={0.6} />
      </mesh>
      {Array.from({ length: MAX_TOWERS }, (_, i) => (
        <Tower key={i} feed={feed} index={i} />
      ))}
      {Array.from({ length: MAX_CRATES }, (_, i) => (
        <Crate key={i} feed={feed} index={i} />
      ))}
    </group>
  );
}

function Tower({ feed, index }: { feed: MatchFeed; index: number }) {
  const root = useRef<Group>(null!);
  const body = useRef<Mesh>(null!);
  const hpLabel = useRef<Sprite>(null!);
  const shown = useRef<number | null>(null);
  const flash = useRef(0);
  const lastHp = useRef(0);

  useFrame((_, dt) => {
    const t = feed.me?.towers[index];
    root.current.visible = !!t && t.hp > 0;
    if (!t || t.hp <= 0) {
      shown.current = null;
      return;
    }
    root.current.position.set(wx(t.x), 0, wz(t.y));
    if (t.hp < lastHp.current) flash.current = 1;
    lastHp.current = t.hp;
    flash.current = Math.max(0, flash.current - dt * 6);
    const m = body.current.material as MeshLambertMaterial;
    m.emissiveIntensity = flash.current;
    // HP label ticks smoothly toward the real value (no per-hit numbers).
    shown.current = shown.current === null ? t.hp : shown.current + (t.hp - shown.current) * Math.min(1, dt * 8);
    const tex = labelTexture(shortNum(shown.current), { color: '#ffffff', outline: PALETTE.base, width: 256, height: 112 });
    if (hpLabel.current.material.map !== tex) {
      hpLabel.current.material.map = tex;
      hpLabel.current.material.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={body} position-y={2.2}>
        <cylinderGeometry args={[1.4, 1.8, 4.4, 10]} />
        <meshLambertMaterial color={PALETTE.tower} emissive="#ffffff" emissiveIntensity={0} />
      </mesh>
      <mesh position-y={4.8}>
        <coneGeometry args={[1.8, 1.6, 10]} />
        <meshLambertMaterial color={PALETTE.base} />
      </mesh>
      <sprite ref={hpLabel} position={[0, 3, 2.2]} scale={[4.6, 2, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}

function Crate({ feed, index }: { feed: MatchFeed; index: number }) {
  const root = useRef<Group>(null!);
  const box = useRef<Mesh>(null!);
  const label = useRef<Sprite>(null!);

  useFrame(() => {
    const c = feed.me?.crates[index];
    root.current.visible = !!c && c.hp > 0;
    if (!c || c.hp <= 0) return;
    root.current.position.set(wx(c.x), 0, wz(c.y));
    box.current.scale.set(c.width * SX, 1, 1);
    const tex = labelTexture(String(c.hp), { color: '#ffffff', outline: PALETTE.crate, width: 192, height: 112 });
    if (label.current.material.map !== tex) {
      label.current.material.map = tex;
      label.current.material.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <mesh ref={box} position-y={0.9}>
        <boxGeometry args={[1, 1.8, 1.6]} />
        <meshLambertMaterial color={PALETTE.crate} />
      </mesh>
      <sprite ref={label} position={[0, 2.6, 0.8]} scale={[2.6, 1.5, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}
