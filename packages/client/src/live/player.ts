// The device's player for live matches (MVP §3.1, §3.4, §3.9): its burner key and the stake rules
// the app checks before it signs anything.
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { BURNER_KEY } from './stakes';

/** Where the burner lives (the browser's localStorage, or a Map-backed fake in tests). */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// The stake rules and BURNER_KEY live in ./stakes (no Solana imports there); re-exported here.
export { BURNER_KEY, STAKE_MIN, STAKE_MAX, STAKE_RESERVE, stakeOnChain, maxStake } from './stakes';

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
