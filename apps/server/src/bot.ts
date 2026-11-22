// The online bot (MVP §3.5 "Play the bot while you wait"): when Quick Match finds nobody on the
// FREE tier within ~5 s, the server's own player takes the seat. It is an ordinary player of the
// on-chain match: its own burner (funded by the sponsor), a server-side LiveSource, and the same
// WASM Warlord as offline, deciding from the public state only (it never sees anything a human
// opponent could not). It only ever creates stake-0 matches, so the matched stake is always 0.
//
// Flow: create (bot pays the rent, back at close) → the human joins → the bot delegates → both
// LiveSources auto-drive the TEE → finish → settle (free: nothing to pay) → the bot closes it.
// If the human never joins, the bot cancels; if they join but never connect, LiveSource aborts.
import {
  baseConnection,
  cancelMatch,
  chain,
  closeMatch,
  createMatch,
  delegateMatch,
  fetchMatch,
  initSim,
  LiveSource,
  waitForStatus,
} from '@lil-dudes/client';
import { Bot } from '@lil-dudes/sim-wasm';
import { Keypair, type Connection } from '@solana/web3.js';
import type { Faucet } from './faucet';

export interface BotService {
  /** The bot's wallet (= its burner): the opponent address the human sees. */
  readonly address: string;
  /** Can it take another match now (under the concurrency cap)? */
  available(): boolean;
  /** Creates match `id` (free) and plays it against `opponent`. Never throws (logs instead). */
  play(id: bigint, opponent: string): void;
  readonly stats: { active: number; started: number; finished: number; cancelled: number; failed: number };
}

export interface BotOptions {
  /** The sponsor tops the bot wallet up (direct transfer, not /topup's limits). */
  faucet: Faucet;
  baseRpc?: string;
  maxConcurrent?: number;
  /** How long the human has to join before the bot cancels (refunds its rent). */
  joinTimeoutMs?: number;
  log?: (...a: unknown[]) => void;
  /** Bot wallet (default: a fresh key per server start, funded on first use). */
  wallet?: Keypair;
}

/** Working capital per live bot match: create rent ~0.0153 (back at close) + delegation and commit
 *  ~0.012 (a real cost: each bot match costs the sponsor ~0.012 SOL) + fees. */
export const BOT_FLOAT = 40_000_000;

export function onlineBot(opts: BotOptions): BotService {
  initSim();
  const wallet = opts.wallet ?? Keypair.generate();
  const base: Connection = baseConnection(opts.baseRpc);
  const max = opts.maxConcurrent ?? 2;
  const log = opts.log ?? ((...a: unknown[]) => console.log('[bot]', ...a));
  const stats = { active: 0, started: 0, finished: 0, cancelled: 0, failed: 0 };
  let funding: Promise<void> | null = null;

  /** Keep BOT_FLOAT × (active matches) on the bot wallet. */
  const fund = async () => {
    const want = BOT_FLOAT * Math.max(1, stats.active);
    const have = await base.getBalance(wallet.publicKey, 'confirmed');
    if (have < want) await opts.faucet.send(wallet.publicKey.toBase58(), want - have);
  };

  async function run(id: bigint, opponent: string) {
    const t0 = Date.now();
    let src: LiveSource | null = null;
    try {
      await (funding = (funding ?? Promise.resolve()).then(fund, fund));
      await createMatch(base, wallet, { id, stake: 0, burner: wallet.publicKey, name: 'Warlord (bot)' });
      log(`match ${id}: created for ${opponent.slice(0, 6)}…`);
      try {
        await waitForStatus(base, id, chain.Status.JOINED, opts.joinTimeoutMs ?? 60_000);
      } catch {
        await cancelMatch(base, wallet, id).catch((e: unknown) => log(`match ${id}: cancel failed`, String(e).split('\n')[0]));
        stats.cancelled++;
        log(`match ${id}: nobody joined, cancelled (rent refunded)`);
        return;
      }
      const m = await fetchMatch(base, id);
      if (!m || m.header.stake !== 0) throw new Error('refusing a staked match');
      await delegateMatch(base, wallet, id);
      src = await LiveSource.connect({ matchId: id, burner: wallet, baseRpc: opts.baseRpc });
      const live = src;
      const brain = new Bot(0, BigInt(Date.now()) ^ id);
      live.subscribe((view) => {
        if (view.status !== 'plant' && view.status !== 'playing') return;
        const [aim, rig, peek] = brain.decide(live.latestBytes);
        if (aim! >= 0) live.setAim(aim!);
        if (rig! >= 0) live.rig(rig!);
        if (peek! >= 0) live.peek(peek!);
      });
      live.start();
      const reveal = await waitFinished(live, 6 * 60_000);
      if (reveal?.settlement?.state === 'settled') await closeMatch(base, wallet, id).catch((e: unknown) => log(`match ${id}: close failed`, String(e).split('\n')[0]));
      stats.finished++;
      log(`match ${id}: ${reveal?.payout?.why ?? 'ended'} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    } catch (e) {
      stats.failed++;
      log(`match ${id}: failed`, String(e).split('\n')[0]);
    } finally {
      src?.dispose();
      stats.active--;
    }
  }

  return {
    address: wallet.publicKey.toBase58(),
    stats,
    available: () => stats.active < max,
    play(id, opponent) {
      stats.active++;
      stats.started++;
      void run(id, opponent);
    },
  };
}

/** Resolves with the full reveal once the match finished and settled (or null on timeout). */
async function waitFinished(src: LiveSource, timeoutMs: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (src.currentStage === 'finished') return src.awaitReveal(90_000);
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
