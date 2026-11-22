import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sprite, SpriteMaterial, Vector3 } from 'three';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { PALETTE, opLabel, wx, wz } from './layout';

const POOL = 16;
const POP_LIFE = 0.7; // s
const SHAKE_GAP = 0.5; // s: shake is rate-limited (TECH §5)

interface Pop {
  sprite: Sprite;
  born: number;
  x: number;
  z: number;
}

/** Reveal pops over gates in your lane, and rate-limited shake on tower hits / tower down / death. */
export function Fx({ feed, camBase }: { feed: MatchFeed; camBase: Vector3 }) {
  const pops = useRef<Pop[]>([]);
  const free = useRef<Sprite[]>([]);
  const sprites = useRef<Sprite[]>([]);
  const shake = useRef(0);
  const lastShake = useRef(-10);
  const clock = useRef(0);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    free.current = sprites.current.filter(Boolean);
    const kick = (amount: number, force = false) => {
      if (!force && clock.current - lastShake.current < SHAKE_GAP) return;
      lastShake.current = clock.current;
      shake.current = Math.min(1.4, shake.current + amount);
    };
    return feed.onEvent((e, view) => {
      if ('side' in e && e.side !== feed.mySide) return; // only my lane shakes and pops
      if (e.type === 'reveal') {
        const g = view.sides[feed.mySide].gates.find((x) => x.slot === e.slot);
        const s = free.current.pop();
        if (!g || !s) return;
        const bad = e.op.kind === 'div';
        (s.material as SpriteMaterial).map = labelTexture(opLabel(e.op), {
          color: '#ffffff',
          outline: bad ? PALETTE.bad : g.big ? PALETTE.gold : PALETTE.good,
          width: 256,
          height: 128,
        });
        s.visible = true;
        pops.current.push({ sprite: s, born: clock.current, x: wx(g.x), z: wz(g.y) });
      } else if (e.type === 'towerHit') {
        kick(0.15);
      } else if (e.type === 'towerDown') {
        kick(0.7, true);
      } else if (e.type === 'death') {
        kick(1.4, true);
      }
    });
  }, [feed]);

  useFrame((_, dt) => {
    clock.current += dt;
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

  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <sprite key={i} ref={(el) => void (sprites.current[i] = el!)} visible={false} renderOrder={20}>
          <spriteMaterial transparent depthTest={false} />
        </sprite>
      ))}
    </>
  );
}
