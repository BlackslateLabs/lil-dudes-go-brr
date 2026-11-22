// The sweeper (MVP §4 edge cases, nobody has to be around): every minute it looks at every
// lil_dudes match on the base layer and on the TEE and does the permissionless clean-up. The
// payees are fixed by each Match, so the sweeper can only ever refund or pay the right people:
// - base OPEN for 20 min (abandoned room) → cancel_match: the creator gets the stake + rent back;
// - base JOINED, never delegated, for 5 min → cancel_match: both refunded;
// - base FINISHED with money in the vault for 30 s (the Magic Action is late) → settle;
// - base paid out (or free) for 10 min → close_match: the rent goes back to the creator (the
//   grace period keeps the Match readable for result screens and Verify);
// - TEE READY/SEEDED for ABORT_ANYONE_SLOTS (~5 min, nobody sent the second salt or started) →
//   finish (abort): both refunded by the settle action;
// - TEE PLAYING with a result nobody finished for 30 s → finish;
// - TEE PLAYING, the tick stuck for 60 s (crank gone, players gone) → advance (catch-up).
// It signs with the sponsor key (base fees; 0 SOL needed on the TEE).
import {
  baseConnection,
  cancelMatch,
  chain,
  closeMatch,
  settleMatch,
  teeToken,
  TEE_RPC,
} from '@lil-dudes/client';
import type { Connection, Keypair } from '@solana/web3.js';

/** state.rs: OPEN_ANYONE_SECS, JOIN_ANYONE_SECS, ABORT_ANYONE_SLOTS (+ a small margin). */
export const SWEEP = {
  openSecs: 20 * 60 + 10,
  joinSecs: 5 * 60 + 10,
  abortSlots: 30_000 + 200,
  settleAfterMs: 30_000,
  closeAfterMs: 10 * 60_000,
  finishAfterMs: 30_000,
  stuckMs: 60_000,
};

export interface BaseMatch {
  id: bigint;
  status: number;
  stake: number;
  vault: number;
  createdAt: number;
  joinedAt: number;
}

export interface TeeMatch {
  id: bigint;
  status: number;
  readySlot: number;
  tick: number;
  hasResult: boolean;
}

export type SweepAction = { kind: 'cancel' | 'settle' | 'close' | 'abort' | 'finish' | 'advance'; id: bigint; why: string };

/** First time each condition was seen (ms), per match: the timers that aren't on-chain. */
export type Seen = Map<string, number>;

/** Pure: what to do now. `seen` is updated (first-seen times; forgotten when a match is gone). */
export function planSweep(base: BaseMatch[], tee: TeeMatch[], now: { ms: number; sec: number; teeSlot: number }, seen: Seen, timing: typeof SWEEP = SWEEP): SweepAction[] {
  const SW = timing;
  const out: SweepAction[] = [];
  const live = new Set<string>();
  const since = (key: string) => {
    live.add(key);
    if (!seen.has(key)) seen.set(key, now.ms);
    return now.ms - seen.get(key)!;
  };
  for (const m of base) {
    const S = chain.Status;
    if (m.status === S.OPEN && now.sec >= m.createdAt + SW.openSecs) out.push({ kind: 'cancel', id: m.id, why: 'open room abandoned (20 min)' });
    else if (m.status === S.JOINED && now.sec >= m.joinedAt + SW.joinSecs) out.push({ kind: 'cancel', id: m.id, why: 'joined but never delegated (5 min)' });
    else if (m.status === S.FINISHED && m.stake > 0 && m.vault > 0) {
      if (since(`settle:${m.id}`) >= SW.settleAfterMs) out.push({ kind: 'settle', id: m.id, why: 'finished, vault not paid out (Magic Action late)' });
    } else if (m.status === S.SETTLED || m.status === S.FINISHED) {
      if (since(`close:${m.id}`) >= SW.closeAfterMs) out.push({ kind: 'close', id: m.id, why: 'paid out 10 min ago: rent back to the creator' });
    }
  }
  for (const m of tee) {
    const S = chain.Status;
    if ((m.status === S.READY || m.status === S.SEEDED) && m.readySlot > 0 && now.teeSlot >= m.readySlot + SW.abortSlots) {
      out.push({ kind: 'abort', id: m.id, why: 'never started (~5 min): abort, both refunded' });
    } else if (m.status === S.PLAYING && m.hasResult) {
      if (since(`finish:${m.id}`) >= SW.finishAfterMs) out.push({ kind: 'finish', id: m.id, why: 'over, nobody finished it' });
    } else if (m.status === S.PLAYING) {
      const key = `tick:${m.id}:${m.tick}`;
      if (since(key) >= SW.stuckMs) out.push({ kind: 'advance', id: m.id, why: `tick ${m.tick} stuck for 60 s (crank gone)` });
    }
  }
  for (const k of seen.keys()) if (!live.has(k)) seen.delete(k);
  return out;
}

