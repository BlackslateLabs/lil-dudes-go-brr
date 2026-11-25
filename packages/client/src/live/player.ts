// The device's player for live matches (MVP §3.1, §3.4, §3.9): its burner key and the stake rules
// the app checks before it signs anything.
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { STAKE_TIERS } from './chain';

/** Where the burner lives (the browser's localStorage, or a Map-backed fake in tests). */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const BURNER_KEY = 'ldgb.burner';

/**
 * This device's burner: loaded from `store`, or made and saved on first use (MVP §3.1: silently, no
 * popup). It signs every match tx. Clearing site data loses it (the wallet sheet warns). Returns a
 * fresh key that is NOT saved if the store refuses writes (private windows): live play still works
 * for that tab.
 */
export function deviceBurner(store: KeyStore, key = BURNER_KEY): Keypair {
  const saved = store.getItem(key);
  if (saved) {
    try {
      return Keypair.fromSecretKey(bs58.decode(saved));
    } catch {
      /* unreadable: replace it below */
    }
  }
  const kp = Keypair.generate();
  try {
    store.setItem(key, bs58.encode(kp.secretKey));
  } catch {
    /* storage blocked */
  }
  return kp;
}

/** The smallest stake the app offers: 0.01 devnet SOL. */
export const STAKE_MIN = 10_000_000;

/** What a burner keeps beyond its stake: create rent ~0.0153 (back at close) + delegation and
 *  commit ~0.012 + fees. The same number as the server's top-up reserve (TOPUP_POLICY.reserve). */
export const STAKE_RESERVE = 35_000_000;

/**
 * Can a match be opened on-chain at this stake today? GAP (program): `create_match` / `join_match`
 * take only STAKE_TIERS (programs/lil_dudes base.rs, `BadStake`), so any other amount is refused
 * before signing. When the program takes any amount in [min, max], change this one function.
 */
export function stakeOnChain(lamports: number): boolean {
  return (STAKE_TIERS as readonly number[]).includes(lamports);
}

/** The most a burner holding `balance` lamports can stake (it keeps STAKE_RESERVE for the rest). */
export const maxStake = (balance: number): number => Math.max(0, balance - STAKE_RESERVE);
