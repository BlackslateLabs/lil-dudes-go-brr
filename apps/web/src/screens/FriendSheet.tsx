import { useEffect, useRef, useState } from 'react';
import { sol } from './format';
import './flow.css';
import './live.css';

const CLOSE_MS = 150;

export interface FriendSheetProps {
  /** The creator's stake, lamports (0 = free). */
  stake: number;
  /** Why Create is blocked (stake invalid / not live / short), or null. */
  blocked: string | null;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onClose: () => void;
}

const CODE_RE = /^[A-HJKMNP-Z2-9]{6}$/;

/**
 * Play a Friend: create a room at the picked stake (you set it; your friend sees it and confirms),
 * or join one with a 6-character code. Same bottom sheet as the stake confirm.
 */
export function FriendSheet({ stake, blocked, onCreate, onJoin, onClose }: FriendSheetProps) {
  const [closing, setClosing] = useState(false);
  const [code, setCode] = useState('');
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
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const valid = CODE_RE.test(clean);

  return (
    <div className={`sheet-wrap ${closing ? 'closing' : ''}`} onClick={() => close(onClose)}>
      <div className="sheet friend-sheet" role="dialog" aria-modal="true" aria-label="Play a friend" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>Play a Friend</h3>

        <section className="fs-block">
          <b className="fs-title">Create a room</b>
          <p className="sheet-fine">You set the stake. Your friend sees it before they join.</p>
          <button className="big primary sheet-go" disabled={!!blocked} onClick={() => close(onCreate)}>
            Create room <small>{stake ? `${sol(stake)} SOL` : 'free'}</small>
          </button>
          {blocked && <p className="ls-hint warn">{blocked}</p>}
        </section>

        <div className="fs-or" aria-hidden>
          <span>or</span>
        </div>

        <section className="fs-block">
          <b className="fs-title">Join with a code</b>
          <form
            className="fs-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (valid) close(() => onJoin(clean));
            }}
          >
            <input
              className="code-input"
              value={clean}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ABC234"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={6}
            />
            <button className="big" type="submit" disabled={!valid}>
              Join
            </button>
          </form>
        </section>

        <button className="sheet-cancel" onClick={() => close(onClose)}>
          Not now
        </button>
      </div>
    </div>
  );
}
