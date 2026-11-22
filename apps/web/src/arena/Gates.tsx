import { useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Group, Mesh, MeshBasicMaterial, MeshLambertMaterial } from 'three';
import { COLS, GATE_WIDTH, ROW_Y, type GateView, type PrivateView, type Side } from '@lil-dudes/client';
import { useHud } from '../hud';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { PALETTE, SX, colCenter, isGoodOp, opLabel, wx, wz } from './layout';

/** Panels lean back towards the camera so labels read from the tilted view. */
const TILT = -0.5;
const PANEL_W = GATE_WIDTH * SX; // ~75% of the column: the gaps make aim matter (SPEC §2)
const PANEL_H = 2.3;
const FLIP_TIME = 0.12; // s: label punch ~1.4× (TECH §5)

function panelColor(g: GateView): string {
  if (g.revealed) return g.gold ? PALETTE.gold : isGoodOp(g.revealed) ? PALETTE.good : PALETTE.bad;
  switch (g.hint) {
    case 'good':
      return PALETTE.good;
    case 'bad':
      return PALETTE.bad;
    case 'gold':
      return PALETTE.gold;
    default:
      return PALETTE.unknown;
  }
}

export function Gates({ feed, side, interactive }: { feed: MatchFeed; side: Side; interactive: boolean }) {
  return (
    <group>
      {ROW_Y.map((y, row) =>
        Array.from({ length: COLS }, (_, col) => (
          <Gate
            key={`${row}:${col}`}
            feed={feed}
            side={side}
            cell={row * COLS + col}
            x={wx(colCenter(col), feed.mySide)}
            z={wz(side, y, feed.mySide)}
            interactive={interactive}
          />
        )),
      )}
    </group>
  );
}

function Gate(props: { feed: MatchFeed; side: Side; cell: number; x: number; z: number; interactive: boolean }) {
  const { feed, side, cell, x, z, interactive } = props;
  const mine = side === feed.mySide;
  const face = useRef<Group>(null!);
  const panel = useRef<Mesh>(null!);
  const label = useRef<Mesh>(null!);
  const marker = useRef<Mesh>(null!);
  const lastKey = useRef('');
  const flipAt = useRef(-1);

  useFrame(({ clock }) => {
    const g = feed.cur?.sides[side].gates[cell];
    if (!g) return;
    const peekOp = mine ? peekedOp(feed.priv, cell) : null;
    const text = g.revealed ? opLabel(g.revealed) : peekOp ? opLabel(peekOp) : '?';
    const key = `${text}|${panelColor(g)}|${g.revealed ? 1 : 0}`;
    if (key !== lastKey.current) {
      if (g.revealed && !lastKey.current.endsWith('|1')) flipAt.current = clock.elapsedTime;
      lastKey.current = key;
      const pm = panel.current.material as MeshLambertMaterial;
      pm.color.set(panelColor(g));
      pm.opacity = g.revealed ? 0.92 : 0.6;
      const lm = label.current.material as MeshBasicMaterial;
      lm.map = labelTexture(text);
      lm.needsUpdate = true;
    }
    // Private markers: my rig on their gate, my peek on mine. Only this client sees them.
    const showMarker = mine ? feed.priv.myPeek?.cell === cell && !g.revealed : feed.priv.myRig === cell && !g.revealed;
    marker.current.visible = showMarker;
    // Reveal: the face squashes, then the label punches to ~1.4× (TECH §5).
    const since = flipAt.current < 0 ? Infinity : clock.elapsedTime - flipAt.current;
    const k = Math.min(1, since / FLIP_TIME);
    const pop = 1 + 0.4 * Math.sin(k * Math.PI);
    face.current.scale.set(pop, pop, 1);
  });

  const onTap = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta > 8) return; // a drag, not a tap
    const view = feed.cur;
    if (!view || view.status === 'ended') return;
    const g = view.sides[side].gates[cell];
    if (!g || g.revealed) return;
    if (!mine && view.status === 'plant') {
      e.stopPropagation();
      feed.source.rig(cell);
    } else if (mine && useHud.getState().peeking) {
      e.stopPropagation();
      feed.source.peek(cell);
      useHud.getState().set({ peeking: false });
    }
  };

  return (
    <group position={[x, 0, z]}>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[(s * (PANEL_W + 0.4)) / 2, 1.5, 0]}>
          <boxGeometry args={[0.4, 3, 0.4]} />
          <meshLambertMaterial color={PALETTE.post} />
        </mesh>
      ))}
      <group position={[0, 1.6, 0]} rotation-x={TILT}>
        <group ref={face}>
          <mesh ref={panel} onClick={onTap}>
            <boxGeometry args={[PANEL_W, PANEL_H, 0.2]} />
            <meshLambertMaterial color={PALETTE.unknown} transparent opacity={0.6} />
          </mesh>
          <mesh ref={label} position={[0, 0, 0.12]}>
            <planeGeometry args={[2.3, 2.3]} />
            <meshBasicMaterial transparent depthWrite={false} />
          </mesh>
          <mesh ref={marker} position={[PANEL_W / 2 - 0.4, PANEL_H / 2 - 0.4, 0.15]} visible={false}>
            <circleGeometry args={[0.38, 20]} />
            <meshBasicMaterial color={mine ? '#ffffff' : PALETTE.outline} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function peekedOp(priv: PrivateView, cell: number) {
  return priv.myPeek && priv.myPeek.cell === cell ? priv.myPeek.op : null;
}
