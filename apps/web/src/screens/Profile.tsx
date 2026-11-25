import { useCallback, useEffect, useState } from 'react';
import {
  ACCOUNT_EXPLORER,
  BASE_EXPLORER,
  baseConnection,
  matchHistory,
  playerStats,
  ServerError,
  STAKE_RESERVE,
  withdraw,
  type HistoryEntry,
  type PlayerStats,
} from '@lil-dudes/client';
import { sfx } from '../feel/sound';
import { myBurner, myName, SERVER } from '../live/device';
import { refreshBalance, short, topUpFor, useLive } from '../live/session';
import { useApp } from '../store';
import { signedSol, sol } from './format';
import './flow.css';
import './live.css';
import './profile.css';

const PAGE = 15;

type Burner = ReturnType<typeof myBurner>;
type Key = Burner['publicKey'];

/** Base58 → bytes (null if any character isn't base58). Enough to check a pasted address. */
function base58(s: string): Uint8Array | null {
  const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const out: number[] = [];
  for (const ch of s) {
    let carry = A.indexOf(ch);
    if (carry < 0) return null;
    for (let i = 0; i < out.length; i++) {
      carry += out[i]! * 58;
      out[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      out.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== '1') break;
    out.push(0);
  }
  return Uint8Array.from(out.reverse());
}

/** A pasted Solana address as a key (same class as the burner's), or why it isn't one. */
function parseAddress(raw: string, me: Key): { key: Key } | { error: string } {
  const s = raw.trim();
  if (!s) return { error: 'Paste a Solana address' };
  const bytes = base58(s);
  if (!bytes || bytes.length !== 32) return { error: "That isn't a Solana address" };
  if (s === me.toBase58()) return { error: "That's this wallet" };
  const PK = me.constructor as new (v: string) => Key;
  return { key: new PK(s) };
}

const toLamports = (text: string) => Math.round(Number(text.replace(',', '.')) * 1e9);

function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/**
 * Profile (Kai's list): this device's burner (address, balance, top up, withdraw to a real wallet)
 * and its match history and stats from the server (which reads them back from the chain). Every
 * number is real: when the server or the RPC can't be reached, it says so.
 */
export function Profile() {
  const go = useApp((s) => s.go);
  const stake = useApp((s) => (s.free ? 0 : s.stake));
  const balance = useLive((s) => s.balance);
  const burner = myBurner();
  const address = burner.publicKey.toBase58();
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const [topping, setTopping] = useState(false);
  const [rpcDown, setRpcDown] = useState(false);
  const say = (text: string) => setNote({ text, at: performance.now() });

  useEffect(() => {
    void refreshBalance().then((b) => setRpcDown(b === null));
  }, []);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(t);
  }, [note]);

  const copy = () => {
    void navigator.clipboard
      ?.writeText(address)
      .then(() => say('Address copied'))
      .catch(() => say("Couldn't copy: select it instead"));
  };

  const doTopUp = async () => {
    setTopping(true);
    const r = await topUpFor(stake);
    setTopping(false);
    say(r.text);
  };

  return (
    <div className="screen profile">
      <header className="pf-head">
        <button
          className="pf-back"
          onClick={() => {
            sfx.playButton();
            go('home');
          }}
        >
          ‹ Home
        </button>
        <h2 className="lobby-title pf-title">Profile</h2>
      </header>

      <section className="pf-card">
        <div className="pf-who">
          <img src="/brand/head-you.webp" alt="" width={56} height={56} />
          <div>
            <b className="pf-name">{myName()}</b>
            <div className="pf-addr">
              <code title={address}>{short(address)}</code>
              <button className="pf-mini" onClick={copy}>
                Copy
              </button>
              <a className="pf-mini" href={ACCOUNT_EXPLORER(address)} target="_blank" rel="noreferrer">
                Explorer ↗
              </a>
            </div>
          </div>
        </div>
        <div className="pf-balance">
          <div>
            <small>Balance · devnet</small>
            <b>{balance === null ? (rpcDown ? '—' : '…') : `${sol(balance)} SOL`}</b>
            {rpcDown && balance === null && <em>Can't reach Solana right now</em>}
          </div>
          <button className="ls-topup" onClick={() => void doTopUp()} disabled={topping}>
            {topping ? 'Topping up…' : '+ Top up'}
          </button>
        </div>
        <p className="pf-note">A burner wallet that lives in this browser. Clearing site data loses it, so withdraw anything you want to keep.</p>
      </section>

      <Withdraw burner={burner} balance={balance} onDone={say} />
      <History address={address} />

      {note && (
        <div key={note.at} className="toast" role="status">
          {note.text}
        </div>
      )}
    </div>
  );
}

