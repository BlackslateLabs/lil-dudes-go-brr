import { useEffect, useRef, useState } from 'react';
import { STAKE_MIN, maxStake, stakeOnChain } from '@lil-dudes/client';
import { clock, useFaucet } from '../live/store';
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
  if (!stakeOnChain(lamports)) return { ok: false, hint: 'On-chain today: 0.05, 0.1 or 0.25. Any amount soon.', short: false, notLive: true };
  if (balance !== null && lamports > maxStake(balance)) {
    return { ok: false, hint: `Max ${sol(maxStake(balance))} SOL (keeps ~0.035 for fees)`, short: true, notLive: false };
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
  /** Unlock staked play without the first bot match. */
  onSkip: () => void;
}

const Lock = () => (
  <svg className="seg-lock" viewBox="0 0 16 16" aria-hidden>
    <path d="M4.5 7V5a3.5 3.5 0 0 1 7 0v2" fill="none" stroke="currentColor" strokeWidth="2" />
    <rect x="2.5" y="7" width="11" height="8" rx="2" fill="currentColor" />
  </svg>
);

/**
 * Home's stake card: a Free / Stake switch; with a stake, a numeric field with − / +, quick
 * presets, the burner balance and Top up. Devnet play money.
 */
export function StakePicker({ locked, balance, onTopUp, toppingUp, onSkip }: StakePickerProps) {
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

  // Top-up cooldown: the chip counts down instead of offering a refused top-up.
  const until = useFaucet((f) => f.until);
  const policy = useFaucet((f) => f.policy);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  const left = until ? until - now : 0;
  const cooling = left > 0;

  // The limits live behind a small "i", never inline on Home.
  const [info, setInfo] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!info) return;
    const off = (e: PointerEvent) => {
      if (!infoRef.current?.contains(e.target as Node)) setInfo(false);
    };
    window.addEventListener('pointerdown', off);
    return () => window.removeEventListener('pointerdown', off);
  }, [info]);

  return (
    <div className={`stake-card live-stake ${locked ? 'is-locked' : ''} ${free ? 'is-free' : 'is-staked'}`}>
      <div className={`seg ${free ? '' : 'right'}`} role="radiogroup" aria-label="Free or staked">
        <i className="seg-thumb" aria-hidden />
        <button role="radio" aria-checked={free} className={free ? 'on' : ''} onClick={() => setFree(true)}>
          Free
        </button>
        <button role="radio" aria-checked={!free} className={!free ? 'on' : ''} disabled={locked} onClick={() => setFree(false)}>
          {locked && <Lock />}
          Stake SOL
        </button>
      </div>

      {locked && (
        <p className="ls-hint">
          Staked play unlocks after your first bot match ·{' '}
          <button className="link" onClick={onSkip}>
            skip
          </button>
        </p>
      )}
      {free && !locked && <p className="ls-hint">Practice for free. No wallet, nothing at stake.</p>}

      {!free && !locked && (
        <>
          <div className="ls-wallet">
            <span>
              Wallet <b>{balance === null ? '…' : sol(balance)} SOL</b>
            </span>
            <div className="ls-topwrap" ref={infoRef}>
              <button
                className={`ls-topup ${cooling ? 'cooling' : ''}`}
                onClick={onTopUp}
                disabled={toppingUp || cooling}
                title={cooling ? 'Next free top-up' : 'Free devnet SOL into your game wallet'}
              >
                {toppingUp ? 'Topping up…' : cooling ? clock(left) : '+ Top up'}
              </button>
              <button className="ls-info" aria-label="Top-up limits" aria-expanded={info} onClick={() => setInfo((v) => !v)}>
                i
              </button>
              {info && (
                <div className="ls-pop" role="note">
                  <b>Free devnet SOL</b>
                  <ul>
                    <li>Tops your game wallet up to {sol(policy.maxBalance)} SOL at most.</li>
                    <li>Once every {Math.round(policy.burnerEveryMs / 60_000)} min per wallet, {policy.ipMax} per {Math.round(policy.ipWindowMs / 60_000)} min per connection.</li>
                    <li>Stakes above ~{sol(policy.maxBalance - policy.reserve)} SOL need SOL from your own wallet.</li>
                  </ul>
                </div>
              )}
            </div>
          </div>
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
