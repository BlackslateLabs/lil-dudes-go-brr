// Live play (MVP §3.4–3.7): Quick Match, rooms, rematch and rejoin, driven step by step against
// apps/server (matchmaking, faucet) and the chain (through packages/client only). The screens draw
// this store; nothing here fakes progress: every step is ticked off when the server or the chain
// says so, and every failure lands in `error` with a retry.
import {
  baseConnection,
  cancelMatch,
  chain,
  closeRoom,
  createMatch,
  createRoom,
  delegateMatch,
  fetchMatch,
  findRoom,
  isOnBase,
  joinMatch,
  joinQueue,
  leaveQueue,
  LiveSource,
  matchResultOf,
  newMatchId,
  nextRoomMatch,
  pollQueue,
  askBot,
  queueStats,
  recoverMatches,
  reportMatch,
  resumeInfo,
  ServerError,
  setRoomState,
  takeSeat,
  STAKE_MIN,
  STAKE_RESERVE,
  stakeOnChain,
  topUp,
  type QueueTicket,
  type Side,
} from '@lil-dudes/client';
import { sol } from '../screens/format';
import { useApp } from '../store';
import { claimTab, guestBurner, hasBurner, myBurner, myName, myTeeToken, releaseTab, saveMatch, savedMatch, SERVER } from './device';
import {
  clock,
  faucetCovers,
  faucetLimits,
  IDLE,
  needFor,
  setKeySource,
  short,
  useFaucet,
  useLive,
  type LiveError,
  type LiveMode,
  type LiveState,
  type LivePhase,
  type Opponent,
  type Step,
  type StepState,
} from './store';

// Lazy screens (Lobby, Profile, LiveVs, LiveProof) import the store's names from here too.
export * from './store';

const set = useLive.setState;
const get = useLive.getState;

const solLabel = (stake: number) => (stake > 0 ? `${sol(stake)} SOL` : 'free');
const go = (s: Parameters<ReturnType<typeof useApp.getState>['go']>[0]) => useApp.getState().go(s);

// --- run bookkeeping: every flow gets a number; cancel / a new flow makes the old one stale ------

let run = 0;
const alive = (r: number) => r === run;
let ticketId: string | null = null;
/** The player asked the Bot to take the current free ticket (don't offer it again). */
let asked = false;
let hostedOpen: { id: bigint; code?: string } | null = null;
let wake: (() => void) | null = null;
let unsub: (() => void) | null = null;

/** Sleeps `ms`, or less if the tab comes back (`visibilitychange`) and wakes the flow. */
function nap(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      if (wake === done) wake = null;
      resolve();
    }
    wake = done;
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) wake?.();
  });
  window.addEventListener('online', () => wake?.());
}

const conn = () => baseConnection();

function setStep(list: 'steps' | 'chain', key: string, state: StepState, patch: Partial<Step> = {}) {
  set((s) => ({ [list]: s[list].map((x) => (x.key === key ? { ...x, state, ...patch } : x)) }) as Partial<LiveState>);
}

/** Starts a flow: claims the tab, stops whatever ran before. Null if another tab is playing. */
function begin(mode: LiveMode, stake: number, phase: LivePhase): number | null {
  stopRun();
  const r = run;
  if (!claimTab()) {
    set({ ...IDLE, phase: 'error', mode, stake, error: { kind: 'tab', title: 'Already playing in another tab', message: 'Live play runs in one tab at a time. Close the other tab, then try again.', retry: retryOf(mode, stake) } });
    return null;
  }
  set({ ...IDLE, phase, mode, stake, since: Date.now() });
  return r;
}

/** Makes the running flow stale (it stops at its next await) and drops its listeners. */
function stopRun() {
  run++;
  wake?.();
  unsub?.();
  unsub = null;
}

function retryOf(mode: LiveMode, stake: number): (() => void) | undefined {
  if (mode === 'queue') return () => void quickMatch(stake);
  if (mode === 'host') return () => void hostRoom(stake);
  const code = get().room?.code;
  if (mode === 'join' && code) return () => void lookupRoom(code);
  if (mode === 'rematch') return () => void rematch();
  if (mode === 'rejoin') return () => void rejoin();
  return undefined;
}

function fail(r: number, e: Omit<LiveError, 'retry'> & { retry?: (() => void) | null }) {
  if (!alive(r)) return;
  const { mode, stake } = get();
  const retry = e.retry === null ? undefined : (e.retry ?? (mode ? retryOf(mode, stake) : undefined));
  set((s) => ({
    phase: 'error',
    error: { ...e, retry },
    steps: s.steps.map((x) => (x.state === 'now' ? { ...x, state: 'fail' } : x)),
    chain: s.chain.map((x) => (x.state === 'now' ? { ...x, state: 'fail' } : x)),
  }));
  get().source?.dispose();
  set({ source: null });
  releaseTab();
}