/** Withdraw to a real wallet: paste an address, pick an amount, confirm on the page, see the tx. */
function Withdraw({ burner, balance, onDone }: { burner: Burner; balance: number | null; onDone: (t: string) => void }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState('');
  const [amt, setAmt] = useState('');
  const [all, setAll] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [sig, setSig] = useState<string | null>(null);

  const max = balance === null ? 0 : Math.max(0, balance - STAKE_RESERVE);
  const parsed = parseAddress(to, burner.publicKey);
  const lamports = all ? (balance ?? 0) : toLamports(amt);
  const amountErr = all
    ? (balance ?? 0) <= 0
      ? 'Nothing to withdraw'
      : ''
    : !amt
      ? 'Enter an amount'
      : !Number.isFinite(lamports) || lamports <= 0
        ? 'Enter an amount'
        : balance !== null && lamports > balance
          ? `You have ${sol(balance)} SOL`
          : '';
  const addrErr = to.trim() ? ('error' in parsed ? parsed.error : '') : '';
  const ready = !('error' in parsed) && !amountErr && !busy;

  const send = async () => {
    if ('error' in parsed) return;
    setBusy(true);
    setErr('');
    try {
      const r = await withdraw(baseConnection(), burner, parsed.key, all ? 'all' : lamports);
      setSig(r.signature);
      setConfirm(false);
      setAmt('');
      setAll(false);
      onDone(`Sent ${sol(r.amount)} SOL`);
      void refreshBalance();
    } catch (e) {
      const m = String(e instanceof Error ? e.message : e).replace(/^withdraw: /, '');
      setErr(m.charAt(0).toUpperCase() + m.slice(1));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button className="pf-card pf-open" onClick={() => setOpen(true)}>
        <span>Withdraw to your wallet</span>
        <b>›</b>
      </button>
    );
  }

  return (
    <section className="pf-card pf-withdraw">
      <h3>Withdraw to your wallet</h3>
      <label className="pf-field">
        <span>To (a Solana address, e.g. your Phantom)</span>
        <input
          id="pf-to"
          value={to}
          onChange={(e) => {
            setTo(e.target.value);
            setConfirm(false);
            setSig(null);
          }}
          placeholder="Paste address"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          className={addrErr ? 'bad' : ''}
        />
        {addrErr && <em>{addrErr}</em>}
      </label>
      <label className="pf-field">
        <span>Amount (SOL)</span>
        <div className="pf-amt">
          <input
            id="pf-amt"
            inputMode="decimal"
            value={all ? 'everything' : amt}
            disabled={all}
            onChange={(e) => {
              setAmt(e.target.value.replace(/[^\d.,]/g, '').slice(0, 10));
              setConfirm(false);
            }}
            placeholder="0.1"
          />
          <button
            className="chip"
            disabled={max <= 0}
            onClick={() => {
              setAll(false);
              setAmt(sol(max));
              setConfirm(false);
            }}
            title="Everything but ~0.035 SOL, kept for your next staked match"
          >
            Max
          </button>
          <button
            className={`chip ${all ? 'on' : ''}`}
            onClick={() => {
              setAll((a) => !a);
              setConfirm(false);
            }}
            title="Empty this wallet (minus the network fee)"
          >
            All
          </button>
        </div>
        {amt && !all && amountErr && <em>{amountErr}</em>}
        {!all && <small>Max keeps ~{sol(STAKE_RESERVE)} SOL here for your next staked match.</small>}
      </label>

      {err && <p className="pf-err">{err}</p>}

      {confirm && !('error' in parsed) ? (
        <div className="pf-confirm">
          <p>
            Send <b>{all ? 'everything' : `${sol(lamports)} SOL`}</b> to <code>{short(parsed.key.toBase58())}</code>? This can't be undone.
          </p>
          <div className="pf-row">
            <button className="big secondary" onClick={() => setConfirm(false)} disabled={busy}>
              Back
            </button>
            <button className="big primary" onClick={() => void send()} disabled={busy}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      ) : (
        <button className="big primary pf-send" disabled={!ready} onClick={() => setConfirm(true)}>
          Withdraw
        </button>
      )}

      {sig && (
        <p className="pf-done">
          Sent ·{' '}
          <a href={BASE_EXPLORER(sig)} target="_blank" rel="noreferrer">
            see the transaction ↗
          </a>
        </p>
      )}
    </section>
  );
}

