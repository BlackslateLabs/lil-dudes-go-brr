// Light handles for the live flows. Each one loads the live code (live/account.ts, then
// live/session.ts, with @solana/web3.js) on first use, so Home, the VS screen and the offline bot
// match never wait for it. Home prefetches it once it's idle, so a tap on FIND MATCH stays instant.
//
// account.ts loads first on purpose: it restores the signed-in game key from this browser's cache
// at load, so no flow can run with the guest key while an account is signed in.

type Session = typeof import('./session');
type Account = typeof import('./account');

let liveLoad: Promise<Session> | null = null;
/** The live code (account first, then the session flows). Loaded once. */
export function loadLive(): Promise<Session> {
  liveLoad ??= import('./account').then(() => import('./session'));
  return liveLoad;
}
const account = (): Promise<Account> => loadLive().then(() => import('./account'));

/** Fetch the live code in the background once the page is idle. */
export function prefetchLive() {
  const go = () => void loadLive().catch(() => {
    liveLoad = null; // offline or a failed chunk: try again on the next use
  });
  const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (ric) ric(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

export const quickMatch = (stake: number) => loadLive().then((m) => m.quickMatch(stake));
export const hostRoom = (stake: number) => loadLive().then((m) => m.hostRoom(stake));
export const lookupRoom = (code: string) => loadLive().then((m) => m.lookupRoom(code));
export const checkResume = () => loadLive().then((m) => m.checkResume());
export const resume = () => loadLive().then((m) => m.resume());
export const recoverStale = () => loadLive().then((m) => m.recoverStale());
export const refreshBalance = () => loadLive().then((m) => m.refreshBalance());
export const topUpFor = (stake: number) => loadLive().then((m) => m.topUpFor(stake));
export const rematch = () => loadLive().then((m) => m.rematch());
export const leave = () => void loadLive().then((m) => m.leave());
export const sweepGuest = () => account().then((m) => m.sweepGuest());
