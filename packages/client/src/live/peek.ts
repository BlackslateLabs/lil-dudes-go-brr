// "Try to cheat": the player's own browser really tries to read what's sealed in a live match
// (the true gate values and the seed in the Secrets account, the opponent's Scout account) over
// every read path a modified client could use, and shows what came back. During play the Private
// Ephemeral Rollup returns nothing for them, even with the player's real TEE login; after the end
// the same accounts are back on the base layer and public. Every attempt is a real request (the
// same paths as scripts/privacy-check.ts, which runs the full adversarial check as the opponent,
// a stranger and a token-less client).
import { BASE_RPC, SECRETS_LEN, TEE_RPC, PROGRAM_ID } from './chain';
import type { LiveSource } from './source';

/**
 * What a read gave back:
 * - `denied`: the RPC refused with an error;
 * - `hidden`: it answered, but as if the account weren't there (null value, not listed, no events);
 * - `zeroed`: the base-layer copy of a delegated account: real account, secret bytes all zero;
 * - `readable`: the bytes came back (expected after the match, and for public accounts);
 * - `failed`: the request itself failed (network): proves nothing either way.
 */
export type PeekOutcome = 'denied' | 'hidden' | 'zeroed' | 'readable' | 'failed';

export interface PeekAttempt {
  /** The RPC method, e.g. `getAccountInfo`. */
  method: string;
  /** What it tried to read, in words ("the true gate values + seed"). */
  target: string;
  /** Where: the rollup with your login, the rollup with no login, or the base layer. */
  via: 'rollup (your login)' | 'rollup (no login)' | 'base layer';
  outcome: PeekOutcome;
  /** The short answer: the RPC error text, "null", "0 of 12 listed", "56 bytes", … */
  detail: string;
  ms: number;
}

type RpcReply = { result?: unknown; error?: { message?: string; code?: number } };

const short = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Byte range of the Secrets account that holds the VRF output and both salts (see privacy-check). */
const SECRET_BYTES: [number, number] = [16, 112];

/**
 * Pure: classify one JSON-RPC reply. `kind` says what kind of read it was; `mine` (getProgramAccounts
 * / getSignaturesForAddress) is the address we hoped to find in the list.
 */
export function classifyRead(
  kind: 'account' | 'list' | 'signatures' | 'base-account',
  reply: RpcReply,
  mine?: string,
): { outcome: PeekOutcome; detail: string } {
  if (reply.error) return { outcome: 'denied', detail: short(reply.error.message ?? `error ${reply.error.code ?? ''}`.trim()) };
  const r = reply.result as unknown;
  if (kind === 'account' || kind === 'base-account') {
    const value = (r as { value?: { data?: [string, string] } | null } | undefined)?.value ?? null;
    if (!value) return { outcome: 'hidden', detail: 'null (no such account, as far as you can tell)' };
    const bytes = base64Bytes(value.data?.[0] ?? '');
    if (kind === 'base-account') {
      const [a, b] = SECRET_BYTES;
      const secret = bytes.subarray(a, Math.min(b, bytes.length));
      if (secret.length && secret.every((x) => x === 0)) return { outcome: 'zeroed', detail: `${bytes.length} bytes, the secret part all zeros` };
    }
    return { outcome: 'readable', detail: `${bytes.length} bytes` };
  }
  if (kind === 'list') {
    const list = Array.isArray(r) ? (r as { pubkey?: string }[]) : [];
    const found = mine ? list.some((x) => x.pubkey === mine) : false;
    return found ? { outcome: 'readable', detail: `listed (${list.length} accounts)` } : { outcome: 'hidden', detail: `not listed (${list.length} accounts returned)` };
  }
  const sigs = Array.isArray(r) ? r.length : 0;
  return sigs > 0 ? { outcome: 'readable', detail: `${sigs} signatures listed` } : { outcome: 'hidden', detail: 'no signatures listed' };
}

/** Pure: one line for the console, e.g. `getAccountInfo(true gate values + seed) → HIDDEN: null`. */
export function peekLine(a: PeekAttempt): string {
  const word = { denied: 'DENIED', hidden: 'NOTHING', zeroed: 'ZEROED', readable: 'READ', failed: 'NO ANSWER' }[a.outcome];
  return `${a.method}(${a.target}) via ${a.via} → ${word}: ${a.detail}`;
}

function base64Bytes(b64: string): Uint8Array {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return new Uint8Array();
  }
}

async function rpc(url: string, method: string, params: unknown[], signal?: AbortSignal): Promise<RpcReply> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal,
  });
  return (await res.json()) as RpcReply;
}

/** A websocket subscription held open for `ms`: notifications counted, or the error. */
function subscribeFor(wsUrl: string, method: string, params: unknown[], ms: number): Promise<RpcReply & { notes: number }> {
  return new Promise((resolve) => {
    let notes = 0;
    let reply: RpcReply = {};
    let ws: WebSocket;
    const done = () => {
      try {
        ws.close();
      } catch {
        /* closed */
      }
      resolve({ ...reply, notes });
    };
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      resolve({ error: { message: String(e instanceof Error ? e.message : e) }, notes });
      return;
    }
    const timer = setTimeout(done, ms);
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }));
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string }; params?: unknown };
      if (m.id === 1) {
        reply = m.error ? { error: m.error } : { result: m.result };
        if (m.error) {
          clearTimeout(timer);
          done();
        }
      } else if (m.params) notes++;
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reply = { error: { message: 'websocket refused' } };
      done();
    };
  });
}

