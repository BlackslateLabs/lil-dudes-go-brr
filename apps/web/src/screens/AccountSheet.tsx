import { useEffect, useState } from 'react';
import { onWalletsChange, type GameWallet } from '@lil-dudes/client';
import { accountWallets, connect, connectBlocked, useAccount, type ConnectStep } from '../live/account';
import './flow.css';
import './account.css';

const STEP: Record<ConnectStep, string> = {
  connect: 'Approve the connection in your wallet',
  derive: 'Sign to make your game key (no fee, not a transaction)',
  link: 'One more signature links it to your account (first time only)',
  move: "Moving this browser's SOL and matches into your account…",
};

/**
 * Connect a wallet (needed for staked play): pick a Solana wallet, approve, sign once (twice the
 * first time). Whatever this browser held as a guest moves into the account on its own before the
 * sheet closes. Blocked while a guest queue ticket, room or match is still running (it belongs to
 * the guest key). No wallet installed → where to get one, and on a phone how to open the game in it.
 */
export function AccountSheet({ onDone, onClose }: { onDone?: () => void; onClose: () => void }) {
  const { step, error, wallet } = useAccount();
  const [wallets, setWallets] = useState<GameWallet[]>(accountWallets);
  const blocked = wallet ? null : connectBlocked();
  useEffect(() => onWalletsChange(setWallets), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !step) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [step, onClose]);

  // Signed in and everything moved over: done.
  useEffect(() => {
    if (wallet && !step) onDone?.();
  }, [wallet, step, onDone]);

  const here = encodeURIComponent(window.location.href);
  const ref = encodeURIComponent(window.location.origin);

  return (
    <div className="sheet-wrap" onClick={() => !step && onClose()}>
      <div className="sheet acct-sheet" role="dialog" aria-modal="true" aria-label="Connect a wallet" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>Connect a wallet</h3>
        <p className="sheet-line">Your account for playing for SOL. Connect the same wallet on any device to get your game wallet and matches back.</p>
        {step ? (
          <p className="acct-step">{STEP[step]}</p>
        ) : blocked ? (
          <p className="acct-err">{blocked}</p>
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
        {error && !blocked && <p className="acct-err">{error}</p>}
        <button className="sheet-cancel" disabled={!!step} onClick={onClose}>
          Not now
        </button>
      </div>
    </div>
  );
}
