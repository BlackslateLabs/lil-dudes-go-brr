// This device's side of live play: the server URL, the burner (made silently on first use, MVP
// §3.1), the player's name, the TEE session token, the match to rejoin after a reload, and the
// one-tab-at-a-time lock. Everything in localStorage is guarded (private windows can throw).
import { BURNER_KEY, deviceBurner, teeToken, type KeyStore } from '@lil-dudes/client';

/** The matchmaking server (apps/server). `VITE_SERVER_URL` in production; in dev the same host on
 *  :8787, so a phone on the LAN reaches `pnpm dev:server` on the laptop. */
export const SERVER: string =
  (import.meta.env.VITE_SERVER_URL as string | undefined)?.replace(/\/$/, '') ??
  `${window.location.protocol}//${window.location.hostname}:8787`;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* storage blocked */
  }
}

const store: KeyStore = { getItem: read, setItem: (k, v) => write(k, v) };

type Burner = ReturnType<typeof deviceBurner>;
let burner: Burner | null = null;

/** This device's burner keypair (made and saved on first call). */
export function myBurner(): Burner {
  burner ??= deviceBurner(store);
  return burner;
}

/** Has this device made a burner yet? (Recovery and balances wait until it has.) */
export const hasBurner = (): boolean => burner !== null || read(BURNER_KEY) !== null;

// --- name -------------------------------------------------------------------------------------

const NAME_KEY = 'ldgb.name';
const NAMES = ['Bean', 'Pip', 'Taco', 'Nugget', 'Biscuit', 'Pickle', 'Waffle', 'Noodle', 'Muffin', 'Dumpling', 'Sprout', 'Pebble', 'Turnip', 'Mochi', 'Gizmo', 'Button'];

/** "Lil Pickle": random once per device, ≤ 16 bytes (the on-chain name field). */
export function myName(): string {
  const saved = read(NAME_KEY);
  if (saved) return saved;
  const n = `Lil ${NAMES[Math.floor(Math.random() * NAMES.length)]}`;
  write(NAME_KEY, n);
  return n;
}

// --- TEE token (lasts ~30 days; cached for a week) ----------------------------------------------

const TEE_KEY = 'ldgb.tee';
const TEE_MAX_AGE_MS = 7 * 24 * 3600_000;

export async function myTeeToken(fresh = false): Promise<string> {
  const kp = myBurner();
  const pk = kp.publicKey.toBase58();
  if (!fresh) {
    try {
      const c = JSON.parse(read(TEE_KEY) ?? 'null') as { pk: string; token: string; at: number } | null;
      if (c && c.pk === pk && Date.now() - c.at < TEE_MAX_AGE_MS) return c.token;
    } catch {
      /* re-fetch */
    }
  }
  const token = await teeToken(kp);
  write(TEE_KEY, JSON.stringify({ pk, token, at: Date.now() }));
  return token;
}

// --- the match to rejoin after a reload ---------------------------------------------------------

export interface SavedMatch {
  id: string;
  stake: number;
  side: 0 | 1;
  /** Room code (rooms and rematches), if any. */
  code?: string;
  bot: boolean;
  oppName: string;
  at: number;
}

const LIVE_KEY = 'ldgb.live';
/** A live match is over within ~4 min of its start; after this long there's nothing to rejoin. */
const REJOIN_MS = 10 * 60_000;

export function saveMatch(m: SavedMatch | null) {
  write(LIVE_KEY, m ? JSON.stringify(m) : null);
}

export function savedMatch(): SavedMatch | null {
  try {
    const m = JSON.parse(read(LIVE_KEY) ?? 'null') as SavedMatch | null;
    if (!m || typeof m.id !== 'string' || Date.now() - m.at > REJOIN_MS) return null;
    return m;
  } catch {
    return null;
  }
}

// --- one tab at a time (MVP §4 "Two tabs, same burner") ----------------------------------------

const TAB_KEY = 'ldgb.tab';
const TAB_ID = Math.random().toString(36).slice(2);
const TAB_STALE_MS = 6_000;
let beat: ReturnType<typeof setInterval> | null = null;

/** Claims live play for this tab. False if another tab of this browser is in a live flow. */
export function claimTab(): boolean {
  try {
    const t = JSON.parse(read(TAB_KEY) ?? 'null') as { id: string; at: number } | null;
    if (t && t.id !== TAB_ID && Date.now() - t.at < TAB_STALE_MS) return false;
  } catch {
    /* claim it */
  }
  const mark = () => write(TAB_KEY, JSON.stringify({ id: TAB_ID, at: Date.now() }));
  mark();
  if (!beat) beat = setInterval(mark, 2_000);
  return true;
}

export function releaseTab() {
  if (beat) clearInterval(beat);
  beat = null;
  try {
    const t = JSON.parse(read(TAB_KEY) ?? 'null') as { id: string } | null;
    if (t?.id === TAB_ID) write(TAB_KEY, null);
  } catch {
    /* nothing to release */
  }
}
