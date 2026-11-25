import { lazy, Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { FEE_BPS } from '@lil-dudes/client';
import { haptic, sfx } from '../feel/sound';
import { leave, rematch } from '../live/actions';
import { useLive } from '../live/store';
import { bestScore, isDemoResult, setBestScore, useApp, type LastMatch, type ScoreParts } from '../store';
import { bpsLabel, signedSol, sol } from './format';
import './flow.css';

// Verify and the explorer links need the live code: they load with it (a live result has it already).
const LiveProof = lazy(() => import('./LiveProof').then((m) => ({ default: m.LiveProof })));

/** Ceremony timeline (ms from mount). Tap anywhere to jump to the end. */
const BANNER_MS = 700;
const ROW_MS = 650;
const COUNT_MS = 480;
const PAY_COUNT_MS = 1000;

interface Row {
  label: string;
  mine: number;
  theirs: number;
}

interface Timeline {
  rowsAt: number;
  totalAt: number;
  payAt: number;
  landAt: number;
  feeAt: number;
  buttonsAt: number;
  proofAt: number;
  end: number;
}

function timeline(rows: number): Timeline {
  const rowsAt = BANNER_MS;
  const totalAt = rowsAt + rows * ROW_MS + 100;
  const payAt = totalAt + 800;
  const landAt = payAt + PAY_COUNT_MS;
  const feeAt = landAt + 200;
  const buttonsAt = feeAt + 400;
  const proofAt = buttonsAt + 350;
  return { rowsAt, totalAt, payAt, landAt, feeAt, buttonsAt, proofAt, end: proofAt + 300 };
}

const PARTS: { key: keyof ScoreParts; label: string }[] = [
  { key: 'damage', label: 'Damage' },
  { key: 'towers', label: 'Towers' },
  { key: 'first', label: 'FIRST' },
  { key: 'rush', label: 'Rush' },
];

/** The score rows: the parts from the breakdown (FIRST hidden when both 0), reconciled to the
 *  result's score so the column always adds up to what the match says. */
function rowsOf(m: LastMatch): Row[] {
  const me = m.mySide;
  const them = (1 - me) as 0 | 1;
  const rows: Row[] = PARTS.map((p) => ({ label: p.label, mine: m.breakdown[me][p.key], theirs: m.breakdown[them][p.key] })).filter(
    (r) => r.label !== 'FIRST' || r.mine !== 0 || r.theirs !== 0,
  );
  const sum = (side: 'mine' | 'theirs') => rows.reduce((a, r) => a + r[side], 0);
  const dMine = m.result.gold[me] - sum('mine');
  const dTheirs = m.result.gold[them] - sum('theirs');
  if (dMine !== 0 || dTheirs !== 0) {
    const empty = sum('mine') === 0 && sum('theirs') === 0;
    if (empty) return [{ label: 'Gold', mine: m.result.gold[me], theirs: m.result.gold[them] }];
    rows.push({ label: 'Other', mine: dMine, theirs: dTheirs });
  }
  return rows;
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Result ceremony (SPEC v5 §8), ~6–7 s, tap to skip: banner → both scores counting up part by part →
 * totals → the payout split animating into your pill (coin shower) → fee line → Rematch / Home →
 * Verify + explorer links. Every money number comes from the MatchResult and the stake.
 */
export function Result() {
  const go = useApp((s) => s.go);
  const m = useApp((s) => s.lastMatch);
  // A live match: the settlement, balance, Verify and links come from live/session.
  const live = useLive((s) => (s.phase === 'playing' || s.phase === 'ended') && !!s.source);
  const liveBot = useLive((s) => !!s.opp?.bot);

  const rows = useMemo(() => (m ? rowsOf(m) : []), [m]);
  const tl = useMemo(() => timeline(rows.length), [rows.length]);
  const [t, setT] = useState(() => (reducedMotion() ? tl.end : 0));
  // Reduced motion: straight to the end state, no count-ups, no shower, no ceremony sounds.
  const skipped = useRef(t >= tl.end);
  const fired = useRef(new Set<string>());

  // My best before this match (read once), then save the new one.
  const myScore = m ? m.result.gold[m.mySide] : 0;
  const [prevBest] = useState(bestScore);
  const record = !!m && myScore > 0 && myScore > prevBest;
  useEffect(() => {
    if (record && !isDemoResult) setBestScore(myScore);
  }, [record, myScore]);

  // The clock.
  useEffect(() => {
    if (t >= tl.end) return;
    const t0 = performance.now() - t;
    let raf = 0;
    const step = () => {
      if (skipped.current) return;
      const now = Math.min(tl.end, performance.now() - t0);
      setT(now);
      if (now < tl.end) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // Started once; a skip sets t to the end directly.
  }, []);

  const me = m?.mySide ?? 0;
  const them = (1 - me) as 0 | 1;
  const won = m ? (m.result.winner === null ? null : m.result.winner === me) : null;
  const free = !m || m.stake === 0;
  const S = m?.stake ?? 0;
  const net = !m || free || won === null ? 0 : won ? m.result.moved - m.result.fee : -m.result.moved;
  const gain = net > 0;

  // Sound and haptics as the clock passes each beat (not when skipping).
  useEffect(() => {
    if (!m || skipped.current) return;
    const once = (key: string, at: number, fn: () => void) => {
      if (t >= at && !fired.current.has(key)) {
        fired.current.add(key);
        fn();
      }
    };
    rows.forEach((_, i) => once(`row${i}`, tl.rowsAt + i * ROW_MS, () => sfx.ladder(i)));
    once('total', tl.totalAt, () => sfx.ladder(rows.length));
    if (!free && won !== null) {
      once('pay', tl.payAt, () => {
        if (gain) sfx.payout();
      });
      once('land', tl.landAt, () => haptic(gain ? 'big' : 'tap'));
    }
  }, [t, m, rows, tl, free, won, gain]);

  const done = t >= tl.end;
  const skip = () => {
    if (done) return;
    skipped.current = true;
    setT(tl.end);
  };

  if (!m) {
    return (
      <div className="screen result flow-result">
        <h2 className="banner draw">NO MATCH</h2>
        <div className="actions row2">
          <button className="big primary" onClick={() => go('home')}>
            Home
          </button>
        </div>
      </div>
    );
  }

  const oppName = m.opponentIsBot || (live && liveBot) ? 'Bot' : m.names[1];
  const died = m.result.died === null ? null : m.result.died === me ? 'me' : 'them';
  const banner = died === 'me' ? 'OVERRUN' : died === 'them' ? 'THEY FELL' : won === null ? 'DRAW' : won ? 'YOU WIN' : 'YOU LOSE';
  const tone = won === null ? 'draw' : won ? 'win' : 'lose';

  // Count-up values at time t.
  const rowK = (i: number) => ease((t - (tl.rowsAt + i * ROW_MS)) / COUNT_MS);
  const shownRows = rows.map((r, i) => ({ ...r, k: rowK(i), on: t >= tl.rowsAt + i * ROW_MS }));
  const runMine = shownRows.reduce((a, r) => a + Math.round(r.mine * r.k), 0);
  const runTheirs = shownRows.reduce((a, r) => a + Math.round(r.theirs * r.k), 0);
  const totalsOn = t >= tl.totalAt;
  const payK = ease((t - tl.payAt) / PAY_COUNT_MS);
  const payOn = t >= tl.payAt;

  // The pot split, from the result: you get S + net back, they get the rest minus the fee.
  const pot = 2 * S;
  const fee = free || won === null ? 0 : m.result.fee;
  const myBack = S + net;
  const theirBack = pot - fee - myBack;
  const split = (v: number) => (pot > 0 ? (S + (v - S) * payK) / pot : 0.5);
  const feeShare = pot > 0 ? (fee * payK) / pot : 0;

  return (
    <div className={`screen result flow-result ${done ? 'done' : ''}`} onClick={skip}>
      <h2 className={`banner ${tone}`}>{banner}</h2>
      <p className="sub">
        vs {oppName} · {m.layoutName}
        {isDemoResult && ' · sample result'}
      </p>

      <section className="card score-card">
        <div className="score-head">
          <span />
          <b className="me">You</b>
          <b className="them">{oppName}</b>
        </div>
        {shownRows.map((r) => (
          <div key={r.label} className={`score-row ${r.on ? 'on' : ''} ${r.label === 'FIRST' ? 'first' : ''}`}>
            <span>{r.label}</span>
            <b>{Math.round(r.mine * r.k)}</b>
            <b>{Math.round(r.theirs * r.k)}</b>
          </div>
        ))}
        <div className={`score-total ${totalsOn ? 'on' : ''}`}>
          <span>Score</span>
          <b className={`gnum ${totalsOn && myScore >= m.result.gold[them] ? 'lead' : ''}`} data-t={String(runMine)}>
            {runMine}
          </b>
          <b className="gnum small" data-t={String(runTheirs)}>
            {runTheirs}
          </b>
        </div>
        {record && totalsOn && <span className="record-tag">New record!</span>}
      </section>

      <section className={`card pay-card ${payOn ? 'on' : ''}`}>
        {free ? (
          <p className="pay-free">Free match: no stake moved</p>
        ) : won === null ? (
          <>
            <div className={`pay-pill draw ${payOn ? 'on' : ''}`}>±0 SOL</div>
            <p className="pay-why">Draw: both stakes back, no fee.</p>
          </>
        ) : (
          <>
            <div className="split" aria-hidden>
              <i className="me" style={{ width: `${split(myBack) * 100}%` }} />
              <i className="them" style={{ width: `${split(theirBack) * 100}%` }} />
              <i className="fee" style={{ width: `${feeShare * 100}%` }} />
            </div>
            <div className="split-labels">
              <span className="me">You {sol(Math.round(S + (myBack - S) * payK))}</span>
              <span className="pot">pot {sol(pot)}</span>
              <span className="them">
                {oppName} {sol(Math.round(S + (theirBack - S) * payK))}
              </span>
            </div>
            <div className={`pay-pill ${gain ? 'plus' : 'minus'} ${payOn ? 'on' : ''} ${t >= tl.landAt ? 'landed' : ''}`}>
              {signedSol(Math.round(net * payK))}
            </div>
            <p className={`pay-why ${t >= tl.feeAt ? 'on' : ''}`}>
              {died
                ? `${died === 'me' ? 'You were' : `${oppName} was`} overrun: the whole stake moves.`
                : `${m.result.gold[m.result.winner!]} vs ${m.result.gold[1 - m.result.winner!]}: ${sol(m.result.moved)} SOL of ${won ? `${oppName}'s` : 'your'} stake moves.`}
              <br />
              Fee {bpsLabel(FEE_BPS)} of what moved: {sol(m.result.fee)} SOL
            </p>
          </>
        )}
      </section>

      <div className={`actions row2 reveal ${t >= tl.buttonsAt ? 'on' : ''}`}>
        <button className="big primary" onClick={() => (live ? void rematch() : go('vs'))}>
          {live && liveBot ? 'Play again' : 'Rematch'}
        </button>
        <button className="big" onClick={() => (live ? leave() : go('home'))}>
          Home
        </button>
      </div>

      {live ? (
        <Suspense fallback={null}>
          <LiveProof on={t >= tl.proofAt} />
        </Suspense>
      ) : (
      <section className={`proof-row reveal ${t >= tl.proofAt ? 'on' : ''}`}>
        <button className="big" disabled title="Needs the revealed VRF seed from the chain">
          Verify
        </button>
        <div className="links">
          <a aria-disabled title="No settlement transaction: this match was not on chain">
            Settlement tx ↗
          </a>
          <a aria-disabled title="No match account: this match was not on chain">
            Match account ↗
          </a>
        </div>
      </section>
      )}

      {!done && <p className="skip-hint">tap to skip</p>}
      {gain && payOn && !skipped.current && !reducedMotion() && <CoinShower />}
    </div>
  );
}

/** Our own coin shower: CSS coins falling with a little spin, ~1.6 s. */
function CoinShower() {
  const coins = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        x: (i * 37) % 100,
        d: ((i * 53) % 60) / 100,
        s: 0.9 + ((i * 29) % 50) / 100,
        r: ((i * 71) % 2 ? 1 : -1) * (180 + ((i * 43) % 360)),
        z: 0.7 + ((i * 17) % 50) / 100,
      })),
    [],
  );
  return (
    <div className="coins" aria-hidden>
      {coins.map((c, i) => (
        <i
          key={i}
          style={
            {
              left: `${c.x}%`,
              animationDelay: `${c.d}s`,
              animationDuration: `${c.s}s`,
              '--r': `${c.r}deg`,
              '--z': c.z,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
