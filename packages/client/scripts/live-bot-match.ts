// Headless live match on devnet + the TEE, bot vs bot, end to end through LiveSource:
// create → join → delegate (base) → both LiveSources auto-drive permissions, salts + VRF seed,
// start (crank) → the WASM Warlord plays both sides through setAim / rig / peek → finish (commit
// + undelegate + Magic Action) → payout check → close → sweep. Burners have 0 SOL.
//   pnpm --filter @lil-dudes/client live [-- --stake 50000000]
// Funds come from the Solana CLI wallet (~/.config/solana/id.json; loaded to sign, never printed).
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, type Connection } from '@solana/web3.js';
import { Bot } from '@lil-dudes/sim-wasm';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baseConnection,
  chain,
  closeMatch,
  createMatch,
  delegateMatch,
  fetchMatch,
  initSim,
  isOnBase,
  joinMatch,
  LiveSource,
  phaseAt,
  settleMatch,
  type LiveStage,
  type MatchEvent,
} from '../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS = path.join(HERE, 'keys'); // gitignored (**/keys/)
const OUT = path.join(HERE, 'out');
fs.mkdirSync(KEYS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
};
const STAKE = Number(arg('stake', '50000000'));
const FUND = STAKE + 40_000_000; // stake + rent (~0.013, A) + fees

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);

function loadKey(file: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]));
}
function key(name: string): Keypair {
  const p = path.join(KEYS, `${name}.json`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  return loadKey(p);
}

async function transfer(base: Connection, from: Keypair, to: PublicKey, lamports: number) {
  const { send } = chain;
  return send(base, [SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports })], [from]);
}

/** Sends everything but the fee back (retried: base-layer confirmations sometimes time out). */
async function sweep(base: Connection, from: Keypair, to: PublicKey) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const left = await base.getBalance(from.publicKey, 'confirmed');
    if (left <= 5_000) return;
    try {
      await transfer(base, from, to, left - 5_000);
      return;
    } catch (e) {
      log(`sweep attempt ${attempt} failed`, String(e).split('\n')[0]);
      await sleep(2_000);
    }
  }
}

