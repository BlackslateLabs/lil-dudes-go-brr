// LiveSource: a match on the Private Ephemeral Rollup, behind the same MatchSource contract as
// MockSource / OfflineSource. It subscribes to the public Match (and the player's own private
// Peek) over the TEE websocket, plays the snapshots out at 20 Hz ~3 ticks behind the newest
// (TECH §5), derives the events, and sends set_aim / plant_rig / peek_cell signed by the
// device's burner (no wallet popups, no SOL needed on the TEE).
//
// With `autoDrive` (default) it also runs the match's TEE choreography itself: init_permissions,
// the private salt + VRF seed request, start, a heartbeat `advance` if the crank stalls, and
// `finish` (commit + undelegate + settlement) when the match has a result. Every step is
// idempotent on-chain, so both players' sources can race safely.
import { Connection, Transaction, TransactionInstruction, type Keypair } from '@solana/web3.js';
import * as C from '../constants';
import { opOf, PUBLIC_LEN, toMatchView } from '../codec';
import type { MatchListener, MatchSource } from '../source';
import type { MatchEvent, MatchStatus, MatchView, PrivateView, Side } from '../types';
import { revealOf, type MatchReveal } from '../verify';
import {
  decodeMatch,
  decodePeek,
  Flags,
  ixs,
  matchAccounts,
  send,
  Status,
  TEE_RPC,
  teeConnection,
  teeToken,
  type MatchAccount,
  type MatchAccounts,
  type PeekAccount,
} from './chain';
import { diffEvents } from './events';

/** Where a live match is, for waiting / result screens (finer than MatchView.status). */
export type LiveStage = 'connecting' | 'setup' | 'playing' | 'finishing' | 'finished';

export interface LiveOptions {
  matchId: bigint;
  /** This device's burner: it signs every TEE tx (it needs no SOL there). */
  burner: Keypair;
  /** TEE session token of the burner (fetched if omitted). */
  token?: string;
  teeRpc?: string;
  /** Render this many ticks behind the newest snapshot (TECH §5). Default 3. */
  delayTicks?: number;
  /** Run the TEE setup and the finish automatically. Default true. */
  autoDrive?: boolean;
  /** Progress of the match (setup, finish) for the waiting and result screens. */
  onStage?: (stage: LiveStage, detail?: string) => void;
  /** Called with every tx this source sends (the "under the hood" list). */
  onTx?: (what: string, signature: string) => void;
}

interface Snap {
  account: MatchAccount;
  view: MatchView;
  /** The codec public state bytes of this snapshot. */
  bytes: Uint8Array;
}

const SALT_LEN = 32;
/** Offset of the codec public state in the Match account (state.rs). */
const STATE_OFFSET = 330;

export class LiveSource implements MatchSource {
  readonly mySide: Side;
  readonly matchId: bigint;
  readonly accounts: MatchAccounts;
  private readonly conn: Connection;
  private readonly wsUrl: string;
  private readonly opts: LiveOptions;
  private readonly delay: number;
  private listeners = new Set<MatchListener>();
  private ws: WebSocket | null = null;
  private subIds = new Map<number, 'match' | 'peek'>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private aimTimer: ReturnType<typeof setInterval> | null = null;
  private newest: Snap;
  private played: Snap;
  /** Snapshots received but not yet played out (oldest first). */
  private queue: Snap[] = [];
  private playTick = 0;
  private frames = 0;
  private peekAcc: PeekAccount | null = null;
  private priv: PrivateView = { myRig: null, myPeek: null };
  private pendingAim: number | null = null;
  private sentAim: number | null = null;
  private blockhash: { value: string; at: number } | null = null;
  private driving = false;
  private lastProgress = { tick: -1, at: Date.now() };
  private tried = new Map<string, number>();
  private disposed = false;
  private stage: LiveStage = 'connecting';
  /** rig / peek: one request at a time, and none once it took this phase. */
  private inflight = { rig: false, peek: false };
  /** Feed statistics (the headless run reports them). */
  readonly stats = { snapshots: 0, emitted: 0, maxQueue: 0, txs: 0, txFailures: 0 };

  private constructor(opts: LiveOptions, conn: Connection, wsUrl: string, first: MatchAccount, firstBytes: Uint8Array, side: Side) {
    this.opts = opts;
    this.conn = conn;
    this.wsUrl = wsUrl;
    this.matchId = opts.matchId;
    this.accounts = matchAccounts(opts.matchId);
    this.mySide = side;
    this.delay = opts.delayTicks ?? 3;
    const snap = this.snap(first, firstBytes);
    this.newest = snap;
    this.played = snap;
    this.playTick = first.state.tick;
  }