/** A readable error from anything a flow can throw. */
function explain(e: unknown, stake: number): Omit<LiveError, 'retry'> {
  if (e instanceof ServerError) {
    if (e.status === 0) return { kind: 'server', title: 'Server unreachable', message: `Can't reach the match server (${SERVER}). Check your connection, or it may be down.` };
    if (e.status === 429) return { kind: 'faucet', title: 'Slow down', message: e.message.replace(/^[A-Z]+ \S+: /, '') };
    return { kind: 'server', title: 'Server said no', message: e.message.replace(/^[A-Z]+ \S+: /, '') };
  }
  // web3.js SendTransactionError keeps the RPC's reason in `transactionMessage` (the message itself
  // may be just "Simulation failed.").
  if (import.meta.env.DEV) console.warn('[live]', e);
  const detail = (e as { transactionMessage?: string } | null)?.transactionMessage;
  const msg = `${detail ? `${detail}\n` : ''}${String(e instanceof Error ? e.message : e)}`;
  if (/insufficient (lamports|funds)|no record of a prior credit|AccountNotFound|account not found|0x1\b/i.test(msg)) {
    return { kind: 'balance', title: 'Not enough devnet SOL', message: `Your burner needs ${solLabel(stake + STAKE_RESERVE)} (stake + ~0.035 for rent and fees).`, stake };
  }
  if (/BadStake/.test(msg)) return { kind: 'stake', title: 'Stake not accepted', message: 'The program refused this stake amount.' };
  if (/fetch|network|Failed to fetch|ECONN|timed? ?out/i.test(msg)) return { kind: 'server', title: 'Connection lost', message: 'The devnet RPC or the rollup did not answer. Try again.' };
  const why = msg.match(/Message: ([^\n]+)/)?.[1] ?? msg.split('\n')[0]!;
  return { kind: 'chain', title: 'Transaction failed', message: why.replace(/^Transaction simulation failed: /, '').slice(0, 160) };
}

/** explain() for a failed tx: an RPC that refuses without a reason usually means the burner can't
 *  pay, so the balance is read again first. */
async function explainTx(e: unknown, stake: number): Promise<Omit<LiveError, 'retry'>> {
  const b = await refreshBalance();
  if (b !== null && b < needFor(stake)) return explain(new Error('insufficient funds'), stake);
  return explain(e, stake);
}

// --- balance + top up --------------------------------------------------------------------------

/** Fetches the burner's balance (lamports); null if the RPC can't be reached. */
export async function refreshBalance(): Promise<number | null> {
  const b = await conn()
    .getBalance(myBurner().publicKey, 'confirmed')
    .catch(() => null);
  if (b !== null) set({ balance: b });
  return b;
}

// --- faucet limits + cooldown -----------------------------------------------------------------

/** The faucet's cooldown is per game wallet (a fresh account key isn't cooling because the guest was). */
const untilKey = (pk: string) => `ldgb.topupUntil:${pk}`;
/** The key that plays now, without making a guest burner just to ask. */
const currentPk = (): string | null => (hasBurner() ? myBurner().publicKey.toBase58() : null);

function readUntil(pk = currentPk()): number | null {
  if (!pk) return null;
  try {
    const v = Number(sessionStorage.getItem(untilKey(pk)));
    return Number.isFinite(v) && v > Date.now() ? v : null;
  } catch {
    return null;
  }
}

function setUntil(until: number | null) {
  useFaucet.setState({ until });
  const pk = currentPk();
  if (!pk) return;
  try {
    if (until) sessionStorage.setItem(untilKey(pk), String(until));
    else sessionStorage.removeItem(untilKey(pk));
  } catch {
    /* private mode: the countdown just won't survive a reload */
  }
}

/** The playing key changed (signed in or out): show that key's cooldown, if any. */
export function syncCooldown() {
  useFaucet.setState({ until: readUntil() });
}

/** Server faucet (devnet): fills the burner to stake + reserve. Resolves with a message to show. */
export async function topUpFor(stake: number): Promise<{ ok: boolean; text: string }> {
  const wait = useFaucet.getState().until;
  if (wait && wait > Date.now()) return { ok: false, text: `${faucetLimits()} Next top-up in ${clock(wait - Date.now())}.` };
  if (!faucetCovers(stake)) {
    const p = useFaucet.getState().policy;
    return { ok: false, text: `The free faucet tops up to ${sol(p.maxBalance)} SOL at most. For ${sol(stake)} SOL, add SOL from your own wallet.` };
  }
  try {
    const t = await topUp(SERVER, myBurner().publicKey, stake);
    set({ balance: t.balance });
    void refreshBalance();
    if (t.sent > 0) setUntil(Date.now() + useFaucet.getState().policy.burnerEveryMs);
    return { ok: true, text: t.sent > 0 ? `+${sol(t.sent)} devnet SOL` : 'Already topped up' };
  } catch (e) {
    if (e instanceof ServerError && e.status === 0) return { ok: false, text: 'Faucet unreachable (server down?)' };
    if (e instanceof ServerError && e.status === 503) return { ok: false, text: 'The faucet is off on this server' };
    if (e instanceof ServerError && e.status === 429) {
      if (e.retryAfterSec) {
        const until = Date.now() + e.retryAfterSec * 1000;
        setUntil(until);
        return { ok: false, text: `${faucetLimits()} Next top-up in ${clock(until - Date.now())}.` };
      }
      return { ok: false, text: "The free faucet's hourly budget is used up. Try again later, or add SOL from your own wallet." };
    }
    const m = String(e instanceof Error ? e.message : e).replace(/^top-up: /, '');
    return { ok: false, text: m.charAt(0).toUpperCase() + m.slice(1) };
  }
}



/** Checks before any signature: the program takes this stake, and the burner can pay for it. */
async function preflight(r: number, stake: number): Promise<boolean> {
  if (!stakeOnChain(stake)) {
    fail(r, {
      kind: 'stake',
      title: 'Pick another amount',
      message: `Stakes run from ${sol(STAKE_MIN)} to 5 SOL, or play free.`,
      retry: null,
    });
    return false;
  }
  const b = await refreshBalance();
  if (!alive(r)) return false;
  if (b === null) {
    fail(r, { kind: 'server', title: 'Devnet unreachable', message: 'Could not read your balance from the devnet RPC.' });
    return false;
  }
  if (b < needFor(stake)) {
    fail(r, {
      kind: 'balance',
      title: 'Not enough devnet SOL',
      message: `This needs ${sol(needFor(stake))} SOL on your burner (${stake ? `${sol(stake)} stake + ` : ''}~0.035 for rent and fees). You have ${sol(b)}.`,
      stake,
    });
    return false;
  }
  return true;
}

