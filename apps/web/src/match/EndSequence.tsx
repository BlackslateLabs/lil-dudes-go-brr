import { useHud } from '../hud';
import { isBreach } from './useMatchHud';
import './hud.css';

/**
 * Display numerals: the orange→yellow gradient with a thick dark outline. Two stacked copies (the
 * outline underneath), because a gradient fill clipped to text can't carry its own outside stroke.
 */
export function GradText({ text, className = '' }: { text: string | number; className?: string }) {
  return (
    <span className={`grad ${className}`}>
      <span className="grad-o" aria-hidden>
        {text}
      </span>
      <span className="grad-f">{text}</span>
    </span>
  );
}

/**
 * The end of my match (SPEC v5 §8), drawn from the HUD store (useMatchHud keeps it on the clock):
 * - breach: a BREACH! stamp (1 s), then a big 3-2-1 on the Rush clock while a counter of dudes
 *   entering the hall climbs next to it, then TIME!;
 * - overrun: a red edge flash and an OVERRUN! stamp;
 * - the opponent falls first: a THEY FELL! stamp.
 * The WIN / LOSE banner belongs to the result screen.
 */
export function EndSequence() {
  const breachAt = useHud((s) => s.breachAt);
  const countdown = useHud((s) => s.countdown);
  const timeAt = useHud((s) => s.timeAt);
  const hall = useHud((s) => s.hallCount);
  const overrunAt = useHud((s) => s.overrunAt);
  const ended = useHud((s) => s.ended);
  const phase = useHud((s) => s.phase[0]);
  const danger = useHud((s) => s.danger);

  const rushing = breachAt !== null && overrunAt === null && ended?.died !== 'them';
  const showCount = rushing && (isBreach(phase) || timeAt !== null);
  const theyFell = ended?.died === 'them';

  return (
    <>
      {danger && overrunAt === null && <div className="danger-edge" />}
      {overrunAt !== null && <div key={`o${overrunAt}`} className="overrun-flash" />}

      {breachAt !== null && overrunAt === null && (
        <div key={`b${breachAt}`} className="stamp breach-stamp">
          <GradText text="BREACH!" />
        </div>
      )}

      {showCount && (
        <div className={`rush-row ${timeAt !== null ? 'over' : ''}`}>
          {timeAt === null ? (
            countdown > 0 && (
              <GradText key={countdown} text={countdown} className="count-num" />
            )
          ) : (
            <GradText key="time" text="TIME!" className="count-num time" />
          )}
          <span className="hall-count" title="Dudes in the town hall">
            <i aria-hidden>🏰</i>
            <b key={hall} className={hall > 0 ? 'bump' : ''}>
              {hall}
            </b>
          </span>
        </div>
      )}

      {/* The 3:00 cap ends the match before my breach: TIME! on its own. */}
      {timeAt !== null && breachAt === null && overrunAt === null && !theyFell && (
        <div key={`t${timeAt}`} className="stamp time-stamp">
          <GradText text="TIME!" />
        </div>
      )}
      {overrunAt !== null && (
        <div key={`ov${overrunAt}`} className="stamp overrun-stamp">
          OVERRUN!
        </div>
      )}
      {theyFell && overrunAt === null && (
        <div key={`f${ended.at}`} className="stamp fell-stamp">
          THEY FELL!
        </div>
      )}
    </>
  );
}
