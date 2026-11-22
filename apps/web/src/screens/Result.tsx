import { useEffect, useState } from 'react';
import { useApp } from '../store';
import { sol } from './format';

/**
 * Result (MVP §3.7, v3): WIN / LOSE / DRAW, gold for both and who died, a count-up of the money
 * moved with one line on why, then Rematch / Home / Verify after ~1.8 s.
 * The full per-stage reveal (OfflineSource/LiveSource `reveal()`) is wired in the next step.
 */
export function Result() {
  const go = useApp((s) => s.go);
  const m = useApp((s) => s.lastMatch);

  const me = m?.mySide ?? 0;
  const them = (1 - me) as 0 | 1;
  const won = m ? (m.result.winner === null ? null : m.result.winner === me) : null;
  const free = !m || m.stake === 0;
  const net = m ? (won ? m.result.moved - m.result.fee : -m.result.moved) : 0;
  const shown = useCountUp(Math.abs(net), 1200);
  const gold = m ? [m.result.gold[me], m.result.gold[them]] : [0, 0];

  return (
    <div className="screen result">
      <h2 className={`banner ${won === null ? 'draw' : won ? 'win' : 'lose'}`}>
        {won === null ? (m ? 'DRAW' : 'NO MATCH') : won ? 'YOU WIN' : 'YOU LOSE'}
      </h2>
      {m && (
        <p className="sub">
          {m.result.died === null ? 'Both survived' : m.result.died === me ? 'You were overrun' : `${m.names[1]} was overrun`} · vs{' '}
          {m.names[1]} · {m.layoutName}
        </p>
      )}

      {m && (
        <section className="card golds">
          <div className="row big-num">
            <span>Your gold</span>
            <b>{gold[0]}</b>
          </div>
          <div className="row">
            <span>{m.names[1]}'s gold</span>
            <span>{gold[1]}</span>
          </div>
        </section>
      )}

      <section className="card payout">
        {free ? (
          <p className="why">Free match: no stake moved. Stakes are for PvP only.</p>
        ) : won === null ? (
          <p className="why">Draw: nothing moves, both stakes are refunded.</p>
        ) : (
          <>
            <div className="row big-num">
              <span>{won ? 'You get' : 'You lose'}</span>
              <b className={won ? 'plus' : 'minus'}>
                {won ? '+' : '−'}
                {sol(shown)} SOL
              </b>
            </div>
            <p className="why">{whyLine(m!, won)}</p>
            <div className="row">
              <span>Moved from loser</span>
              <span>{sol(m!.result.moved)} SOL</span>
            </div>
            <div className="row">
              <span>Fee (5%)</span>
              <span>−{sol(m!.result.fee)} SOL</span>
            </div>
          </>
        )}
      </section>

      <div className="later">
        <section className="card proof">
          <button className="big" disabled title="Needs the revealed VRF seed from the chain">
            Verify match
          </button>
          <div className="links">
            <a aria-disabled>Settlement tx ↗</a>
            <a aria-disabled>Match account ↗</a>
          </div>
        </section>
        <div className="actions row2">
          <button className="big primary" onClick={() => go('match')}>
            Rematch
          </button>
          <button className="big" onClick={() => go('home')}>
            Home
          </button>
        </div>
      </div>
    </div>
  );
}

function whyLine(m: NonNullable<ReturnType<typeof useApp.getState>['lastMatch']>, won: boolean): string {
  const me = m.mySide;
  const them = (1 - me) as 0 | 1;
  if (m.result.died !== null) return won ? `${m.names[1]} was overrun → you take the pot, 5% fee.` : 'You were overrun → they take the pot.';
  const total = m.result.gold[0] + m.result.gold[1];
  const pct = total > 0 ? Math.round((m.result.gold[me] / total) * 1000) / 10 : 50;
  return `${m.result.gold[me]} vs ${m.result.gold[them]} gold → you take ${pct}% of the pot${won ? ', 5% fee' : ''}.`;
}

/** Counts a number up from 0 over `ms` (eased). */
function useCountUp(target: number, ms: number): number {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}