// --- Quick Match ---------------------------------------------------------------------------------

/** Alone this long in the free queue: offer the Bot (the player decides; it never joins by itself). */
const BOT_OFFER_MS = 5_000;

/** Alone this long at a stake: suggest the nearest stakes with players and the bot. */
const LONELY_MS = 12_000;

/** Queue with `stake` lamports. Staked: pairs with any staked player and both play for the lower of
 *  the two picks (the server says which; the rest never leaves the wallet). Free: pairs with free,
 *  and the server's bot steps in after ~5 s. */
export async function quickMatch(stake: number): Promise<void> {
  const r = begin('queue', stake, 'queue');
  if (r === null) return go('lobby');
  go('lobby');
  set({
    steps: [
      { key: 'funds', label: 'Checking your balance', state: 'now' },
      { key: 'queue', label: `Joining the queue · ${solLabel(stake)}`, state: 'todo' },
      { key: 'wait', label: 'Waiting for a player', state: 'todo' },
      { key: 'found', label: 'Opponent found', state: 'todo' },
    ],
  });
  if (!(await preflight(r, stake))) return;
  setStep('steps', 'funds', 'ok', { label: `Balance ${sol(get().balance ?? 0)} SOL` });
  setStep('steps', 'queue', 'now');
  const pk = myBurner().publicKey;
  asked = false;
  let ticket: QueueTicket | null = null;
  let misses = 0;
  let polls = 0;
  while (alive(r)) {
    try {
      ticket = ticket ? await pollQueue(SERVER, ticket.ticket) : await joinQueue(SERVER, pk, stake);
      if (!alive(r)) {
        void leaveQueue(SERVER, ticket.ticket);
        return;
      }
      ticketId = ticket.ticket;
      misses = 0;
      if (get().conn !== 'ok') set({ conn: 'ok' });
      if (get().steps.find((x) => x.key === 'queue')?.state !== 'ok') {
        setStep('steps', 'queue', 'ok');
        setStep('steps', 'wait', 'now', { note: undefined });
        set({ since: Date.now() });
      }
      if (ticket.match) break;
      // Liquidity every ~3 s: who else is waiting here, and the nearest stakes with someone.
      if (++polls % 3 === 1) {
        const st = await queueStats(SERVER, { stake, player: pk }).catch(() => null);
        if (!alive(r)) return;
        if (st) set({ qstats: { here: st.here ?? 0, near: st.near, online: st.online } });
      }
      if (!get().lonely && Date.now() - get().since > LONELY_MS && (get().qstats?.here ?? 0) === 0) set({ lonely: true });
      if (stake === 0 && !get().botOffer && !asked && Date.now() - get().since > BOT_OFFER_MS) set({ botOffer: true });
    } catch (e) {
      if (!alive(r)) return;
      if (e instanceof ServerError && e.status === 404) {
        // The ticket expired (the tab slept): queue again, same stake.
        ticket = null;
        setStep('steps', 'wait', 'now', { note: 'Rejoined the queue' });
        continue;
      }
      if (e instanceof ServerError && e.status === 0) {
        misses++;
        set({ conn: 'retrying' });
        if (!ticket && misses >= 3) return fail(r, explain(e, stake));
        setStep('steps', ticket ? 'wait' : 'queue', 'now', { note: 'Connection lost, retrying…' });
        await nap(Math.min(8_000, 1_000 * 2 ** misses));
        continue;
      }
      return fail(r, explain(e, stake));
    }
    await nap(1_000);
  }
  if (!alive(r) || !ticket?.match) return;
  ticketId = null;
  const m = ticket.match;
  setStep('steps', 'wait', 'ok', { note: undefined });
  // Both play for the lower pick (m.stake); say so when it's below ours.
  const lower = !m.bot && m.stake < stake;
  set({ botOffer: false });
  setStep('steps', 'found', 'ok', {
    label: m.bot ? 'Playing the Bot' : `Matched with ${short(m.opponent)}`,
    note: lower ? `Playing for ${solLabel(m.stake)} (their stake). The rest stays in your wallet.` : undefined,
  });
  await startMatch(r, { id: m.id, role: m.role, stake: m.stake, opponent: m.opponent, bot: m.bot });
}

/** "Play the Bot instead" (free Quick Match, offered after ~5 s alone): the server's bot takes the
 *  ticket; the queue loop picks the match up on its next poll. A person can still pair first. */
export async function askForBot(): Promise<void> {
  const id = ticketId;
  if (!id || asked) return;
  asked = true;
  set({ botOffer: false });
  setStep('steps', 'wait', 'now', { note: 'Calling the Bot…' });
  try {
    await askBot(SERVER, id);
  } catch (e) {
    // Whatever the reason (the bot is off, the server is older, the network), never leave the player
    // stuck: offer the bot on this device instead, and say why the online one didn't come.
    asked = false;
    const why =
      e instanceof ServerError && e.status === 503
        ? 'The online Bot is off right now.'
        : e instanceof ServerError && e.status === 0
          ? 'Couldn’t reach the server.'
          : e instanceof ServerError && /no such route/.test(e.message)
            ? 'The online Bot isn’t available on this server yet.'
            : 'The online Bot didn’t answer.';
    set({ botOffer: true, botOffline: true });
    setStep('steps', 'wait', 'now', { note: `${why} You can play it on this device.` });
  }
}

// --- rooms -------------------------------------------------------------------------------------

/** Create a room: open the match on-chain (stake escrowed), get a code, wait for the friend. */
export async function hostRoom(stake: number): Promise<void> {
  const r = begin('host', stake, 'host');
  if (r === null) return go('lobby');
  go('lobby');
  await hostFlow(r, stake, null);
}

