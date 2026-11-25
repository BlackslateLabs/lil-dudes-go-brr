import { useEffect, useState } from 'react';
import { FEE_BPS, stakeOnChain } from '@lil-dudes/client';
import { cancel, confirmJoin, leave, needFor, quickMatch, refreshBalance, topUpFor, useLive, type LiveError, type Step } from '../live/session';
import { useApp } from '../store';
import { bpsLabel, sol } from './format';
import './flow.css';
import './live.css';

/** "0:07" since `since`, ticking once a second. */
export function useElapsed(since: number): string {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The chain / server steps as they happen: ✓ done, a pulse for the one in progress, ✕ failed. */
export function StepList({ steps }: { steps: Step[] }) {
  return (
    <ol className="live-steps" aria-live="polite">
      {steps.map((s) => (
        <li key={s.key} className={s.state}>
          <i aria-hidden />
          <span>
            {s.label}
            {s.note && <small>{s.note}</small>}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The live waiting screens (MVP §3.5): Quick Match queue, Create room (code + share), Join room
 * (stake to confirm), rematch waits, and every error with its way out.
 */
export function Lobby() {
  const s = useLive();
  const elapsed = useElapsed(s.since);
  const title =
    s.mode === 'queue' ? 'Quick Match' : s.mode === 'host' ? 'Your Room' : s.mode === 'join' ? 'Join a Room' : s.mode === 'rematch' ? 'Rematch' : 'Live Match';
  const amt = s.room?.stake || s.stake;
  // A joiner doesn't know the stake until the room is looked up.
  const known = !(s.mode === 'join' && !amt && s.matchId === null);
  const stakeChip = known ? (amt ? `${sol(amt)} SOL` : 'Free') : null;

  return (
    <div className="screen lobby">
      <header className="lobby-head">
        <h2 className="lobby-title">{title}</h2>
        {stakeChip && <span className="lobby-stake">{stakeChip}</span>}
      </header>

      {s.phase === 'error' && s.error ? (
        <ErrorCard error={s.error} steps={s.steps} />
      ) : s.mode === 'join' && s.confirm && s.room ? (
        <JoinConfirm />
      ) : (
        <>
          <div className="lobby-wait">
            <Marchers />
            {(s.phase === 'queue' || (s.phase === 'host' && s.room) || (s.mode === 'rematch' && s.phase === 'join')) && <b className="lobby-clock">{elapsed}</b>}
          </div>
          {s.phase === 'host' && s.room && <ShareCard code={s.room.code} />}
          <StepList steps={s.steps} />
          {s.conn === 'retrying' && <p className="lobby-conn">Reconnecting…</p>}
          {s.phase === 'queue' && s.qstats && (
            <div className="lobby-stats">
              <p>
                {s.qstats.here > 0 ? `${s.qstats.here} waiting at ${s.stake ? `${sol(s.stake)} SOL` : 'free'}` : `Nobody else at ${s.stake ? `${sol(s.stake)} SOL` : 'free'} yet`} ·{' '}
                {s.qstats.online} online
              </p>
            </div>
          )}
          {s.lonely && s.phase === 'queue' && (
            <div className="lobby-lonely">
              {s.qstats && s.qstats.near.some((n) => n.stake === 0 || stakeOnChain(n.stake)) ? (
                <>
                  <p>Players are waiting at:</p>
                  <div className="near-stakes">
                    {s.qstats.near.filter((n) => n.stake === 0 || stakeOnChain(n.stake)).map((n) => (
                      <button key={n.stake} className="chip" onClick={() => void switchStake(n.stake)}>
                        {n.stake ? `${sol(n.stake)} SOL` : 'Free'}
                        <small>{n.players} waiting</small>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <p>No one around at {s.stake ? `exactly ${sol(s.stake)} SOL` : 'this stake'} yet.</p>
              )}
              <button
                className="link"
                onClick={() => {
                  void cancel().then(() => {
                    useApp.getState().setTutorialAgain(false);
                    useApp.getState().go('vs');
                  });
                }}
              >
                Play the bot instead (free)
              </button>
            </div>
          )}
          <div className="actions lobby-actions">
            <button className="big" onClick={() => void cancel()}>
              {s.phase === 'host' && s.room ? `Cancel${s.stake ? ' & refund' : ''}` : 'Cancel'}
            </button>
          </div>
        </>
      )}
      <p className="lobby-foot">Devnet play money · your burner signs, no wallet popups</p>
    </div>
  );
}

/** Queue at one of the suggested stakes instead (Home remembers it; free switches to Free). */
async function switchStake(stake: number) {
  if (stake > 0) useApp.getState().setStake(stake);
  await quickMatch(stake);
}

/** A few dudes marching in place while you wait. */
function Marchers() {
  return (
    <div className="marchers" aria-hidden>
      {[0, 1, 2, 3, 4].map((i) => (
        <i key={i} style={{ animationDelay: `${i * 0.12}s` }} />
      ))}
    </div>
  );
}

/** The room code, a share link (copy) and the phone's share sheet. */
function ShareCard({ code }: { code: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const link = `${window.location.origin}${window.location.pathname}?room=${code}`;
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied('Copy blocked: long-press the code');
    }
    setTimeout(() => setCopied(null), 1800);
  };
  const share = async () => {
    try {
      await navigator.share({ title: 'Lil Dudes Go Brr', text: `Play me! Room ${code}`, url: link });
    } catch {
      /* dismissed */
    }
  };
  return (
    <section className="share-card">
      <span className="share-label">Room code</span>
      <button className="code-tiles" onClick={() => void copy(code, 'Code copied')} aria-label={`Room code ${code}, tap to copy`}>
        {code.split('').map((ch, i) => (
          <b key={i}>{ch}</b>
        ))}
      </button>
      <div className="share-link">
        <span title={link}>{link.replace(/^https?:\/\//, '')}</span>
      </div>
      <div className="actions row2">
        <button className="big" onClick={() => void copy(link, 'Link copied')}>
          Copy link
        </button>
        {typeof navigator.share === 'function' && (
          <button className="big primary" onClick={() => void share()}>
            Share
          </button>
        )}
      </div>
      {copied && <span className="share-copied">{copied}</span>}
    </section>
  );
}

/** The joiner sees the host's stake and confirms (or tops up first). */
function JoinConfirm() {
  const room = useLive((s) => s.room)!;
  const balance = useLive((s) => s.balance);
  const [topping, setTopping] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const need = needFor(room.stake);
  const short = balance !== null && balance < need;
  return (
    <section className="card join-card">
      <p className="join-from">
        <b>{room.host}</b> invites you
      </p>
      <div className="sheet-stake">
        <span>Stake (set by the host)</span>
        <b className="gnum" data-t={room.stake ? `${sol(room.stake)} SOL` : 'FREE'}>
          {room.stake ? `${sol(room.stake)} SOL` : 'FREE'}
        </b>
      </div>
      {room.stake > 0 && (
        <p className="sheet-line">
          Pot {sol(room.stake * 2)} · fee {bpsLabel(FEE_BPS)} of what moves · devnet
        </p>
      )}
      <p className="sheet-fine">
        Room {room.code} · your burner: {balance === null ? '…' : `${sol(balance)} SOL`}
        {short && ` · needs ${sol(need)}`}
      </p>
      {short ? (
        <button
          className="big primary"
          disabled={topping}
          onClick={async () => {
            setTopping(true);
            const r = await topUpFor(room.stake);
            setTopping(false);
            setMsg(r.text);
            void refreshBalance();
          }}
        >
          {topping ? 'Topping up…' : 'Top up (devnet)'}
        </button>
      ) : (
        <button className="big primary" disabled={balance === null} onClick={() => void confirmJoin()}>
          {room.stake ? `Join · lock ${sol(room.stake)} SOL` : 'Join (free)'}
        </button>
      )}
      {msg && <p className="ls-hint">{msg}</p>}
      <button className="sheet-cancel" onClick={() => void cancel()}>
        Not now
      </button>
    </section>
  );
}

/** What went wrong, in words, with the way out: retry, top up, or Home. */
export function ErrorCard({ error, steps }: { error: LiveError; steps?: Step[] }) {
  const [topping, setTopping] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <section className={`card error-card kind-${error.kind}`} role="alert">
      <b className="error-title">{error.title}</b>
      <p className="error-msg">{error.message}</p>
      {steps && steps.length > 0 && <StepList steps={steps} />}
      {msg && <p className="ls-hint">{msg}</p>}
      <div className="actions">
        {error.kind === 'balance' && (
          <button
            className="big primary"
            disabled={topping}
            onClick={async () => {
              setTopping(true);
              const r = await topUpFor(error.stake ?? 0);
              setTopping(false);
              setMsg(r.text);
            }}
          >
            {topping ? 'Topping up…' : 'Top up (devnet)'}
          </button>
        )}
        {error.retry && (
          <button className={`big ${error.kind === 'balance' ? '' : 'primary'}`} onClick={error.retry}>
            Try again
          </button>
        )}
        <button className="big" onClick={leave}>
          Home
        </button>
      </div>
    </section>
  );
}
