// A "fresh phone" against apps/server end to end on devnet: a new 0-SOL burner gets topped up by
// the faucet, queues for a FREE Quick Match, gets the server's bot after ~5 s alone, joins, and
// plays it through LiveSource (the WASM Warlord stands in for the human's thumbs). Checks the
// reveal + settlement, then sends what is left back to the sponsor.
//   pnpm --filter server start   (with the sponsor key in apps/server/.env)
//   pnpm --filter @lil-dudes/client exec tsx scripts/vs-server-bot.ts [--server http://localhost:8787]
import { Bot } from '@lil-dudes/sim-wasm';
import { Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import { askBot, baseConnection, chain, initSim, joinMatch, joinQueue, LiveSource, pollQueue, topUp, waitForStatus } from '../src/index';

const args = process.argv.slice(2);
const server = args[args.indexOf('--server') + 1] && args.includes('--server') ? args[args.indexOf('--server') + 1]! : 'http://localhost:8787';
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

async function main() {
  initSim();
  const base = baseConnection();
  const me = Keypair.generate();
  const lap: Record<string, number> = {};
  const top = await topUp(server, me.publicKey, 0);
  lap.toppedUp = Date.now() - t0;
  log('topped up', top.sent, 'lamports', top.signature?.slice(0, 12));
  // Since 25 Nov the bot joins only when asked ("Play the Bot instead" in the queue).
  let t = await joinQueue(server, me.publicKey, 0);
  await new Promise((r) => setTimeout(r, 1_000));
  if (t.state !== 'matched') t = await askBot(server, t.ticket);
  for (let i = 0; t.state !== 'matched' && i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    t = await pollQueue(server, t.ticket);
  }
  if (!t.match) throw new Error('no match from the queue');
  const q = t.match;
  lap.matched = Date.now() - t0;
  log('matched', q.bot ? 'with the server bot' : `with ${q.opponent}`, 'role', q.role, 'id', q.id.toString());
  if (!q.bot || q.role !== 'join') throw new Error('expected the server bot (role join)');
  await waitForStatus(base, q.id, chain.Status.OPEN, 60_000);
  await joinMatch(base, me, { id: q.id, stake: 0, burner: me.publicKey, name: 'Fresh Phone' });
  lap.joined = Date.now() - t0;
  const src = await LiveSource.connect({ matchId: q.id, burner: me, onStage: (s, d) => log('stage', s, d ?? '') });
  lap.connected = Date.now() - t0;
  const brain = new Bot(1, 0x5eedn ^ q.id);
  let playing = 0;
  src.subscribe((view) => {
    if (view.status !== 'playing') return;
    if (!playing) playing = Date.now() - t0;
    const [aim, peek, champion, trigger] = brain.decide(src.latestBytes);
    if (aim! >= 0) src.setAim(aim!);
    if (peek! >= 0) src.peek(peek!);
    if (champion === 1) src.champion();
    if (trigger! >= 0) src.setFiring(trigger === 1);
  });
  src.start();
  while (src.currentStage !== 'finished') {
    if (Date.now() - t0 > 6 * 60_000) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 500));
  }
  const r = await src.awaitReveal(90_000);
  src.dispose();
  lap.playing = playing;
  lap.settled = Date.now() - t0;
  log('result:', r?.payout?.why, '| settlement', r?.settlement, '| stake', r?.payout?.stake);
  if (r?.payout?.stake !== 0) throw new Error('a bot match must be free');
  // Give what is left back to the sponsor.
  const info = (await (await fetch(`${server}/faucet`)).json()) as { address?: string };
  const left = await base.getBalance(me.publicKey, 'confirmed');
  if (info.address && left > 5_000) {
    await chain.send(base, [SystemProgram.transfer({ fromPubkey: me.publicKey, toPubkey: new PublicKey(info.address), lamports: left - 5_000 })], [me]);
  }
  log('timings ms', JSON.stringify(lap), '| burner spent', top.sent - (left - 5_000), 'lamports');
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
