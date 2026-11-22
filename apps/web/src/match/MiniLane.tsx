import { useEffect, useRef } from 'react';
import { LANE_LENGTH, LANE_WIDTH, type LaneView } from '@lil-dudes/client';
import { PALETTE, opLabel } from '../arena/layout';
import type { MatchFeed } from './feed';

/**
 * A small live map of the opponent's lane (TECH §5, v3): their stage, gates, crowd, waves, towers.
 * A 2D canvas, not a second WebGL scene. View only: you rig from your own lane (SPEC v4 §6); the
 * gate you rigged on their side gets a frame here once they reach that stage.
 */
export function MiniLane({ feed }: { feed: MatchFeed }) {
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const c = canvas.current;
      const lane = feed.them;
      if (!c || !lane) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawLane(ctx, w, h, lane, feed.priv.myRig?.stage === lane.stage ? feed.priv.myRig.slot : null);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [feed]);

  return (
    <canvas ref={canvas} className="mini-lane" />
  );
}

function drawLane(ctx: CanvasRenderingContext2D, w: number, h: number, lane: LaneView, rigSlot: number | null) {
  const sx = (x: number) => (x / LANE_WIDTH) * w;
  const sy = (y: number) => h - (y / LANE_LENGTH) * h;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = PALETTE.lane;
  ctx.fillRect(0, 0, w, h);
  // Faint tiles, like the big lane.
  ctx.fillStyle = PALETTE.laneTile;
  const tile = w / 6;
  ctx.globalAlpha = 0.6;
  for (let ty = 0; ty * tile < h; ty++) for (let tx = 0; tx < 6; tx++) if ((tx + ty) % 2) ctx.fillRect(tx * tile, h - (ty + 1) * tile, tile, tile);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.base;
  ctx.fillRect(0, 0, w, Math.max(4, h * 0.035));
  // Gates
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.max(9, Math.round(w / 9))}px "Lilita One", sans-serif`;
  for (const g of lane.gates) {
    const gw = Math.max(6, sx(g.width));
    const x = sx(g.x) - gw / 2;
    const y = sy(g.y) - 5;
    ctx.fillStyle = g.revealed ? (g.revealed.kind === 'div' ? PALETTE.bad : g.big ? PALETTE.gold : PALETTE.good) : g.big ? PALETTE.gold : PALETTE.unknown;
    ctx.beginPath();
    ctx.roundRect(x, y, gw, 10, 3);
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillText(g.revealed ? opLabel(g.revealed) : '?', sx(g.x), sy(g.y));
    if (rigSlot === g.slot) {
      ctx.strokeStyle = PALETTE.outline;
      ctx.lineWidth = 2;
      ctx.strokeRect(x - 2, y - 2, gw + 4, 14);
    }
  }
  // Crates
  ctx.fillStyle = PALETTE.crate;
  for (const c of lane.crates) if (c.hp > 0) ctx.fillRect(sx(c.x) - sx(c.width) / 2, sy(c.y) - 3, sx(c.width), 6);
  // Towers
  for (const t of lane.towers) {
    if (t.hp <= 0) continue;
    ctx.fillStyle = PALETTE.tower;
    ctx.beginPath();
    ctx.roundRect(sx(t.x) - 6, sy(t.y) - 6, 12, 12, 3);
    ctx.fill();
    ctx.strokeStyle = PALETTE.outline;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.fillRect(sx(t.x) - 6, sy(t.y) + 8, 12, 2);
    ctx.fillStyle = '#3c3';
    ctx.fillRect(sx(t.x) - 6, sy(t.y) + 8, (12 * t.hp) / Math.max(1, t.maxHp), 2);
  }
  // Crowds
  const dot = (x: number, y: number, n: number, color: string) => {
    ctx.fillStyle = color;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(sx(x), sy(y), Math.min(7, 1.5 + Math.sqrt(n) * 0.6), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  };
  for (const c of lane.cohorts) dot(c.x, c.y, c.count, PALETTE.me);
  for (const c of lane.enemies) dot(c.x, c.y, c.count, PALETTE.enemy);
  // Cannon
  ctx.fillStyle = PALETTE.enemy;
  ctx.fillRect(0, h - 9, w, 1.5);
  ctx.fillStyle = PALETTE.me;
  ctx.beginPath();
  ctx.roundRect(sx(lane.cannonX) - 6, h - 7, 12, 7, [3, 3, 0, 0]);
  ctx.fill();
  if (lane.phase === 'dead' || lane.phase === 'done') {
    ctx.fillStyle = '#1b1530aa';
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${Math.round(w / 5)}px "Lilita One", sans-serif`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = PALETTE.outline;
    ctx.strokeText(lane.phase === 'dead' ? 'DEAD' : 'DONE', w / 2, h / 2);
    ctx.fillStyle = lane.phase === 'dead' ? PALETTE.bad : PALETTE.gold;
    ctx.fillText(lane.phase === 'dead' ? 'DEAD' : 'DONE', w / 2, h / 2);
  }
}
