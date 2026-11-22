import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Sprite, SpriteMaterial, Vector3 } from 'three';
import { COLS, ROW_Y } from '@lil-dudes/client';
import type { MatchFeed } from '../match/feed';
import { labelTexture } from './labelTexture';
import { PALETTE, colCenter, isGoodOp, opLabel, wx, wz } from './layout';

const POOL = 16;
const POP_LIFE = 0.7; // s
const SHAKE_GAP = 0.5; // s: shake is rate-limited (TECH §5)

interface Pop {
  sprite: Sprite;
  born: number;
  x: number;
  z: number;
}

/** Reveal pops over gates, and rate-limited camera shake on hits to your cannon and on KO. */
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
    return feed.onEvent((e) => {
      if (e.type === 'reveal') {
        const s = free.current.pop();
        if (!s) return;
        const row = Math.floor(e.cell / COLS);
        const col = e.cell % COLS;
        const good = e.gold ? e.op.kind === 'mul' : isGoodOp(e.op);
        (s.material as SpriteMaterial).map = labelTexture(opLabel(e.op), {
          color: '#ffffff',
          outline: e.gold ? PALETTE.gold : good ? PALETTE.good : PALETTE.bad,
          width: 256,
          height: 128,
        });
        s.visible = true;
        pops.current.push({
          sprite: s,
          born: clock.current,
          x: wx(colCenter(col), feed.mySide),
          z: wz(e.side, ROW_Y[row] ?? 0, feed.mySide),
        });
      } else if (e.type === 'hit' && e.side === feed.mySide) {
        if (clock.current - lastShake.current >= SHAKE_GAP) {
          lastShake.current = clock.current;
          shake.current = Math.min(0.8, shake.current + 0.35);
        }
      } else if (e.type === 'end' && e.result.ko) {
        shake.current = 1.4;
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
