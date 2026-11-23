import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group, MeshStandardMaterial, Sprite } from 'three';
import { FINAL_STAGE, VAULT_Y } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { HALF_L, LANE_W, PALETTE, SX, shortNum, wx, wz } from './layout';
import { mergeParts, preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';
import { HALL_DOOR, HALL_FRONT_Z, HALL_TOP, hallParts, wallParts } from './models/hall';

const MAX_TOWERS = 4;
const MAX_CRATES = 6;

/**
 * The crate model: one constant, so swapping to another crate (e.g. a KayKit Block Bits crate once
 * it's in `public/assets/models/`) is a one-line change. `[pack, piece]`; the piece's long side
 * runs along Z (it is turned to lie across the lane) and it is ~1.2 long, 0.55 deep, 0.37 tall.
 */
const CRATE_MODEL = ['blaster', 'crate'] as const;
const CRATE_LEN = 1.2;

/** Fantasy Town Kit: roof + banner swatches → enemy red, stone swatches → warm cream. */
const HALL_TINT: readonly TintRule[] = [
  { cells: [[0, 3], [1, 3]], ref: [1, 3], color: PALETTE.enemy },
  { cells: [[2, 2], [3, 2]], ref: [3, 2], color: PALETTE.hall },
];
/** Tower Defense Kit: the red trim/roof swatches → enemy red (the stone stays). */
const TOWER_TINT: readonly TintRule[] = [{ cells: [[14, 2], [15, 2]], ref: [15, 2], color: PALETTE.enemy }];

/** Town-kit tile size in world units: the hall is 5 tiles ≈ 61% of the lane width. */
const TILE = 2.2;
/** Tower Defense pieces are 1 unit across; scaled to the old tower's ~3.4 footprint. */
const TOWER_SCALE = 3.4;
const TOWER_SINK = 0.7; // s to collapse when its hp hits 0

preloadPacks('hall', 'towers', 'blaster');

/** The enemy base at the far end: a wall across the lane, its towers, and on the last stage the town hall. */
export function Base({ feed }: { feed: MatchFeed }) {
  return (
    <Suspense fallback={null}>
      <group>
        <BaseWall />
        <TownHall feed={feed} />
        {Array.from({ length: MAX_TOWERS }, (_, i) => (
          <Tower key={i} feed={feed} index={i} />
        ))}
        {Array.from({ length: MAX_CRATES }, (_, i) => (
          <Crate key={i} feed={feed} index={i} />
        ))}
      </group>
    </Suspense>
  );
}

/** Stone wall across the far end of the lane. */
function BaseWall() {
  const pack = usePack('hall');
  const mat = useTintedMaterial(pack, 'hall', HALL_TINT);
  const blocks = Math.ceil((LANE_W + 2) / TILE);
  const geo = useMemo(() => mergeParts(pack, wallParts(blocks), TILE), [pack, blocks]);
  return <mesh geometry={geo} material={mat} position={[0, 0, -HALF_L - 1.2]} scale={[1, 1.25, 0.9]} />;
}

/** Town hall front face sits on the loot line: a dude reaching VAULT_Y is inside it. */
const HALL_FRONT = wz(VAULT_Y) - 0.4;

/**
 * The town hall: behind the towers on the last stage, the target of the finale (SPEC v4 §3). Once
 * the towers fall the whole mob pours into it; every loot event shakes it and the gold above it
 * counts up.
 */
function TownHall({ feed }: { feed: MatchFeed }) {
  const root = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const label = useRef<Sprite>(null!);
  const hit = useRef(0);
  const shown = useRef(0);
  const pack = usePack('hall');
  const mat = useTintedMaterial(pack, 'hall', HALL_TINT);
  const geo = useMemo(() => mergeParts(pack, hallParts(), TILE), [pack]);
  const doorMat = useMemo(
    () => new MeshStandardMaterial({ color: PALETTE.gold, emissive: PALETTE.gold, emissiveIntensity: 0.15, roughness: 0.4 }),
    [],
  );

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
    const raid = lane.phase === 'rush' || lane.phase === 'done';
    hit.current = Math.max(0, hit.current - dt * 4);
    const h = hit.current;
    const wob = Math.sin(clock.elapsedTime * 40) * h;
    body.current.position.x = wob * 0.25;
    body.current.scale.set(1 + h * 0.04, 1 - h * 0.05, 1 + h * 0.04);
    doorMat.emissiveIntensity = raid ? 1.6 + 0.8 * Math.sin(clock.elapsedTime * 6) + 2 * h : 0.2;
    label.current.visible = raid && lane.rushGold > 0;
    if (label.current.visible) {
      shown.current += (lane.rushGold - shown.current) * Math.min(1, dt * 10);
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
    <group ref={root} visible={false} position={[0, 0, HALL_FRONT - HALL_FRONT_Z * TILE]}>
      <group ref={body}>
        <mesh geometry={geo} material={mat} />
        {/* The vault: a gold glow filling the arched doorway, pulsing during the raid. */}
        <mesh material={doorMat} position={[0, HALL_DOOR.y * TILE, HALL_DOOR.z * TILE]}>
          <planeGeometry args={[HALL_DOOR.w * TILE, HALL_DOOR.h * TILE]} />
        </mesh>
      </group>
      <sprite ref={label} position={[0, (HALL_TOP + 0.9) * TILE, HALL_FRONT_Z * TILE]} scale={[6.4, 2.56, 1]} renderOrder={16} visible={false}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}

function Tower({ feed, index }: { feed: MatchFeed; index: number }) {
  const root = useRef<Group>(null!);
  const body = useRef<Group>(null!);
  const hpLabel = useRef<Sprite>(null!);
  const shown = useRef<number | null>(null);
  const flash = useRef(0);
  const lastHp = useRef(0);
  const down = useRef(0); // 0 standing … 1 fully sunk
  const pack = usePack('towers');
  const shared = useTintedMaterial(pack, 'tower', TOWER_TINT);
  // Own material per tower so its hit flash doesn't light the others.
  const mat = useMemo(() => {
    const m = shared.clone();
    m.emissive.set('#ffffff');
    m.emissiveIntensity = 0;
    return m;
  }, [shared]);
  const geo = useMemo(
    () =>
      mergeParts(
        pack,
        [
          { piece: 'tower-bottom', x: 0, y: 0, z: 0 },
          { piece: 'tower-roof', x: 0, y: 0.6, z: 0 },
        ],
        TOWER_SCALE,
      ),
    [pack],
  );

  useFrame((_, dt) => {
    const t = feed.me?.towers[index];
    if (!t) {
      root.current.visible = false;
      shown.current = null;
      down.current = 0;
      return;
    }
    root.current.position.set(wx(t.x), 0, wz(t.y));
    if (t.hp <= 0) {
      // Knocked down: a quick tilt-and-sink into the ground, then gone.
      if (lastHp.current > 0 || down.current > 0) down.current = Math.min(1, down.current + dt / TOWER_SINK);
      else down.current = 1; // already down when we first saw it
      lastHp.current = 0;
      const d = down.current;
      root.current.visible = d < 1;
      body.current.position.y = -d * d * 7;
      body.current.rotation.z = d * 0.35 * (index % 2 ? 1 : -1);
      hpLabel.current.visible = false;
      shown.current = null;
      return;
    }
    root.current.visible = true;
    down.current = 0;
    body.current.position.y = 0;
    body.current.rotation.z = 0;
    hpLabel.current.visible = true;
    if (t.hp < lastHp.current) flash.current = 1;
    lastHp.current = t.hp;
    flash.current = Math.max(0, flash.current - dt * 6);
    mat.emissiveIntensity = flash.current * 0.5;
    // A little squash on each hit.
    const f = flash.current;
    body.current.scale.set(1 + f * 0.04, 1 - f * 0.05, 1 + f * 0.04);
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
      <group ref={body}>
        <mesh geometry={geo} material={mat} />
      </group>
      <sprite ref={hpLabel} position={[0, 3, 2.2]} scale={[4.6, 2, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}

function Crate({ feed, index }: { feed: MatchFeed; index: number }) {
  const root = useRef<Group>(null!);
  const box = useRef<Group>(null!);
  const label = useRef<Sprite>(null!);
  const pack = usePack(CRATE_MODEL[0]);
  const mat = useMemo(() => {
    const m = pack.material.clone();
    m.roughness = 0.55;
    return m;
  }, [pack]);

  useFrame(() => {
    const c = feed.me?.crates[index];
    root.current.visible = !!c && c.hp > 0;
    if (!c || c.hp <= 0) return;
    root.current.position.set(wx(c.x), 0, wz(c.y));
    // Same width as the sim's crate: c.width sim units across the lane.
    box.current.scale.set((c.width * SX) / CRATE_LEN, 1, 1);
    const tex = labelTexture(String(c.hp), { color: '#ffffff', outline: PALETTE.crate, width: 192, height: 112 });
    if (label.current.material.map !== tex) {
      label.current.material.map = tex;
      label.current.material.needsUpdate = true;
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={box}>
        {/* Turned a quarter so the long side lies across the lane; ~1.6 deep and ~1.7 tall. */}
        <mesh geometry={pack.geo[CRATE_MODEL[1]]!} material={mat} rotation-y={Math.PI / 2} scale={[2.9, 4.6, 1]} />
      </group>
      <sprite ref={label} position={[0, 2.6, 0.8]} scale={[2.6, 1.5, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}
