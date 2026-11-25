// The player's account in the web app: connect a Solana wallet, derive the game key from it
// (packages/client src/live/account.ts), link it the first time, and play with it. A wallet is
// needed for staked play only; guests keep their browser burner for the bot and free online play.
//
// What this browser keeps:
// - `ldgb.account` = { wallet, walletName, name, key }: `key` is the derived game key (base58), a
//   cache with the same trust as the guest burner, so a reload needs no popup. Disconnect drops it;
//   connecting the same wallet signs the same message and rebuilds the same key.
// - The guest burner (`ldgb.burner`) is never deleted: refunds or late payouts of guest-era matches
//   can still land on it, and every check sweeps them into the account.
// - `ldgb.guestOwner`: the account that took this browser's guest key (the first to connect here).
// - `ldgb.retiredKeys`: { wallet: key } game keys of accounts that disconnected here, so a wallet
//   whose signature changed (a new game key) still gets its old SOL swept across.
// No wallet secret is ever stored.
import {
  accountProfile,
  baseConnection,
  BASE_FEE,
  connectWallet,
  depositFromWallet,
  disconnectWallet,
  keyFromText,
  keyToText,
  linkAccount,
  listWallets,
  mergeGuestHistory,
  PublicKey,
  ServerError,
  setAccountName as saveName,
  deriveBurner,
  sweepable,
  sweepKey,
  withdrawToWallet,
  type AccountProfile,
  type ConnectedWallet,
  type GameWallet,
} from '@lil-dudes/client';
import { sol } from '../screens/format';
import { guestBurner, myBurner, read, savedMatch, SERVER, setAccountKey, setAccountName, write } from './device';
import { ACCOUNT_KEY } from './storage';
import { refreshBalance, syncCooldown, useLive } from './session';

const GUEST_OWNER = 'ldgb.guestOwner';
const GUEST_MERGED = 'ldgb.guestMerged';
const RETIRED = 'ldgb.retiredKeys';

interface Cached {
  wallet: string;
  walletName: string;
  name: string | null;
  key: string;
}

import { useAccount, type AccountState } from './accountStore';

// The store and its types live in ./accountStore (light); re-exported for the screens.
export { signedIn, useAccount } from './accountStore';
export type { AccountState, ConnectStep, Stuck } from './accountStore';

const set = (p: Partial<AccountState>) => useAccount.setState(p);
const say = (text: string) => set({ notice: { text, at: Date.now() } });


const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;

function readCache(): Cached | null {
  try {
    const c = JSON.parse(read(ACCOUNT_KEY) ?? 'null') as Cached | null;
    return c && typeof c.wallet === 'string' && typeof c.key === 'string' ? c : null;
  } catch {
    return null;
  }
}

function cache(c: Cached | null) {
  write(ACCOUNT_KEY, c ? JSON.stringify(c) : null);
}

function retired(): Record<string, string> {
  try {
    const r = JSON.parse(read(RETIRED) ?? '{}') as Record<string, string> | null;
    return r && typeof r === 'object' ? r : {};
  } catch {
    return {};
  }
}

function setRetired(wallet: string, key: string | null) {
  const r = retired();
  if (key) r[wallet] = key;
  else delete r[wallet];
  write(RETIRED, Object.keys(r).length ? JSON.stringify(r) : null);
}

/** Restores a signed-in account from this browser's cache (no popup). Runs once, at start. */
function restore() {
  const c = readCache();
  const kp = keyFromText(c?.key);
  if (!c || !kp) return;
  setAccountKey(kp);
  setAccountName(c.name);
  set({ wallet: c.wallet, walletName: c.walletName, name: c.name });
  syncCooldown();
  void refreshProfile();
}
restore();

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
  return m.replace(/^POST \/account\/[\w-]+: /, '').replace(/^\w/, (x) => x.toUpperCase());
};

/**
 * Why connecting (or switching key) right now would strand something, or null if it's safe. A
 * queue ticket, an open room or a live match belongs to the key that started it: finish or leave
 * it first (its refund paths stay on that key).
 */
export function connectBlocked(): string | null {
  const s = useLive.getState();
  if (s.phase === 'queue') return "You're in the queue. Leave it first, then connect.";
  if (s.phase === 'host' || s.phase === 'join') return 'Your room is still open. Close it first, then connect.';
  if (s.phase === 'starting' || s.phase === 'playing' || savedMatch()) return 'Your live match is still on. Finish it first, then connect.';
  if (s.resume?.kind === 'queue') return "You're still in the queue. Leave it from Home first, then connect.";
  if (s.resume?.kind === 'room') return 'Your room is still open. Close it from Home first, then connect.';
  if (s.resume?.kind === 'match') return 'Your live match is still on. Finish it first, then connect.';
  return null;
}

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
 * once more to link it. Then everything this browser holds moves in before it returns, so the
 * balance and stake checks right after (FIND MATCH) already see it. `step` says which popup is up.
 */
