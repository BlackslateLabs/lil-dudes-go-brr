import { useEffect, useState } from 'react';
import { onWalletsChange, type GameWallet } from '@lil-dudes/client';
import { accountWallets, connect, moveGuest, skipGuest, useAccount, type ConnectStep } from '../live/account';
import { sol } from './format';
import './flow.css';
import './account.css';

const STEP: Record<ConnectStep, string> = {
  connect: 'Approve the connection in your wallet',
  derive: 'Sign to make your game key (no fee, not a transaction)',
  link: 'One more signature links it to your account (first time only)',
  move: 'Moving it over…',
};

/**
 * Connect a wallet (needed for staked play): pick a Solana wallet, approve, sign once (twice the
 * first time). Then, if this browser played as a guest, offer to move that SOL and those matches
 * in. No wallet installed → where to get one, and on a phone how to open the game inside it.
 */
export function AccountSheet({ onDone, onClose }: { onDone?: () => void; onClose: () => void }) {
  const { step, error, offer, wallet } = useAccount();
  const [wallets, setWallets] = useState<GameWallet[]>(accountWallets);
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onWalletsChange(setWallets), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !step) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  // Signed in and nothing to move: done.
  useEffect(() => {
    if (wallet && !offer && !step) onDone?.();
  }, [wallet, offer, step, onDone]);

  const here = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);

  return (
    <div className="sheet-wrap" onClick={() => !step && onClose()}>
      <div className="sheet acct-sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        {wallet && offer ? (
          <>
            <h3>Bring your progress</h3>
            <p className="sheet-line">
              This browser played as a guest
              {offer.lamports > 0 && <> and holds <b>{sol(offer.lamports)} SOL</b></>}
              {offer.matches > 0 && <> with {offer.matches} {offer.matches === 1 ? 'match' : 'matches'}</>}. Move it into your account?
            </p>
            {step === 'move' ? (
              <p className="acct-step">{STEP.move}</p>
            ) : (
              <button
                className="big primary sheet-go"
                onClick={async () => {
                  setNote(await moveGuest());
                }}
              >
                Move it over
              </button>
            )}
            {error && <p className="acct-err">{error}</p>}
            {note && <p className="ls-hint">{note}</p>}
            <button className="sheet-cancel" disabled={step === 'move'} onClick={skipGuest}>
              Not now
            </button>
          </>
        ) : (
          <>
            <h3>Connect a wallet</h3>
            <p className="sheet-line">Your account for playing for SOL. Connect the same wallet on any device to get your game wallet and matches back.</p>
            {step ? (
              <p className="acct-step">{STEP[step]}</p>
            ) : wallets.length ? (
              <ul className="acct-list">
                {wallets.map((w) => (
                  <li key={w.name}>
                    <button className="acct-wallet" onClick={() => void connect(w)}>
                      <img src={w.icon} alt="" width={32} height={32} />
                      <span>{w.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="acct-none">
                <p>No Solana wallet in this browser.</p>
                <div className="acct-links">
                  <a className="chip" href={`https://phantom.app/ul/browse/${here}?ref=${ref}`}>
                    Open in Phantom
                  </a>
                  <a className="chip" href={`https://solflare.com/ul/v1/browse/${here}?ref=${ref}`}>
                    Open in Solflare
                  </a>
                </div>
                <small>On a computer, install Phantom or Solflare, then come back.</small>
              </div>
            )}
            {error && <p className="acct-err">{error}</p>}
            <button className="sheet-cancel" disabled={!!step} onClick={onClose}>
              Not now
            </button>
          </>
        )}
      </div>
    </div>
  );
}