  /** Authenticates the burner on the TEE, loads the match (it must already be delegated) and opens the feed. */
  static async connect(opts: LiveOptions): Promise<LiveSource> {
    const rpc = opts.teeRpc ?? TEE_RPC;
    const token = opts.token ?? (await teeToken(opts.burner, rpc));
    const conn = teeConnection(token, rpc);
    const a = matchAccounts(opts.matchId);
    // Delegation reaches the TEE a few seconds after the base tx (TECH §4: ~9–11 s end to end).
    let info = await conn.getAccountInfo(a.game, 'confirmed');
    for (let i = 0; i < 120 && !info; i++) {
      await new Promise((r) => setTimeout(r, 250));
      info = await conn.getAccountInfo(a.game, 'confirmed');
    }
    if (!info) throw new Error(`match ${opts.matchId} is not on the TEE (delegated?)`);
    const account = decodeMatch(info.data);
    const side = account.header.burners.findIndex((b) => b.equals(opts.burner.publicKey));
    if (side < 0) throw new Error('this burner is not a player of the match');
    const src = new LiveSource(opts, conn, `${rpc.replace(/^http/, 'ws')}?token=${token}`, account, info.data, side === 1 ? 1 : 0);
    src.openFeed();
    await src.refreshPeek();
    return src;
  }

  // --- MatchSource -------------------------------------------------------------------------

