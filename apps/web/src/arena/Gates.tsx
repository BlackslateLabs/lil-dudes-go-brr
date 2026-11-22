import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { CanvasTexture, Color, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace } from 'three';
import type { GateView } from '@lil-dudes/client';
import { useHud } from '../hud';
import type { MatchFeed } from '../match/feed';
import { canRigSlot } from '../match/rig';
import { GLASS_PAD, makeGlassMaterial } from './glass';
import { labelTexture } from './labelTexture';
import { GLASS, PALETTE, SX, opLabel, wx, wz } from './layout';

/** Pool size: more than any stage's gate count. */
const MAX_GATES = 12;
/** Panels lean back towards the camera so labels read from the tilted view. */
const TILT = -0.5;
const PANEL_H = 2.3;
const FLIP_TIME = 0.12; // s: label punch ~1.4× (TECH §5)
const PASS_FLASH = 0.35; // s: a crowd going through
const GOTCHA_FLASH = 0.9; // s: red flash when my dudes spring a trap

type Look = keyof typeof GLASS;

const RIM = Object.fromEntries(Object.entries(GLASS).map(([k, v]) => [k, new Color(v.rim)])) as Record<Look, Color>;
const TRAP_RED = new Color('#ff2a3c');

function gateLook(g: GateView): Look {
  if (!g.revealed) return g.big ? 'gold' : 'unknown';
  if (g.revealed.kind === 'div') return 'bad';
  return g.big ? 'gold' : 'good';
}

/** Recent hits per slot, written by match events and read by each pooled gate every frame. */
interface GateHits {
  /** slot → time (s, performance clock) a crowd last went through, and whether it got smaller. */
  pass: Map<number, { at: number; shrink: boolean }>;
  /** `stage|slot` → time my dudes sprang a trap there (the crack stays for that gate). */
  gotcha: Map<string, number>;
}

const now = () => performance.now() / 1000;

/** The current stage's gates in your lane. Gates come and go with the stage, so this is a pool. */
export function Gates({ feed, interactive }: { feed: MatchFeed; interactive: boolean }) {
  const hits = useMemo<GateHits>(() => ({ pass: new Map(), gotcha: new Map() }), []);
  useEffect(
    () =>
      feed.onEvent((e) => {
        if (!('side' in e) || e.side !== feed.mySide) return;
        if (e.type === 'gate') hits.pass.set(e.slot, { at: now(), shrink: e.after < e.before });
        else if (e.type === 'gotcha') hits.gotcha.set(`${e.stage}|${e.slot}`, now());
        else if (e.type === 'stage') hits.pass.clear();
      }),
    [feed, hits],
  );
  return (
    <group>
      {Array.from({ length: MAX_GATES }, (_, i) => (
        <Gate key={i} feed={feed} index={i} interactive={interactive} hits={hits} />
      ))}
    </group>
  );
}

