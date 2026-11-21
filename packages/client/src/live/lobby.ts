// Base-layer steps of a live match (they need SOL: the stake, rent and fees). The wallet is the
// player's funded burner (MVP: one burner per device, topped up by the server) or any Keypair.
//   A: createMatch → share the id (room code / queue)    B: joinMatch
//   either: delegateMatch → both: LiveSource.connect({ matchId, burner }).start()
// After the end: the Magic Action pays out; if it doesn't within ~20 s, anyone calls settleMatch.
import { Connection, PublicKey, type Keypair } from '@solana/web3.js';
import { BASE_RPC, decodeMatch, ixs, matchAccounts, newMatchId, send, Status, TEE_VALIDATOR, type MatchAccount } from './chain';

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