type Load = { state: 'loading' } | { state: 'down' } | { state: 'error'; text: string } | { state: 'ok' };

/** Stats and recent matches from the server (records it read back from the match accounts). */
function History({ address }: { address: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [stats, setStats] = useState<PlayerStats | null>(null);
  const [rows, setRows] = useState<HistoryEntry[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [more, setMore] = useState(false);

  const fail = (e: unknown): Load =>
    e instanceof ServerError && e.status === 0 ? { state: 'down' } : { state: 'error', text: e instanceof Error ? e.message : String(e) };

  const fetchAll = useCallback(async () => {
    setLoad({ state: 'loading' });
    try {
      const [st, h] = await Promise.all([playerStats(SERVER, address), matchHistory(SERVER, address, { limit: PAGE })]);
      setStats(st);
      setRows(h.entries);
      setNext(h.next);
      setLoad({ state: 'ok' });
    } catch (e) {
      setLoad(fail(e));
    }
  }, [address]);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const loadMore = async () => {
    if (next === null) return;
    setMore(true);
    try {
      const h = await matchHistory(SERVER, address, { limit: PAGE, before: next });
      setRows((r) => [...r, ...h.entries]);
      setNext(h.next);
    } catch {
      /* keep what we have; the button stays */
    } finally {
      setMore(false);
    }
  };

  return (
    <section className="pf-card pf-history">
      <h3>Your matches</h3>
      {load.state === 'loading' && <p className="pf-muted">Loading…</p>}
      {(load.state === 'down' || load.state === 'error') && (
        <div className="pf-muted">
          <p>{load.state === 'down' ? "Can't reach the match server, so your history can't load right now." : `History didn't load: ${load.text}`}</p>
          <button className="link" onClick={() => void fetchAll()}>
            Try again
          </button>
        </div>
      )}
      {load.state === 'ok' && stats && (
        <>
          <div className="pf-stats">
            <Stat label="Played" value={String(stats.played)} />
            <Stat label="Won" value={String(stats.won)} />
            <Stat label="Lost" value={String(stats.lost)} />
            <Stat label="Draw" value={String(stats.draw)} />
            <Stat label="Net" value={signedSol(stats.net)} tone={stats.net > 0 ? 'good' : stats.net < 0 ? 'bad' : ''} />
            <Stat label="Best score" value={stats.best > 0 ? String(stats.best) : '—'} />
          </div>
          {rows.length === 0 ? (
            <p className="pf-muted">No online matches yet. Quick Match and friend matches show up here once they settle on-chain.</p>
          ) : (
            <ul className="pf-list">
              {rows.map((m) => (
                <Row key={m.matchId} m={m} />
              ))}
            </ul>
          )}
          {next !== null && (
            <button className="link pf-more" onClick={() => void loadMore()} disabled={more}>
              {more ? 'Loading…' : 'Older matches'}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function Stat({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div className={`pf-stat ${tone}`}>
      <b>{value}</b>
      <small>{label}</small>
    </div>
  );
}

function Row({ m }: { m: HistoryEntry }) {
  const stake = m.stakes[m.side];
  const who = m.bot ? 'Bot' : m.opponentName || short(m.opponent);
  return (
    <li className={`pf-row-m ${m.outcome}`}>
      <span className="pf-out">{m.outcome === 'won' ? 'Won' : m.outcome === 'lost' ? 'Lost' : 'Draw'}</span>
      <div className="pf-mid">
        <b>
          vs {who}
          {!m.bot && m.opponentName && <code>{short(m.opponent)}</code>}
        </b>
        <small>
          {stake ? `${sol(stake)} SOL stake` : 'Free'} · {m.scores[m.side]}–{m.scores[1 - m.side]} · {ago(m.endedAt)}
        </small>
      </div>
      <div className="pf-net">
        <b>{stake ? signedSol(m.net) : '—'}</b>
        {m.settleSig && (
          <a href={BASE_EXPLORER(m.settleSig)} target="_blank" rel="noreferrer">
            tx ↗
          </a>
        )}
      </div>
    </li>
  );
}
