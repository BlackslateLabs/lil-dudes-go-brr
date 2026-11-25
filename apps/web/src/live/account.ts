// The player's account in the web app: connect a Solana wallet, derive the game key from it
// (packages/client src/live/account.ts), link it the first time, and play with it. A wallet is
// needed for staked play only; guests keep their browser burner for the bot and free online play.
//
// What this browser keeps: `ldgb.account` = { wallet, walletName, name, key } where `key` is the
// derived game key (base58). It's a cache with the same trust as the guest burner it replaces, so
// a reload needs no popup. Clearing site data (or Disconnect) drops it, and nothing is lost:
// connecting the same wallet signs the same message and rebuilds the same key. No wallet secret is
// ever stored.
import { create } from 'zustand';
import {
  accountProfile,
  baseConnection,
  connectWallet,
  depositFromWallet,
  disconnectWallet,
  keyFromText,
  keyToText,
  linkAccount,
  listWallets,
  migrateGuest,
  playerStats,
  RENT_EXEMPT_MIN,
  BASE_FEE,
  ServerError,
  setAccountName as saveName,
  deriveBurner,
  withdrawToWallet,
  type AccountProfile,
  type ConnectedWallet,
  type GameWallet,
} from '@lil-dudes/client';
import { guestBurner, myBurner, read, SERVER, setAccountKey, setAccountName, write } from './device';
import { refreshBalance } from './session';

const ACCOUNT_KEY = 'ldgb.account';

interface Cached {
  wallet: string;
  walletName: string;
  name: string | null;
  key: string;
}

/** Where the connect flow is: which popup the player is looking at. */
export type ConnectStep = 'connect' | 'derive' | 'link' | 'move';

export interface AccountState {
  /** The connected account's wallet address (null = guest). */
  wallet: string | null;
  walletName: string | null;
  name: string | null;
  profile: AccountProfile | null;
  step: ConnectStep | null;
  error: string | null;
  /** This browser's guest key holds SOL or has matches: offer to move them into the account. */
  offer: { lamports: number; matches: number } | null;
}

export const useAccount = create<AccountState>(() => ({ wallet: null, walletName: null, name: null, profile: null, step: null, error: null, offer: null }));
const set = (p: Partial<AccountState>) => useAccount.setState(p);

/** Signed in with a wallet? (Staked play needs it.) */
export const signedIn = (): boolean => useAccount.getState().wallet !== null;

function readCache(): Cached | null {
  try {
    const c = JSON.parse(read(ACCOUNT_KEY) ?? 'null') as Cached | null;
    return c && typeof c.wallet === 'string' && typeof c.key === 'string' ? c : null;
  } catch {
    return null;
  }
}

/** Restores a signed-in account from this browser's cache (no popup). Runs once, at start. */
function restore() {
  const c = readCache();
  const kp = keyFromText(c?.key);
  if (!c || !kp) return;
  setAccountKey(kp);
  setAccountName(c.name);
  set({ wallet: c.wallet, walletName: c.walletName, name: c.name });
  void refreshProfile();
}
restore();

function cache(c: Cached | null) {
  write(ACCOUNT_KEY, c ? JSON.stringify(c) : null);
}

/** Re-reads the account from the server (stats, name). Keeps the last one if it can't. */
export async function refreshProfile(): Promise<AccountProfile | null> {
  const w = useAccount.getState().wallet;
  if (!w) return null;
  const p = await accountProfile(SERVER, w).catch(() => null);
  if (p) {
    set({ profile: p, name: p.name });
    setAccountName(p.name);
  }
  return p;
}

const readable = (e: unknown): string => {
  if (e instanceof ServerError && e.status === 0) return "Can't reach the game server right now. Try again in a moment.";
  const m = String(e instanceof Error ? e.message : e);
  if (/reject|denied|declined|cancel/i.test(m)) return 'You closed the wallet prompt. Nothing was signed.';
  return m.replace(/^POST \/account\/\w+: /, '').replace(/^\w/, (x) => x.toUpperCase());
};

/** The connected wallet object (for deposits), reconnecting silently when the page was reloaded. */
let live: ConnectedWallet | null = null;
async function wallet(): Promise<ConnectedWallet> {
  const s = useAccount.getState();
  if (live && live.address === s.wallet) return live;
  const w = listWallets().find((x) => x.name === s.walletName);
  if (!w) throw new Error(`${s.walletName ?? 'Your wallet'} isn't available in this browser`);
  const c = await connectWallet(w, { silent: true }).catch(() => connectWallet(w));
  if (c.address !== s.wallet) throw new Error(`${w.name} is on another account (${c.address.slice(0, 4)}…). Switch back, or disconnect and connect again.`);
  live = c;
  return c;
}