  subscribe(listener: MatchListener): () => void {
    this.listeners.add(listener);
    listener(this.played.view, this.priv, []);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer || this.disposed) return;
    this.timer = setInterval(() => this.frame(), C.TICK_MS);
    this.aimTimer = setInterval(() => this.flushAim(), 100);
    void this.drive();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.aimTimer) clearInterval(this.aimTimer);
    this.timer = null;
    this.aimTimer = null;
  }

  setAim(x: number): void {
    if (!Number.isFinite(x)) return;
    this.pendingAim = Math.round(Math.max(0, Math.min(C.LANE_WIDTH - 1, x)));
  }

  rig(cell: number): void {
    if (!Number.isInteger(cell) || cell < 0 || cell >= C.CELLS) return;
    if (this.inflight.rig || this.newest.view.sides[this.mySide].rigUsed || this.newest.view.status !== 'plant') return;
    this.inflight.rig = true;
    void this.tx('plant_rig', ixs.plantRig(this.accounts, this.opts.burner.publicKey, this.mySide, cell), true).finally(() => {
      this.inflight.rig = false;
    });
  }

  peek(cell: number): void {
    if (!Number.isInteger(cell) || cell < 0 || cell >= C.CELLS) return;
    if (this.inflight.peek || this.newest.view.sides[this.mySide].peekUsed || this.newest.view.status !== 'playing') return;
    this.inflight.peek = true;
    void this.tx('peek_cell', ixs.peekCell(this.accounts, this.opts.burner.publicKey, this.mySide, cell), true).finally(() => {
      this.inflight.peek = false;
    });
  }

  // --- extras ------------------------------------------------------------------------------

  /** The latest view handed to listeners. */
  get view(): MatchView {
    return this.played.view;
  }

  /** The newest public state in its raw codec bytes (e.g. for the WASM bot). */
  get latestBytes(): Uint8Array {
    return this.newest.bytes;
  }

  /** The newest decoded Match account (header + state), ahead of the rendered view. */
  get latest(): MatchAccount {
    return this.newest.account;
  }

  get currentStage(): LiveStage {
    return this.stage;
  }

  /**
   * Waits for the final Match (status FINISHED or later: seed + history published), from the TEE
   * feed or, once it is undelegated, the base layer. Resolves null after `timeoutMs`.
   */
  async awaitFinal(base: Connection, timeoutMs = 60_000): Promise<MatchAccount | null> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (this.newest.account.header.status >= Status.FINISHED) return this.newest.account;
      for (const conn of [this.conn, base]) {
        const info = await conn.getAccountInfo(this.accounts.game, 'confirmed').catch(() => null);
        if (!info) continue;
        const account = decodeMatch(info.data);
        if (account.header.status >= Status.FINISHED) {
          this.newest = this.snap(account, info.data);
          this.setStage('finished');
          return account;
        }
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    return null;
  }

  /** The full reveal once the match finished (seed + every deal + every rig and peek). */
  reveal(): MatchReveal | null {
    const h = this.newest.account.header;
    if (h.status < Status.FINISHED || h.flags & Flags.ABORTED) return null;
    return revealOf(h.seed, h.history);
  }

  /** Stop, close the feed and forget the listeners. */
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.listeners.clear();
    this.ws?.close();
    this.ws = null;
  }

  // --- feed --------------------------------------------------------------------------------

  private snap(account: MatchAccount, raw?: Uint8Array): Snap {
    const h = account.header;
    const status: MatchStatus | undefined =
      account.state.result ? 'ended' : h.status < Status.PLAYING || h.startSlot === 0 ? 'waiting' : undefined;
    const bytes = raw ? raw.slice(STATE_OFFSET, STATE_OFFSET + PUBLIC_LEN) : new Uint8Array(PUBLIC_LEN);
    return { account, view: toMatchView(account.state, this.matchId.toString(), h.names, status), bytes };
  }

  private openFeed(): void {
    if (this.disposed) return;
    const ws = new WebSocket(this.wsUrl);
    this.ws = ws;
    this.subIds.clear();
    const subs: [number, string, 'match' | 'peek'][] = [
      [1, this.accounts.game.toBase58(), 'match'],
      [2, this.accounts.peeks[this.mySide].toBase58(), 'peek'],
    ];
    const pending = new Map<number, 'match' | 'peek'>();
    ws.onopen = () => {
      for (const [id, key, kind] of subs) {
        pending.set(id, kind);
        ws.send(JSON.stringify({ jsonrpc: '2.0', id, method: 'accountSubscribe', params: [key, { encoding: 'base64', commitment: 'processed' }] }));
      }
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data)) as {
        id?: number;
        result?: number;
        method?: string;
        params?: { subscription: number; result: { value: { data: [string, string] } | null } };
      };
      if (m.id !== undefined && typeof m.result === 'number') {
        const kind = pending.get(m.id);
        if (kind) this.subIds.set(m.result, kind);
        return;
      }
      if (m.method !== 'accountNotification' || !m.params) return;
      const kind = this.subIds.get(m.params.subscription);
      const value = m.params.result.value;
      if (!kind || !value) return;
      const bytes = base64Bytes(value.data[0]);
      if (kind === 'match') this.onMatch(bytes);
      else this.onPeek(bytes);
    };
    ws.onclose = () => {
      if (!this.disposed && this.stage !== 'finished') setTimeout(() => this.openFeed(), 500);
    };
    ws.onerror = () => ws.close();
  }

  private onMatch(bytes: Uint8Array): void {
    let account: MatchAccount;
    try {
      account = decodeMatch(bytes);
    } catch {
      return;
    }
    const prev = this.newest.account;
    if (account.state.tick < prev.state.tick) return;
    const snap = this.snap(account, bytes);
    this.newest = snap;
    this.stats.snapshots++;
    if (account.state.tick !== this.lastProgress.tick) this.lastProgress = { tick: account.state.tick, at: Date.now() };
    if (snap.view.status === 'playing' || snap.view.status === 'plant') {
      if (this.played.view.status === 'waiting') this.playTick = account.state.tick - this.delay;
      this.queue.push(snap);
      this.stats.maxQueue = Math.max(this.stats.maxQueue, this.queue.length);
    } else if (this.timer) {
      // Before play and after the end, show changes at once (no playout clock).
      this.queue = [];
      this.emit(snap);
    }
    void this.drive();
  }

  private onPeek(bytes: Uint8Array): void {
    try {
      this.peekAcc = decodePeek(bytes);
    } catch {
      return;
    }
    this.priv = this.privateView(this.played.view.phase);
  }

  private async refreshPeek(): Promise<void> {
    const info = await this.conn.getAccountInfo(this.accounts.peeks[this.mySide], 'confirmed').catch(() => null);
    if (info) this.onPeek(info.data);
  }

  private privateView(phase: number): PrivateView {
    const p = this.peekAcc;
    return {
      myRig: p?.rig && p.rig.phase === phase ? p.rig.cell : null,
      myPeek: p?.peek && p.peek.phase === phase ? { cell: p.peek.cell, op: opOf(p.peek.kind, p.peek.value), gold: p.peek.gold } : null,
    };
  }

  /** One playout frame (20 Hz): advance the render clock, play out the snapshots it reached. */
  private frame(): void {
    if (++this.frames % 10 === 0) void this.drive();
    if (this.queue.length === 0) return;
    const newest = this.newest.account.state.tick;
    // Stay ~delay ticks behind the newest snapshot (TECH §5): one tick per frame, never ahead of
    // the newest (a stall drains the buffer, then holds), and jump if far behind.
    this.playTick = Math.min(this.playTick + 1, newest);
    if (this.playTick < newest - this.delay - 2) this.playTick = newest - this.delay;
    let next: Snap | null = null;
    while (this.queue.length > 0 && this.queue[0]!.account.state.tick <= this.playTick) next = this.queue.shift()!;
    // The result is shown as soon as it is reached.
    if (next) this.emit(next);
  }

  private emit(next: Snap): void {
    if (next === this.played) return;
    if (next.account.state.tick < this.played.account.state.tick) return;
    const events: MatchEvent[] = diffEvents(
      { state: this.played.account.state, gotcha: this.played.account.header.gotcha },
      { state: next.account.state, gotcha: next.account.header.gotcha },
    );
    this.played = next;
    this.stats.emitted++;
    this.priv = this.privateView(next.view.phase);
    for (const l of this.listeners) l(next.view, this.priv, events);
  }

  // --- sending -----------------------------------------------------------------------------

  private async recentBlockhash(): Promise<string> {
    if (this.blockhash && Date.now() - this.blockhash.at < 10_000) return this.blockhash.value;
    const { blockhash } = await this.conn.getLatestBlockhash('confirmed');
    this.blockhash = { value: blockhash, at: Date.now() };
    return blockhash;
  }

  private flushAim(): void {
    const aim = this.pendingAim;
    if (aim === null || aim === this.sentAim) return;
    const h = this.newest.account.header;
    if (h.status !== Status.PLAYING || this.newest.account.state.result) return;
    this.sentAim = aim;
    void this.fastTx('set_aim', ixs.setAim(this.accounts, this.opts.burner.publicKey, aim));
  }

  /** Fire-and-forget (set_aim): cached blockhash, no confirmation. */
  private async fastTx(what: string, instruction: TransactionInstruction): Promise<void> {
    try {
      const tx = new Transaction().add(instruction);
      tx.feePayer = this.opts.burner.publicKey;
      tx.recentBlockhash = await this.recentBlockhash();
      tx.sign(this.opts.burner);
      const sig = await this.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      this.stats.txs++;
      this.opts.onTx?.(what, sig);
    } catch {
      this.stats.txFailures++;
      this.blockhash = null;
    }
  }

  private async tx(what: string, instruction: TransactionInstruction, quiet = false, cu?: number): Promise<boolean> {
    try {
      const sig = await send(this.conn, [instruction], [this.opts.burner], { cu });
      this.stats.txs++;
      this.opts.onTx?.(what, sig);
      return true;
    } catch (e) {
      this.stats.txFailures++;
      if (!quiet) this.opts.onStage?.(this.stage, `${what} failed: ${String(e).split('\n')[0]}`);
      return false;
    }
  }

  // --- auto-drive --------------------------------------------------------------------------

  private setStage(stage: LiveStage, detail?: string): void {
    if (stage !== this.stage || detail) {
      this.stage = stage;
      this.opts.onStage?.(stage, detail);
    }
  }

  /** Try `key` at most once per `everyMs` (both players race; retries cover lost txs). */
  private due(key: string, everyMs: number): boolean {
    const last = this.tried.get(key) ?? 0;
    if (Date.now() - last < everyMs) return false;
    this.tried.set(key, Date.now());
    return true;
  }

  private async drive(): Promise<void> {
    if (this.driving || this.disposed || this.opts.autoDrive === false) return;
    this.driving = true;
    try {
      const { header, state } = this.newest.account;
      const me = this.opts.burner.publicKey;
      const a = this.accounts;
      const mySalt = this.mySide === 0 ? Flags.SALT0 : Flags.SALT1;
      switch (header.status) {
        case Status.JOINED:
          this.setStage('setup', 'permissions');
          if (this.due('perms', 2_000)) await this.tx('init_permissions', ixs.initPermissions(a, me), true, 400_000);
          break;
        case Status.READY:
          this.setStage('setup', 'seed');
          // My salt (private: the tx touches Secrets); re-sent as a VRF retry if the seed is late.
          if (!(header.flags & mySalt) ? this.due('salt', 2_000) : this.due('seed-retry', 4_000) && !!(header.flags & Flags.SEED_REQUESTED)) {
            await this.tx('request_seed', ixs.requestSeed(a, me, randomSalt()), true, 300_000);
          }
          break;
        case Status.SEEDED:
          this.setStage('setup', 'start');
          // Side 0 starts; side 1 steps in if side 0 is gone.
          if (this.due('start', this.mySide === 0 ? 2_000 : 4_000) && (this.mySide === 0 || this.tried.has('start-wait'))) {
            await this.tx('start', ixs.start(a, me), true);
          }
          this.tried.set('start-wait', 1);
          break;
        case Status.PLAYING:
          if (state.result) {
            this.setStage('finishing');
            if (this.due('finish', this.mySide === 0 ? 3_000 : 6_000) && (await this.tx('finish', ixs.finish(a, me), true, 400_000))) {
              this.setStage('finished');
            }
          } else {
            this.setStage('playing');
            // Heartbeat if the crank stalls (TECH §8): anyone may advance.
            if (Date.now() - this.lastProgress.at > 1_000 && this.due('advance', 1_000)) {
              await this.tx('advance', ixs.advance(a), true, 400_000);
            }
          }
          break;
        case Status.FINISHED:
        case Status.SETTLED:
          this.setStage('finished');
          break;
      }
    } finally {
      this.driving = false;
    }
  }
}

function randomSalt(): Uint8Array {
  const salt = new Uint8Array(SALT_LEN);
  crypto.getRandomValues(salt);
  return salt;
}

function base64Bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
