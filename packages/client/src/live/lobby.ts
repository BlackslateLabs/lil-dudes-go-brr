// Base-layer steps of a live match (they need SOL: the stake, rent and fees). The wallet is the
// player's funded burner (MVP: one burner per device, topped up by the server) or any Keypair.
//   A: createMatch → share the id (room code / queue)    B: joinMatch
//   either: delegateMatch → both: LiveSource.connect({ matchId, burner }).start()
// After the end: the Magic Action pays out; if it doesn't within ~20 s, anyone calls settleMatch.
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import { BASE_RPC, decodeMatch, DELEGATION_PROGRAM, ixs, matchAccounts, newMatchId, PROGRAM_ID, send, Status, TEE_VALIDATOR, type MatchAccount } from './chain';
import { BASE_EXPLORER, type SettlementInfo, type TxRecord } from '../verify';

export const baseConnection = (rpc = BASE_RPC) => new Connection(rpc, 'confirmed');

export interface CreateOptions {
  /** Default: a random u64 (the PDA seed; share it as the room code). */
  id?: bigint;
  /** Lamports, one of STAKE_TIERS. */
  stake: number;
  /** The key that signs on the TEE (usually the same burner as `wallet`). */
  burner: PublicKey;
  name: string;
}

/** Player A: opens the match and escrows the stake (+ ~0.013 SOL rent, back at close). */
export async function createMatch(base: Connection, wallet: Keypair, o: CreateOptions): Promise<{ id: bigint; signature: string }> {
  const id = o.id ?? newMatchId();
  const a = matchAccounts(id);
  const signature = await send(base, [ixs.createMatch(a, wallet.publicKey, BigInt(o.stake), o.burner, o.name)], [wallet], { skipPreflight: false });
  return { id, signature };
}

/** Player B: joins; the matched stake is the lower of the two picks (A's excess goes back). */
export async function joinMatch(base: Connection, wallet: Keypair, o: { id: bigint; stake: number; burner: PublicKey; name: string }): Promise<string> {
  const m = await fetchMatch(base, o.id);
  if (!m) throw new Error(`no match ${o.id}`);
  if (m.header.status !== Status.OPEN) throw new Error('match is not open');
  const a = matchAccounts(o.id);
  return send(base, [ixs.joinMatch(a, wallet.publicKey, m.header.players[0], BigInt(o.stake), o.burner, o.name)], [wallet], { skipPreflight: false });
}

/** Either player (or a server): moves the match to the TEE once both are in. */
export async function delegateMatch(base: Connection, payer: Keypair, id: bigint, validator = TEE_VALIDATOR): Promise<string> {
  return send(base, [ixs.delegateMatch(matchAccounts(id), payer.publicKey, validator)], [payer], { cu: 400_000, skipPreflight: false });
}

/** Refund before the TEE: the creator any time while open; either player 60 s after a join. */
export async function cancelMatch(base: Connection, wallet: Keypair, id: bigint): Promise<string> {
  const m = await fetchMatch(base, id);
  if (!m) throw new Error(`no match ${id}`);
  const [creator, opponent] = m.header.players;
  const other = m.header.status === Status.OPEN ? creator : opponent;
  return send(base, [ixs.cancelMatch(matchAccounts(id), wallet.publicKey, creator, other)], [wallet], { skipPreflight: false });
}

/** Fallback settlement (anyone, once the Match is back on the base layer). */
export async function settleMatch(base: Connection, payer: Keypair, id: bigint): Promise<string> {
  const m = await fetchMatch(base, id);
  if (!m) throw new Error(`no match ${id}`);
  return send(base, [ixs.settle(matchAccounts(id), m.header.players, m.header.treasury)], [payer], { skipPreflight: false });
}

/** Closes a paid-out match; the rent goes back to the creator. */
export async function closeMatch(base: Connection, payer: Keypair, id: bigint): Promise<string> {
  const m = await fetchMatch(base, id);
  if (!m) throw new Error(`no match ${id}`);
  return send(base, [ixs.closeMatch(matchAccounts(id), m.header.players[0])], [payer], { skipPreflight: false });
}

/** The Match as `conn` sees it (base or TEE), or null. */
export async function fetchMatch(conn: Connection, id: bigint): Promise<MatchAccount | null> {
  const info = await conn.getAccountInfo(matchAccounts(id).game, 'confirmed');
  return info ? decodeMatch(info.data) : null;
}

