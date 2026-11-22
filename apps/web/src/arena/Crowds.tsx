import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CapsuleGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { HALF_W, PALETTE, wx, wz } from './layout';

/** Instance cap per crowd (TECH §5: ~1,500 on a phone). */
const MAX_UNITS = 1500;
const SPACING = 0.32;
/** Widest a crowd is drawn either side of its centre: about the sim's gate grace (100 units). */
const MAX_HALF_SPREAD = 0.6;

/** Visible units for a cohort: 1:1 when small, then sub-linear so big crowds stay affordable. */
function unitsFor(count: number): number {
  if (count <= 0) return 0;
  return count <= 30 ? count : Math.round(30 + Math.sqrt(count - 30) * 4);
}

const unitGeo = new CapsuleGeometry(0.24, 0.36, 2, 8);
unitGeo.translate(0, 0.44, 0);

const m4 = new Matrix4();
const q = new Quaternion();
const pos = new Vector3();
const one = new Vector3(1, 1, 1);

/** Your dudes (blue) and the base's troops (red) in your lane. No number badge per crowd (SPEC v3 §7). */
export function Crowds({ feed }: { feed: MatchFeed }) {
  return (
    <>
      <Crowd feed={feed} enemy={false} />
      <Crowd feed={feed} enemy />
    </>
  );
}

function Crowd({ feed, enemy }: { feed: MatchFeed; enemy: boolean }) {
  const ref = useRef<InstancedMesh>(null!);

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
        const bob = Math.abs(Math.sin(time * 13 + i * 1.7 + c.id)) * 0.18;
        pos.set(ux, bob, uz);
        m4.compose(pos, q, one);
        mesh.setMatrixAt(n++, m4);
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={ref} args={[unitGeo, undefined, MAX_UNITS]} frustumCulled={false}>
      <meshLambertMaterial color={enemy ? PALETTE.enemy : PALETTE.me} />
    </instancedMesh>
  );
}
