import { enterMatch, useLive } from '../live/session';
import { ErrorCard } from './Lobby';
import { Vs } from './Vs';
import './live.css';

/**
 * The VS screen of a live match: only feeds `Vs` (its look belongs to Vs.tsx) with the real chain
 * steps as they happen (stakes → private rollup → VRF → arena), the opponent (a Bot is labelled
 * Bot) and the level once the seed picked it. A failure shows over it with its way out.
 */
export function LiveVs() {
  const chain = useLive((s) => s.chain);
  const opp = useLive((s) => s.opp);
  const stake = useLive((s) => s.stake);
  const layout = useLive((s) => s.layout);
  const error = useLive((s) => s.error);
  const phase = useLive((s) => s.phase);
  const done = chain.filter((s) => s.state === 'ok').length;
  const now = chain.find((s) => s.state === 'now' || s.state === 'fail');
  return (
    <>
      <Vs
        me={{ name: 'You', stake: stake || undefined }}
        them={{ name: opp?.name ?? 'Opponent', isBot: opp?.bot, stake: stake || undefined }}
        steps={chain.map((s) => s.label)}
        step={done}
        layout={layout ?? undefined}
        onDone={enterMatch}
      />
      {now?.note && phase === 'starting' && <p className="vs-live-note">{now.note}</p>}
      {phase === 'error' && error && (
        <div className="live-veil">
          <ErrorCard error={error} steps={chain} />
        </div>
      )}
    </>
  );
}