async function hostFlow(r: number, stake: number, prev: { id: bigint; code: string; opp: Opponent } | null) {
  set({
    steps: [
      { key: 'funds', label: 'Checking your balance', state: 'now' },
      { key: 'lock', label: stake ? `Locking your stake · ${solLabel(stake)}` : 'Opening the match (free)', state: 'todo' },
      { key: 'code', label: prev ? `Reusing room ${prev.code}` : 'Getting a room code', state: 'todo' },
      { key: 'wait', label: prev ? `Waiting for ${prev.opp.name} to accept` : 'Waiting for your friend', state: 'todo' },
    ],
    opp: prev?.opp ?? null,
  });
  if (!(await preflight(r, stake))) return;
  setStep('steps', 'funds', 'ok', { label: `Balance ${sol(get().balance ?? 0)} SOL` });
  setStep('steps', 'lock', 'now');
  const base = conn();
  const kp = myBurner();
  const id = newMatchId();
  try {
    await createMatch(base, kp, { id, stake, burner: kp.publicKey, name: myName() });
  } catch (e) {
    return fail(r, await explainTx(e, stake));
  }
  hostedOpen = { id };
  if (!alive(r)) return void cancelOpen();
  setStep('steps', 'lock', 'ok');
  setStep('steps', 'code', 'now');
  let code: string;
  try {
    code = prev ? (await nextRoomMatch(SERVER, prev.code, prev.id, id, kp.publicKey)).code : (await createRoom(SERVER, id, stake, { player: kp.publicKey })).code;
  } catch (e) {
    await cancelOpen();
    return fail(r, { ...explain(e, stake), message: `${explain(e, stake).message} Your stake was refunded.` });
  }
  hostedOpen = { id, code };
  if (!alive(r)) return void cancelOpen();
  set({ room: { code, stake, host: myName() }, since: Date.now() });
  setStep('steps', 'code', 'ok', { label: `Room ${code}` });
  setStep('steps', 'wait', 'now');
  saveMatch({ id: id.toString(), stake, side: 0, code, bot: false, oppName: prev?.opp.name ?? 'Friend', at: Date.now() });
  // Wait for the join (no timeout: the host cancels; the sweeper refunds after 20 min).
  const m = await waitFor(r, id, chain.Status.JOINED, Infinity, 'steps', 'wait');
  if (!m || !alive(r)) return;
  hostedOpen = null;
  setStep('steps', 'wait', 'ok', { label: `${m.header.names[1] || 'Friend'} joined` });
  await startMatch(r, { id, role: 'create', stake, opponent: m.header.players[1].toBase58(), bot: false, code, created: true });
}

/** Refunds the room this device opened and nobody joined (cancel_match, creator any time). */
async function cancelOpen() {
  const open = hostedOpen;
  hostedOpen = null;
  if (!open) return;
  if (open.code) void closeRoom(SERVER, open.code, myBurner().publicKey);
  saveMatch(null);
  await cancelMatch(conn(), myBurner(), open.id).catch(() => undefined);
  void refreshBalance();
}

/** Join: look the code up (from the field or a `?room=` link) and show its stake to confirm. */
export async function lookupRoom(raw: string): Promise<void> {
  const code = raw.trim().toUpperCase();
  const r = begin('join', 0, 'join');
  if (r === null) return go('lobby');
  go('lobby');
  set({ room: { code, stake: 0, host: '' }, steps: [{ key: 'find', label: `Looking up room ${code}`, state: 'now' }] });
  try {
    const room = await findRoom(SERVER, code);
    if (!alive(r)) return;
    const me = myBurner().publicKey;
    // Two seats: the second one taken by someone else (or a match already on) = full.
    if (room.joiner && room.joiner !== me.toBase58()) return fail(r, { kind: 'full', title: 'Room is full', message: `Room ${code} already has two players.`, retry: null });
    const m = await fetchMatch(conn(), room.id);
    if (!alive(r)) return;
    if (!m) return fail(r, { kind: 'room', title: 'Room closed', message: `Room ${code} was cancelled by its host.`, retry: null });
    if (m.header.players[0].equals(me)) return fail(r, { kind: 'room', title: 'That’s your room', message: 'Send the code to a friend: they join it from their phone.', retry: null });
    if (m.header.status !== chain.Status.OPEN) return fail(r, { kind: 'full', title: 'Room is full', message: `Room ${code} already has two players.`, retry: null });
    const stake = m.header.picks[0] || room.stake;
    set({ stake, matchId: room.id, room: { code, stake, host: m.header.names[0] || short(m.header.players[0].toBase58()) }, confirm: true, opp: { name: m.header.names[0] || 'Host', address: m.header.players[0].toBase58(), bot: false } });
    setStep('steps', 'find', 'ok', { label: `Room ${code}` });
    void refreshBalance();
  } catch (e) {
    if (e instanceof ServerError && e.status === 404) return fail(r, { kind: 'room', title: 'Room not found', message: `There's no room ${code}. Check the code with your friend.`, retry: null });
    if (e instanceof ServerError && e.status === 410) {
      const cancelled = /cancel/.test(e.message);
      return fail(r, { kind: 'room', title: cancelled ? 'Room cancelled' : 'Room expired', message: cancelled ? `The host cancelled room ${code}.` : `Room ${code} expired (30 min idle). Ask your friend for a new one.`, retry: null });
    }
    if (e instanceof ServerError && e.status === 400) return fail(r, { kind: 'room', title: 'Not a room code', message: 'A room code is 6 letters and digits.', retry: null });
    return fail(r, explain(e, 0));
  }
}

