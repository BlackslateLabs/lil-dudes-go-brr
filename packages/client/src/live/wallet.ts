// Money edges for the wallet sheet and the result screen (MVP §3.7, §3.9, §4):
// - withdraw: burner → any address, without leaving rent dust behind;
// - settleNow: the "Settle now" button when the Magic Action is late (permissionless `settle`).
import { PublicKey, SystemProgram, type Connection, type Keypair } from '@solana/web3.js';
import { matchAccounts, send, Status } from './chain';
import { fetchMatch, isOnBase, settleMatch, settlementOf } from './lobby';

/** Rent-exempt minimum of a 0-data system account (a wallet), lamports. */
export const RENT_EXEMPT_MIN = 890_880;
/** Base fee of a one-signature tx (no priority fee), lamports. */
export const BASE_FEE = 5_000;

export type WithdrawPlan =
  | { ok: true; amount: number; leaves: number; fee: number }
  /** `max`: the most that can be sent while leaving ≥ the rent minimum (if any); `all`: everything. */
  | { ok: false; reason: string; max?: number; all?: number };

/**
 * How much to send from a burner holding `balance` (pure; withdraw() uses it). The burner must
 * end at exactly 0 (the account disappears) or at ≥ the rent-exempt minimum, and a brand-new
 * destination must receive ≥ the minimum, otherwise the runtime rejects the tx.
 */
export function planWithdraw(balance: number, amount: number | 'all', destBalance: number, fee = BASE_FEE, rentMin = RENT_EXEMPT_MIN): WithdrawPlan {
  const all = balance - fee;
  if (all <= 0) return { ok: false, reason: 'nothing to withdraw (the balance does not cover the fee)' };
  const want = amount === 'all' ? all : amount;
  if (!Number.isSafeInteger(want) || want <= 0) return { ok: false, reason: 'amount must be a positive number of lamports' };
  const max = all - rentMin > 0 ? all - rentMin : undefined;
  if (want > all) return { ok: false, reason: `more than the balance minus the fee (${all} lamports)`, max, all };
  const leaves = all - want;
  if (leaves > 0 && leaves < rentMin) {
    return { ok: false, reason: `would leave ${leaves} lamports, below the rent-exempt minimum (${rentMin}): withdraw all, or at most ${max ?? 0}`, max, all };
  }
  if (destBalance === 0 && want < rentMin) return { ok: false, reason: `a new address needs at least ${rentMin} lamports (0.00089 SOL)`, max, all };
  return { ok: true, amount: want, leaves, fee };
}

/**
 * How much a sweep (send everything) from a key holding `balance` moves to a destination holding
 * `destBalance` (pure). Everything minus the fee, or 0 when that's nothing, or when a brand-new
 * destination would get less than the rent minimum (the runtime would refuse it). Never negative.
 */
export function sweepable(balance: number, destBalance: number, fee = BASE_FEE, rentMin = RENT_EXEMPT_MIN): number {
  const all = balance - fee;
  if (!Number.isFinite(all) || all <= 0) return 0;
  if (destBalance <= 0 && all < rentMin) return 0;
  return all;
}

/**
 * Wallet sheet "Withdraw" (MVP §3.9): sends `amount` lamports (default: everything) from the
 * burner to `to` (e.g. the player's Phantom). Stakes in a live match sit in its vault, not in the
 * burner, so this never touches a match. Throws with a readable reason (see planWithdraw).
 */
export async function withdraw(base: Connection, burner: Keypair, to: PublicKey, amount: number | 'all' = 'all'): Promise<{ signature: string; amount: number; leaves: number }> {
  if (to.equals(burner.publicKey)) throw new Error('withdraw: that is this wallet');
  if (!PublicKey.isOnCurve(to.toBytes())) throw new Error('withdraw: not a wallet address (off-curve, e.g. a program account)');
  const [balance, dest] = await Promise.all([base.getBalance(burner.publicKey, 'confirmed'), base.getBalance(to, 'confirmed')]);
  const rentMin = await base.getMinimumBalanceForRentExemption(0).catch(() => RENT_EXEMPT_MIN);
  const plan = planWithdraw(balance, amount, dest, BASE_FEE, rentMin);
  if (!plan.ok) throw new Error(`withdraw: ${plan.reason}`);
  const signature = await send(base, [SystemProgram.transfer({ fromPubkey: burner.publicKey, toPubkey: to, lamports: plan.amount })], [burner], { skipPreflight: false });
  return { signature, amount: plan.amount, leaves: plan.leaves };
}

export type SettleNowResult =
  /** Already paid (by the Magic Action, a fallback, or nothing to pay). */
  | { state: 'settled'; by?: 'action' | 'fallback' | 'free'; signature?: string }
  /** This call paid it out (`settle` signed by `payer`, or by the server's sponsor). */
  | { state: 'sent'; signature: string; via: 'payer' | 'server' }
  /** Still on the TEE / undelegating (commit + undelegation take ~1–5 s): try again shortly. */
  | { state: 'not-on-base' }
  | { state: 'not-finished' };

/**
 * Result screen "Settle now" (MVP §3.7, shown ~20 s after the end if `reveal().settlement` is
 * still pending): pays the vault out with the permissionless `settle`. Signed by `payer` if it can
 * pay the fee, else by the server (`POST /settle`, sponsor-paid) when `server` is given. Safe to
 * call any time: a settled match returns 'settled', and a double settle is refused on-chain.
 */
export async function settleNow(base: Connection, payer: Keypair | null, id: bigint, server?: string): Promise<SettleNowResult> {
  const m = await fetchMatch(base, id);
  // Closed (close_match / cancel_match need the money out first): nothing left to pay.
  if (!m) return { state: 'settled' };
  if (!(await isOnBase(base, id))) return { state: 'not-on-base' };
  if (m.header.status < Status.FINISHED) return { state: 'not-finished' };
  const before = await settlementOf(base, id, []);
  if (before.state === 'settled') return { state: 'settled', by: before.by };
  const canPay = payer && (await base.getBalance(payer.publicKey, 'confirmed')) >= 2 * BASE_FEE;
  try {
    if (canPay) return { state: 'sent', signature: await settleMatch(base, payer, id), via: 'payer' };
    if (!server) throw new Error('settle: the payer has no SOL for the fee and no server was given');
    const res = await fetch(`${server.replace(/\/$/, '')}/settle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: id.toString() }) });
    const json = (await res.json()) as { signature?: string; state?: string; error?: string };
    if (json.state === 'settled') return { state: 'settled' };
    if (!res.ok || !json.signature) throw new Error(`settle via server: ${json.error ?? res.status}`);
    return { state: 'sent', signature: json.signature, via: 'server' };
  } catch (e) {
    // Someone else (the action, the sweeper, the opponent) may have paid in between.
    const after = await settlementOf(base, id, []).catch(() => null);
    if (after?.state === 'settled') return { state: 'settled', by: after.by };
    throw e;
  }
}

/** The vault's balance (lamports): 0 once paid out. */
export const vaultBalance = (base: Connection, id: bigint) => base.getBalance(matchAccounts(id).vault, 'confirmed');
