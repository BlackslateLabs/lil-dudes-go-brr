import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { CHAMP_COUNT, TOWER_Y, type CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { HALF_W, PALETTE, wx, wz } from './layout';
import { preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';
import { columnWidth, spanAt, wallsOf } from './walls';

/** Instance cap per crowd mesh (TECH §5: ~1,500 on a phone). Above it, units are culled at random. */
const MAX_UNITS = 1500;
/** A cohort is drawn 1:1 up to this many dudes, then grows only slowly. */
const COHORT_FULL = 250;
/**
 * Model scale. The characters are ~0.55 wide at scale 1 (arms down, baked idle pose), so at 1.3 a
 * dude is ~0.72 wide and about 21 fit across the 15-unit lane (the genre's chunky look).
 */
const UNIT_SCALE = 1.3;
/** Sunflower packing step: a dude's footprint is ~π·SPACING², a little under its width squared, so
 *  neighbours touch and a crowd reads as one solid blob. */
const SPACING = 0.36;
/** Keep a dude's middle this far (world) inside a wall or the lane edge. */
const EDGE = 0.34;
/** A blob squeezed into its column grows along the lane, at most this much; past that it packs tighter. */
const KZ_MAX = 2.4;
/** A new enemy cohort pours out of its tower as a stream, then spreads into a blob over this long (s). */
const POUR_TIME = 0.7;

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

/** Visible units for a cohort: 1:1 up to COHORT_FULL, then sub-linear. */
function unitsFor(count: number): number {
  if (count <= 0) return 0;
  return count <= COHORT_FULL ? count : Math.min(400, Math.round(COHORT_FULL + Math.sqrt(count - COHORT_FULL) * 3));
}

/** Stable pseudo-random 0..1 per (cohort, unit): which units survive the global cap. */
function keepHash(id: number, i: number): number {
  const h = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453;
  return h - Math.floor(h);
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scl = new Vector3(UNIT_SCALE, UNIT_SCALE, UNIT_SCALE);
const span = { lo: 0, hi: 0 };
const bigScl = new Vector3();
/** A Champion giant is drawn ~2.4× a dude, an enemy giant ~1.8×. */
const CHAMP_SCALE = 2.4 * UNIT_SCALE;
const GIANT_SCALE = 1.8 * UNIT_SCALE;
/** Most giants drawn for one Champion cohort (a ×8 gate on a fresh Champion makes 8). */
const MAX_GIANTS = 16;
/** Spacing of a Champion's giants: two abreast across the lane, rows along it. */
const GIANT_DX = 0.95;
const GIANT_DZ = 1.5;

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

  // Enemy cohorts carry no age, so remember when each one first showed up (for the pour-out).
  const born = useMemo(() => new Map<number, number>(), []);
  const nextPrune = useRef(0);

  useFrame(({ clock }) => {
    const mesh = ref.current;
    const lane = feed.me;
    const view = feed.cur;
    if (!lane || !view) return;
    const a = feed.alpha();
    const list: CohortView[] = enemy ? lane.enemies : lane.cohorts;
    const prevById = enemy ? feed.prevEnemies : feed.prevCohorts;
    const time = clock.elapsedTime;
    const walls = wallsOf(view.layout, lane.stage);
    const col = columnWidth(view.layout, lane.stage);
    const towerZ = wz(TOWER_Y);

    // Global cap: past MAX_UNITS, every crowd keeps the same random share of its units, so blobs
    // keep their size and shape and just get a little sparser.
    let total = 0;
    for (const c of list) if (c.count > 0 && !c.champion && !c.giant) total += unitsFor(c.count);
    const keep = total > MAX_UNITS ? MAX_UNITS / total : 1;

    if (enemy && time >= nextPrune.current) {
      nextPrune.current = time + 2;
      for (const id of born.keys()) if (!list.some((c) => c.id === id)) born.delete(id);
    }

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
          pos.set(Math.max(-HALF_W + 0.8, Math.min(HALF_W - 0.8, gx)), Math.abs(Math.sin(ph)) * 0.3, gz);
          m4.compose(pos, q, bigScl);
          mesh.setMatrixAt(n++, m4);
        }
        continue;
      }

      // A round blob (sunflower packing) as wide as its free span allows: the walls around it, or
      // half a column either side, inside the lane. A blob wider than that squeezes across and
      // grows along the lane instead (up to KZ_MAX, then it just packs tighter).
      const units = unitsFor(c.count);
      const R = SPACING * Math.sqrt(units + 0.5);
      spanAt(walls, col, x, y, span);
      const lo = wx(span.lo) + EDGE;
      const hi = wx(span.hi) - EDGE;
      const half = Math.max(0.05, (hi - lo) / 2);
      const w = Math.min(R, half);
      const kx = w / R;
      const kz = Math.min(KZ_MAX, 1 / kx);
      const bx = hi - lo > 2 * w ? Math.max(lo + w, Math.min(hi - w, cx)) : (lo + hi) / 2;

      // Enemies: pour out of the tower in a narrow stream, then spread into the blob.
      let pour = 1;
      if (enemy) {
        let t0 = born.get(c.id);
        if (t0 === undefined) {
          // Only cohorts first seen at their tower pour; ones already mid-lane (a page reload) don't.
          t0 = y > TOWER_Y - 400 ? time : -Infinity;
          born.set(c.id, t0);
        }
        const k = Math.min(1, (time - t0) / POUR_TIME);
        pour = k * k * (3 - 2 * k);
      }
      const trail = Math.max(0, cz - towerZ); // how far the leader has come out of the tower

      for (let i = 0; i < units && n < MAX_UNITS; i++) {
        if (keep < 1 && keepHash(c.id, i) > keep) continue;
        const r = SPACING * Math.sqrt(i + 0.5);
        const ang = i * 2.39996 + c.id * 0.7;
        let ux = bx + r * Math.cos(ang) * kx;
        let uz = cz + r * Math.sin(ang) * kz;
        if (pour < 1) {
          // Stream: three abreast, from the leader back into the tower.
          const sx = cx + ((i % 3) - 1) * 0.3;
          const sz = cz - (i / units) * trail;
          ux = sx + (ux - sx) * pour;
          uz = sz + (uz - sz) * pour;
        }
        ux = Math.max(-HALF_W + EDGE, Math.min(HALF_W - EDGE, ux));
        // Cheap walk: a hop and a side-to-side waddle per instance, phase-shifted so the crowd
        // doesn't move in lockstep. The model itself is static (no skinning).
        const ph = time * 13 + i * 1.7 + c.id;
        const bob = Math.abs(Math.sin(ph)) * 0.2;
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
