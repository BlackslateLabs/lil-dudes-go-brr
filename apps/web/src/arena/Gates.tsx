import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import type { GateView } from '@lil-dudes/client';
import { useHud } from '../hud';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { PALETTE, SX, opLabel, wx, wz } from './layout';

/** Pool size: more than any stage's gate count. */
const MAX_GATES = 12;
/** Panels lean back towards the camera so labels read from the tilted view. */
const TILT = -0.5;
const PANEL_H = 2.3;
const FLIP_TIME = 0.12; // s: label punch ~1.4× (TECH §5)

function panelColor(g: GateView): string {
  if (!g.revealed) return g.big ? PALETTE.gold : PALETTE.unknown;
  if (g.revealed.kind === 'div') return PALETTE.bad;
  return g.big ? PALETTE.gold : PALETTE.good;
}

/** The current stage's gates in your lane. Gates come and go with the stage, so this is a pool. */
export function Gates({ feed, interactive }: { feed: MatchFeed; interactive: boolean }) {
  return (
    <group>
      {Array.from({ length: MAX_GATES }, (_, i) => (
        <Gate key={i} feed={feed} index={i} interactive={interactive} />
      ))}
    </group>
  );
}

function Gate({ feed, index, interactive }: { feed: MatchFeed; index: number; interactive: boolean }) {
  const root = useRef<Group>(null!);
  const face = useRef<Group>(null!);
  const panel = useRef<Mesh>(null!);
  const label = useRef<Mesh>(null!);
  const posts = useRef<Group>(null!);
  const marker = useRef<Mesh>(null!);
  const lastKey = useRef('');
  const flipAt = useRef(-1);
  const slotRef = useRef(-1);
  const wasHidden = useRef('');

  useFrame(({ clock }) => {
    const lane = feed.me;
    const g = lane?.gates[index];
    root.current.visible = !!g;
    if (!g || !lane) return;
    slotRef.current = g.slot;
    // Moving gates: interpolate x between snapshots.
    const p = feed.prevGates.get(g.slot);
    const x = p ? p.x + (g.x - p.x) * feed.alpha() : g.x;
    root.current.position.set(wx(x), 0, wz(g.y));

    const peek = feed.priv.myPeek && feed.priv.myPeek.stage === lane.stage && feed.priv.myPeek.slot === g.slot ? feed.priv.myPeek.op : null;
    const text = g.revealed ? opLabel(g.revealed) : peek ? opLabel(peek) : g.locked ? '🔒' : '?';
    const width = g.width * SX;
    const key = `${lane.stage}|${g.slot}|${text}|${panelColor(g)}|${g.revealed ? 1 : 0}|${width}`;
    // Flip only when this same gate (stage + slot) goes from hidden to revealed.
    const ident = `${lane.stage}|${g.slot}`;
    if (g.revealed && wasHidden.current === ident) flipAt.current = clock.elapsedTime;
    wasHidden.current = g.revealed ? '' : ident;
    if (key !== lastKey.current) {
      lastKey.current = key;
      const pm = panel.current.material as MeshLambertMaterial;
      pm.color.set(panelColor(g));
      pm.opacity = g.revealed ? 0.92 : 0.6;
      panel.current.scale.set(width, 1, 1);
      posts.current.children[0]!.position.x = -(width + 0.4) / 2;
      posts.current.children[1]!.position.x = (width + 0.4) / 2;
      const lm = label.current.material as MeshBasicMaterial;
      lm.map = labelTexture(text);
      lm.needsUpdate = true;
      marker.current.position.x = width / 2 - 0.4;
    }
    marker.current.visible = !!peek && !g.revealed;
    const since = flipAt.current < 0 ? Infinity : clock.elapsedTime - flipAt.current;
    const k = Math.min(1, since / FLIP_TIME);
    const pop = 1 + 0.4 * Math.sin(k * Math.PI);
    face.current.scale.set(pop, pop, 1);
  });

  const onTap = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta > 8) return; // a drag, not a tap
    const lane = feed.me;
    const g = lane?.gates.find((x) => x.slot === slotRef.current);
    if (!lane || !g || g.revealed) return;
    if (useHud.getState().peeking && !lane.peekUsed) {
      e.stopPropagation();
      feed.source.peek(g.slot);
      useHud.getState().set({ peeking: false });
    }
  };

  return (
    <group ref={root} visible={false}>
      <group ref={posts}>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * 2, 1.5, 0]}>
            <boxGeometry args={[0.4, 3, 0.4]} />
            <meshLambertMaterial color={PALETTE.post} />
          </mesh>
        ))}
      </group>
      <group position={[0, 1.6, 0]} rotation-x={TILT}>
        <group ref={face}>
          <mesh ref={panel} onClick={onTap}>
            <boxGeometry args={[1, PANEL_H, 0.2]} />
            <meshLambertMaterial color={PALETTE.unknown} transparent opacity={0.6} />
          </mesh>
          <mesh ref={label} position={[0, 0, 0.12]}>
            <planeGeometry args={[2.3, 2.3]} />
            <meshBasicMaterial transparent depthWrite={false} />
          </mesh>
          <mesh ref={marker} position={[1, PANEL_H / 2 - 0.4, 0.15]} visible={false}>
            <circleGeometry args={[0.38, 20]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
