import { useEffect, useState } from 'react';
import { STAKE_MIN, maxStake, stakeOnChain } from '@lil-dudes/client';
import { STAKE_PRESETS, useApp } from '../store';
import { sol } from './format';
import './live.css';

/** What the picked stake allows (Home's buttons read it too). */
export interface StakeCheck {
  ok: boolean;
  /** One line under the field ("" when there's nothing to say). */
  hint: string;
  /** The amount is fine but needs a top-up first. */
  short: boolean;
  /** GAP (program): a valid amount the program doesn't take yet. */
  notLive: boolean;
}

/** Valid = at least 0.01 SOL, at most the balance minus the reserve, and (today) a program tier. */
export function checkStake(lamports: number, balance: number | null): StakeCheck {
  if (!Number.isFinite(lamports) || lamports < STAKE_MIN) return { ok: false, hint: `Min ${sol(STAKE_MIN)} SOL`, short: false, notLive: false };
  // The program's limit first (topping up wouldn't help), then the balance.
  if (!stakeOnChain(lamports)) return { ok: false, hint: 'Live on-chain today: 0.05 · 0.1 · 0.25. Any amount comes with the next program update.', short: false, notLive: true };
  if (balance !== null && lamports > maxStake(balance)) {
    return { ok: false, hint: `Max ${sol(maxStake(balance))} SOL: your balance minus ~0.035 for rent and fees`, short: true, notLive: false };
  }
  return { ok: true, hint: '', short: false, notLive: false };
}

const toSol = (lamports: number) => sol(lamports);
const toLamports = (text: string) => Math.round(Number(text.replace(',', '.')) * 1e9);

/** +/− step: 0.01 under 0.1 SOL, 0.05 from there. */
function step(lamports: number, dir: 1 | -1): number {
  const up = dir > 0 ? lamports >= 100_000_000 : lamports > 100_000_000;
  const s = up ? 50_000_000 : 10_000_000;
  const next = Math.round(lamports / s) * s + dir * s;
  return Math.max(STAKE_MIN, next);
}

export interface StakePickerProps {
  locked: boolean;
  balance: number | null;
  onTopUp: () => void;
  toppingUp: boolean;
}

/**
 * Home's stake card: Free (vs bot) or a stake: a numeric field with − / +, quick presets, the
 * burner balance and Top up. Devnet play money.
 */
export function StakePicker({ locked, balance, onTopUp, toppingUp }: StakePickerProps) {
  const free = useApp((s) => s.free);
  const stake = useApp((s) => s.stake);
  const setFree = useApp((s) => s.setFree);
  const setStake = useApp((s) => s.setStake);
  const [text, setText] = useState(() => toSol(stake));
  // Presets and −/+ write the store; mirror it into the field.
  useEffect(() => {
    if (toLamports(text) !== stake) setText(toSol(stake));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stake]);

  const typed = toLamports(text);
  const check = checkStake(typed, balance);

  return (
    <div className={`stake-card live-stake ${locked ? 'is-locked' : ''}`}>
      <div className="ls-top">
        <span className="stake-head">Stake · devnet SOL</span>
        {!locked && (
          <button className="ls-bal" onClick={onTopUp} disabled={toppingUp} title="Your burner wallet in this browser (devnet play money)">
            <span>{balance === null ? '…' : sol(balance)} SOL</span>
            <b>{toppingUp ? 'Topping up…' : 'Top up'}</b>
          </button>
        )}
      </div>

      <div className="ls-mode" role="radiogroup" aria-label="Free or staked">
        <button role="radio" aria-checked={free} className={`chip ${free ? 'on' : ''}`} onClick={() => setFree(true)}>
          Free · vs Bot
        </button>
        <button role="radio" aria-checked={!free} className={`chip ${!free ? 'on' : ''} ${locked ? 'locked' : ''}`} disabled={locked} onClick={() => setFree(false)}>
          Stake
        </button>
      </div>

      {!free && !locked && (
        <>
          <div className={`ls-field ${check.ok ? '' : check.notLive && !check.short ? 'warn' : 'bad'}`}>
            <button className="ls-step" aria-label="Less" onClick={() => setStake(step(Number.isFinite(typed) ? typed : stake, -1))}>
              −
            </button>
            <label>
              <input
                inputMode="decimal"
                enterKeyHint="done"
                aria-label="Stake in devnet SOL"
                value={text}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^\d.,]/g, '').slice(0, 8);
                  setText(v);
                  const l = toLamports(v);
                  if (Number.isFinite(l) && l > 0) useApp.setState({ stake: l, free: false });
                }}
                onBlur={() => {
                  if (Number.isFinite(typed) && typed > 0) setStake(typed);
                  else setText(toSol(stake));
                }}
              />
              <span>SOL</span>
            </label>
            <button className="ls-step" aria-label="More" onClick={() => setStake(step(Number.isFinite(typed) ? typed : stake, 1))}>
              +
            </button>
          </div>
          <div className="stakes ls-presets">
            {STAKE_PRESETS.map((p) => {
              const l = Math.round(p * 1e9);
              return (
                <button key={p} className={`chip ${typed === l ? 'on' : ''}`} onClick={() => setStake(l)}>
                  {p}
                </button>
              );
            })}
          </div>
          <p className={`ls-hint ${check.ok ? '' : check.notLive && !check.short ? 'warn' : 'bad'}`} aria-live="polite">
            {check.hint || `Pot ${sol(typed * 2)} SOL · the higher score takes a slice`}
          </p>
        </>
      )}
    </div>
  );
}
