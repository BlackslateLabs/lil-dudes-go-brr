import { LANE_LENGTH, LANE_WIDTH, TOWER_HALF_W, TOWER_Y, stageDef } from '@lil-dudes/client';
import { wallsOf, WALL_HALF } from '../arena/columns';
import { obstacleCorners, obstaclesOf, padsOf, pipesOf } from '../arena/levelDefs';

/** Lane margin around the drawing (sim units). */
const PAD = 160;
const GATE_H = 380;

/**
 * A small top-down map of a level's first stage (the VS screen): the lane, walls, obstacles, speed
 * pads, pipes, crates, gate slots as `?` and the towers, your cannon at the bottom. Drawn in sim
 * units (y up the lane, flipped for the screen); both players get this exact lane.
 */
export function LanePreview({ layout, className }: { layout: number; className?: string }) {
  const st = stageDef(layout, 0);
  const Y = (y: number) => LANE_LENGTH - y;
  const box = (x0: number, y0: number, x1: number, y1: number) => ({ x: x0, y: Y(y1), width: x1 - x0, height: y1 - y0 });
  return (
    <svg
      className={className}
      viewBox={`${-PAD} ${-PAD} ${LANE_WIDTH + 2 * PAD} ${LANE_LENGTH + 2 * PAD}`}
      role="img"
      aria-label="The level's first stage, seen from above"
    >
      <rect x={-PAD} y={-PAD} width={LANE_WIDTH + 2 * PAD} height={LANE_LENGTH + 2 * PAD} rx={260} className="lp-grass" />
      <rect x={0} y={0} width={LANE_WIDTH} height={LANE_LENGTH} rx={120} className="lp-lane" />
      {padsOf(layout, 0).map((p, i) => (
        <rect key={`p${i}`} {...box(p.x0, p.y0, p.x1, p.y1)} rx={60} className="lp-pad" />
      ))}
      {pipesOf(layout, 0).map((p, i) => (
        <g key={`q${i}`}>
          <rect {...box(p.x0, p.y0, p.x1, p.y1)} rx={120} className="lp-pipe" />
          <circle cx={p.outX} cy={Y(p.outY)} r={170} className="lp-pipe" />
        </g>
      ))}
      {obstaclesOf(layout, 0).map((o, i) => (
        <polygon key={`o${i}`} points={obstacleCorners(o).map(([x, y]) => `${x},${Y(y)}`).join(' ')} className="lp-block" />
      ))}
      {wallsOf(layout, 0).map((w, i) => (
        <rect key={`w${i}`} {...box(w.x - WALL_HALF * 1.6, w.y0, w.x + WALL_HALF * 1.6, w.y1)} rx={60} className="lp-block" />
      ))}
      {st.crates.map((c, i) => (
        <rect key={`c${i}`} {...box(c.x - c.width / 2, c.y - 150, c.x + c.width / 2, c.y + 150)} rx={50} className="lp-crate" />
      ))}
      {st.gates.map((g, i) => {
        const y = st.rows[g.row] ?? 0;
        const w = Math.max(300, g.width - 120);
        return (
          <g key={`g${i}`}>
            <rect {...box(g.x - w / 2, y - GATE_H / 2, g.x + w / 2, y + GATE_H / 2)} rx={110} className={g.big ? 'lp-gate big' : 'lp-gate'} />
            <text x={g.x} y={Y(y) + 190} className="lp-q">
              ?
            </text>
          </g>
        );
      })}
      {st.towers.map((t, i) => (
        <rect key={`t${i}`} {...box(t.x - TOWER_HALF_W, TOWER_Y - TOWER_HALF_W, t.x + TOWER_HALF_W, TOWER_Y + TOWER_HALF_W)} rx={140} className="lp-tower" />
      ))}
      <circle cx={LANE_WIDTH / 2} cy={Y(0) - 80} r={260} className="lp-cannon" />
    </svg>
  );
}