export async function connect(w: GameWallet): Promise<boolean> {
  const blocked = connectBlocked();
  if (blocked) {
    set({ error: blocked });
    return false;
  }
  set({ error: null, step: 'connect', lost: null });
  try {
    const c = await connectWallet(w);
    set({ step: 'derive' });
    const kp = await deriveBurner(c);
    const pk = kp.publicKey.toBase58();
    let profile = await accountProfile(SERVER, c.address);
    // A known account whose game key came out different: the wallet signed differently this time.
    // The server keeps the old key as a guest link (its matches stay); its SOL must follow too.
    const previous = profile && profile.burner !== pk ? profile.burner : null;
    if (!profile || previous) {
      set({ step: 'link' });
      profile = await linkAccount(SERVER, c, kp);
    }
    live = c;
    setAccountKey(kp);
    setAccountName(profile.name);
    cache({ wallet: c.address, walletName: w.name, name: profile.name, key: keyToText(kp) });
    set({ wallet: c.address, walletName: w.name, name: profile.name, profile, step: 'move' });
    syncCooldown();
    // Same key as last time here: no need to keep the retired copy.
    const old = keyFromText(retired()[c.address]);
    if (old && old.publicKey.toBase58() === pk) setRetired(c.address, null);
    if (previous) await sweepOld(previous, w.name);
    await sweepGuest();
    set({ step: null });
    void refreshBalance();
    return true;
  } catch (e) {
    set({ step: null, error: readable(e) });
    return false;
  }
}

/** An older game key of this wallet: sweep it if this browser still has it, else show it. */
async function sweepOld(previous: string, walletName: string) {
  const s = useAccount.getState();
  if (!s.wallet) return;
  const candidates = [keyFromText(retired()[s.wallet])].filter((k): k is NonNullable<typeof k> => !!k && k.publicKey.toBase58() === previous);
  const kp = candidates[0];
  if (!kp) {
    const bal = await baseConnection()
      .getBalance(new PublicKey(previous), 'confirmed')
      .catch(() => null);
    if (bal === null || bal > BASE_FEE) set({ lost: { address: previous, walletName } });
    return;
  }
  try {
    const r = await sweepKey(kp, myBurner().publicKey);
    if (r.moved > 0) say(`Moved ${sol(r.moved)} SOL from your previous game wallet`);
    setRetired(s.wallet, null);
  } catch {
    set({ stuck: { lamports: 0, from: 'old', address: previous } });
  }
}

let sweeping: Promise<void> | null = null;

/**
 * Moves this browser's guest SOL (minus the fee) into the signed-in account, and folds the guest's
 * matches in (once). Automatic, no question asked: same person, same device. Safe to call often
 * (on connect, on Home, after a recovery): one sweep at a time, and a failure just leaves a note
 * and retries next time. Never touches a guest key that another account took first, or one that
 * is still in a live flow.
 */
export function sweepGuest(): Promise<void> {
  sweeping ??= doSweep().finally(() => {
    sweeping = null;
  });
  return sweeping;
}

async function doSweep() {
  const s = useAccount.getState();
  const g = guestBurner();
  if (!s.wallet || !g) return;
  const acct = myBurner();
  if (g.publicKey.equals(acct.publicKey)) return;
  const address = g.publicKey.toBase58();
  const owner = read(GUEST_OWNER);
  const base = baseConnection();
  if (owner && owner !== s.wallet) {
    // The first account to connect here took this guest wallet: its SOL waits for that account.
    const bal = await base.getBalance(g.publicKey, 'confirmed').catch(() => 0);
    set({ stuck: sweepable(bal, 1) > 0 ? { lamports: sweepable(bal, 1), from: 'other', address, owner } : null });
    return;
  }
  // (Connecting is blocked while a guest-era ticket, room or match runs, and once signed in live
  // play uses the account's key, so sweeping the guest key never pulls a stake out of a flow.)
  try {
    const r = await sweepKey(g, acct.publicKey, base);
    write(GUEST_OWNER, s.wallet);
    set({ stuck: null });
    if (r.moved > 0) {
      say(`Moved ${sol(r.moved)} SOL from this browser into your account`);
      void refreshBalance();
    }
  } catch {
    const bal = await base.getBalance(g.publicKey, 'confirmed').catch(() => null);
    const left = bal === null ? 0 : sweepable(bal, 1);
    if (left > 0) set({ stuck: { lamports: left, from: 'guest', address } });
  }
  if (read(GUEST_MERGED) !== s.wallet) {
    try {
      await mergeGuestHistory(SERVER, g, acct, s.wallet);
      write(GUEST_MERGED, s.wallet);
      write(GUEST_OWNER, s.wallet);
      void refreshProfile();
    } catch {
      /* the server was down or busy: next check tries again */
    }
  }
}

/** Profile's "Move it" for a stuck guest balance: try the sweep again now. */
export async function moveGuest(): Promise<string> {
  await sweepGuest();
  const st = useAccount.getState().stuck;
  return st && st.from === 'guest' ? "Couldn't move it yet. Try again in a moment." : 'Moved into your account';
}

/**
 * Signs out on this browser. The account's SOL stays on its game key and comes back on reconnect;
 * the key is kept aside so a wallet that signs differently next time still gets its SOL swept.
 */
export async function disconnect() {
  const c = readCache();
  if (c) setRetired(c.wallet, c.key);
  if (live) await disconnectWallet(live).catch(() => undefined);
  live = null;
  cache(null);
  setAccountKey(null);
  setAccountName(null);
  set({ wallet: null, walletName: null, name: null, profile: null, stuck: null, lost: null, error: null, step: null });
  syncCooldown();
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
    return { ok: true, text: `Added ${sol(lamports)} SOL`, signature };
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
export { shortAddr };