function Gate({ feed, index, interactive, hits }: { feed: MatchFeed; index: number; interactive: boolean; hits: GateHits }) {
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

  const glass = useMemo(() => makeGlassMaterial(index * 0.37), [index]);
  const orb = useMemo(() => new MeshStandardMaterial({ roughness: 0.25, emissiveIntensity: 3 }), []);
  useEffect(
    () => () => {
      glass.dispose();
      orb.dispose();
    },
    [glass, orb],
  );

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
    const look = gateLook(g);
    const key = `${lane.stage}|${g.slot}|${text}|${look}|${g.revealed ? 1 : 0}|${width}|${g.locked ? 1 : 0}`;
    // Flip only when this same gate (stage + slot) goes from hidden to revealed.
    const ident = `${lane.stage}|${g.slot}`;
    if (g.revealed && wasHidden.current === ident) flipAt.current = clock.elapsedTime;
    wasHidden.current = g.revealed ? '' : ident;
    const u = glass.uniforms;
    if (key !== lastKey.current) {
      lastKey.current = key;
      const c = GLASS[look];
      u.uBody.value.set(c.body);
      u.uRim.value.set(c.rim);
      u.uOpacity.value = g.revealed ? 0.8 : g.locked ? 0.45 : 0.62;
      u.uSize.value.set(width, PANEL_H);
      panel.current.scale.set(width + 2 * GLASS_PAD, PANEL_H + 2 * GLASS_PAD, 1);
      posts.current.children[0]!.position.x = -(width + 0.4) / 2;
      posts.current.children[1]!.position.x = (width + 0.4) / 2;
      orb.color.set(c.rim);
      orb.emissive.set(c.body);
      const lm = label.current.material as MeshBasicMaterial;
      lm.map = labelTexture(text, { outline: PALETTE.outline, stroke: 0.12 });
      lm.needsUpdate = true;
      marker.current.position.x = width / 2 - 0.35;
    }
    u.uTime.value = clock.elapsedTime;
    marker.current.visible = !!peek && !g.revealed;

    // Rig: in rig mode the gates you can rig pulse red; the one you rigged keeps a red frame
    // (it's their copy that's rigged, shown here so you know where your trap waits).
    const mine = feed.priv.myRig;
    const rigged = !!mine && mine.stage === lane.stage && mine.slot === g.slot;
    const target = useHud.getState().rigging && canRigSlot(feed, g.slot);
    u.uRig.value = rigged ? 0.95 : target ? 0.4 + 0.55 * Math.abs(Math.sin(clock.elapsedTime * 5)) : 0;

    // Flashes: reveal (white), crowd through (rim colour, or red if it shrank), gotcha (red + crack).
    const t = now();
    const since = flipAt.current < 0 ? Infinity : clock.elapsedTime - flipAt.current;
    const pass = hits.pass.get(g.slot);
    const passK = pass ? Math.max(0, 1 - (t - pass.at) / PASS_FLASH) : 0;
    const hitAt = hits.gotcha.get(ident);
    const gotK = hitAt === undefined ? 0 : Math.max(0, 1 - (t - hitAt) / GOTCHA_FLASH);
    const revealK = Math.max(0, 1 - since / 0.3);
    u.uCrack.value = hitAt === undefined ? 0 : Math.min(1, (t - hitAt) / 0.08);
    u.uFlashColor.value.copy(gotK > 0 || pass?.shrink ? TRAP_RED : RIM[look]);
    u.uFlash.value = Math.max(passK * 0.32, gotK * (0.6 + 0.4 * Math.sin(t * 40)), revealK);

    const k = Math.min(1, since / FLIP_TIME);
    const pop = 1 + 0.4 * Math.sin(k * Math.PI) + passK * passK * 0.08 + gotK * gotK * 0.12;
    face.current.scale.set(pop, pop, 1);
    face.current.rotation.z = gotK > 0 ? Math.sin(t * 55) * 0.05 * gotK : 0;
  });

  const onTap = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.delta > 8) return; // a drag, not a tap
    const lane = feed.me;
    const g = lane?.gates.find((x) => x.slot === slotRef.current);
    if (!lane || !g) return;
    const hud = useHud.getState();
    if (hud.rigging) {
      e.stopPropagation();
      if (canRigSlot(feed, g.slot)) {
        feed.source.rig(g.slot);
        hud.set({ rigging: false });
      }
      return;
    }
    if (g.revealed) return;
    if (hud.peeking && !lane.peekUsed) {
      e.stopPropagation();
      feed.source.peek(g.slot);
      hud.set({ peeking: false });
    }
  };

  return (
    <group ref={root} visible={false}>
      <group ref={posts}>
        {[-1, 1].map((s) => (
          <group key={s} position={[s * 2, 0, 0]}>
            <mesh position-y={0.12}>
              <cylinderGeometry args={[0.34, 0.4, 0.24, 14]} />
              <meshStandardMaterial color="#e9e4ff" roughness={0.35} />
            </mesh>
            <mesh position-y={1.45}>
              <capsuleGeometry args={[0.19, 2.5, 4, 12]} />
              <meshStandardMaterial color={PALETTE.post} roughness={0.28} />
            </mesh>
            <mesh position-y={3.05} material={orb} userData={{ noShadow: true }}>
              <sphereGeometry args={[0.3, 16, 12]} />
            </mesh>
          </group>
        ))}
      </group>
      <group position={[0, 1.6, 0]} rotation-x={TILT}>
        <group ref={face}>
          <mesh ref={panel} material={glass} onClick={onTap} renderOrder={5}>
            <planeGeometry args={[1, 1]} />
          </mesh>
          <mesh ref={label} position={[0, 0, 0.06]} renderOrder={6}>
            <planeGeometry args={[2.3, 2.3]} />
            <meshBasicMaterial transparent depthWrite={false} toneMapped={false} />
          </mesh>
          <mesh ref={marker} position={[1, PANEL_H / 2 - 0.35, 0.1]} renderOrder={7} visible={false}>
            <planeGeometry args={[0.9, 0.9]} />
            <meshBasicMaterial map={eyeBadge()} transparent depthWrite={false} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </group>
  );
}

let eye: CanvasTexture | null = null;

/** The "you peeked this" badge: a little white eye on a dark disc. */
function eyeBadge(): CanvasTexture {
  if (eye) return eye;
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = PALETTE.outline;
  g.beginPath();
  g.arc(48, 48, 44, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.ellipse(48, 48, 32, 20, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PALETTE.good;
  g.beginPath();
  g.arc(48, 48, 13, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = PALETTE.outline;
  g.beginPath();
  g.arc(48, 48, 6.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(43, 43, 3.5, 0, Math.PI * 2);
  g.fill();
  eye = new CanvasTexture(c);
  eye.colorSpace = SRGBColorSpace;
  return eye;
}
