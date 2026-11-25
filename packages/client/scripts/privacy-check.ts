// M4 privacy re-check of the REAL lil_dudes program on devnet + the TEE (Stage 0 check 2, redone).
// A free live match, bot vs bot through two LiveSources (A = side 0, B = side 1). While it runs,
// the opponent B (its own TEE token) and a stranger C (a third token) and a token-less client try
// every read path on A's secrets: Secrets, A's Peek, and the tx data of A's request_seed /
// peek_cell (getAccountInfo, getMultipleAccounts, getProgramAccounts,
// getTransaction, getSignaturesForAddress, accountSubscribe, programSubscribe, logsSubscribe).
// Every payload they receive is decoded (base64 / base58 → hex) and searched for A's salt, the
// peek instruction data, A's Peek bytes and (after the match, from base) the VRF output and
// both salts. Positive controls make sure each channel is alive. Public-state invariants are
// checked on every Match snapshot (no seed / history before finish, no revealed gate in a plant or transit).
//   pnpm --filter @lil-dudes/client exec tsx scripts/privacy-check.ts
// Funds come from the Solana CLI wallet (~/.config/solana/id.json; loaded to sign, never printed).
import { Bot } from '@lil-dudes/sim-wasm';
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from '@solana/web3.js';
import bs58 from 'bs58';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baseConnection,
  chain,
  closeMatch,
  createMatch,
  delegateMatch,
  initSim,
  isOnBase,
  joinMatch,
  LiveSource,
  TEE_RPC,
  teeToken,
  waitForStatus,
} from '../src/index';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEYS = path.join(HERE, 'keys'); // gitignored
const OUT = path.join(HERE, 'out');
fs.mkdirSync(KEYS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...a);
const loadKey = (file: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8')) as number[]));
function key(name: string): Keypair {
  const p = path.join(KEYS, `${name}.json`);
  if (!fs.existsSync(p)) fs.writeFileSync(p, JSON.stringify(Array.from(Keypair.generate().secretKey)));
  return loadKey(p);
}
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

// --- what each prober received (for the leak search) ----------------------------------------

type Who = 'A' | 'B' | 'C' | 'anon';
const corpus: Record<Who, { t: number; s: string }[]> = { A: [], B: [], C: [], anon: [] };
/** When the first FINISHED Match snapshot arrived: after it everything is public by design. */
let finishedAt = Infinity;
/** Every string in `x`, plus its base64 / base58 decodings as hex (needles are hex). */
function absorb(who: Who, x: unknown) {
  const t = Date.now();
  const add = (s: string) => corpus[who].push({ t, s });
  const walk = (v: unknown) => {
    if (typeof v === 'string') {
      add(v.toLowerCase());
      if (v.length >= 12 && /^[A-Za-z0-9+/]+=*$/.test(v)) add(Buffer.from(v, 'base64').toString('hex'));
      if (v.length >= 12 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(v)) {
        try {
          add(hex(bs58.decode(v)));
        } catch {
          /* not base58 */
        }
      }
      // "Program data: <b64>" log lines
      const m = /^Program (?:data|return): (?:\S+ )?([A-Za-z0-9+/=]+)$/.exec(v);
      if (m) add(Buffer.from(m[1]!, 'base64').toString('hex'));
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(x);
}

async function rpc(url: string, method: string, params: unknown[]): Promise<{ result?: unknown; error?: { message: string } }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  return (await res.json()) as { result?: unknown; error?: { message: string } };
}

/** Raw websocket subscriptions; counts notifications per label and absorbs every payload. */
function listen(who: Who, wsUrl: string, subs: [string, string, unknown[]][]) {
  const counts: Record<string, number> = Object.fromEntries(subs.map(([label]) => [label, 0]));
  const afterFinish: Record<string, number> = Object.fromEntries(subs.map(([label]) => [label, 0]));
  const errors: Record<string, string> = {};
  const ws = new WebSocket(wsUrl);
  const byReq = new Map<number, string>();
  const bySub = new Map<number, string>();
  ws.onopen = () =>
    subs.forEach(([label, method, params], i) => {
      byReq.set(i + 1, label);
      ws.send(JSON.stringify({ jsonrpc: '2.0', id: i + 1, method, params }));
    });
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string }; params?: { subscription: number; result: unknown } };
    if (m.id !== undefined) {
      const label = byReq.get(m.id)!;
      if (typeof m.result === 'number') bySub.set(m.result, label);
      else errors[label] = m.error?.message ?? JSON.stringify(m.result);
      return;
    }
    if (!m.params) return;
    const label = bySub.get(m.params.subscription);
    if (!label) return;
    if (Date.now() < finishedAt) counts[label]!++;
    else afterFinish[label]!++;
    absorb(who, m.params.result);
  };
  return { counts, afterFinish, errors, close: () => ws.close() };
}