/** The joiner confirmed the stake: join on-chain and start. */
export async function confirmJoin(): Promise<void> {
  const { room, matchId, opp, confirm } = get();
  if (!room || matchId === null || !opp || !confirm) return;
  const r = run;
  set({ confirm: false });
  if (!(await preflight(r, room.stake))) return;
  try {
    await takeSeat(SERVER, room.code, myBurner().publicKey);
  } catch (e) {
    if (e instanceof ServerError && e.status === 409) return fail(r, { kind: 'full', title: 'Room is full', message: `Someone else just took the seat in room ${room.code}.`, retry: null });
    if (e instanceof ServerError && e.status === 410) return fail(r, { kind: 'room', title: 'Room closed', message: e.message.replace(/^[A-Z]+ \S+: /, ''), retry: null });
    return fail(r, explain(e, room.stake));
  }
  if (!alive(r)) return;
  await startMatch(r, { id: matchId, role: 'join', stake: room.stake, opponent: opp.address, bot: false, code: room.code });
}

// --- the match: stakes → rollup → VRF → arena (the VS screen's steps) ---------------------------

interface Pairing {
  id: bigint;
  role: 'create' | 'join';
  stake: number;
  opponent: string;
  bot: boolean;
  code?: string;
  /** The creator already opened it (rooms). */
  created?: boolean;
}

function chainSteps(stake: number): Step[] {
  return [
    { key: 'stake', label: stake ? 'Locking stakes…' : 'Opening the match…', state: 'now' },
    { key: 'rollup', label: 'Entering the private rollup…', state: 'todo' },
    { key: 'vrf', label: 'Rolling the dice (VRF)…', state: 'todo' },
    { key: 'arena', label: 'Into the arena…', state: 'todo' },
  ];
}

async function startMatch(r: number, p: Pairing): Promise<void> {
  if (!alive(r)) return;
  const base = conn();
  const kp = myBurner();
  set((s) => ({
    phase: 'starting',
    stake: p.stake,
    matchId: p.id,
    chain: chainSteps(p.stake),
    opp: s.opp ?? { name: p.bot ? 'Bot' : 'Opponent', address: p.opponent, bot: p.bot },
    room: p.code ? { code: p.code, stake: p.stake, host: s.room?.host ?? '' } : s.room,
  }));
  go('vs');
  // 1. Stakes: the creator opens the match and waits for the join; the joiner waits for it to open, then joins.
  try {
    // Resumed after a reload: the tx may have landed already.
    const had = await fetchMatch(base, p.id).catch(() => null);
    if (p.role === 'create') {
      if (!p.created && !had?.header.players[0].equals(kp.publicKey)) {
        await createMatch(base, kp, { id: p.id, stake: p.stake, burner: kp.publicKey, name: myName() });
        hostedOpen = { id: p.id };
      }
      if (!alive(r)) return;
      setStep('chain', 'stake', 'now', { note: 'Waiting for the opponent’s stake' });
      const joined = await waitFor(r, p.id, chain.Status.JOINED, 60_000, 'chain', 'stake');
      if (!alive(r)) return;
      if (!joined) {
        await cancelOpen();
        return fail(r, { kind: 'noshow', title: 'Opponent never showed', message: p.stake ? 'They didn’t lock their stake in time. Your stake was refunded.' : 'They didn’t join in time.' });
      }
      hostedOpen = null;
    } else {
      const open = await waitFor(r, p.id, chain.Status.OPEN, 45_000, 'chain', 'stake');
      if (!alive(r)) return;
      if (!open) return fail(r, { kind: 'noshow', title: 'Opponent never showed', message: 'The match was never opened. Nothing was spent.' });
      const mine = open.header.status !== chain.Status.OPEN && open.header.players[1].equals(kp.publicKey);
      if (open.header.status !== chain.Status.OPEN && !mine) return fail(r, { kind: 'full', title: 'Match is full', message: 'Someone else took the seat.', retry: null });
      if (!mine) await joinMatch(base, kp, { id: p.id, stake: p.stake, burner: kp.publicKey, name: myName() });
    }
  } catch (e) {
    if (p.role === 'create') await cancelOpen();
    return fail(r, await explainTx(e, p.stake));
  }
  if (!alive(r)) return;
  const m = await fetchMatch(base, p.id).catch(() => null);
  const side: Side = m && m.header.players[1].equals(kp.publicKey) ? 1 : 0;
  const oppName = p.bot ? 'Bot' : (m?.header.names[1 - side] || get().opp?.name || 'Opponent');
  set({ side, opp: { name: oppName, address: p.opponent, bot: p.bot } });
  let code = p.code;
  // Both sides register the match's room (idempotent by id, each in its seat): a rematch reuses its code.
  if (!code && !p.bot) code = await createRoom(SERVER, p.id, p.stake, { player: kp.publicKey, role: p.role }).then((x) => x.code).catch(() => undefined);
  if (code) set((s) => ({ room: { code: code!, stake: p.stake, host: s.room?.host ?? '' } }));
  saveMatch({ id: p.id.toString(), stake: p.stake, side, code, bot: p.bot, oppName, at: Date.now() });
  setStep('chain', 'stake', 'ok', { note: undefined });
  await enterRollup(r, p.id, p.role === 'create' || p.bot === false);
}

/** 2–4: delegate (the creator), connect to the TEE feed, then the source drives permissions → VRF
 *  seed → start by itself (LiveSource autoDrive); the steps tick as its stages come in. */
