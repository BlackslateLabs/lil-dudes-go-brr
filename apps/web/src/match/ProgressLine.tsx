import type { LanePhase } from '@lil-dudes/client';
import { useHud } from '../hud';
import { isBreach } from './useMatchHud';
import './hud.css';

/** Their stage in one or two words: Fight 1, Fight 2, Breach, Done, Overrun. */
function stageLabel(stage: number, phase: LanePhase | string): string {
  if (phase === 'dead') return 'Overrun';
  if (phase === 'done') return 'Done';
  if (isBreach(phase)) return 'Breach';
  return `Fight ${stage + 1}`;
}

/**
 * The opponent, as one thin line under the top bar (SPEC v5 §1, §8): name, stage, their current
 * stage's tower HP and their score. No view of their lane (v5 has no mini-view).
 */
export function ProgressLine() {
  const name = useHud((s) => s.names[1]);
  const stage = useHud((s) => s.stage[1]);
  const phase = useHud((s) => s.phase[1]);
  const gold = useHud((s) => s.gold[1]);
  const towers = useHud((s) => s.theirTowers);
  const label = stageLabel(stage, phase);
  const pct = Math.round(Math.max(0, Math.min(1, towers)) * 100);
  // Transit already names the next stage, so its towers are the ones they walk to.
  const fighting = phase === 'plant' || phase === 'fight' || phase === 'transit';
  const note = fighting ? `${pct}%` : isBreach(phase) ? 'town hall' : '';
  return (
    <div className={`hud progress-line ${phase === 'dead' ? 'dead' : ''} ${phase === 'done' || isBreach(phase) ? 'ahead' : ''}`}>
      <b className="pl-name">{name}</b>
      <span className="pl-stage">{label}</span>
      <span className="pl-bar" aria-label={`their towers ${pct}%`}>
        <i style={{ width: `${fighting ? pct : 0}%` }} />
        <em>{note}</em>
      </span>
      <span className="pl-gold">{gold}</span>
    </div>
  );
}
