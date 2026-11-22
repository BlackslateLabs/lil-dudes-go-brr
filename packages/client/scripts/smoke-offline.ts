// Headless smoke run: one full v3 match through OfflineSource on its own timer. A scripted player
// on side 0 (defends, follows the best revealed gates, rigs and peeks every stage), the Warlord
// bot on side 1. Exits non-zero if the match doesn't end cleanly.
//   pnpm --filter @lil-dudes/client smoke [-- --speed 20 --seed 123 --selfbot]   (speed 1 = real time)
import { DEFEND_Y, LANE_WIDTH, MATCH_TICKS, OfflineSource, TICKS_PER_SEC } from '../src/index';
import type { LaneView, MatchView } from '../src/index';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const speed = Number(arg('speed', '20'));
const seed = BigInt(arg('seed', '20261127'));
const selfBot = args.includes('--selfbot');
const clock = (tick: number) => {
  const s = Math.floor(tick / TICKS_PER_SEC);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const src = new OfflineSource({ seed, botSeed: seed ^ 0xb07n, stake: 100_000_000, speed, myName: 'Smoke', selfBot });
const counts: Record<string, number> = {};
const started = Date.now();
let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.error(`  ✗ ${msg}`);
};

/** The scripted player's aim: the lowest enemy if one is close, else the gate with the best
 *  revealed value (unlocked), else the lane's middle. */
function aimFor(me: LaneView): number {
  const close = me.enemies.filter((e) => e.y < DEFEND_Y).sort((a, b) => a.y - b.y)[0];
  if (close) return close.x;
  const best = me.gates
    .filter((g) => !g.locked && g.revealed?.kind === 'mul')
    .sort((a, b) => b.revealed!.value - a.revealed!.value || a.y - b.y)[0];
  return best?.x ?? LANE_WIDTH / 2;
}

console.log(`smoke: OfflineSource seed ${seed}, speed ×${speed}${selfBot ? ', bot vs bot' : ''}`);
src.subscribe((view: MatchView, priv, events) => {
  const at = clock(view.tick);
  for (const e of events) {
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    if (e.type === 'stage') console.log(`  ${at} side ${e.side}: stage ${e.stage + 1} ${e.phase}`);
    if (e.type === 'gotcha') console.log(`  ${at} GOTCHA in side ${e.side}'s lane (stage ${e.stage + 1}, slot ${e.slot})`);
    if (e.type === 'death') console.log(`  ${at} side ${e.side} DIED`);
  }
  const [me, them] = view.sides;
  if (!selfBot) {
    src.setAim(aimFor(me));
    if (me.phase === 'plant' && !me.rigUsed) {
      const slot = them.gates.find((g) => !g.revealed)?.slot;
      if (slot !== undefined) src.rig(slot);
    }
    if ((me.phase === 'fight' || me.phase === 'raid') && !me.peekUsed) {
      const slot = me.gates.find((g) => !g.revealed && !g.locked)?.slot;
      if (slot !== undefined) src.peek(slot);
    }
  }
  if (view.tick % (10 * TICKS_PER_SEC) === 0 && view.tick > 0) {
    const lane = (s: LaneView) => `${s.phase} ${s.stage + 1}, gold ${s.gold}, dudes ${s.cohorts.reduce((n, c) => n + c.count, 0)}, foes ${s.enemies.reduce((n, c) => n + c.count, 0)}`;
    const rig = priv.myRig ? `stage ${priv.myRig.stage + 1} slot ${priv.myRig.slot}` : '-';
    const peek = priv.myPeek ? `slot ${priv.myPeek.slot} = ${priv.myPeek.op.kind === 'mul' ? '×' : '÷'}${priv.myPeek.op.value}` : '-';
    console.log(`  ${at} [${lane(me)}] vs [${lane(them)}], my rig ${rig}, peek ${peek}`);
  }
  if (!view.result) return;

  const r = view.result;
  const secs = (Date.now() - started) / 1000;
  const reveal = src.reveal();
  console.log(`  ${at} END on ${view.layoutName}: ${reveal.payout!.why}`);
  console.log(`  gold ${r.gold[0]} vs ${r.gold[1]} (raid ${me.raidGold} vs ${them.raidGold}), moved ${r.moved} lamports, fee ${r.fee}`);
  console.log(`  events: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(`  ${view.tick} ticks in ${secs.toFixed(1)} s (${(view.tick / secs).toFixed(0)} ticks/s, target ${TICKS_PER_SEC * speed})`);
  if (counts.end !== 1) fail(`expected one end event, got ${counts.end}`);
  if (view.tick > MATCH_TICKS) fail(`ran past the time cap: ${view.tick}`);
  if (r.gold[0] !== me.gold || r.gold[1] !== them.gold) fail('result gold disagrees with the lanes');
  const dead = view.sides.map((s) => s.phase === 'dead');
  if (r.died !== (dead[0] !== dead[1] ? (dead[0] ? 0 : 1) : null)) fail('died disagrees with the lanes');
  if (reveal.payout!.moved !== r.moved || reveal.payout!.fee !== r.fee) fail('payoutOf disagrees with the sim');
  if (!view.tick || !(counts.volley && counts.wave && counts.stage && counts.reveal)) fail('missing core events');
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