/**
 * Connect flow: approve the connection, sign to make the game key, and (first time only) sign
 * once more to link it. Returns true when signed in. `step` says which popup is up.
 */
export async function connect(w: GameWallet): Promise<boolean> {
  set({ error: null, step: 'connect' });
  try {
    const c = await connectWallet(w);
    set({ step: 'derive' });
    const kp = await deriveBurner(c);
    const pk = kp.publicKey.toBase58();
    let profile = await accountProfile(SERVER, c.address);
    if (!profile || profile.burner !== pk) {
      set({ step: 'link' });
      profile = await linkAccount(SERVER, c, kp);
    }
    live = c;
    setAccountKey(kp);
    setAccountName(profile.name);
    cache({ wallet: c.address, walletName: w.name, name: profile.name, key: keyToText(kp) });
    set({ wallet: c.address, walletName: w.name, name: profile.name, profile, step: null });
    void refreshBalance();
    void checkGuest();
    return true;
  } catch (e) {
    set({ step: null, error: readable(e) });
    return false;
  }
}

/** Does this browser's old guest key hold SOL or matches worth moving into the account? */
async function checkGuest() {
  const g = guestBurner();
  const s = useAccount.getState();
  if (!g || !s.profile || s.profile.guests.includes(g.publicKey.toBase58()) || g.publicKey.toBase58() === s.profile.burner) return;
  const [lamports, stats] = await Promise.all([
    baseConnection()
      .getBalance(g.publicKey, 'confirmed')
      .catch(() => 0),
    playerStats(SERVER, g.publicKey).catch(() => null),
  ]);
  const movable = lamports > BASE_FEE + RENT_EXEMPT_MIN ? lamports - BASE_FEE : 0;
  const matches = stats?.played ?? 0;
  if (movable > 0 || matches > 0) set({ offer: { lamports: movable, matches } });
}

/** Moves the guest key's SOL and matches into the account (silent: the guest key signs). */
export async function moveGuest(): Promise<string> {
  const g = guestBurner();
  const s = useAccount.getState();
  if (!g || !s.wallet) return 'Nothing to move';
  set({ step: 'move', error: null });
  try {
    const r = await migrateGuest(SERVER, g, myBurner(), s.wallet);
    set({ step: null, offer: null });
    void refreshBalance();
    void refreshProfile();
    return r.moved > 0 ? `Moved ${(r.moved / 1e9).toFixed(3).replace(/\.?0+$/, '')} SOL and your matches` : 'Your matches are in your account';
  } catch (e) {
    set({ step: null, error: readable(e) });
    return readable(e);
  }
}

export const skipGuest = () => set({ offer: null });

/** Signs out on this browser: forgets the cached game key. Connecting again brings it all back. */
export async function disconnect() {
  if (live) await disconnectWallet(live);
  live = null;
  cache(null);
  setAccountKey(null);
  setAccountName(null);
  set({ wallet: null, walletName: null, name: null, profile: null, offer: null, error: null, step: null });
  void refreshBalance();
}

/** Sets the account's display name (also the name in new matches). */
export async function rename(name: string): Promise<string | null> {
  try {
    const p = await saveName(SERVER, myBurner(), name);
    setAccountName(p.name);
    const c = readCache();
    if (c) cache({ ...c, name: p.name });
    set({ profile: p, name: p.name });
    return null;
  } catch (e) {
    return readable(e);
  }
}

/** "Add SOL from wallet": one wallet popup, wallet → game key. */
export async function addFromWallet(lamports: number): Promise<{ ok: boolean; text: string; signature?: string }> {
  try {
    const c = await wallet();
    const signature = await depositFromWallet(c, myBurner().publicKey, lamports);
    void refreshBalance();
    return { ok: true, text: `Added ${(lamports / 1e9).toFixed(3).replace(/\.?0+$/, '')} SOL`, signature };
  } catch (e) {
    return { ok: false, text: readable(e) };
  }
}

/** Withdraw from the game key to the connected wallet (no popup: the game key signs). */
export async function withdrawToMine(amount: number | 'all') {
  const w = useAccount.getState().wallet;
  if (!w) throw new Error('Connect a wallet first');
  return withdrawToWallet(baseConnection(), myBurner(), w, amount);
}

export const accountWallets = listWallets;
