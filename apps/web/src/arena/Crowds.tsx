import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CapsuleGeometry, InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import type { Side } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { HALF_W, PALETTE, wx, wz } from './layout';

/** Per-side instance cap (TECH §5: ~1,500 per side on a phone). */
const MAX_UNITS = 1500;
const SPACING = 0.32;

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

/** Crowds are drawn from cohorts; no number badge per crowd (SPEC §6). */
export function Crowds({ feed }: { feed: MatchFeed }) {
  return (
    <>
      <Crowd feed={feed} side={0} />
      <Crowd feed={feed} side={1} />
    </>
  );
}

function Crowd({ feed, side }: { feed: MatchFeed; side: Side }) {
  const ref = useRef<InstancedMesh>(null!);
  const color = side === feed.mySide ? PALETTE.me : PALETTE.them;

  useFrame(({ clock }) => {
    const mesh = ref.current;
    const cur = feed.cur;
    if (!cur) return;
    const a = feed.alpha();
    const prevById = feed.prevCohorts[side];
    const time = clock.elapsedTime;
    let n = 0;
    for (const c of cur.sides[side].cohorts) {
      if (c.count <= 0) continue;
      const p = prevById.get(c.id);
      const x = p ? p.x + (c.x - p.x) * a : c.x;
      const y = p ? p.y + (c.y - p.y) * a : c.y * a;
      const cx = wx(x, feed.mySide);
      const cz = wz(side, y, feed.mySide);
      const units = unitsFor(c.count);
      for (let i = 0; i < units && n < MAX_UNITS; i++) {
        // Sunflower spiral blob; jitter is cosmetic (SPEC §6).
        const r = SPACING * Math.sqrt(i + 0.5);
        const ang = i * 2.39996 + c.id * 0.7;
        const ux = Math.max(-HALF_W + 0.3, Math.min(HALF_W - 0.3, cx + r * Math.cos(ang)));
        const uz = cz + r * Math.sin(ang) * 0.7;
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
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}
