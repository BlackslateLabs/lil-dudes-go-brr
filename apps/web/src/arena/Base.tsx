import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, Mesh, MeshLambertMaterial, Sprite } from 'three';
import { FINAL_STAGE, VAULT_Y } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { HALF_L, LANE_W, PALETTE, SX, shortNum, wx, wz } from './layout';

const MAX_TOWERS = 4;
const MAX_CRATES = 6;

/** The enemy base at the far end: a wall across the lane, its towers, and on the last stage the town hall. */
export function Base({ feed }: { feed: MatchFeed }) {
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
      <TownHall feed={feed} />
      {Array.from({ length: MAX_TOWERS }, (_, i) => (
        <Tower key={i} feed={feed} index={i} />
      ))}
      {Array.from({ length: MAX_CRATES }, (_, i) => (
        <Crate key={i} feed={feed} index={i} />
      ))}
    </group>
  );
}

/** Town hall front face sits on the loot line: a dude reaching VAULT_Y is inside it. */
const HALL_FRONT = wz(VAULT_Y) - 0.4;
const HALL_W = LANE_W * 0.62;
const HALL_D = 3.6;

/**
 * The town hall: behind the towers on the last stage, the target of the finale (SPEC v4 §3). Once
 * the towers fall the whole mob pours into it; every loot event shakes it and the gold above it
 * counts up.
 */
function TownHall({ feed }: { feed: MatchFeed }) {
  const root = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const door = useRef<Mesh>(null!);
  const label = useRef<Sprite>(null!);
  const hit = useRef(0);
  const shown = useRef(0);

  useEffect(
    () =>
      feed.onEvent((e) => {
        if (e.type === 'loot' && e.side === feed.mySide) hit.current = Math.min(1, hit.current + 0.35);
      }),
    [feed],
  );

  useFrame(({ clock }, dt) => {
    const lane = feed.me;
    const last = !!lane && lane.stage === FINAL_STAGE && lane.phase !== 'transit';
    root.current.visible = last;
    if (!lane || !last) {
      shown.current = 0;
      return;
    }
    const raid = lane.phase === 'raid' || lane.phase === 'done';
    hit.current = Math.max(0, hit.current - dt * 4);
    const h = hit.current;
    const wob = Math.sin(clock.elapsedTime * 40) * h;
    body.current.position.x = wob * 0.25;
    body.current.scale.set(1 + h * 0.04, 1 - h * 0.05, 1 + h * 0.04);
    const dm = door.current.material as MeshLambertMaterial;
    dm.emissiveIntensity = raid ? 0.6 + 0.4 * Math.sin(clock.elapsedTime * 6) + h : 0.15;
    label.current.visible = raid && lane.raidGold > 0;
    if (label.current.visible) {
      shown.current += (lane.raidGold - shown.current) * Math.min(1, dt * 10);
      const tex = labelTexture(`+${Math.round(shown.current)}`, { color: '#ffffff', outline: PALETTE.goldDark, width: 320, height: 128 });
      if (label.current.material.map !== tex) {
        label.current.material.map = tex;
        label.current.material.needsUpdate = true;
      }
      const s = 1 + h * 0.25;
      label.current.scale.set(6.4 * s, 2.56 * s, 1);
    }
  });

  return (
    <group ref={root} visible={false} position={[0, 0, HALL_FRONT - HALL_D / 2]}>
      <group ref={body}>
        {/* Steps */}
        <mesh position={[0, 0.25, HALL_D / 2 + 0.3]}>
          <boxGeometry args={[HALL_W * 0.5, 0.5, 1]} />
          <meshLambertMaterial color={PALETTE.baseTrim} />
        </mesh>
        {/* Hall */}
        <mesh position-y={2.6}>
          <boxGeometry args={[HALL_W, 5.2, HALL_D]} />
          <meshLambertMaterial color={PALETTE.hall} />
        </mesh>
        {/* Columns */}
        {[-0.38, -0.13, 0.13, 0.38].map((f) => (
          <mesh key={f} position={[f * HALL_W, 2.4, HALL_D / 2 + 0.25]}>
            <cylinderGeometry args={[0.32, 0.38, 4.8, 10]} />
            <meshLambertMaterial color={PALETTE.baseTrim} />
          </mesh>
        ))}
        {/* Gable roof: two slabs meeting along the ridge. */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0, 6.15, s * HALL_D * 0.27]} rotation-x={s * 0.62}>
            <boxGeometry args={[HALL_W + 0.8, 0.35, HALL_D * 0.68]} />
            <meshLambertMaterial color={PALETTE.base} />
          </mesh>
        ))}
        {/* Door: the vault glow during the finale */}
        <mesh ref={door} position={[0, 1.7, HALL_D / 2 + 0.02]}>
          <planeGeometry args={[2.4, 3.2]} />
          <meshLambertMaterial color={PALETTE.gold} emissive={PALETTE.gold} emissiveIntensity={0.15} />
        </mesh>
        {/* Flag */}
        <mesh position={[0, 9.4, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 2.4, 6]} />
          <meshLambertMaterial color="#ffffff" />
        </mesh>
        <mesh position={[0.6, 10.2, 0]}>
          <boxGeometry args={[1.2, 0.7, 0.05]} />
          <meshLambertMaterial color={PALETTE.gold} />
        </mesh>
      </group>
      <sprite ref={label} position={[0, 11.5, 0]} scale={[6.4, 2.56, 1]} renderOrder={16} visible={false}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
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
