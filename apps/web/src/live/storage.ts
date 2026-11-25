// The light half of device.ts: the server URL and guarded localStorage. No Solana imports, so the
// first screen can use it before the live code loads.
import { BURNER_KEY } from '@lil-dudes/client';

/** The matchmaking server (apps/server). `VITE_SERVER_URL` in production; in dev the same host on
 *  :8787, so a phone on the LAN reaches `pnpm dev:server` on the laptop. */
export const SERVER: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ??
  `${window.location.protocol}//${window.location.hostname}:8787`;

export function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

/** Where the signed-in account is cached (live/account.ts). */
export const ACCOUNT_KEY = 'ldgb.account';

/** Has this browser a key to play with (a guest burner or a signed-in account)? Reads storage only:
 *  device.ts `hasBurner()` is the same check once the live code has loaded. */
export const hasStoredKey = (): boolean => read(ACCOUNT_KEY) !== null || read(BURNER_KEY) !== null;
