// The stake rules the app checks before it signs anything, and where the burner lives. No Solana
// imports here on purpose: the web app reads these on its first screen without pulling in
// @solana/web3.js (the live code loads later, on demand). live/player.ts re-exports them.

/** Where the burner lives in localStorage. */
export const BURNER_KEY = 'ldgb.burner';

/** The smallest stake the app offers: 0.01 devnet SOL. */
export const STAKE_MIN = 10_000_000;
/** Program STAKE_MAX (state.rs). */
export const STAKE_MAX = 5_000_000_000;

/** What a burner keeps beyond its stake: create rent ~0.0153 (back at close) + delegation and
 *  commit ~0.012 + fees. The same number as the server's top-up reserve (TOPUP_POLICY.reserve). */
export const STAKE_RESERVE = 35_000_000;

/** Can a match be opened on-chain at this stake? The program (state.rs `stake_ok`) takes 0 or any
 *  amount in [STAKE_MIN, STAKE_MAX]; anything else is refused with `BadStake`. */
export function stakeOnChain(lamports: number): boolean {
  return Number.isSafeInteger(lamports) && (lamports === 0 || (lamports >= STAKE_MIN && lamports <= STAKE_MAX));
}

/** The most a burner holding `balance` lamports can stake (it keeps STAKE_RESERVE for the rest). */
export const maxStake = (balance: number): number => Math.max(0, balance - STAKE_RESERVE);
