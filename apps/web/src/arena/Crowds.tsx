import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, type InstancedBufferAttribute, InstancedMesh, Matrix4, type MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { CHAMP_COUNT, LANE_WIDTH, TICKS_PER_SEC, type CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { PALETTE, wx, wz } from './layout';
import { preloadPacks, usePack, useTintedMaterial, type Pack, type TintRule } from './models/assets';
import { animateMaterial, animatedGeometry, useVat, type Vat } from './models/vat';
import { CrowdSim, POOL } from './crowdSim';
import { pushOut, solidsOf } from './levelDefs';
import { spanAt, wallsOf } from './columns';

/**
 * Model scale. The characters are ~0.66 wide and ~0.81 tall at scale 1, so at 1.8 a dude is
 * ~1.2 units wide and ~1.46 tall: the genre's chunky look (crowd spacing in crowdSim.ts matches).
 */
const UNIT_SCALE = 1.8;
/** A Champion giant is ~3× a dude (purple and gold), an enemy giant ~1.8× (red). */
const CHAMP_SCALE = 5.5;
const GIANT_SCALE = 3.2;
/** Most giants drawn for one Champion cohort (a ×8 gate on a fresh Champion makes 8). */
const MAX_GIANTS = 16;
const CHAMP_POOL = 48;
/** Spacing of a Champion's giants (sim units): two abreast across the lane, rows along it. */
const GIANT_DX = 390;
const GIANT_DZ = 550;
/** A Champion's column never gets longer than this (sim units): rows close up past it. */
const GIANT_COLUMN = 1700;
/** Body radius (sim units) of a Champion giant and of an enemy giant, against walls and solids. */
const CHAMP_R = 290;
const GIANT_R = 170;
/** Giants walk a slower, heavier cycle (loops per second at cruise, and the range). */
const GIANT_CYC = 1.25;
const GIANT_CYC_MIN = 0.8;
const GIANT_CYC_MAX = 1.9;
const span = { lo: 0, hi: 0 };

/**
 * Team colours on the shared Mini Characters colormap (see models/assets.ts `tintedMap`): our
 * knight's armour + helmet go team blue, the robot's metal team red with dark trim. The Champion
 * is royal purple armour under a gold helmet and trim, to match the purple Champion button.
 */
const DUDE_TINT: readonly TintRule[] = [{ cells: [[5, 3], [3, 3]], ref: [5, 3], color: PALETTE.me }];
const CHAMP_TINT: readonly TintRule[] = [
  { cells: [[5, 3]], color: '#6a3df0' },
  { cells: [[3, 3], [7, 3]], ref: [3, 3], color: '#ffc21a' },
];
const TROOP_TINT: readonly TintRule[] = [
  { cells: [[5, 3], [3, 3]], ref: [5, 3], color: PALETTE.enemy },
  { cells: [[1, 3]], color: '#5a1f2a' },
];

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const bigScl = new Vector3();
const hit = { x: 0, y: 0, nx: 0, ny: 0 };
const fract = (v: number) => v - Math.floor(v);

/**
 * How many giants a Champion cohort is: one per CHAMP_COUNT dudes, rounded up (SPEC_V5 §4: the
 * Champion multiplies through gates like any cohort, so a ×3 gate makes three giants).
 */
export function giantsFor(count: number): number {
  return count <= 0 ? 0 : Math.min(MAX_GIANTS, Math.ceil(count / CHAMP_COUNT));
}

preloadPacks('dudes');

/** Crowd step cost, for `?crowdprof=1` (read from devtools as `__crowd`). */
const prof = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('crowdprof');
const sims: Record<string, CrowdSim> = {};
if (prof) (window as unknown as { __crowd: typeof sims }).__crowd = sims;

/** Your dudes (blue, Champions purple) and the base's troops (red) in your lane. */
export function Crowds({ feed }: { feed: MatchFeed }) {
  return (
    <Suspense fallback={null}>
      <Crowd feed={feed} enemy={false} />
      <Crowd feed={feed} enemy />
    </Suspense>
  );
}

/** A crowd mesh's animated geometry (own copy with a per-instance `aAnim`) and VAT materials. */
function useAnimated(pack: Pack, vat: Vat | null, piece: string, base: MeshStandardMaterial, count: number) {
  return useMemo(() => {
    const { geo, anim } = animatedGeometry(pack.geo[piece]!, count);
    const material = base.clone();
    const depth = animateMaterial(vat, piece, material);
    return { geo, anim, material, depth };
  }, [pack, vat, piece, base, count]);
}

function Crowd({ feed, enemy }: { feed: MatchFeed; enemy: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  const champRef = useRef<InstancedMesh>(null);
  const pack = usePack('dudes');
  const vat = useVat();
  const piece = enemy ? 'troop' : 'dude';
  const baseMat = useTintedMaterial(pack, piece, enemy ? TROOP_TINT : DUDE_TINT, 0.5);
  const champBase = useTintedMaterial(pack, 'champ', CHAMP_TINT, 0.35);
  const crowd = useAnimated(pack, vat, piece, baseMat, POOL);
  const champ = useAnimated(pack, vat, 'dude', champBase, CHAMP_POOL);
  useEffect(
    () => () => {
      for (const m of [crowd, champ]) {
        m.geo.dispose();
        m.material.dispose();
        m.depth?.dispose();
      }
    },
    [crowd, champ],
  );
  /** Walk phase per giant cohort (by id), advanced by its speed. */
  const giantCyc = useMemo(() => new Float32Array(256), []);
  const sim = useMemo(() => new CrowdSim(enemy), [enemy]);
  if (prof) sims[enemy ? 'enemy' : 'me'] = sim;
  // Dudes run up the lane (−Z, backs to the camera); troops run down it, facing us.
  const yaw = enemy ? 0 : Math.PI;

  // Pipes move a cohort in one tick: its dudes dive into the entrance and pop out of the exit.
  useEffect(
    () =>
      feed.onEvent((ev) => {
        const p = ev as unknown as { type: string; side?: number; cohortId?: number; pipeIx?: number };
        if (!enemy && p.type === 'pipe' && p.side === feed.mySide && p.cohortId !== undefined) sim.pipe(p.cohortId, p.pipeIx ?? 0);
      }),
    [feed, sim, enemy],
  );

  useFrame(({ clock }, dt) => {
    const mesh = ref.current;
    const lane = feed.me;
    const view = feed.cur;
    if (!lane || !view) return;
    const list: CohortView[] = enemy ? lane.enemies : lane.cohorts;
    const prevById = enemy ? feed.prevEnemies : feed.prevCohorts;
    const time = clock.elapsedTime;
    const a = feed.alpha();
    const foes: CohortView[] = enemy ? lane.cohorts : lane.enemies;
    sim.update({ lane, layout: view.layout, list, foes, prevById, alpha: a, time, dt });
    const anim = crowd.anim.array as Float32Array;
    const champAnim = champ.anim.array as Float32Array;
    let n = sim.write(mesh, 0, UNIT_SCALE, time, dt, anim);

    // Giants: a Champion (mine) is one giant per CHAMP_COUNT dudes, on its own purple mesh; an
    // enemy giant is one big troop in the red mesh. Never a cluster of small ones (SPEC_V5 §4–5).
    const champMesh = champRef.current;
    let nc = 0;
    const solids = solidsOf(view.layout, lane.stage);
    const walls = wallsOf(view.layout, lane.stage);
    for (const c of list) {
      if (c.count <= 0 || (!c.champion && !c.giant)) continue;
      const p = prevById.get(c.id);
      const x = p ? p.x + (c.x - p.x) * a : c.x;
      const y = p ? p.y + (c.y - p.y) * a : c.y;
      const big = c.champion ? CHAMP_SCALE : GIANT_SCALE;
      const R = c.champion ? CHAMP_R : GIANT_R;
      const k = c.champion ? giantsFor(c.count) : 1;
      // A heavier walk than the dudes': slower loops, a little faster when the cohort is.
      const sp = p ? Math.hypot(c.x - p.x, c.y - p.y) * TICKS_PER_SEC : 1200;
      const rate = Math.min(GIANT_CYC_MAX, Math.max(GIANT_CYC_MIN, (GIANT_CYC * sp) / 1200));
      const cyc0 = (giantCyc[c.id & 255] = fract(giantCyc[c.id & 255]! + dt * rate));
      // Pairs squeeze to the room between the walls around them (lane edges otherwise).
      spanAt(walls, 2 * LANE_WIDTH, x, y, span);
      const dx = Math.max(0, Math.min(GIANT_DX, (span.hi - span.lo) / 2 - R));
      // Too narrow for two abreast (a corridor): single file instead of overlapping.
      const abreast = dx >= R * 1.15;
      const rows = abreast ? Math.ceil(k / 2) : k;
      const dz = rows > 1 ? Math.min(GIANT_DZ, GIANT_COLUMN / (rows - 1)) : 0;
      const mx = span.hi - span.lo > 2 * (R + dx) ? Math.max(span.lo + R + dx, Math.min(span.hi - R - dx, x)) : (span.lo + span.hi) / 2;
      bigScl.set(big, big, big);
      for (let i = 0; i < k; i++) {
        const cyc = fract(cyc0 + i * 0.37);
        // Two abreast, rows trailing behind the leader; an odd one out walks in the middle.
        const row = abreast ? Math.floor(i / 2) : i;
        const pair = abreast && k - row * 2 >= 2;
        const side = pair ? (i % 2 === 0 ? -1 : 1) : 0;
        let gx = (k > 1 ? mx : x) + side * dx * (k > 1 ? 1 : 0);
        let gy = y - row * dz * (enemy ? -1 : 1);
        for (let s = 0; s < solids.n; s++) {
          if (pushOut(solids, s, gx, gy, R, hit) > 0) {
            gx = hit.x;
            gy = hit.y;
          }
        }
        gx = Math.max(R, Math.min(LANE_WIDTH - R, gx));
        e.set(0, yaw + Math.sin(time * 1.7 + c.id + i) * 0.05, 0);
        q.setFromEuler(e);
        pos.set(wx(gx), Math.abs(Math.sin(cyc * Math.PI * 2)) * 0.08, wz(gy));
        m4.compose(pos, q, bigScl);
        if (c.champion && champMesh && nc < CHAMP_POOL) {
          champAnim[nc * 2] = cyc;
          champAnim[nc * 2 + 1] = 0;
          champMesh.setMatrixAt(nc++, m4);
        } else if (!c.champion && n < POOL) {
          anim[n * 2] = cyc;
          anim[n * 2 + 1] = 0;
          mesh.setMatrixAt(n++, m4);
        }
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    flush(crowd.anim, n);
    if (champMesh) {
      champMesh.count = nc;
      champMesh.instanceMatrix.needsUpdate = true;
      flush(champ.anim, nc);
    }
  });

  return (
    <>
      <instancedMesh
        ref={ref}
        args={[crowd.geo, crowd.material, POOL]}
        frustumCulled={false}
        customDepthMaterial={crowd.depth ?? undefined}
      />
      {!enemy && (
        <instancedMesh
          ref={champRef}
          args={[champ.geo, champ.material, CHAMP_POOL]}
          frustumCulled={false}
          customDepthMaterial={champ.depth ?? undefined}
        />
      )}
    </>
  );
}

/** Upload only the instances written this frame. */
function flush(attr: InstancedBufferAttribute, n: number) {
  if (n <= 0) return;
  attr.clearUpdateRanges();
  attr.addUpdateRange(0, n * 2);
  attr.needsUpdate = true;
}