async function enterRollup(r: number, id: bigint, mayDelegate: boolean): Promise<void> {
  const base = conn();
  const kp = myBurner();
  setStep('chain', 'rollup', 'now');
  const m = await fetchMatch(base, id).catch(() => null);
  const creator = !!m && m.header.players[0].equals(kp.publicKey);
  if (creator && (await isOnBase(base, id).catch(() => false))) {
    try {
      await delegateMatch(base, kp, id);
    } catch (e) {
      // The other side may have delegated first: fine if it is no longer on the base layer.
      if (await isOnBase(base, id).catch(() => true)) return fail(r, explain(e, get().stake));
    }
  }
  if (!alive(r)) return;
  let src: LiveSource | null = null;
  for (let attempt = 0; attempt < 3 && !src; attempt++) {
    try {
      src = await LiveSource.connect({ matchId: id, burner: kp, token: await myTeeToken(attempt > 0), onStage: (stage, detail) => onStage(r, stage, detail) });
    } catch (e) {
      if (!alive(r)) return;
      const msg = String(e instanceof Error ? e.message : e);
      // Joiner: the creator never delegated. Either player may, so do it.
      if (/not on the TEE/.test(msg) && mayDelegate && !creator && (await isOnBase(base, id).catch(() => false))) {
        setStep('chain', 'rollup', 'now', { note: 'Opponent slow: delegating it ourselves' });
        await delegateMatch(base, kp, id).catch(() => undefined);
        continue;
      }
      if (attempt === 2) return fail(r, { kind: 'chain', title: 'Couldn’t reach the rollup', message: msg.split('\n')[0]!.slice(0, 160) });
      await nap(1_500);
    }
  }
  if (!src || !alive(r)) return void src?.dispose();
  attach(r, src);
  setStep('chain', 'rollup', 'ok', { note: undefined });
  setStep('chain', 'vrf', 'now');
  src.start();
  // Rejoined mid-match or later: jump ahead.
  const v = src.view;
  if (v.status !== 'waiting') markPlaying();
}

function attach(r: number, src: LiveSource) {
  set({ source: src, layout: src.latest.header.status >= chain.Status.SEEDED ? src.latest.state.layout : null });
  unsub?.();
  unsub = src.subscribe((view, _priv, events) => {
    if (!alive(r)) return;
    for (const e of events) if (e.type === 'reveal') set((s) => ({ flips: [...s.flips, { side: e.side, stage: e.stage, slot: e.slot, op: e.op }] }));
    if (view.status !== 'waiting' && get().phase === 'starting') markPlaying();
    if (get().layout === null && view.status !== 'waiting') set({ layout: view.layout });
  });
}

function markPlaying() {
  const src = get().source;
  // The stake is in the vault now and the payout hasn't landed: the result counts up from here.
  if (get().balanceBefore === null) {
    void markBalanceBefore();
    const code = get().room?.code;
    if (code) void setRoomState(SERVER, code, myBurner().publicKey, 'playing');
  }
  set((s) => ({ chain: s.chain.map((x) => ({ ...x, state: 'ok', note: undefined })), layout: src && src.view.status !== 'waiting' ? src.view.layout : s.layout }));
}

function onStage(r: number, stage: string, detail?: string) {
  if (!alive(r)) return;
  const s = get();
  if (stage === 'setup' && s.phase === 'starting') {
    if (detail === 'start') {
      // SEEDED: the seed picked the level (public from here), so the VS level card can show it.
      if (s.source && s.layout === null) set({ layout: s.source.latest.state.layout });
      setStep('chain', 'vrf', 'ok', { note: undefined });
      setStep('chain', 'arena', 'now');
    } else if (detail?.includes('aborting')) {
      setStep('chain', 'vrf', 'now', { note: 'Opponent never showed: aborting (refund)' });
    } else if (detail === 'seed') {
      setStep('chain', 'vrf', 'now', { note: 'Waiting for the VRF seed' });
    } else if (detail === 'permissions') {
      setStep('chain', 'vrf', 'now', { note: 'Sealing the private accounts' });
    }
  }
  if (stage === 'playing' && s.phase === 'starting') markPlaying();
  if (stage === 'finished') {
    const src = s.source;
    const aborted = !!src && !!(src.latest.header.flags & chain.Flags.ABORTED);
    if (aborted && (s.phase === 'starting' || s.phase === 'playing')) {
      saveMatch(null);
      return fail(r, { kind: 'aborted', title: 'Match aborted', message: s.stake ? 'It never started (a player didn’t show). Both stakes are refunded.' : 'It never started (a player didn’t show).', retry: null });
    }
    if (s.phase === 'playing' || s.phase === 'starting') {
      saveMatch(null);
      releaseTab();
      set({ phase: 'ended' });
      if (s.room?.code) void setRoomState(SERVER, s.room.code, myBurner().publicKey, 'ended');
      if (s.matchId !== null) void report(s.matchId);
    }
    if (detail === 'settled') set((x) => ({ settled: x.settled + 1 }));
  }
}

/** Into the match history (the server reads the result from the base layer once the match is
 *  back there: a few seconds after the end). Best effort, a few tries. */
async function report(id: bigint) {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 4_000 : 8_000));
    const r = await reportMatch(SERVER, id).catch(() => 'error' as const);
    if (r === 'recorded' || r === 'skipped') return;
  }
}

/** The VS screen finished its beats: into the match. */
export function enterMatch() {
  if (get().phase !== 'starting') return;
  set({ phase: 'playing' });
  go('match');
}

/** Polls the base layer until match `id` reaches `status` (null after `timeoutMs`, or if the flow
 *  was cancelled). RPC failures keep it trying and show a note on `key`. */
async function waitFor(r: number, id: bigint, status: number, timeoutMs: number, list: 'steps' | 'chain', key: string) {
  const t0 = Date.now();
  let misses = 0;
  while (alive(r)) {
    try {
      const m = await fetchMatch(conn(), id);
      if (misses) setStep(list, key, 'now', { note: undefined });
      misses = 0;
      if (get().conn !== 'ok') set({ conn: 'ok' });
      if (m && m.header.status >= status) return m;
    } catch {
      misses++;
      set({ conn: 'retrying' });
      setStep(list, key, 'now', { note: 'Devnet RPC not answering, retrying…' });
    }
    if (Date.now() - t0 > timeoutMs) return null;
    await nap(misses ? 2_500 : 1_200);
  }
  return null;
}