export interface SweeperOptions {
  signer: Keypair;
  base?: Connection;
  teeRpc?: string;
  log?: (...a: unknown[]) => void;
  /** Shorter grace periods (tests); the on-chain timeouts can't be shortened. */
  timing?: Partial<typeof SWEEP>;
}

export function sweeper(opts: SweeperOptions) {
  const base = opts.base ?? baseConnection();
  const rpc = opts.teeRpc ?? TEE_RPC;
  const log = opts.log ?? ((...a: unknown[]) => console.log('[sweep]', ...a));
  const seen: Seen = new Map();
  const stats = { runs: 0, actions: 0, failed: 0, lastRunAt: 0, last: [] as string[] };
  let tee: Connection | null = null;
  let running = false;

  const teeConn = async () => (tee ??= chain.teeConnection(await teeToken(opts.signer, rpc), rpc));

  async function listBase(): Promise<BaseMatch[]> {
    const list = await base.getProgramAccounts(chain.PROGRAM_ID, { commitment: 'confirmed', filters: [{ dataSize: chain.MATCH_LEN }] });
    const out: BaseMatch[] = [];
    for (const x of list) {
      const h = chain.decodeMatch(x.account.data).header;
      const vault = h.status >= chain.Status.FINISHED && h.stake > 0 ? await base.getBalance(chain.matchAccounts(h.id).vault, 'confirmed') : 0;
      out.push({ id: h.id, status: h.status, stake: h.stake, vault, createdAt: h.createdAt, joinedAt: h.joinedAt });
    }
    return out;
  }

  async function listTee(conn: Connection): Promise<TeeMatch[]> {
    const list = await conn.getProgramAccounts(chain.PROGRAM_ID, { commitment: 'confirmed', filters: [{ dataSize: chain.MATCH_LEN }] });
    return list.map((x) => {
      const m = chain.decodeMatch(x.account.data);
      return { id: m.header.id, status: m.header.status, readySlot: m.header.readySlot, tick: m.state.tick, hasResult: !!m.state.result };
    });
  }

  async function act(a: SweepAction, conn: Connection): Promise<string> {
    const ac = chain.matchAccounts(a.id);
    const me = opts.signer.publicKey;
    switch (a.kind) {
      case 'cancel':
        return cancelMatch(base, opts.signer, a.id);
      case 'settle':
        return settleMatch(base, opts.signer, a.id);
      case 'close':
        return closeMatch(base, opts.signer, a.id);
      case 'abort':
      case 'finish':
        return chain.send(conn, [chain.ixs.finish(ac, me)], [opts.signer], { cu: 400_000 });
      case 'advance': {
        let sig = '';
        for (let i = 0; i < 20; i++) sig = await chain.send(conn, [chain.ixs.advance(ac)], [opts.signer], { cu: 400_000 });
        return sig;
      }
    }
  }

  /** One pass. Returns what it did (for logs and /health). */
  async function runOnce(): Promise<string[]> {
    if (running) return [];
    running = true;
    const done: string[] = [];
    try {
      const conn = await teeConn();
      const [b, t, teeSlot] = await Promise.all([listBase(), listTee(conn).catch(() => []), conn.getSlot('confirmed').catch(() => 0)]);
      const actions = planSweep(b, t, { ms: Date.now(), sec: Math.floor(Date.now() / 1000), teeSlot }, seen, { ...SWEEP, ...opts.timing });
      for (const a of actions) {
        try {
          const sig = await act(a, conn);
          stats.actions++;
          done.push(`${a.kind} ${a.id}: ${a.why} (${sig.slice(0, 10)}…)`);
        } catch (e) {
          stats.failed++;
          done.push(`${a.kind} ${a.id} failed: ${String(e).split('\n')[0]!.slice(0, 100)}`);
        }
      }
      stats.runs++;
      stats.lastRunAt = Date.now();
      stats.last = done.slice(-10);
      for (const d of done) log(d);
    } catch (e) {
      stats.failed++;
      tee = null; // token may have expired
      log('sweep failed', String(e).split('\n')[0]);
    } finally {
      running = false;
    }
    return done;
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  return {
    stats,
    runOnce,
    start(everyMs = 60_000) {
      setTimeout(() => void runOnce(), 10_000);
      timer = setInterval(() => void runOnce(), everyMs);
    },
    stop() {
      if (timer) clearInterval(timer);
    },
  };
}

export type Sweeper = ReturnType<typeof sweeper>;
