import { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import type { InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial } from 'three';
import type { CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { PALETTE } from './layout';
import { preloadPacks, usePack, useTintedMaterial, type Pack, type TintRule } from './models/assets';
import { animateMaterial, animatedGeometry, useVat, type Vat } from './models/vat';
import { Big, CrowdSim, POOL } from './crowdSim';

/**
 * Model scale. The characters are ~0.66 wide and ~0.81 tall at scale 1, so at 1.8 a dude is
 * ~1.2 units wide and ~1.46 tall: the genre's chunky look (crowd spacing in crowdSim.ts matches).
 */
const UNIT_SCALE = 1.8;
/**
 * A Champion giant is ~3× a dude (purple and gold). An enemy giant is the base's Champion
 * (SPEC_V5 §16): ~2.7× (crimson and gold), big enough to read as one at a glance.
 */
const CHAMP_SCALE = 5.5;
const GIANT_SCALE = 4.8;
/** Champion giants drawn at once (crowdSim.ts: at most MAX_GIANTS per Champion cohort). */
const CHAMP_POOL = 48;

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
/** The enemy Champion: dark crimson metal with gold trim (mirrors our purple-and-gold Champion). */
const FOE_CHAMP_TINT: readonly TintRule[] = [
  { cells: [[5, 3], [3, 3]], ref: [5, 3], color: '#a5122a' },
  { cells: [[1, 3]], color: '#ffc21a' },
];

preloadPacks('dudes');

/** Crowd step cost, for `?crowdprof=1` (read from devtools as `__crowd`). */
const prof = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('crowdprof');
const sims: Record<string, CrowdSim> = {};
if (prof) (window as unknown as { __crowd: typeof sims }).__crowd = sims;

/** Your dudes (blue, Champions purple) and the base's troops (red, its Champions crimson and gold). */
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
  const champBase = useTintedMaterial(pack, enemy ? 'foe-champ' : 'champ', enemy ? FOE_CHAMP_TINT : CHAMP_TINT, 0.35);
  const crowd = useAnimated(pack, vat, piece, baseMat, POOL);
  const champ = useAnimated(pack, vat, piece, champBase, CHAMP_POOL);
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
  const sim = useMemo(() => new CrowdSim(enemy), [enemy]);
  if (prof) sims[enemy ? 'enemy' : 'me'] = sim;

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
    // Giants are agents in the crowd layer too (they collide, squeeze and die one at a time), on
    // their own mesh: a Champion's purple giants, or the base's crimson-and-gold Champions.
    const n = sim.write(mesh, 0, Big.Dude, UNIT_SCALE, time, dt, anim);
    const champMesh = champRef.current;
    const nc = champMesh
      ? enemy
        ? sim.write(champMesh, 0, Big.Troop, GIANT_SCALE, time, dt, champAnim)
        : sim.write(champMesh, 0, Big.Champ, CHAMP_SCALE, time, dt, champAnim)
      : 0;
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
      <instancedMesh
        ref={champRef}
        args={[champ.geo, champ.material, CHAMP_POOL]}
        frustumCulled={false}
        customDepthMaterial={champ.depth ?? undefined}
      />
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