// --- leaving, rematch, rejoin ------------------------------------------------------------------

/** Cancel the current wait (queue, room, VS before the stakes lock). Refunds an open room. */
export async function cancel(): Promise<void> {
  const ticket = ticketId;
  ticketId = null;
  stopRun();
  if (ticket) void leaveQueue(SERVER, ticket);
  get().source?.dispose();
  set({ ...IDLE, balance: get().balance });
  releaseTab();
  go('home');
  await cancelOpen();
}

/** Back to Home from the result (or an error): a finished match's source is dropped; a match
 *  still running stays (Home offers to rejoin it). */
export function leave() {
  const s = get();
  if (s.phase === 'playing') {
    go('home');
    return;
  }
  stopRun();
  s.source?.dispose();
  set({ ...IDLE, balance: s.balance });
  releaseTab();
  go('home');
}

/** Back into a match: the running one, or the saved one after a reload. */
export async function rejoin(): Promise<void> {
  const s = get();
  if (s.phase === 'playing' && s.source) return go('match');
  const saved = savedMatch();
  if (!saved) return;
  const id = BigInt(saved.id);
  const r = begin('rejoin', saved.stake, 'starting');
  if (r === null) return go('lobby');
  set({ chain: chainSteps(saved.stake), opp: { name: saved.oppName, address: '', bot: saved.bot }, matchId: id, side: saved.side, room: saved.code ? { code: saved.code, stake: saved.stake, host: '' } : null });
  go('vs');
  const base = conn();
  const m = await fetchMatch(base, id).catch(() => undefined);
  if (!alive(r)) return;
  if (m === undefined) return fail(r, { kind: 'server', title: 'Devnet unreachable', message: 'Could not read the match from the devnet RPC.' });
  const onBase = m ? await isOnBase(base, id).catch(() => true) : true;
  if (!m || (onBase && m.header.status >= chain.Status.FINISHED)) {
    saveMatch(null);
    return fail(r, { kind: 'aborted', title: 'That match is over', message: 'It finished (or was refunded) while you were away. Your balance shows the result.', retry: null });
  }
  if (onBase && m.header.status <= chain.Status.JOINED) {
    // Never reached the rollup: refund it (creator any time while open; either side 60 s after a join).
    saveMatch(null);
    const out = await recoverMatches(base, myBurner(), {}).catch(() => []);
    const refunded = out.some((x) => x.id === id && x.action === 'cancelled');
    return fail(r, { kind: 'aborted', title: 'Match didn’t start', message: refunded ? 'It never reached the rollup, so it was cancelled and your stake refunded.' : 'It never reached the rollup. The stake comes back automatically (within ~5 min).', retry: null });
  }
  setStep('chain', 'stake', 'ok');
  await enterRollup(r, id, true);
  const src = get().source;
  if (!alive(r) || !src) return;
  // Already over on the rollup: straight to the result.
  if (src.view.status === 'ended') {
    const result = matchResultOf(src.latest.state);
    if (result) {
      const side = src.mySide;
      useApp.getState().setLastMatch({
        result,
        mySide: side,
        names: [src.view.sides[side].name, src.view.sides[1 - side]!.name],
        stake: src.view.stake,
        layoutName: src.view.layoutName,
        opponentIsBot: saved.bot,
        breakdown: [
          { damage: 0, towers: 0, first: 0, rush: 0 },
          { damage: 0, towers: 0, first: 0, rush: 0 },
        ],
      });
      set({ phase: 'ended' });
      go('result');
    }
  }
}

/** Rematch: same opponent, same stake, same room code. The previous creator opens the new match;
 *  the other side waits for the room to point at it and joins. A Bot match queues again. */
export async function rematch(): Promise<void> {
  const prev = get();
  if (prev.matchId === null || prev.side === null || !prev.opp) return;
  if (prev.opp.bot) return quickMatch(prev.stake);
  const code = prev.room?.code;
  const prevId = prev.matchId;
  const opp = prev.opp;
  const stake = prev.stake;
  prev.source?.dispose();
  if (!code) {
    const r = begin('rematch', stake, 'error');
    if (r !== null) fail(r, { kind: 'room', title: 'No room to reuse', message: 'This match has no room code. Start a new Quick Match or room.', retry: null });
    return go('lobby');
  }
  if (prev.side === 0) {
    const r = begin('rematch', stake, 'host');
    if (r === null) return go('lobby');
    set({ room: { code, stake, host: myName() }, matchId: prevId, side: 0, opp });
    go('lobby');
    return hostFlow(r, stake, { id: prevId, code, opp });
  }
  const r = begin('rematch', stake, 'join');
  if (r === null) return go('lobby');
  set({
    room: { code, stake, host: opp.name },
    matchId: prevId,
    side: 1,
    opp,
    steps: [
      { key: 'funds', label: 'Checking your balance', state: 'now' },
      { key: 'wait', label: `Waiting for ${opp.name} to start the rematch`, state: 'todo' },
    ],
  });
  go('lobby');
  if (!(await preflight(r, stake))) return;
  setStep('steps', 'funds', 'ok', { label: `Balance ${sol(get().balance ?? 0)} SOL` });
  setStep('steps', 'wait', 'now');
  set({ since: Date.now() });
  const t0 = Date.now();
  while (alive(r)) {
    try {
      const room = await findRoom(SERVER, code);
      if (get().conn !== 'ok') set({ conn: 'ok' });
      if (room.id !== prevId) {
        if (!alive(r)) return;
        await takeSeat(SERVER, code, myBurner().publicKey).catch(() => undefined);
        setStep('steps', 'wait', 'ok', { label: `${opp.name} accepted` });
        return startMatch(r, { id: room.id, role: 'join', stake, opponent: opp.address, bot: false, code });
      }
    } catch (e) {
      if (e instanceof ServerError && e.status === 404) return fail(r, { kind: 'room', title: 'Room expired', message: 'The room is gone. Start a new one.', retry: null });
      set({ conn: 'retrying' });
    }
    if (Date.now() - t0 > 3 * 60_000) return fail(r, { kind: 'noshow', title: 'No rematch', message: `${opp.name} didn’t start the rematch.` });
    await nap(1_500);
  }
}