/** getTransaction as `url` sees it: 'full' (keys/instructions/logs), 'redacted' (slot/err only) or 'none'. */
async function txView(who: Who, url: string, sig: string) {
  const r = await rpc(url, 'getTransaction', [sig, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }]);
  absorb(who, r);
  const t = r.result as { transaction?: { message?: { accountKeys?: string[]; instructions?: unknown[] } }; meta?: { logMessages?: string[] } } | null | undefined;
  if (!t) return { view: 'none' as const, keys: [] as string[] };
  const keys = t.transaction?.message?.accountKeys ?? [];
  const full = keys.length > 0 || (t.transaction?.message?.instructions?.length ?? 0) > 0 || (t.meta?.logMessages?.length ?? 0) > 0;
  return { view: full ? ('full' as const) : ('redacted' as const), keys };
}

async function main() {
  initSim();
  const base = baseConnection();
  const funder = loadKey(path.join(os.homedir(), '.config/solana/id.json'));
  const [walletA, walletB] = [key('wallet-a'), key('wallet-b')];
  const startBalance = await base.getBalance(funder.publicKey, 'confirmed');
  for (const [w, want] of [[walletA, 40_000_000], [walletB, 5_000_000]] as const) {
    const have = await base.getBalance(w.publicKey, 'confirmed');
    if (have < want) await chain.send(base, [SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: w.publicKey, lamports: want - have })], [funder]);
  }
  const [bA, bB, bC] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const { id } = await createMatch(base, walletA, { stake: 0, burner: bA.publicKey, name: 'Probe A' });
  await joinMatch(base, walletB, { id, stake: 0, burner: bB.publicKey, name: 'Probe B' });
  await waitForStatus(base, id, chain.Status.JOINED);
  await delegateMatch(base, walletA, id);
  const a = chain.matchAccounts(id);
  log('match', id.toString(), 'delegated; Match', a.game.toBase58());

  const [tA, tB, tC] = await Promise.all([bA, bB, bC].map((k) => teeToken(k)));
  const url: Record<Who, string> = { A: `${TEE_RPC}?token=${tA}`, B: `${TEE_RPC}?token=${tB}`, C: `${TEE_RPC}?token=${tC}`, anon: TEE_RPC };
  const ws = (u: string) => u.replace(/^http/, 'ws');
  const connA = chain.teeConnection(tA!);
  for (let i = 0; i < 120 && !(await connA.getAccountInfo(a.game)); i++) await sleep(250);
  const P = chain.PROGRAM_ID.toBase58();
  const k = { secrets: a.secrets.toBase58(), peek0: a.peeks[0].toBase58(), peek1: a.peeks[1].toBase58(), match: a.game.toBase58() };
  const enc = { encoding: 'base64', commitment: 'confirmed' };

  // Subscriptions of the opponent, the stranger and a token-less client, opened BEFORE anything secret is written.
  const subsFor = (): [string, string, unknown[]][] => [
    ['accountSubscribe(Secrets)', 'accountSubscribe', [k.secrets, enc]],
    ['accountSubscribe(Peek0)', 'accountSubscribe', [k.peek0, enc]],
    ['accountSubscribe(Peek1)', 'accountSubscribe', [k.peek1, enc]],
    ['accountSubscribe(Match)', 'accountSubscribe', [k.match, enc]],
    ['programSubscribe', 'programSubscribe', [P, enc]],
    ['logsSubscribe(program)', 'logsSubscribe', [{ mentions: [P] }, { commitment: 'confirmed' }]],
    ['logsSubscribe(Secrets)', 'logsSubscribe', [{ mentions: [k.secrets] }, { commitment: 'confirmed' }]],
    ['logsSubscribe(Peek0)', 'logsSubscribe', [{ mentions: [k.peek0] }, { commitment: 'confirmed' }]],
    ['logsSubscribe(Peek1)', 'logsSubscribe', [{ mentions: [k.peek1] }, { commitment: 'confirmed' }]],
  ];
  const listeners = { B: listen('B', ws(url.B), subsFor()), C: listen('C', ws(url.C), subsFor()), anon: listen('anon', ws(url.anon), subsFor()) };

  // C watches the public Match feed for the invariants.
  const invariants = { snapshots: 0, plantSnapshots: 0, seedBeforeFinish: 0, historyBeforeFinish: 0, revealedInPlant: 0 };
  const watcher = new WebSocket(ws(url.C));
  watcher.onopen = () => watcher.send(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'accountSubscribe', params: [k.match, enc] }));
  watcher.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data)) as { params?: { result: { value: { data: [string, string] } | null } } };
    const v = m.params?.result.value;
    if (!v) return;
    const acc = chain.decodeMatch(Buffer.from(v.data[0], 'base64'));
    invariants.snapshots++;
    if (acc.header.status >= chain.Status.FINISHED) finishedAt = Math.min(finishedAt, Date.now());
    if (acc.header.status < chain.Status.FINISHED) {
      if (acc.header.seed !== 0n) invariants.seedBeforeFinish++;
      if (acc.header.history.some((b) => b !== 255)) invariants.historyBeforeFinish++;
    }
    if (acc.header.status === chain.Status.PLAYING) {
      // Plant / Transit (phase codes 0 / 2): a fresh stage, every gate face-down.
      for (const s of acc.state.sides) {
        if (s.phase !== 0 && s.phase !== 2) continue;
        invariants.plantSnapshots++;
        for (const g of s.gates) if (g.revealed) invariants.revealedInPlant++;
      }
    }
  };
  await sleep(1_500);

  // Setup by hand for A (so A's salt is known and tagged), the rest auto-driven.
  const sigs: { who: 'A' | 'B'; what: string; sig: string; data?: string }[] = [];
  await chain.send(connA, [chain.ixs.initPermissions(a, bA.publicKey)], [bA], { cu: 400_000 });
  const saltA = Buffer.concat([Buffer.from('LDGBRSALT'), Buffer.from(crypto.getRandomValues(new Uint8Array(23)))]);
  const saltIx = chain.ixs.requestSeed(a, bA.publicKey, saltA);
  sigs.push({ who: 'A', what: 'request_seed', sig: await chain.send(connA, [saltIx], [bA], { cu: 300_000 }), data: hex(saltIx.data) });
  log('A salt sent (tagged)');

  // Two LiveSources + bots; each side scouts (peeks) every stage (forced if the bot doesn't).
  const sources: LiveSource[] = [];
  const burners = [bA, bB];
  for (const side of [0, 1] as const) {
    const who = side === 0 ? 'A' : 'B';
    const src = await LiveSource.connect({
      matchId: id,
      burner: burners[side]!,
      token: side === 0 ? tA : tB,
      onTx: (what, sig) => sigs.push({ who, what, sig }),
    });
    sources.push(src);
  }
  const bots = [new Bot(0, 0xa11cen ^ id), new Bot(1, 0xb0bn ^ id)];
  const cellsSent: { side: number; what: string; cell: number; phase: number }[] = [];
  const note = (side: number, what: string, cell: number, phase: number) => {
    if (!cellsSent.some((c) => c.side === side && c.what === what && c.phase === phase && c.cell === cell)) cellsSent.push({ side, what, cell, phase });
  };
  for (const [side, src] of sources.entries()) {
    src.subscribe((view) => {
      if (view.status !== 'playing') return;
      const [aim, peek, champion] = bots[side]!.decide(src.latestBytes);
      if (aim! >= 0) src.setAim(aim!);
      if (champion === 1) src.champion();
      const me = view.sides[side]!;
      if ((me.phase === 'fight' || me.phase === 'rush') && !me.peekUsed && (peek! >= 0 || view.tick % 40 === 0)) {
        const cell = peek! >= 0 ? peek! : me.gates.findIndex((g) => !g.revealed && !g.timing);
        if (cell >= 0) {
          src.peek(cell);
          note(side, 'peek', cell, me.stage);
        }
      }
    });
    src.start();
  }

  // --- probes during play ---------------------------------------------------------------------
  const probes: Record<string, unknown> = {};
  const fails: string[] = [];
  const controls: Record<string, boolean> = {};
  const accountReads = async (label: string) => {
    const out: Record<string, Record<string, string>> = {};
    for (const who of ['A', 'B', 'C', 'anon'] as Who[]) {
      out[who] = {};
      const multi = await rpc(url[who], 'getMultipleAccounts', [[k.secrets, k.peek0, k.peek1, k.match], enc]);
      absorb(who, multi);
      const mv = (multi.result as { value?: (unknown | null)[] } | undefined)?.value ?? [];
      for (const [name, pk] of Object.entries(k)) {
        const r = await rpc(url[who], 'getAccountInfo', [pk, enc]);
        absorb(who, r);
        const visible = !!(r.result as { value?: unknown } | undefined)?.value;
        out[who][name] = visible ? 'visible' : r.error ? `error: ${r.error.message.slice(0, 60)}` : 'null';
        out[who][`${name} (multi)`] = mv[Object.keys(k).indexOf(name)] ? 'visible' : 'null';
      }
      for (const size of [chain.MATCH_LEN, chain.SECRETS_LEN, chain.PEEK_LEN]) {
        const g = await rpc(url[who], 'getProgramAccounts', [P, { ...enc, filters: [{ dataSize: size }] }]);
        absorb(who, g);
        const keys = ((g.result as { pubkey: string }[] | undefined) ?? []).map((x) => x.pubkey);
        out[who][`gpa(${size} B)`] = `${keys.length} accounts; ours: ${Object.entries(k).filter(([, pk]) => keys.includes(pk)).map(([n]) => n).join(',') || 'none'}`;
      }
    }
    probes[`accounts ${label}`] = out;
    // FAIL: anyone but the member sees a private account.
    for (const who of ['A', 'B', 'C', 'anon'] as Who[]) {
      for (const [name, member] of [['secrets', null], ['peek0', 'A'], ['peek1', 'B']] as const) {
        if (member === who) continue;
        for (const via of [name, `${name} (multi)`]) if (out[who]![via] === 'visible') fails.push(`${who} reads ${via} (${label})`);
        if (out[who]![`gpa(${name === 'secrets' ? chain.SECRETS_LEN : chain.PEEK_LEN} B)`]?.includes(name)) fails.push(`${who} lists ${name} via getProgramAccounts (${label})`);
      }
    }
    controls[`A reads own Peek0 (${label})`] = out.A!.peek0 === 'visible';
    controls[`B reads own Peek1 (${label})`] = out.B!.peek1 === 'visible';
    controls[`everyone reads Match (${label})`] = (['A', 'B', 'C', 'anon'] as Who[]).every((w) => out[w]!.match === 'visible');
  };
  const txReads = async (label: string) => {
    const out: Record<string, Record<string, string>> = {};
    const secretSigs = sigs.filter((s) => ['request_seed', 'peek_cell'].includes(s.what));
    for (const s of sigs.filter((x) => x.what !== 'set_aim').concat(sigs.filter((x) => x.what === 'set_aim').slice(0, 2))) {
      const row: Record<string, string> = {};
      for (const who of ['A', 'B', 'C', 'anon'] as Who[]) {
        const v = await txView(who, url[who], s.sig);
        row[who] = v.view;
        const secret = secretSigs.includes(s);
        const own = s.who === who;
        if (secret && !own && v.view === 'full') fails.push(`${who} reads ${s.who}'s ${s.what} tx in full (${label})`);
      }
      out[`${s.who} ${s.what} ${s.sig.slice(0, 8)}`] = row;
    }
    probes[`getTransaction ${label}`] = out;
    const aAim = sigs.find((s) => s.who === 'A' && s.what === 'set_aim');
    if (aAim) controls[`B reads A's public set_aim in full (${label})`] = out[`A set_aim ${aAim.sig.slice(0, 8)}`]?.B === 'full';
    // Listing: A's secret txs must not show up for B / C / anon.
    const lists: Record<string, string> = {};
    for (const who of ['B', 'C', 'anon'] as Who[]) {
      for (const [name, pk] of [['Secrets', k.secrets], ['Peek0', k.peek0], ['Match', k.match], ['program', P], ['burnerA', bA.publicKey.toBase58()]]) {
        const r = await rpc(url[who], 'getSignaturesForAddress', [pk, { limit: 1000, commitment: 'confirmed' }]);
        absorb(who, r);
        const listed = ((r.result as { signature: string }[] | undefined) ?? []).map((x) => x.signature);
        const ours = secretSigs.filter((s) => s.who === 'A' && listed.includes(s.sig));
        lists[`${who} ${name}`] = r.error ? `error: ${r.error.message.slice(0, 60)}` : `${listed.length} sigs; A's secret txs listed: ${ours.length}`;
        if (ours.length) fails.push(`${who} lists ${ours.length} of A's secret txs via ${name} (${label})`);
        // Any tx this reader can read in full must not touch Secrets or a Peek it isn't a member of.
        for (const sig of listed.slice(0, 40)) {
          const v = await txView(who, url[who], sig);
          const touched = v.keys.filter((x) => x === k.secrets || (x === k.peek0 && who !== 'A') || (x === k.peek1 && who !== 'B'));
          if (v.view === 'full' && touched.length) fails.push(`${who} reads a full tx ${sig.slice(0, 8)} touching a private account (${label})`);
        }
      }
    }
    probes[`getSignaturesForAddress ${label}`] = lists;
  };

  // Base layer during play: the delegated Secrets on base still holds its creation-time bytes.
  const baseSecretsDuring = async () => {
    const info = await base.getAccountInfo(a.secrets, 'confirmed');
    const d = info?.data ?? new Uint8Array();
    return { owner: info?.owner.toBase58(), zeroVrfAndSalts: d.subarray(16, 16 + 96).every((b) => b === 0), zeroState: d.subarray(112).every((b) => b === 0) };
  };

  let probed = false;
  for (;;) {
    const v = sources[0]!.view;
    const done = sources.every((s) => s.currentStage === 'finished') || (sources.some((s) => s.currentStage !== 'playing' && s.currentStage !== 'setup') && (await isOnBase(base, id)));
    // Probe once A has scouted in Fight 1, and again in Fight 2.
    const aPeek = sigs.some((s) => s.who === 'A' && s.what === 'peek_cell');
    if (!probed && aPeek && v.status === 'playing') {
      probed = true;
      log('probing mid-match at tick', v.tick);
      probes.baseSecretsDuringPlay = await baseSecretsDuring();
      await accountReads('mid-match');
      await txReads('mid-match');
      log('mid-match probes done at tick', sources[0]!.view.tick, 'fails so far', fails.length);
    }
    if (probed && v.sides[0].stage === 1 && !probes['accounts fight 2'] && v.status === 'playing') {
      log('probing in Fight 2 at tick', v.tick);
      await accountReads('fight 2');
      await txReads('fight 2');
    }
    if (done) break;
    if (Date.now() - t0 > 8 * 60_000) throw new Error('timeout');
    await sleep(250);
  }
  const final = await sources[0]!.awaitFinal(base);
  log('finished; result', final?.state.result, 'tick', final?.state.tick);
  // A's Peek as A saw it (needle), before the sources go away.
  const peekA = await rpc(url.A, 'getAccountInfo', [k.peek0, enc]);
  const peekABytes = (peekA.result as { value?: { data: [string, string] } } | undefined)?.value?.data[0];
  await sleep(3_000);
  for (const l of Object.values(listeners)) l.close();
  watcher.close();
  for (const s of sources) s.dispose();

  // --- needles ----------------------------------------------------------------------------------
  for (let i = 0; i < 60 && !(await isOnBase(base, id)); i++) await sleep(1_000);
  const sec = (await base.getAccountInfo(a.secrets, 'confirmed'))?.data;
  const needles: Record<string, string> = { 'A salt': hex(saltA), 'A request_seed ix data': sigs[0]!.data! };
  if (sec) {
    needles['VRF output (base, after)'] = hex(sec.subarray(16, 48));
    needles['salt 1 (B, base, after)'] = hex(sec.subarray(80, 112));
    needles['secret state bytes 8..40'] = hex(sec.subarray(112 + 8, 112 + 40));
  }
  if (peekABytes) needles['A Peek account bytes (56 B)'] = Buffer.from(peekABytes, 'base64').toString('hex');
  // Scout instruction data (discriminator + cell, 9 B) of both sides, every phase.
  const ixData = (c: { side: number; what: string; cell: number }) => hex(chain.ixs.peekCell(a, PublicKey.default, 0, c.cell).data);
  const leaks: string[] = [];
  for (const who of ['B', 'C', 'anon'] as Who[]) {
    const pre = corpus[who].filter((e) => e.t < finishedAt).map((e) => e.s);
    const hay = pre.join('|');
    for (const [name, n] of Object.entries(needles)) {
      if (name.startsWith('salt 1') && who === 'B') continue; // B's own salt
      if (hay.includes(n)) leaks.push(`${who}: ${name}`);
    }
    // 9-byte needles: whole decoded strings only (the instruction data field). B may see its own.
    const own = new Set(cellsSent.filter((c) => who === 'B' && c.side === 1).map(ixData));
    for (const c of cellsSent) {
      const n = ixData(c);
      if (own.has(n)) continue;
      if (pre.some((x) => x === n)) leaks.push(`${who}: side ${c.side} ${c.what} ix data (stage ${c.phase + 1}, slot ${c.cell})`);
    }
  }
  for (const l of leaks) fails.push(`leak: ${l}`);
  if (invariants.seedBeforeFinish || invariants.historyBeforeFinish || invariants.revealedInPlant) fails.push(`public-state invariant broken ${JSON.stringify(invariants)}`);
  const subs = Object.fromEntries(Object.entries(listeners).map(([w, l]) => [w, { beforeFinish: l.counts, afterFinish: l.afterFinish, errors: l.errors }]));
  for (const [w, l] of Object.entries(listeners)) {
    for (const [label, n] of Object.entries(l.counts)) {
      const priv = label.includes('Secrets') || (label.includes('Peek0') && w !== 'A') || (label.includes('Peek1') && w !== 'B');
      if (priv && n > 0) fails.push(`${w} got ${n} notifications on ${label}`);
    }
  }
  controls['B accountSubscribe(own Peek1) > 0'] = listeners.B.counts['accountSubscribe(Peek1)']! > 0;
  controls['C accountSubscribe(Match) > 0'] = listeners.C.counts['accountSubscribe(Match)']! > 0;
  controls['public snapshots during a plant window seen'] = invariants.plantSnapshots > 0;
  controls['A scouted (peek_cell)'] = sigs.some((s) => s.who === 'A' && s.what === 'peek_cell');
  const controlsOk = Object.values(controls).every(Boolean);

  // Cleanup (free match: nothing to pay; close returns the rent).
  await closeMatch(base, walletA, id).catch((e) => log('close failed', String(e).split('\n')[0]));
  for (const w of [walletA, walletB]) {
    const left = await base.getBalance(w.publicKey, 'confirmed');
    if (left > 5_000) await chain.send(base, [SystemProgram.transfer({ fromPubkey: w.publicKey, toPubkey: funder.publicKey, lamports: left - 5_000 })], [w]).catch(() => undefined);
  }
  const endBalance = await base.getBalance(funder.publicKey, 'confirmed');
  const verdict = fails.length === 0 && controlsOk ? 'PASS' : 'FAIL';
  const result = {
    verdict,
    match: id.toString(),
    fails,
    controls,
    invariants,
    subscriptions: subs,
    needles: Object.keys(needles),
    corpusStrings: Object.fromEntries(Object.entries(corpus).map(([w, c]) => [w, c.filter((e) => e.t < finishedAt).length])),
    sigs: sigs.reduce<Record<string, number>>((m, s) => ((m[`${s.who} ${s.what}`] = (m[`${s.who} ${s.what}`] ?? 0) + 1), m), {}),
    cellsSent,
    probes,
    sol: { before: startBalance / LAMPORTS_PER_SOL, after: endBalance / LAMPORTS_PER_SOL, spent: (startBalance - endBalance) / LAMPORTS_PER_SOL },
  };
  const file = path.join(OUT, `privacy-${id}.json`);
  fs.writeFileSync(file, JSON.stringify(result, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
  log(verdict, `${fails.length} fails`, fails.slice(0, 10), 'controls', controls);
  log('→', path.relative(process.cwd(), file), 'SOL spent', result.sol.spent);
  process.exit(verdict === 'PASS' ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