export interface PeekOptions {
  /** Each attempt as it lands (the console prints them one by one). */
  onAttempt?: (a: PeekAttempt) => void;
  /** Also try the rollup with no login at all. Default true. */
  tokenless?: boolean;
  /** How long the subscription attempt listens (ms). Default 2500 (the secret state changes every tick). */
  listenMs?: number;
  signal?: AbortSignal;
}

/**
 * Tries every read path on the sealed accounts of `src`'s match, as this player:
 * 1. `getAccountInfo` on the Secrets account (true gate values, VRF seed, salts), with your login;
 * 2. `getAccountInfo` on the opponent's Scout account, with your login;
 * 3. `getMultipleAccounts` on both at once;
 * 4. `getProgramAccounts` filtered to Secrets-sized accounts (is ours listed?);
 * 5. `accountSubscribe` on Secrets for a few seconds (it changes every tick: any event = a leak);
 * 6. `getAccountInfo` on Secrets with no login (optional);
 * 7. `getAccountInfo` on the base-layer copy of Secrets: during play it's delegated and its secret
 *    bytes are zeros; after the match it holds the real values (public by design).
 * Runs one at a time (light on the rollup); never throws: a failed request is `failed`.
 */
export async function peekAttempts(src: LiveSource, opts: PeekOptions = {}): Promise<PeekAttempt[]> {
  const out: PeekAttempt[] = [];
  const a = src.accounts;
  const secrets = a.secrets.toBase58();
  const theirPeek = a.peeks[src.mySide === 0 ? 1 : 0].toBase58();
  const teeUrl = src.teeRpcUrl;
  const anonUrl = TEE_RPC;
  const baseUrl = src.baseRpcUrl ?? BASE_RPC;
  const enc = { encoding: 'base64', commitment: 'confirmed' };
  const theirs = src.view.sides[src.mySide === 0 ? 1 : 0].name || 'your opponent';

  const run = async (
    method: string,
    target: string,
    via: PeekAttempt['via'],
    go: () => Promise<{ outcome: PeekOutcome; detail: string }>,
  ) => {
    const t0 = Date.now();
    let r: { outcome: PeekOutcome; detail: string };
    try {
      r = await go();
    } catch (e) {
      r = { outcome: 'failed', detail: short(String(e instanceof Error ? e.message : e)) };
    }
    const attempt: PeekAttempt = { method, target, via, ...r, ms: Date.now() - t0 };
    out.push(attempt);
    opts.onAttempt?.(attempt);
  };
  const s = opts.signal;

  await run('getAccountInfo', 'true gate values + seed', 'rollup (your login)', async () => classifyRead('account', await rpc(teeUrl, 'getAccountInfo', [secrets, enc], s)));
  await run('getAccountInfo', `${theirs}'s Scout`, 'rollup (your login)', async () => classifyRead('account', await rpc(teeUrl, 'getAccountInfo', [theirPeek, enc], s)));
  await run('getMultipleAccounts', 'gate values + their Scout', 'rollup (your login)', async () => {
    const r = await rpc(teeUrl, 'getMultipleAccounts', [[secrets, theirPeek], enc], s);
    if (r.error) return classifyRead('account', r);
    const values = ((r.result as { value?: (unknown | null)[] } | undefined)?.value ?? []).filter(Boolean).length;
    return values ? { outcome: 'readable' as const, detail: `${values} of 2 came back` } : { outcome: 'hidden' as const, detail: 'both null' };
  });
  await run('getProgramAccounts', `every ${SECRETS_LEN}-byte account`, 'rollup (your login)', async () =>
    classifyRead('list', await rpc(teeUrl, 'getProgramAccounts', [PROGRAM_ID.toBase58(), { ...enc, filters: [{ dataSize: SECRETS_LEN }] }], s), secrets),
  );
  await run('accountSubscribe', 'gate values, live', 'rollup (your login)', async () => {
    const r = await subscribeFor(teeUrl.replace(/^http/, 'ws'), 'accountSubscribe', [secrets, enc], opts.listenMs ?? 2_500);
    if (r.error) return classifyRead('account', r);
    return r.notes > 0
      ? { outcome: 'readable' as const, detail: `${r.notes} updates received` }
      : { outcome: 'hidden' as const, detail: `subscribed, 0 updates in ${((opts.listenMs ?? 2_500) / 1000).toFixed(1)} s (it changes every tick)` };
  });
  if (opts.tokenless ?? true) {
    await run('getAccountInfo', 'true gate values + seed', 'rollup (no login)', async () => classifyRead('account', await rpc(anonUrl, 'getAccountInfo', [secrets, enc], s)));
  }
  await run('getAccountInfo', 'true gate values + seed', 'base layer', async () => classifyRead('base-account', await rpc(baseUrl, 'getAccountInfo', [secrets, enc], s)));
  return out;
}
