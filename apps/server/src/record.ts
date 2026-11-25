// Builds a history record from the Match account on the base layer (the only source the server
// trusts for history). A match is recordable once it is back on the base layer with status
// FINISHED or SETTLED; aborted matches (never started, everyone refunded) are not history.
import { baseConnection, chain, fetchMatch, isOnBase, matchResultOf, payoutOf } from '@lil-dudes/client';
import type { Connection } from '@solana/web3.js';
import type { HistoryRecord } from './history';

export type ReadResult = HistoryRecord | 'pending' | 'aborted' | null;
/** Reads match `id` for the history (null = no such match, e.g. already closed). */
export type MatchReader = (id: bigint) => Promise<ReadResult>;

export function chainReader(opts: { base?: Connection; bot?: () => string | null; now?: () => number } = {}): MatchReader {
  const base = opts.base ?? baseConnection();
  const now = opts.now ?? Date.now;
  return async (id) => {
    const m = await fetchMatch(base, id);
    if (!m) return null;
    const h = m.header;
    if (h.status < chain.Status.FINISHED || !(await isOnBase(base, id))) return 'pending';
    if (h.flags & chain.Flags.ABORTED) return 'aborted';
    const s = m.state;
    const dead: [boolean, boolean] = [s.sides[0].dead, s.sides[1].dead];
    const result = matchResultOf(s);
    const pay = payoutOf(h.stake, result, { names: h.names, dead });
    const players: [string, string] = [h.players[0].toBase58(), h.players[1].toBase58()];
    const bot = opts.bot?.() ?? null;
    return {
      matchId: h.id.toString(),
      players,
      names: h.names,
      stakes: [h.stake, h.stake],
      scores: [s.sides[0].gold, s.sides[1].gold],
      winner: result?.winner ?? null,
      died: result?.died ?? null,
      payout: { paid: pay.paid, net: pay.net, moved: pay.moved, fee: pay.fee, why: pay.why },
      bot: !!bot && players.includes(bot),
      endedAt: now(),
    };
  };
}