/** Whether the base layer holds the match (owned by the program: not delegated). */
export async function isOnBase(base: Connection, id: bigint): Promise<boolean> {
  const info = await base.getAccountInfo(matchAccounts(id).game, 'confirmed');
  return !!info && info.owner.equals(new PublicKey(ixs.advance(matchAccounts(id)).programId));
}

/** Settled = back on base and the vault empty (paid by the action or the fallback). */
export async function isSettled(base: Connection, id: bigint): Promise<boolean> {
  const m = await fetchMatch(base, id);
  if (!m || !(await isOnBase(base, id))) return false;
  if (m.header.status === Status.SETTLED) return true;
  if (m.header.status !== Status.FINISHED) return false;
  return m.header.stake === 0 || (await base.getBalance(matchAccounts(id).vault, 'confirmed')) === 0;
}

/** Polls the base layer until the match exists with at least `status` (e.g. OPEN for a joiner,
 *  JOINED for the creator before delegating). Throws after `timeoutMs`. */
export async function waitForStatus(base: Connection, id: bigint, status: number, timeoutMs = 60_000): Promise<MatchAccount> {
  const t0 = Date.now();
  for (;;) {
    const m = await fetchMatch(base, id).catch(() => null);
    if (m && m.header.status >= status) return m;
    if (Date.now() - t0 > timeoutMs) throw new Error(`match ${id} did not reach status ${status} in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 750));
  }
}

const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** Raw getTransaction (the Magic Action's base tx is a v1 transaction web3.js 1.x can't decode). */
async function rawTx(base: Connection, sig: string): Promise<{ logs: string[]; payer?: string } | null> {
  for (const version of [1, 0]) {
    const res = await fetch(base.rpcEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [sig, { encoding: 'json', maxSupportedTransactionVersion: version, commitment: 'confirmed' }] }),
    }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { result?: { meta?: { logMessages?: string[] }; transaction?: { message?: { accountKeys?: (string | { pubkey: string })[] } } } | null; error?: unknown } | null;
    if (!body || body.error) continue;
    if (!body.result) return null;
    const k0 = body.result.transaction?.message?.accountKeys?.[0];
    return { logs: body.result.meta?.logMessages ?? [], payer: typeof k0 === 'string' ? k0 : k0?.pubkey };
  }
  return null;
}

/** Labels a base-layer tx of a match from its logs. */
function label(logs: string[]): string {
  const ours = logs.filter((l) => l.startsWith('Program log: Instruction: ')).map((l) => snake(l.slice('Program log: Instruction: '.length)));
  const dlp = logs.some((l) => l.includes(DELEGATION_PROGRAM.toBase58()));
  if (ours.includes('settle_action')) return 'commit + undelegate + settle (Magic Action)';
  if (dlp && !ours.length) return 'commit + undelegate';
  return ours.find((x) => x !== 'settle_action') ?? (dlp ? 'delegation' : 'other');
}

/**
 * Every successful base-layer tx of a match (oldest first): create, join, delegate, the TEE's
 * commit + undelegate + Magic Action, a fallback settle, cancel, close. For the result screen's
 * explorer links and Verify's "under the hood" list. Players are matched by fee payer.
 */
export async function matchTxs(base: Connection, id: bigint, header?: MatchAccount['header']): Promise<TxRecord[]> {
  const a = matchAccounts(id);
  const sigs = new Map<string, number>();
  for (const pk of [a.game, a.vault]) {
    const list = await base.getSignaturesForAddress(pk, { limit: 100 }, 'confirmed').catch(() => []);
    for (const s of list) if (!s.err) sigs.set(s.signature, s.slot);
  }
  const out: (TxRecord & { slot: number })[] = [];
  for (const [signature, slot] of [...sigs].sort((x, y) => x[1] - y[1])) {
    const t = await rawTx(base, signature);
    if (!t) continue;
    const what = label(t.logs);
    if (what === 'other' && !t.logs.some((l) => l.includes(PROGRAM_ID.toBase58()))) continue;
    const by: TxRecord['by'] = !t.payer
      ? undefined
      : t.payer === TEE_VALIDATOR.toBase58()
        ? 'validator'
        : header?.players.findIndex((p) => p.toBase58() === t.payer) === 0 || header?.burners[0]?.toBase58() === t.payer
          ? 0
          : header?.players[1]?.toBase58() === t.payer || header?.burners[1]?.toBase58() === t.payer
            ? 1
            : 'other';
    out.push({ what, signature, layer: 'base', url: BASE_EXPLORER(signature), by, slot });
  }
  return out.map(({ slot: _slot, ...r }) => r);
}

/** Where the stakes are (MVP §3.7 "Settling…"): settled once the Match is back on base and the
 *  vault is paid out (or the match is closed). Call it after the end only. `txs` (from matchTxs)
 *  supplies the signature and who paid. */
export async function settlementOf(base: Connection, id: bigint, txs?: TxRecord[]): Promise<SettlementInfo> {
  const m = await fetchMatch(base, id);
  // Closed (close_match / cancel_match need the money out first): nothing left to pay.
  if (!m) return { state: 'settled' };
  if (!(await isOnBase(base, id))) return { state: 'pending' };
  if (m.header.status < Status.FINISHED) return { state: 'pending' };
  if (m.header.stake === 0) return { state: 'settled', by: 'free' };
  const vault = await base.getBalance(matchAccounts(id).vault, 'confirmed');
  if (m.header.status !== Status.SETTLED && vault > 0) return { state: 'pending' };
  const list = txs ?? (await matchTxs(base, id, m.header));
  const action = list.find((t) => t.what.includes('Magic Action'));
  const fallback = list.find((t) => t.what === 'settle');
  if (fallback) return { state: 'settled', by: 'fallback', signature: fallback.signature };
  return { state: 'settled', by: 'action', signature: action?.signature };
}

/** Matches on the base layer where `player` is player A or B (delegated ones live on the TEE
 *  and are not listed). Oldest first. */
export async function myMatches(base: Connection, player: PublicKey): Promise<MatchAccount[]> {
  const out: MatchAccount[] = [];
  for (const offset of [88, 120]) {
    const list = await base.getProgramAccounts(PROGRAM_ID, { commitment: 'confirmed', filters: [{ dataSize: 8 + 1368 }, { memcmp: { offset, bytes: player.toBase58() } }] });
    for (const x of list) out.push(decodeMatch(x.account.data));
  }
  return out.sort((a, b) => a.header.createdAt - b.header.createdAt);
}

export interface Recovered {
  id: bigint;
  action: 'cancelled' | 'settled' | 'closed' | 'left';
  signature?: string;
  /** Why it was left alone (e.g. "joined 20 s ago: cancel after 60 s"). */
  note?: string;
}

/**
 * "Where did my stake go?" on app start (MVP §4): for every base-layer match of `wallet`, cancel
 * its own open room (refund), cancel a join that was never delegated once 60 s passed, settle a
 * finished match the action didn't pay, and close paid-out ones it created (rent back). Never
 * touches a match that is still in play. Safe to run any time; the server's sweeper does the same
 * for everyone after longer timeouts.
 */
export async function recoverMatches(base: Connection, wallet: Keypair, opts: { keepOpen?: bigint[] } = {}): Promise<Recovered[]> {
  const out: Recovered[] = [];
  const now = Math.floor(Date.now() / 1000);
  for (const m of await myMatches(base, wallet.publicKey)) {
    const { id, status, players, joinedAt, stake } = m.header;
    const creator = players[0].equals(wallet.publicKey);
    try {
      if (status === Status.OPEN) {
        if (!creator || opts.keepOpen?.includes(id)) out.push({ id, action: 'left', note: 'open room' });
        else out.push({ id, action: 'cancelled', signature: await cancelMatch(base, wallet, id) });
      } else if (status === Status.JOINED) {
        if (now - joinedAt < 60) out.push({ id, action: 'left', note: `joined ${now - joinedAt} s ago: cancel after 60 s` });
        else out.push({ id, action: 'cancelled', signature: await cancelMatch(base, wallet, id) });
      } else if (status >= Status.FINISHED) {
        const s = await settlementOf(base, id, []);
        if (s.state !== 'settled' && stake > 0) {
          out.push({ id, action: 'settled', signature: await settleMatch(base, wallet, id) });
        } else if (creator) {
          out.push({ id, action: 'closed', signature: await closeMatch(base, wallet, id) });
        } else out.push({ id, action: 'left', note: 'the creator (or the sweeper) closes it' });
      } else out.push({ id, action: 'left', note: 'in play' });
    } catch (e) {
      out.push({ id, action: 'left', note: String(e).split('\n')[0]!.slice(0, 120) });
    }
  }
  return out;
}
