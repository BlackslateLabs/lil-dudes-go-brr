// Headless smoke run: one full match through OfflineSource on its own timer. A scripted player on
// side 0, the Warlord bot on side 1. Exits non-zero if the match doesn't end cleanly.
//   pnpm --filter @lil-dudes/client smoke [-- --speed 10 --seed 123]   (speed 1 = real time, 2:00)
import { COL_WIDTH, COLS, MATCH_TICKS, OfflineSource, TICKS_PER_SEC } from '../src/index';
import type { MatchView } from '../src/index';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const speed = Number(arg('speed', '10'));
const seed = BigInt(arg('seed', '20261127'));
const clock = (tick: number) => {
  const s = Math.floor(tick / TICKS_PER_SEC);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const src = new OfflineSource({ seed, botSeed: seed ^ 0xb07n, stake: 100_000_000, speed, myName: 'Smoke' });
const counts: Record<string, number> = {};
const started = Date.now();
let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.error(`  ✗ ${msg}`);
};

/** The scripted player: go for its best revealed column, else the column with the most blue hints. */
function bestColumn(view: MatchView): number {
  const gates = view.sides[0].gates;
  let best = 1;
  let bestScore = -Infinity;
  for (let col = 0; col < COLS; col++) {
    let score = 0;
    for (let row = 0; row < 3; row++) {
      const g = gates[row * COLS + col]!;
      if (g.revealed) score += g.revealed.kind === 'mul' || g.revealed.kind === 'add' ? 3 : -3;
      else score += g.hint === 'good' || g.hint === 'gold' ? 1 : g.hint === 'bad' ? -1 : 0;
    }
    if (score > bestScore) [best, bestScore] = [col, score];
  }
  return best;
}

console.log(`smoke: OfflineSource seed ${seed}, speed ×${speed}`);
src.subscribe((view, priv, events) => {
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    const at = clock(view.tick);
    if (e.type === 'plant') console.log(`  ${at} plant ${e.phase + 1}`);
    if (e.type === 'surge') console.log(`  ${at} SURGE`);
    if (e.type === 'gotcha') console.log(`  ${at} GOTCHA on side ${e.side} (cell ${e.cell})`);
  }
  if (view.tick % TICKS_PER_SEC === 0) src.setAim(bestColumn(view) * COL_WIDTH + COL_WIDTH / 2);
  if (view.status === 'plant' && !view.sides[0].rigUsed) src.rig(view.tick % 9);
  if (view.status === 'playing' && !view.sides[0].peekUsed) {
    const cell = view.sides[0].gates.find((g) => !g.revealed)?.cell;
    if (cell !== undefined) src.peek(cell);
  }
  if (view.tick % (20 * TICKS_PER_SEC) === 0 && view.tick > 0) {
    const [a, b] = view.sides;
    console.log(`  ${clock(view.tick)} HP ${a.hp} vs ${b.hp}, cohorts ${a.cohorts.length} vs ${b.cohorts.length}, rig ${priv.myRig ?? '-'}, peek ${priv.myPeek ? `${priv.myPeek.cell}=${priv.myPeek.op.kind}${priv.myPeek.op.value}` : '-'}`);
  }
  if (!view.result) return;

  const r = view.result;
  const secs = (Date.now() - started) / 1000;
  console.log(`  ${clock(view.tick)} END: ${r.winner === null ? 'draw' : `side ${r.winner} wins`}${r.ko ? ' by KO' : ' on the timer'}, HP ${view.sides[0].hp} vs ${view.sides[1].hp}, moved ${r.moved} lamports, fee ${r.fee}`);
  console.log(`  events: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  ${view.tick} ticks in ${secs.toFixed(1)} s (${(view.tick / secs).toFixed(0)} ticks/s, target ${TICKS_PER_SEC * speed})`);
  if (counts.end !== 1) fail(`expected one end event, got ${counts.end}`);
  if (view.tick > MATCH_TICKS) fail(`ran past the timer: ${view.tick}`);
  if (r.ko !== view.sides.some((s) => s.hp === 0)) fail('KO flag disagrees with HP');
  if (!view.tick || !(counts.volley && counts.clash && counts.reveal)) fail('missing core events');
  setTimeout(() => {
    if (src.view.tick !== view.tick) fail('kept ticking after the end');
    console.log(problems ? `smoke: FAILED (${problems})` : 'smoke: OK');
    src.dispose();
    process.exit(problems ? 1 : 0);
  }, 100);
});
src.start();
setTimeout(() => {
  console.error('smoke: FAILED (match did not end in time)');
  process.exit(1);
}, (MATCH_TICKS / TICKS_PER_SEC / speed) * 3000 + 5000);
