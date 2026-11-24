import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Color, Sprite, SpriteMaterial, Vector3 } from 'three';
import { VAULT_Y } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { GLASS, PALETTE, SX, opLabel, wx, wz } from './layout';
import { Particles, burst, pop } from './particles';
import { PopFlag, PopKind, hallPulse, pops as popQ, towerPulse } from './popQueue';

const POOL = 16;
const POP_LIFE = 0.7; // s
const SHAKE_GAP = 0.5; // s: shake is rate-limited (TECH §5)
/** Gate panel centre height (Gates.tsx). */
const GATE_Y = 1.6;
/**
 * Crowd pop budget per frame: up to POP_FULL pops each get a burst; past that one burst stands for
 * 3 (or, past POP_HEAVY, 5) pops, and never more than POP_MAX bursts a frame (~4 particles each).
 */
const POP_FULL = 18;
const POP_HEAVY = 60;
const POP_MAX = 30;
/** Pop / burst counters, for `?crowdprof=1` (read from devtools as `__fx`). */
const stats = { pops: 0, bursts: 0 };
if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('crowdprof')) {
  (window as unknown as { __fx: typeof stats }).__fx = stats;
}
/** A wave of pops at a building pulses it at most this often (s). */
const PULSE_GAP = 0.16;

interface Pop {
  sprite: Sprite;
  born: number;
  x: number;
  z: number;
}

const COLOR = {
  good: new Color(GLASS.good.rim),
  gold: new Color(GLASS.gold.rim),
  bad: new Color(GLASS.bad.rim),
  tower: new Color(PALETTE.tower),
  crate: new Color(PALETTE.crate),
  dust: new Color('#fff4e2'),
  me: new Color(PALETTE.me),
  enemy: new Color(PALETTE.enemy),
};

/**
 * Effects in your lane: reveal pops, particle bursts (gate multiply, tower hits and collapses,
 * crate smashes, coins, clashes, muzzle puffs, crowd and giant pops) and rate-limited camera shake.
 * Purely cosmetic: everything here reacts to match events, nothing feeds back into the match.
 */
