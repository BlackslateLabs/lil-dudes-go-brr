// The light half of live/account.ts: the account store the screens draw and `signedIn`, seeded
// from this browser's cache so Home shows the account at once. Connecting, keys and money moves
// live in live/account.ts, which loads with the rest of the live code.
import { create } from 'zustand';
import type { AccountProfile } from '@lil-dudes/client';
import { ACCOUNT_KEY, read } from './storage';

/** Where the connect flow is: which popup the player is looking at. */
export type ConnectStep = 'connect' | 'derive' | 'link' | 'move';

/** SOL that couldn't move into the account yet (shown in Profile with a way to act on it). */
export interface Stuck {
  lamports: number;
  /** guest: this browser's guest wallet (Move it); other: it belongs to another account; old: an older game key. */
  from: 'guest' | 'other' | 'old';
  address: string;
  /** For `other`: the account (wallet) that owns this browser's guest wallet. */
  owner?: string;
}

export interface AccountState {
  /** The connected account's wallet address (null = guest). */
  wallet: string | null;
  walletName: string | null;
  name: string | null;
  profile: AccountProfile | null;
  step: ConnectStep | null;
  error: string | null;
  stuck: Stuck | null;
  /** An older game key of this wallet that isn't cached here: shown so its SOL never silently vanishes. */
  lost: { address: string; walletName: string } | null;
  /** "Moved 0.17 SOL…": a toast for whichever screen is up. */
  notice: { text: string; at: number } | null;
}

/** The cached account (no key material is read here), so the first frame already shows it. */
function cached(): { wallet: string | null; walletName: string | null; name: string | null } {
  try {
    const c = JSON.parse(read(ACCOUNT_KEY) ?? 'null') as { wallet?: unknown; walletName?: unknown; name?: unknown; key?: unknown } | null;
    if (c && typeof c.wallet === 'string' && typeof c.key === 'string') {
      return { wallet: c.wallet, walletName: typeof c.walletName === 'string' ? c.walletName : null, name: typeof c.name === 'string' ? c.name : null };
    }
  } catch {
    /* no cache */
  }
  return { wallet: null, walletName: null, name: null };
}

export const useAccount = create<AccountState>(() => ({
  ...cached(),
  profile: null,
  step: null,
  error: null,
  stuck: null,
  lost: null,
  notice: null,
}));
/** Signed in with a wallet? (Staked play needs it.) */
export const signedIn = (): boolean => useAccount.getState().wallet !== null;
