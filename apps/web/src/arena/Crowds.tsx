import { Suspense, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { CHAMP_COUNT, type CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { HALF_W, PALETTE, wx, wz } from './layout';
import { preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';

/** Instance cap per crowd (TECH §5: ~1,500 on a phone). */
const MAX_UNITS = 1500;
const SPACING = 0.32;
/** Widest a crowd is drawn either side of its centre: about the sim's gate grace (100 units). */
const MAX_HALF_SPREAD = 0.6;
/**
 * Model scale. The characters are ~0.8 tall with arms down (baked "idle" pose), so a dude is about
 * as tall as the old capsule and ~0.55 wide; the narrow-column spread above is unchanged.
 */
const UNIT_SCALE = 1.0;

/**
 * Team colours on the shared Mini Characters colormap (see models/assets.ts `tintedMap`):
 * our knight's armour + helmet swatches go team blue, the robot's metal goes team red and its
 * brass bits a dark trim, so from the high camera each crowd is one clear colour.
 */
const DUDE_TINT: readonly TintRule[] = [{ cells: [[5, 3], [3, 3]], ref: [5, 3], color: PALETTE.me }];
const TROOP_TINT: readonly TintRule[] = [
  { cells: [[5, 3], [3, 3]], ref: [5, 3], color: PALETTE.enemy },
  { cells: [[1, 3]], color: '#5a1f2a' },
];

/** Visible units for a cohort: 1:1 when small, then sub-linear so big crowds stay affordable. */
function unitsFor(count: number): number {
  if (count <= 0) return 0;
  return count <= 30 ? count : Math.round(30 + Math.sqrt(count - 30) * 4);
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scl = new Vector3(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
const bigScl = new Vector3();
/** A Champion giant is drawn ~2.8× a dude, an enemy giant ~2×. */
const CHAMP_SCALE = 2.8;
const GIANT_SCALE = 2.1;
/** Most giants drawn for one Champion cohort (a ×8 gate on a fresh Champion makes 8). */
const MAX_GIANTS = 16;
/** Spacing of a Champion's giants: two abreast across the lane, rows along it. */
const GIANT_DX = 0.75;
const GIANT_DZ = 1.25;

/**
 * How many giants a Champion cohort is: one per CHAMP_COUNT dudes, rounded up (SPEC_V5 §4: the
 * Champion multiplies through gates like any cohort, so a ×3 gate makes three giants).
 */
export function giantsFor(count: number): number {
  return count <= 0 ? 0 : Math.min(MAX_GIANTS, Math.ceil(count / CHAMP_COUNT));
}

preloadPacks('dudes');

/** Your dudes (blue) and the base's troops (red) in your lane. No number badge per crowd (SPEC v3 §7). */
export function Crowds({ feed }: { feed: MatchFeed }) {
  return (
    <Suspense fallback={null}>
      <Crowd feed={feed} enemy={false} />
      <Crowd feed={feed} enemy />
    </Suspense>
  );
}

function Crowd({ feed, enemy }: { feed: MatchFeed; enemy: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  const pack = usePack('dudes');
  const geo = pack.geo[enemy ? 'troop' : 'dude']!;
  const material = useTintedMaterial(pack, enemy ? 'troop' : 'dude', enemy ? TROOP_TINT : DUDE_TINT, 0.5);
  // Dudes run up the lane (−Z, backs to the camera); troops run down it, facing us.
  const yaw = enemy ? 0 : Math.PI;

  useFrame(({ clock }) => {
    const mesh = ref.current;
    const lane = feed.me;
    if (!lane) return;
    const a = feed.alpha();
    const list: CohortView[] = enemy ? lane.enemies : lane.cohorts;
    const prevById = enemy ? feed.prevEnemies : feed.prevCohorts;
    const time = clock.elapsedTime;
    let n = 0;
    for (const c of list) {
      if (c.count <= 0) continue;
      const p = prevById.get(c.id);
      const x = p ? p.x + (c.x - p.x) * a : c.x;
      const y = p ? p.y + (c.y - p.y) * a : c.y;
      const cx = wx(x);
      const cz = wz(y);
      // A Champion (mine) is giants, one per CHAMP_COUNT dudes; an enemy giant is one big
      // troop. Never a cluster of small ones (SPEC_V5 §4–5).
      const big = c.champion ? CHAMP_SCALE : c.giant ? GIANT_SCALE : 0;
      if (big > 0) {
        const k = c.champion ? giantsFor(c.count) : 1;
        bigScl.set(big, big, big);
        for (let i = 0; i < k && n < MAX_UNITS; i++) {
          const ph = time * 8 + c.id + i * 1.9;
          // Two abreast, rows trailing behind the leader; an odd one out walks in the middle.
          const row = Math.floor(i / 2);
          const pair = k - row * 2 >= 2;
          const side = pair ? (i % 2 === 0 ? -1 : 1) : 0;
          const gx = cx + side * GIANT_DX * (k > 1 ? 1 : 0);
          const gz = cz + row * GIANT_DZ * (enemy ? -1 : 1);
          e.set(0, yaw + Math.sin(ph * 0.5) * 0.08, Math.cos(ph) * 0.1);
          q.setFromEuler(e);
          pos.set(Math.max(-HALF_W + 0.6, Math.min(HALF_W - 0.6, gx)), Math.abs(Math.sin(ph)) * 0.25, gz);
          m4.compose(pos, q, bigScl);
          mesh.setMatrixAt(n++, m4);
        }
        continue;
      }
      const units = unitsFor(c.count);
      // The sim treats a cohort as a point (plus a small gate grace), so keep the drawn crowd
      // narrow across the lane and let big crowds stretch along it instead. Then a crowd that
      // looks like it touches a gate really does go through it.
      const rMax = SPACING * Math.sqrt(units + 0.5);
      const kx = Math.min(1, MAX_HALF_SPREAD / rMax);
      const kz = Math.min(2, 0.7 / kx);
      for (let i = 0; i < units && n < MAX_UNITS; i++) {
        // Sunflower spiral blob; jitter is cosmetic.
        const r = SPACING * Math.sqrt(i + 0.5);
        const ang = i * 2.39996 + c.id * 0.7;
        const ux = Math.max(-HALF_W + 0.3, Math.min(HALF_W - 0.3, cx + r * Math.cos(ang) * kx));
        const uz = cz + r * Math.sin(ang) * kz;
        // Cheap walk: a hop and a side-to-side waddle per instance, phase-shifted so the crowd
        // doesn't move in lockstep. The model itself is static (no skinning).
        const ph = time * 13 + i * 1.7 + c.id;
        const bob = Math.abs(Math.sin(ph)) * 0.16;
        e.set(0, yaw + Math.sin(ph * 0.37 + i) * 0.12, Math.cos(ph) * 0.2);
        q.setFromEuler(e);
        pos.set(ux, bob, uz);
        m4.compose(pos, q, scl);
        mesh.setMatrixAt(n++, m4);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return <instancedMesh ref={ref} args={[geo, material, MAX_UNITS]} frustumCulled={false} />;
}
