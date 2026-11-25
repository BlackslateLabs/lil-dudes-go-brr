import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { opLabel, type LiveSource, type PeekAttempt } from '@lil-dudes/client';
import { runPeek, usePeekLog } from '../live/peekLog';
import './peek.css';

const WORD: Record<PeekAttempt['outcome'], string> = {
  denied: 'DENIED',
  hidden: 'NOTHING',
  zeroed: 'ZEROED',
  readable: 'READ',
  failed: 'NO ANSWER',
};

/** One attempt as a console line: method(target) → OUTCOME: detail. */
function Line({ a, after }: { a: PeekAttempt; after: boolean }) {
  // During play a read is a leak; after the end the same read is expected (it's public then).
  const tone = a.outcome === 'readable' ? (after ? 'ok' : 'bad') : a.outcome === 'failed' ? 'warn' : after ? 'muted' : 'ok';
  return (
    <li className={`pk-line ${tone}`}>
      <code>
        {a.method}({a.target})
      </code>
      <small>{a.via}</small>
      <span>
        → <b>{WORD[a.outcome]}</b> {a.detail}
      </span>
    </li>
  );
}

/**
 * "Try to cheat": this browser really tries to read the sealed accounts (the true gate values and
 * seed, the opponent's Scout) over every read path, with the player's own rollup login, and shows
 * what came back. During play: nothing. After the end: the same accounts are public.
 */
export function PeekConsole({ src, autoRun = false }: { src: LiveSource; autoRun?: boolean }) {
  const log = usePeekLog();
  const mine = log.matchId === src.matchId.toString();
  const during = mine ? log.during : [];
  const afterLines = mine ? log.after : [];
  const reveal = src.reveal();
  const ran = useRef(false);
  useEffect(() => {
    if (autoRun && !ran.current) {
      ran.current = true;
      void runPeek(src);
    }
  }, [autoRun, src]);
  const leaks = during.filter((a) => a.outcome === 'readable').length;
  const runningNow = log.running !== null && mine;

  return (
    <div className="pk">
      {during.length > 0 && (
        <section>
          <p className="pk-head">During the match{leaks === 0 ? ': nothing came back' : `: ${leaks} read${leaks > 1 ? 's' : ''} came back`}</p>
          <ol className="pk-lines">
            {during.map((a, i) => (
              <Line key={`d${i}`} a={a} after={false} />
            ))}
          </ol>
        </section>
      )}
      {reveal && afterLines.length > 0 && (
        <section>
          <p className="pk-head">After the end: public</p>
          <ol className="pk-lines">
            {afterLines.map((a, i) => (
              <Line key={`a${i}`} a={a} after />
            ))}
          </ol>
        </section>
      )}
      {reveal && reveal.seed !== 0n && (
        <p className="pk-public">
          Now public: seed <code>{reveal.seed.toString(16).padStart(16, '0')}</code>
          {reveal.values.map((stage, s) => (
            <span key={s}>
              {' '}
              · Fight {s + 1}: {stage.map((op) => opLabel(op)).join(' ')}
            </span>
          ))}
        </p>
      )}
      {!reveal && during.length === 0 && !runningNow && <p className="pk-fine">Your browser will ask the rollup for the sealed accounts, with your own login. Real requests.</p>}
      <button className="big pk-run" disabled={runningNow} onClick={() => void runPeek(src)}>
        {runningNow ? 'Trying…' : reveal ? (afterLines.length ? 'Read them again' : 'Read them now') : during.length ? 'Try again' : 'Try to peek'}
      </button>
    </div>
  );
}

/** The console as its own sheet (from the match menu): the match keeps running underneath. */
export function PeekSheet({ src, onClose }: { src: LiveSource; onClose: () => void }) {
  const [closing, setClosing] = useState(false);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 150);
  };
  return createPortal(
    <div className={`sheet-wrap sheet-fixed ${closing ? 'closing' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={close}>
      <div className="sheet pk-sheet" role="dialog" aria-modal="true" aria-label="Try to peek at their gates" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>Try to peek</h3>
        <PeekConsole src={src} autoRun />
        <p className="sheet-fine">
          The gate values and their Scout sit in private accounts inside MagicBlock’s Private Ephemeral Rollup (an Intel TDX enclave)
          until the match ends. That hardware is the trust assumption. The match keeps going.
        </p>
        <button className="sheet-cancel" onClick={close}>
          Back to the match
        </button>
      </div>
    </div>,
    document.body,
  );
}