async function main() {
  initSim();
  const base = baseConnection();
  const funder = loadKey(path.join(os.homedir(), '.config/solana/id.json'));
  const wallets = [key('wallet-a'), key('wallet-b')];
  if (args.includes('--sweep-only')) {
    for (const w of wallets) await sweep(base, w, funder.publicKey);
    log('swept; funder balance', (await base.getBalance(funder.publicKey, 'confirmed')) / LAMPORTS_PER_SOL, 'SOL');
    return;
  }
  // Fresh 0-SOL burners each run: the TEE side must work without any SOL.
  const burners = [Keypair.generate(), Keypair.generate()];
  const startBalance = await base.getBalance(funder.publicKey, 'confirmed');
  log('funder balance', startBalance / LAMPORTS_PER_SOL, 'SOL; stake', STAKE / LAMPORTS_PER_SOL);
  for (const w of wallets) {
    const have = await base.getBalance(w.publicKey, 'confirmed');
    if (have < FUND) await transfer(base, funder, w.publicKey, FUND - have);
  }
  const result: Record<string, unknown> = { stake: STAKE, started: new Date().toISOString() };
  const timings: Record<string, number> = {};
  const lap = (k: string) => (timings[k] = Date.now() - t0);

  // 1. Base layer.
  const { id, signature: createSig } = await createMatch(base, wallets[0]!, { stake: STAKE, burner: burners[0]!.publicKey, name: 'Bot A' });
  lap('created');
  log('match', id.toString(), 'created', createSig);
  const joinSig = await joinMatch(base, wallets[1]!, { id, stake: STAKE, burner: burners[1]!.publicKey, name: 'Bot B' });
  lap('joined');
  const delegateSig = await delegateMatch(base, wallets[0]!, id);
  lap('delegated');
  log('joined', joinSig, 'delegated', delegateSig);
  result.match = { id: id.toString(), account: chain.matchAccounts(id).game.toBase58(), createSig, joinSig, delegateSig };
  // The wallets send nothing more until close, so balance changes from here on are the payout.
  const before = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey, 'confirmed')));

  // 2. Two live sources (one per side), each with the WASM Warlord deciding from the public state.
  const txs: Record<string, number> = {};
  const stages: string[] = [];
  const events = new Map<MatchEvent['type'], number>();
  const arrivals: number[] = [];
  const sources: LiveSource[] = [];
  for (const side of [0, 1] as const) {
    const src = await LiveSource.connect({
      matchId: id,
      burner: burners[side]!,
      onStage: (stage: LiveStage, detail?: string) => {
        const line = `side ${side}: ${stage}${detail ? ` (${detail})` : ''}`;
        stages.push(`${((Date.now() - t0) / 1000).toFixed(1)}s ${line}`);
        log(line);
      },
      onTx: (what) => (txs[what] = (txs[what] ?? 0) + 1),
    });
    sources.push(src);
  }
  lap('connected');
  const bots = [new Bot(0, 0xb0b0n ^ id), new Bot(1, 0xb1b1n ^ id)];
  let lastTick = -1;
  let lastAt = Date.now();
  for (const [side, src] of sources.entries()) {
    src.subscribe((view, _priv, evs) => {
      if (side === 0) {
        for (const e of evs) events.set(e.type, (events.get(e.type) ?? 0) + 1);
        if (view.tick !== lastTick && view.status !== 'waiting') {
          // The first frame's gap is the setup wait, not the feed.
          if (lastTick >= 0) arrivals.push(Date.now() - lastAt);
          lastAt = Date.now();
          lastTick = view.tick;
        }
      }
      if (view.status !== 'plant' && view.status !== 'playing') return;
      const [aim, rig, peek] = bots[side]!.decide(src.latestBytes);
      if (aim! >= 0) src.setAim(aim!);
      if (rig! >= 0) src.rig(rig!);
      if (peek! >= 0) src.peek(peek!);
    });
    src.start();
  }

  // 3. Play: progress every 10 s until both sources see the match finished.
  let lastLog = 0;
  let playStart = 0;
  for (;;) {
    const v = sources[0]!.view;
    if (v.status !== 'waiting' && !playStart) {
      playStart = Date.now();
      lap('playing');
    }
    if (Date.now() - lastLog > 10_000) {
      lastLog = Date.now();
      log(`tick ${v.tick} ${v.status} phase ${v.phase} hp ${v.sides[0].hp}:${v.sides[1].hp} cohorts ${v.sides[0].cohorts.length}:${v.sides[1].cohorts.length}`);
    }
    if (sources.every((s) => s.currentStage === 'finished')) break;
    if (sources.some((s) => s.currentStage === 'finished' || s.currentStage === 'finishing') && (await isOnBase(base, id))) break;
    if (Date.now() - t0 > 6 * 60_000) throw new Error('timeout: match did not finish in 6 min');
    await sleep(250);
  }
  lap('finished_on_tee');
  const finalAccount = await sources[0]!.awaitFinal(base);
  if (!finalAccount) throw new Error('no final Match (seed/history) after 60 s');
  const final = finalAccount;
  const r = final.state.result;
  log('result', r, 'hp', final.state.sides[0].hp, final.state.sides[1].hp, 'tick', final.state.tick);
  const reveal = sources[0]!.reveal();
  log('seed', reveal?.seed.toString(), 'phase-1 rigs', reveal?.history[0]?.rigs);
  const feed = sources.map((s) => ({ ...s.stats }));
  for (const s of sources) s.dispose();

  // 4. Settlement on base: the Magic Action should drain the vault within a few seconds.
  const a = chain.matchAccounts(id);
  let settledBy = 'action';
  const t1 = Date.now();
  for (;;) {
    const onBase = await isOnBase(base, id);
    const vault = await base.getBalance(a.vault, 'confirmed');
    if (onBase && (vault === 0 || STAKE === 0)) break;
    if (onBase && Date.now() - t1 > 25_000) {
      log('action did not pay in 25 s: fallback settle');
      await settleMatch(base, wallets[0]!, id);
      settledBy = 'fallback';
      break;
    }
    if (Date.now() - t1 > 90_000) throw new Error('match not back on base after 90 s');
    await sleep(500);
  }
  lap('settled');
  const m = await fetchMatch(base, id);
  const after = await Promise.all(wallets.map((w) => base.getBalance(w.publicKey, 'confirmed')));
  const deltas = after.map((x, i) => x - before[i]!);
  const expect = !r || r.winner === null ? [STAKE, STAKE] : r.winner === 0 ? [STAKE + r.moved - r.fee, STAKE - r.moved] : [STAKE - r.moved, STAKE + r.moved - r.fee];
  const payoutOk = settledBy === 'fallback' ? 'see fallback' : deltas[0] === expect[0] && deltas[1] === expect[1];
  log('payout deltas', deltas, 'expected', expect, payoutOk === true ? 'OK' : payoutOk);
  // Verify (MVP §3.8): the published seed + rigs re-derive every gate revealed on the final board.
  let checked = 0;
  let mismatches = 0;
  if (reveal) {
    const phase = phaseAt(Math.max(0, final.state.tick - 1));
    const deal = reveal.deals[phase]!;
    for (const side of [0, 1] as const) {
      final.state.sides[side].gates.forEach((g, cell) => {
        if (!g.revealed) return;
        const rigged = reveal.history[phase]!.rigs[side === 0 ? 1 : 0] === cell;
        const want = rigged ? { kind: 'div', value: 2 } : deal.ops[cell]!;
        checked++;
        if (want.kind !== g.revealed.kind || want.value !== g.revealed.value) mismatches++;
      });
      if (final.state.sides[side].gates.findIndex((g) => g.gold) !== deal.goldCell) mismatches++;
    }
  }
  const verified = !!reveal && mismatches === 0;
  log('verify', verified ? 'OK' : 'FAILED', `${checked} revealed gates checked, ${mismatches} mismatches`);

  // 5. Close + sweep back.
  await closeMatch(base, wallets[0]!, id).catch((e) => log('close failed', String(e).split('\n')[0]));
  for (const w of wallets) await sweep(base, w, funder.publicKey);
  const endBalance = await base.getBalance(funder.publicKey, 'confirmed');
  lap('done');

  const s = [...arrivals].sort((x, y) => x - y);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  Object.assign(result, {
    result: r,
    finalTick: final.state.tick,
    hp: [final.state.sides[0].hp, final.state.sides[1].hp],
    settledBy,
    payoutDeltas: deltas,
    payoutExpected: expect,
    payoutOk,
    seed: reveal?.seed.toString(),
    history: reveal?.history,
    verify: { ok: verified, revealedGatesChecked: checked, mismatches },
    status: m?.header.status,
    txs,
    events: Object.fromEntries(events),
    renderedFrames: arrivals.length,
    feed,
    frameGapMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: s[s.length - 1] },
    stages,
    timingsMs: timings,
    sol: { before: startBalance / LAMPORTS_PER_SOL, after: endBalance / LAMPORTS_PER_SOL, spent: (startBalance - endBalance) / LAMPORTS_PER_SOL },
  });
  const file = path.join(OUT, `live-${id}.json`);
  fs.writeFileSync(file, JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  log('→', path.relative(process.cwd(), file));
  log('SOL spent', (startBalance - endBalance) / LAMPORTS_PER_SOL);
  process.exit(payoutOk === false || !verified ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
