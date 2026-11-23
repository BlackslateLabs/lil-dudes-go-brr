// v6 crowds: each sim cohort (a point) is drawn as a packed, jostling blob of our dudes with a GPU
// run cycle; enemies the same in red (giants bigger); a Champion as one big crowned dude. Blob
// shadows under everyone (cheap, instanced) instead of shadow-map casting.
import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Euler, type InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import type { CohortView } from '@lil-dudes/client';
import type { MatchFeed } from '../../match/feed';
import { HALF_W, PALETTE, wx, wz } from '../layout';
import { useV6 } from './models';
import { addPhase, toonMaterial } from './toon';

/** Instance caps (TECH §5: ~1,500 bodies on a phone). */
const MAX_UNITS = 1400;
const MAX_BIG = 40;
/** Model scale: our dude is ~0.9 tall, drawn ~1.25 (the genre's dude-to-lane ratio). */
const UNIT = 1.4;
const SPACING = 0.5;
/** A crowd spreads at most about a gate's half width across the lane, then stretches along it. */
const MAX_HALF = 1.9;

/** Bodies drawn for a cohort: 1:1 when small, sub-linear when huge (the count is the truth). */
export function bodiesFor(count: number): number {
  if (count <= 0) return 0;
  return count <= 36 ? count : Math.round(36 + Math.sqrt(count - 36) * 5);
}

const m4 = new Matrix4();
const q = new Quaternion();
const e = new Euler();
const pos = new Vector3();
const scl = new Vector3();

export function Crowds6({ feed }: { feed: MatchFeed }) {
  return (
    <Suspense fallback={null}>
      <Crowd feed={feed} enemy={false} />
      <Crowd feed={feed} enemy />
    </Suspense>
  );
}

function Crowd({ feed, enemy }: { feed: MatchFeed; enemy: boolean }) {
  const pieces = useV6('dudes');
  const body = useRef<InstancedMesh>(null!);
  const big = useRef<InstancedMesh>(null!);
  const shadow = useRef<InstancedMesh>(null!);
  const { geo, bigGeo, mat, bigMat, shadowMat } = useMemo(() => {
    const geo = pieces[enemy ? 'troop' : 'dude']!.clone();
    addPhase(geo, MAX_UNITS);
    const bigGeo = pieces[enemy ? 'giant' : 'champ']!.clone();
    addPhase(bigGeo, MAX_BIG);
    const team = enemy ? PALETTE.enemy : PALETTE.me;
    return {
      geo,
      bigGeo,
      mat: toonMaterial({ team, run: true }),
      bigMat: toonMaterial({ team, run: true, neutral: enemy ? '#ffffff' : '#ffd23a' }),
      shadowMat: new MeshBasicMaterial({ color: '#1d2a14', transparent: true, opacity: 0.28, depthWrite: false }),
    };
  }, [pieces, enemy]);

  useFrame(({ clock }) => {
    const lane = feed.me;
    const t = clock.elapsedTime;
    mat.userData.uniforms.uTime.value = t;
    bigMat.userData.uniforms.uTime.value = t * 0.7;
    if (!lane) return;
    const a = feed.alpha();
    const list: CohortView[] = enemy ? lane.enemies : lane.cohorts;
    const prevById = enemy ? feed.prevEnemies : feed.prevCohorts;
    // Ours run away from the camera (−Z), theirs toward it.
    const yaw = enemy ? 0 : Math.PI;
    let n = 0;
    let nb = 0;
    let ns = 0;
    const put = (mesh: InstancedMesh, i: number, x: number, z: number, s: number, rot: number) => {
      e.set(0, rot, 0);
      q.setFromEuler(e);
      pos.set(x, 0, z);
      scl.setScalar(s);
      m4.compose(pos, q, scl);
      mesh.setMatrixAt(i, m4);
    };
    const shade = (x: number, z: number, s: number) => {
      if (ns >= MAX_UNITS + MAX_BIG) return;
      pos.set(x, 0.02, z);
      q.identity();
      scl.set(s, 1, s);
      m4.compose(pos, q, scl);
      shadow.current.setMatrixAt(ns++, m4);
    };
    for (const c of list) {
      if (c.count <= 0) continue;
      const p = prevById.get(c.id);
      const cx = wx(p ? p.x + (c.x - p.x) * a : c.x);
      const cz = wz(p ? p.y + (c.y - p.y) * a : c.y);
      let rest = c.count;
      // A Champion or a giant: one big body leads the group.
      if ((c.champion || c.giant) && nb < MAX_BIG) {
        put(big.current, nb++, cx, cz, c.champion ? 1.25 : 1.15, yaw);
        shade(cx, cz, 2.4);
        rest = c.champion ? Math.max(0, c.count - 20) : Math.max(0, c.count - 5);
      }
      const units = bodiesFor(rest);
      if (units === 0) continue;
      // Packed disc (golden-angle spiral), squeezed to a gate's width and stretched along the lane.
      const rMax = SPACING * Math.sqrt(units + 0.5);
      const kx = Math.min(1, MAX_HALF / rMax);
      const kz = Math.min(2.4, 1 / kx);
      for (let i = 0; i < units && n < MAX_UNITS; i++) {
        const r = SPACING * Math.sqrt(i + 0.5);
        const ang = i * 2.39996 + c.id * 0.7;
        // Jostle: each body drifts a little around its slot.
        const jx = Math.sin(t * 2.1 + i * 1.3 + c.id) * 0.09;
        const jz = Math.cos(t * 1.7 + i * 0.9) * 0.09;
        const ux = Math.max(-HALF_W + 0.35, Math.min(HALF_W - 0.35, cx + r * Math.cos(ang) * kx + jx));
        const uz = cz + r * Math.sin(ang) * kz + jz;
        put(body.current, n++, ux, uz, UNIT, yaw + Math.sin(t * 3 + i) * 0.15);
        shade(ux, uz, 1);
      }
    }
    for (const [mesh, k] of [[body.current, n], [big.current, nb], [shadow.current, ns]] as const) {
      mesh.count = k;
      mesh.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      <instancedMesh ref={shadow} args={[pieces.shadow!, shadowMat, MAX_UNITS + MAX_BIG]} frustumCulled={false} renderOrder={1} userData={{ noShadow: true }} />
      <instancedMesh ref={body} args={[geo, mat, MAX_UNITS]} frustumCulled={false} userData={{ noShadow: true }} />
      <instancedMesh ref={big} args={[bigGeo, bigMat, MAX_BIG]} frustumCulled={false} userData={{ noShadow: true }} />
    </group>
  );
}