export function Fx({ feed, camBase }: { feed: MatchFeed; camBase: Vector3 }) {
  const pops = useRef<Pop[]>([]);
  const free = useRef<Sprite[]>([]);
  const sprites = useRef<Sprite[]>([]);
  const shake = useRef(0);
  const lastShake = useRef(-10);
  const clock = useRef(0);
  const camera = useThree((s) => s.camera);
  const px = useMemo(() => new Particles(), []);
  useEffect(() => () => px.dispose(), [px]);
  // Pops per building since its last pulse, and when that was (towers 0..3, hall 4).
  const pulse = useMemo(() => ({ n: new Float32Array(5), at: new Float32Array(5).fill(-10) }), []);
  useEffect(() => {
    popQ.clear();
    return () => popQ.clear();
  }, []);

  const kick = (amount: number, force = false) => {
    if (!force && clock.current - lastShake.current < SHAKE_GAP) return;
    lastShake.current = clock.current;
    shake.current = Math.min(1.4, shake.current + amount);
  };

  useEffect(() => {
    free.current = sprites.current.filter(Boolean);
    // Per-key rate limit for frequent events (a gate passes many crowds, towers take many hits).
    const last = new Map<string, number>();
    const every = (key: string, gap: number) => {
      const t = last.get(key) ?? -10;
      if (clock.current - t < gap) return false;
      last.set(key, clock.current);
      return true;
    };
    return feed.onEvent((e, view) => {
      if ('side' in e && e.side !== feed.mySide) return; // only my lane shakes and pops
      const lane = view.sides[feed.mySide];
      if (e.type === 'reveal') {
        const g = lane.gates.find((x) => x.slot === e.slot);
        if (!g) return;
        const bad = e.op.kind === 'div' || e.op.kind === 'sub';
        burst.reveal(px, wx(g.x), GATE_Y, wz(g.y), bad ? COLOR.bad : g.big ? COLOR.gold : COLOR.good);
        const s = free.current.pop();
        if (!s) return;
        (s.material as SpriteMaterial).map = labelTexture(opLabel(e.op), {
          color: '#ffffff',
          outline: bad ? PALETTE.bad : g.big ? PALETTE.goldDark : PALETTE.good,
          width: 256,
          height: 128,
        });
        (s.material as SpriteMaterial).needsUpdate = true;
        s.visible = true;
        pops.current.push({ sprite: s, born: clock.current, x: wx(g.x), z: wz(g.y) });
      } else if (e.type === 'gate') {
        const g = lane.gates.find((x) => x.slot === e.slot);
        if (!g || !every(`g${e.slot}`, 0.4)) return;
        if (e.after < e.before) burst.shrink(px, wx(g.x), GATE_Y, wz(g.y));
        else if (e.after > e.before) burst.multiply(px, wx(g.x), GATE_Y, wz(g.y), g.big ? COLOR.gold : COLOR.good, e.after / Math.max(1, e.before), g.width * SX);
      } else if (e.type === 'towerHit') {
        const t = lane.towers.find((x) => x.index === e.tower);
        if (t && every(`t${e.tower}`, 0.12)) burst.hit(px, wx(t.x), 2.6, wz(t.y), COLOR.dust);
        kick(0.15);
      } else if (e.type === 'towerDown') {
        const t = lane.towers.find((x) => x.index === e.tower);
        if (t) burst.collapse(px, wx(t.x), wz(t.y), COLOR.tower, Math.min(16, 6 + Math.round(e.gold / 25)));
        kick(0.7, true);
      } else if (e.type === 'crate') {
        const c = lane.crates.find((x) => x.index === e.index);
        if (!c) return;
        if (e.broken) {
          burst.smash(px, wx(c.x), wz(c.y), c.width * SX, COLOR.crate);
          kick(0.35);
        } else if (every(`c${e.index}`, 0.07)) burst.chip(px, wx(c.x), 1.2, wz(c.y), c.width * SX);
      } else if (e.type === 'loot') {
        if (every('loot', 0.1)) burst.coins(px, (Math.random() - 0.5) * 4, 2.2, wz(VAULT_Y) + 0.4, Math.min(5, 1 + e.count));
      } else if (e.type === 'clash') {
        if (every(`k${Math.round(e.x / 300)}|${Math.round(e.y / 300)}`, 0.12)) burst.poof(px, wx(e.x), wz(e.y));
      } else if (e.type === 'volley') {
        burst.muzzle(px, wx(e.x), 3, wz(0) - 0.4);
      } else if (e.type === 'death') {
        burst.overrun(px, wx(lane.cannonX), wz(0) - 0.6);
        kick(1.4, true);
      }
    });
  }, [feed, px]);

  useFrame((_, dt) => {
    clock.current += dt;
    drainPops();
    px.update(Math.min(dt, 0.05));
    for (let i = pops.current.length - 1; i >= 0; i--) {
      const p = pops.current[i]!;
      const age = clock.current - p.born;
      if (age >= POP_LIFE) {
        p.sprite.visible = false;
        free.current.push(p.sprite);
        pops.current.splice(i, 1);
        continue;
      }
      const k = age / POP_LIFE;
      const grow = k < 0.15 ? 0.6 + (k / 0.15) * 0.8 : 1.4 - (k - 0.15) * 0.4;
      p.sprite.position.set(p.x, 4.5 + k * 2.5, p.z);
      p.sprite.scale.set(5 * grow, 2.5 * grow, 1);
      (p.sprite.material as SpriteMaterial).opacity = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
    }
    shake.current *= Math.exp(-dt * 8);
    const a = shake.current;
    const t = clock.current * 60;
    camera.position.set(
      camBase.x + Math.sin(t * 1.3) * a * 0.6,
      camBase.y + Math.sin(t * 1.7 + 1) * a * 0.4,
      camBase.z + Math.cos(t * 1.1) * a * 0.3,
    );
  });

  /**
   * Crowd pops → bursts (budgeted, aggregated), and a hit pulse for the building a wave hits.
   * Only my lane's crowds exist, so every pop is in my lane. A giant always gets its own big burst
   * (outside the budget: there are few), and the last giant of a cohort shakes the camera.
   */
  function drainPops() {
    const n = popQ.length;
    if (n === 0) return;
    stats.pops += n;
    const stride = n <= POP_FULL ? 1 : n <= POP_HEAVY ? 3 : 5;
    let skip = 0;
    let made = 0;
    while (popQ.length > 0) {
      const i = popQ.peek();
      const kind = popQ.kind[i]!;
      const x = wx(popQ.x[i]!);
      const z = wz(popQ.y[i]!);
      const team = popQ.team[i]!;
      const ix = popQ.ix[i]!;
      const flags = popQ.flags[i]!;
      popQ.shift();
      const b = kind === PopKind.Tower && ix >= 0 && ix < 4 ? ix : kind === PopKind.Hall ? 4 : -1;
      if (b >= 0) pulse.n[b]! += flags & PopFlag.Giant ? 6 : 1;
      if (kind === PopKind.None) continue;
      if (flags & PopFlag.Giant) {
        pop.giant(px, x, z, team, (flags & PopFlag.Last) !== 0);
        if (flags & PopFlag.Last) kick(0.5, true);
        else kick(0.12);
        continue;
      }
      if (++skip < stride) continue;
      skip = 0;
      if (made >= POP_MAX) continue;
      made++;
      stats.bursts++;
      if (kind === PopKind.Tower || kind === PopKind.Hall) pop.tower(px, x, z, stride, kind === PopKind.Hall);
      else if (kind === PopKind.Clash) pop.clash(px, x, z, stride, team ? COLOR.enemy : COLOR.me);
      else if (kind === PopKind.Crate) pop.crate(px, x, z, stride);
      else pop.dust(px, x, z, stride);
    }
    for (let b = 0; b < 5; b++) {
      const c = pulse.n[b]!;
      if (c <= 0 || clock.current - pulse.at[b]! < PULSE_GAP) continue;
      const amt = Math.min(1, 0.35 + c * 0.05);
      if (b < 4) towerPulse[b] = Math.max(towerPulse[b]!, amt);
      else hallPulse[0] = Math.max(hallPulse[0]!, amt);
      pulse.n[b] = 0;
      pulse.at[b] = clock.current;
    }
  }

  return (
    <>
      <primitive object={px.solid.mesh} />
      <primitive object={px.glow.mesh} />
      {Array.from({ length: POOL }, (_, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el!)} visible={false} renderOrder={40}>
          <spriteMaterial transparent depthTest={false} toneMapped={false} />
        </sprite>
      ))}
    </>
  );
}
