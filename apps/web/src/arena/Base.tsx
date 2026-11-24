import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CanvasTexture, Group, type Mesh, MeshStandardMaterial, SRGBColorSpace, Sprite } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { FINAL_STAGE, VAULT_Y, stageDef } from '@lil-dudes/client';
import { crateDepth, isLockCrate } from './crowdSim';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { HALF_L, LANE_W, PALETTE, SX, shortNum, wx, wz } from './layout';
import { mergeParts, preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';
import { HALL_DOOR, HALL_FRONT_Z, HALL_TOP, hallParts, wallParts } from './models/hall';
import { hallPulse, towerPulse } from './popQueue';

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
    // Each wave of dudes popping at the door (Fx.tsx) jolts it too.
    if (hallPulse[0]! > 0) {
      hit.current = Math.min(1, Math.max(hit.current, hallPulse[0]! * 0.7));
      hallPulse[0] = 0;
    }
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
  const shake = useRef(0);
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

  useFrame(({ clock }, dt) => {
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
    hpLabel.current.visible = true;
    if (t.hp < lastHp.current) flash.current = 1;
    lastHp.current = t.hp;
    // Each wave of dudes popping against it (Fx.tsx) flashes and shakes it.
    const pulse = towerPulse[index]!;
    if (pulse > 0) {
      flash.current = Math.max(flash.current, pulse);
      shake.current = Math.max(shake.current, pulse);
      towerPulse[index] = 0;
    }
    flash.current = Math.max(0, flash.current - dt * 6);
    shake.current = Math.max(0, shake.current - dt * 5);
    mat.emissiveIntensity = flash.current * 0.5;
    // A little squash on each hit, and a rattle while a crowd pops against it.
    const f = flash.current;
    const sh = shake.current;
    body.current.scale.set(1 + f * 0.04, 1 - f * 0.05, 1 + f * 0.04);
    body.current.position.x = Math.sin(clock.elapsedTime * 57) * sh * 0.16;
    body.current.position.z = Math.cos(clock.elapsedTime * 43) * sh * 0.08;
    body.current.rotation.z = Math.sin(clock.elapsedTime * 37) * sh * 0.02;
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

/** A stand-alone crate is a chunky block about 1.1 dudes tall. */
const BLOCK_H = 1.4;
const CRATE_RED = '#c8552c';
const CRATE_DARK = '#7a2e16';
const CRATE_LIGHT = '#f08a4b';

/** Wood-block faces drawn in code: a light frame, planks and an X brace, plus `crack` (0–2) cracks. */
const woodTex: CanvasTexture[] = [];
function woodTexture(crack: number): CanvasTexture {
  if (woodTex[crack]) return woodTex[crack]!;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = CRATE_RED;
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = CRATE_DARK;
  g.lineWidth = 3;
  for (const y of [44, 84]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(128, y);
    g.stroke();
  }
  g.lineCap = 'round';
  g.strokeStyle = CRATE_LIGHT;
  g.lineWidth = 14;
  g.beginPath();
  g.moveTo(16, 16);
  g.lineTo(112, 112);
  g.stroke();
  g.strokeStyle = CRATE_LIGHT;
  g.lineWidth = 16;
  g.strokeRect(8, 8, 112, 112);
  g.strokeStyle = CRATE_DARK;
  g.lineWidth = 2.5;
  g.strokeRect(1.5, 1.5, 125, 125);
  g.strokeRect(16.5, 16.5, 95, 95);
  if (crack > 0) {
    g.strokeStyle = '#3a130a';
    g.lineWidth = 3;
    g.lineJoin = 'round';
    const paths =
      crack === 1
        ? [[[64, 6], [58, 30], [70, 46], [62, 64]]]
        : [
            [[64, 6], [58, 30], [70, 46], [62, 64], [74, 86], [66, 110]],
            [[6, 70], [30, 64], [44, 74], [62, 64]],
            [[122, 40], [98, 52], [90, 70], [74, 86]],
          ];
    for (const path of paths) {
      g.beginPath();
      path.forEach(([x, y], i) => (i ? g.lineTo(x!, y!) : g.moveTo(x!, y!)));
      g.stroke();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  woodTex[crack] = t;
  return t;
}

const blockGeo = new Map<string, RoundedBoxGeometry>();
function blockGeometry(w: number, d: number): RoundedBoxGeometry {
  const key = `${w.toFixed(2)}|${d.toFixed(2)}`;
  let g = blockGeo.get(key);
  if (!g) {
    g = new RoundedBoxGeometry(w, BLOCK_H, d, 3, 0.16);
    g.translate(0, BLOCK_H / 2, 0);
    blockGeo.set(key, g);
  }
  return g;
}

/**
 * A crate: one locking a big gate is a wide plank of boxes (the blaster-kit crate); a stand-alone
 * one (rules v8) is a chunky red wood block with a big HP number on top. Both jolt and flash when
 * hit, and a block cracks as it loses HP (Fx.tsx puffs and smashes it).
 */
function Crate({ feed, index }: { feed: MatchFeed; index: number }) {
  const root = useRef<Group>(null!);
  const box = useRef<Group>(null!);
  const block = useRef<Mesh>(null!);
  const label = useRef<Sprite>(null!);
  const lastHp = useRef(-1);
  const flash = useRef(0);
  const pack = usePack(CRATE_MODEL[0]);
  const mat = useMemo(() => {
    const m = pack.material.clone();
    m.roughness = 0.55;
    m.emissive.set('#ffffff');
    m.emissiveIntensity = 0;
    return m;
  }, [pack]);
  const blockMat = useMemo(
    () => new MeshStandardMaterial({ map: woodTexture(0), roughness: 0.6, metalness: 0, emissive: '#ffffff', emissiveIntensity: 0 }),
    [],
  );

  useFrame(({ clock }, dt) => {
    const lane = feed.me;
    const view = feed.cur;
    const c = lane?.crates[index];
    root.current.visible = !!c && c.hp > 0;
    if (!c || c.hp <= 0 || !lane || !view) {
      lastHp.current = -1;
      return;
    }
    root.current.position.set(wx(c.x), 0, wz(c.y));
    const lock = isLockCrate(stageDef(view.layout, lane.stage), c.x, c.y);
    if (lastHp.current >= 0 && c.hp < lastHp.current) flash.current = 1;
    lastHp.current = c.hp;
    flash.current = Math.max(0, flash.current - dt * 5);
    const f = flash.current;
    const jolt = Math.sin(clock.elapsedTime * 60) * f * 0.12;
    box.current.visible = lock;
    block.current.visible = !lock;
    if (lock) {
      // Same width as the sim's crate: c.width sim units across the lane.
      box.current.scale.set(((c.width * SX) / CRATE_LEN) * (1 + f * 0.04), 1 - f * 0.06, 1);
      box.current.position.x = jolt;
      mat.emissiveIntensity = f * 0.45;
    } else {
      const w = c.width * SX;
      const d = crateDepth(c.width, false) * SX;
      const geo = blockGeometry(w, d);
      if (block.current.geometry !== geo) block.current.geometry = geo;
      block.current.scale.set(1 + f * 0.06, 1 - f * 0.1, 1 + f * 0.06);
      block.current.position.x = jolt;
      const lost = 1 - c.hp / Math.max(1, c.maxHp);
      const tex = woodTexture(lost > 0.6 ? 2 : lost > 0.25 ? 1 : 0);
      if (blockMat.map !== tex) {
        blockMat.map = tex;
        blockMat.needsUpdate = true;
      }
      blockMat.emissiveIntensity = f * 0.5;
    }
    const tex = labelTexture(String(c.hp), { color: '#ffffff', outline: CRATE_DARK, width: 192, height: 112 });
    if (label.current.material.map !== tex) {
      label.current.material.map = tex;
      label.current.material.needsUpdate = true;
    }
    const pop = 1 + f * 0.3;
    if (lock) {
      label.current.position.set(0, 2.6, 0.8);
      label.current.scale.set(2.6 * pop, 1.5 * pop, 1);
    } else {
      label.current.position.set(0, BLOCK_H + 1.0, 0.3);
      label.current.scale.set(3.4 * pop, 2 * pop, 1);
    }
  });

  return (
    <group ref={root} visible={false}>
      <group ref={box}>
        {/* Turned a quarter so the long side lies across the lane; ~1.6 deep and ~1.7 tall. */}
        <mesh geometry={pack.geo[CRATE_MODEL[1]]!} material={mat} rotation-y={Math.PI / 2} scale={[2.9, 4.6, 1]} />
      </group>
      <mesh ref={block} material={blockMat} visible={false} castShadow receiveShadow />
      <sprite ref={label} position={[0, 2.6, 0.8]} scale={[2.6, 1.5, 1]} renderOrder={15}>
        <spriteMaterial transparent depthTest={false} />
      </sprite>
    </group>
  );
}
