import { useEffect, useRef, useState } from 'react';
import { FEE_BPS } from '@lil-dudes/client';
import { bpsLabel, sol } from './format';
import './flow.css';

const CLOSE_MS = 150;

export interface StakeSheetProps {
  /** What the player picked: "Quick Match" or "Room Code". */
  title: string;
  /** Lamports per player. */
  stake: number;
  /** The burner's balance (lamports), if known. */
  balance?: number | null;
  /** Signed: start the staked flow (live/session). */
  onSign: () => void;
  onClose: () => void;
  /** "3 online · 1 searching at 0.1 SOL" (Quick Match), or null while unknown. */
  around?: string | null;
  /**
   * Not enough SOL for this stake: the sheet says so and offers a way to fund it instead of
   * "Sign & play". `faucet` = the free top-up can cover it (with a cooldown label while it can't
   * be used yet); otherwise `onAddFromWallet` (Profile today; Part 2's "Add SOL from wallet").
   */
  short?: {
    need: number;
    faucet: boolean;
    cooldown: string | null;
    topping: boolean;
    onTopUp: () => void;
    onAddFromWallet: () => void;
  } | null;
}

/**
 * Stake confirm (SPEC v5 §8): one bottom sheet, one signature. Opens in 0.25 s and closes in
 * 0.15 s, both with a back-ease. Tapping the dimmed backdrop cancels.
 */
export function StakeSheet({ title, stake, balance, onSign, onClose, around, short }: StakeSheetProps) {
  const [closing, setClosing] = useState(false);
  const after = useRef<() => void>(onClose);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const close = (then: () => void) => {
    if (closing) return;
    after.current = then;
    setClosing(true);
    timer.current = setTimeout(() => after.current(), CLOSE_MS);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(onClose);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`sheet-wrap ${closing ? 'closing' : ''}`} onClick={() => close(onClose)}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${title}: confirm stake`} onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>{title}</h3>
        <div className="sheet-stake">
          <span>Stake</span>
          <b className="gnum" data-t={`${sol(stake)} SOL`}>
            {sol(stake)} SOL
          </b>
        </div>
        <p className="sheet-line">
          Stake {sol(stake)} SOL · pot {sol(stake * 2)} · fee {bpsLabel(FEE_BPS)} of what moves · devnet
        </p>
        {around && <p className="sheet-around">{around}</p>}
        {short ? (
          <>
            <p className="sheet-short">
              You need {sol(short.need)} SOL for this (stake + ~0.035 for fees)
              {balance != null && `; your game wallet has ${sol(balance)}`}.
            </p>
            {short.faucet ? (
              <button className="big primary sheet-go" disabled={short.topping || !!short.cooldown} onClick={short.onTopUp}>
                {short.topping ? 'Topping up…' : short.cooldown ? `Top up in ${short.cooldown}` : 'Top up free'}
              </button>
            ) : (
              <button className="big primary sheet-go" onClick={() => close(short.onAddFromWallet)}>
                Add SOL from your wallet
              </button>
            )}
          </>
        ) : (
          <>
            <p className="sheet-fine">
              The higher score wins a slice of the other stake; if an enemy reaches your cannon, you lose the whole stake.
              {balance != null && ` Your game wallet: ${sol(balance)} SOL (devnet play money).`}
            </p>
            <button className="big primary sheet-go" onClick={() => close(onSign)}>
              Sign &amp; play
            </button>
          </>
        )}
        <button className="sheet-cancel" onClick={() => close(onClose)}>
          Not now
        </button>
      </div>
    </div>
  );
}
