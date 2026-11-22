import { useEffect, useState } from 'react';
import { HP_MAX } from '@lil-dudes/client';
import { useApp } from '../store';
import { SAMPLE_PHASES, SAMPLE_RIG_LINES, sol, type RevealCell } from './resultSample';

/**
 * Result (MVP §3.7): WIN / LOSE / DRAW, final HP, a count-up of the money moved with one line on why,
 * the full reveal, then Rematch / Home / Verify after ~1.8 s.
 */
export function Result() {
  const go = useApp((s) => s.go);
  const m = useApp((s) => s.lastMatch);
  const [phase, setPhase] = useState(0);

  const won = m ? (m.result.winner === null ? null : m.result.winner === m.mySide) : null;
  const hpPct = (hp: number) => Math.round((hp / HP_MAX) * 100);
  const free = !m || m.stake === 0;
  const net = m ? (won ? m.result.moved - m.result.fee : -m.result.moved) : 0;
  const shown = useCountUp(Math.abs(net), 1200);

  return (
    <div className="screen result">
      <h2 className={`banner ${won === null ? 'draw' : won ? 'win' : 'lose'}`}>
        {won === null ? (m ? 'DRAW' : 'NO MATCH') : won ? 'YOU WIN' : 'YOU LOSE'}
      </h2>
      {m && (
        <p className="sub">
          {m.result.ko ? 'Knockout' : 'Timer'} · {hpPct(m.hp[0])}% vs {hpPct(m.hp[1])}% HP · vs {m.names[1]}
        </p>
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
            <p className="why">{whyLine(m!.result.ko, m!.hp, won)}</p>
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

      <section className="card reveal">
        <div className="tabs" role="tablist">
          {SAMPLE_PHASES.map((_, i) => (
            <button key={i} role="tab" aria-selected={phase === i} className={phase === i ? 'on' : ''} onClick={() => setPhase(i)}>
              Deal {i + 1}
            </button>
          ))}
        </div>
        <Board cells={SAMPLE_PHASES[phase] ?? []} />
        <p className="legend">
          <i className="k-trap" /> rigged by them <i className="k-peek" /> you peeked <i className="k-gold" /> gold
        </p>
        <p className="rig-line">{SAMPLE_RIG_LINES[phase]}</p>
        <p className="sample-note">Sample boards: the deal history isn't in MatchView yet.</p>
      </section>

      <div className="later">
        <section className="card proof">
          <button className="big" disabled title="Needs the revealed VRF seed from the chain (M4)">
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

function whyLine(ko: boolean, hp: [number, number], won: boolean | null): string {
  if (ko) return 'KO: the full stake moves.';
  const leadPm = Math.floor((Math.abs(hp[0] - hp[1]) * 1000) / HP_MAX);
  const share = (500 + leadPm / 2) / 10;
  return won
    ? `Won by ${leadPm / 10}% HP → you take ${share}% of their stake, 5% fee.`
    : `Lost by ${leadPm / 10}% HP → they take ${share}% of your stake.`;
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

function Board({ cells }: { cells: RevealCell[] }) {
  // Row 2 (furthest from your cannon) is drawn at the top, as in the arena.
  const rows = [2, 1, 0];
  return (
    <div className="board">
      {rows.flatMap((row) =>
        [0, 1, 2].map((col) => {
          const c = cells[row * 3 + col];
          if (!c) return null;
          return (
            <div key={`${row}${col}`} className={`cell k-${c.kind}${c.peeked ? ' peeked' : ''}`}>
              {c.label}
            </div>
          );
        }),
      )}
    </div>
  );
}