/** Once per app start: refund / settle / close this device's stale matches (MVP §4). Returns a
 *  line for a toast when it moved money back, else null. Leaves a match it could rejoin alone. */
let recovered = false;
export async function recoverStale(): Promise<string | null> {
  if (recovered || get().phase !== 'idle' || savedMatch()) return null;
  recovered = true;
  // Signed in: the guest key's old matches still get their refunds (account.ts sweeps them in after).
  const guest = guestBurner();
  const keys = guest && !guest.publicKey.equals(myBurner().publicKey) ? [myBurner(), guest] : [myBurner()];
  const out = (await Promise.all(keys.map((k) => recoverMatches(conn(), k).catch(() => [])))).flat();
  const back = out.filter((x) => x.action === 'cancelled' || x.action === 'settled').length;
  if (back) void refreshBalance();
  return back ? `Refunded ${back} unfinished match${back > 1 ? 'es' : ''}` : null;
}

/** The balance the result's count-up starts from: read right at the end (the stake still in the vault). */
export async function markBalanceBefore() {
  const b = await refreshBalance();
  if (b !== null && get().balanceBefore === null) set({ balanceBefore: b });
}

// --- resume after a reload (this device's saved match, else the server's /me) -------------------

let serverResume: Awaited<ReturnType<typeof resumeInfo>> | null = null;

/** On Home: is there anything to go back to? Sets `resume` for the banner. */
export async function checkResume(): Promise<void> {
  const s = get();
  if (s.phase === 'playing' && s.source) return set({ resume: { kind: 'match', label: `Your live match vs ${s.opp?.name ?? 'your opponent'} is still on` } });
  if (s.phase !== 'idle') return;
  const saved = savedMatch();
  if (saved) return set({ resume: { kind: 'match', label: `Your live match vs ${saved.oppName} is still on` } });
  if (!hasBurner()) return set({ resume: null });
  const pk = myBurner().publicKey.toBase58();
  const me = await resumeInfo(SERVER, myBurner().publicKey).catch(() => null);
  serverResume = me;
  if (!me || get().phase !== 'idle') return;
  if (me.match && !me.match.bot) set({ resume: { kind: 'match', label: `You were matched${me.match.stake ? ` at ${sol(me.match.stake)} SOL` : ''}` } });
  else if (me.ticket?.state === 'waiting') set({ resume: { kind: 'queue', label: `You're still in the queue at ${solLabel(me.ticket.stake)}` } });
  else if (me.room?.state === 'waiting' && me.room.creator === pk) set({ resume: { kind: 'room', label: `Your room ${me.room.code} is still open` } });
  else set({ resume: null });
}

/** The Home banner's button. */
export async function resume(): Promise<void> {
  const what = get().resume;
  set({ resume: null });
  if (!what) return;
  const s = get();
  if (what.kind === 'match' && ((s.phase === 'playing' && s.source) || savedMatch())) return rejoin();
  const me = serverResume;
  serverResume = null;
  if (!me) return;
  if (what.kind === 'queue' && me.ticket) return quickMatch(me.ticket.stake);
  if (what.kind === 'match' && me.match) {
    const m = me.match;
    const r = begin('rejoin', m.stake, 'starting');
    if (r === null) return go('lobby');
    return startMatch(r, { id: m.id, role: m.role, stake: m.stake, opponent: m.opponent ?? '', bot: m.bot, code: m.code ?? undefined });
  }
  if (what.kind === 'room' && me.room) {
    const room = me.room;
    const r = begin('host', room.stake, 'host');
    if (r === null) return go('lobby');
    go('lobby');
    // Only claim "stake locked" if the chain says the match is there.
    const open = await fetchMatch(conn(), room.id).catch(() => undefined);
    if (!alive(r)) return;
    if (open === undefined) return fail(r, { kind: 'server', title: 'Devnet unreachable', message: 'Could not read your room’s match from the devnet RPC.' });
    if (open === null || open.header.status !== chain.Status.OPEN) {
      void closeRoom(SERVER, room.code, myBurner().publicKey);
      return fail(r, { kind: 'room', title: 'Room closed', message: `Room ${room.code} has no open match on-chain any more (cancelled or refunded).`, retry: null });
    }
    hostedOpen = { id: room.id, code: room.code };
    set({
      room: { code: room.code, stake: room.stake, host: myName() },
      steps: [
        { key: 'lock', label: room.stake ? `Stake locked · ${solLabel(room.stake)}` : 'Match open (free)', state: 'ok' },
        { key: 'code', label: `Room ${room.code}`, state: 'ok' },
        { key: 'wait', label: 'Waiting for your friend', state: 'now' },
      ],
    });
    const m = await waitFor(r, room.id, chain.Status.JOINED, Infinity, 'steps', 'wait');
    if (!m || !alive(r)) return;
    hostedOpen = null;
    setStep('steps', 'wait', 'ok', { label: `${m.header.names[1] || 'Friend'} joined` });
    return startMatch(r, { id: room.id, role: 'create', stake: room.stake, opponent: m.header.players[1].toBase58(), bot: false, code: room.code, created: true });
  }
}

// The live code is loaded: show this key's faucet cooldown, and tell the light store whose key plays.
setKeySource(currentPk);
syncCooldown();
