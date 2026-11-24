import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { CHAMP_COUNT, LANE_WIDTH, type CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { PALETTE, wx, wz } from './layout';
import { preloadPacks, usePack, useTintedMaterial, type TintRule } from './models/assets';
import { CrowdSim, POOL } from './crowdSim';
import { pushOut, solidsOf } from './levelDefs';
import { spanAt, wallsOf } from './columns';

/**
 * Model scale. The characters are ~0.66 wide and ~0.81 tall at scale 1, so at 1.55 a dude is
 * ~1 unit wide and ~1.26 tall: the genre's chunky look (crowd spacing in crowdSim.ts matches).
 */
const UNIT_SCALE = 1.55;
/** A Champion giant is ~2.2× a dude (purple and gold), an enemy giant ~1.8× (red). */
const CHAMP_SCALE = 3.4;
const GIANT_SCALE = 2.8;
/** Most giants drawn for one Champion cohort (a ×8 gate on a fresh Champion makes 8). */
const MAX_GIANTS = 16;
const CHAMP_POOL = 48;
/** Spacing of a Champion's giants (sim units): two abreast across the lane, rows along it. */
const GIANT_DX = 240;
const GIANT_DZ = 340;
const GIANT_R = 180;
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

function Crowd({ feed, enemy }: { feed: MatchFeed; enemy: boolean }) {
  const ref = useRef<InstancedMesh>(null!);
  const champRef = useRef<InstancedMesh>(null);
  const pack = usePack('dudes');
  const geo = pack.geo[enemy ? 'troop' : 'dude']!;
  const material = useTintedMaterial(pack, enemy ? 'troop' : 'dude', enemy ? TROOP_TINT : DUDE_TINT, 0.5);
  const champMat = useTintedMaterial(pack, 'champ', CHAMP_TINT, 0.35);
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
    sim.update({ lane, layout: view.layout, list, prevById, alpha: a, time, dt });
    let n = sim.write(mesh, 0, UNIT_SCALE, time, dt);

    // Giants: a Champion (mine) is one giant per CHAMP_COUNT dudes, on its own purple mesh; an
    // enemy giant is one big troop in the red mesh. Never a cluster of small ones (SPEC_V5 §4–5).
    const champ = champRef.current;
    let nc = 0;
    const solids = solidsOf(view.layout, lane.stage);
    const walls = wallsOf(view.layout, lane.stage);
    for (const c of list) {
      if (c.count <= 0 || (!c.champion && !c.giant)) continue;
      const p = prevById.get(c.id);
      const x = p ? p.x + (c.x - p.x) * a : c.x;
      const y = p ? p.y + (c.y - p.y) * a : c.y;
      const big = c.champion ? CHAMP_SCALE : GIANT_SCALE;
      const k = c.champion ? giantsFor(c.count) : 1;
      // Pairs squeeze to the room between the walls around them (lane edges otherwise).
      spanAt(walls, 2 * LANE_WIDTH, x, y, span);
      const dx = Math.max(0, Math.min(GIANT_DX, (span.hi - span.lo) / 2 - GIANT_R));
      const mx = span.hi - span.lo > 2 * (GIANT_R + dx) ? Math.max(span.lo + GIANT_R + dx, Math.min(span.hi - GIANT_R - dx, x)) : (span.lo + span.hi) / 2;
      bigScl.set(big, big, big);
      for (let i = 0; i < k; i++) {
        const ph = time * 8 + c.id + i * 1.9;
        // Two abreast, rows trailing behind the leader; an odd one out walks in the middle.
        const row = Math.floor(i / 2);
        const pair = k - row * 2 >= 2;
        const side = pair ? (i % 2 === 0 ? -1 : 1) : 0;
        let gx = (k > 1 ? mx : x) + side * dx * (k > 1 ? 1 : 0);
        let gy = y - row * GIANT_DZ * (enemy ? -1 : 1);
        for (let s = 0; s < solids.n; s++) {
          if (pushOut(solids, s, gx, gy, GIANT_R, hit) > 0) {
            gx = hit.x;
            gy = hit.y;
          }
        }
        gx = Math.max(GIANT_R, Math.min(LANE_WIDTH - GIANT_R, gx));
        e.set(0, yaw + Math.sin(ph * 0.5) * 0.08, Math.cos(ph) * 0.1);
        q.setFromEuler(e);
        pos.set(wx(gx), Math.abs(Math.sin(ph)) * 0.3, wz(gy));
        m4.compose(pos, q, bigScl);
        if (c.champion && champ && nc < CHAMP_POOL) champ.setMatrixAt(nc++, m4);
        else if (!c.champion && n < POOL) mesh.setMatrixAt(n++, m4);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (champ) {
      champ.count = nc;
      champ.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <>
      <instancedMesh ref={ref} args={[geo, material, POOL]} frustumCulled={false} />
      {!enemy && <instancedMesh ref={champRef} args={[geo, champMat, CHAMP_POOL]} frustumCulled={false} />}
    </>
  );
}
