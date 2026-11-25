import { useHud, type RaceTrack } from '../hud';
import './hud.css';

/**
 * The race bar, bottom left beside the Champion meter: two thin tracks, you (blue) and your opponent (red), each with
 * the same icons (the towers of Fight 1, of Fight 2, then the town hall), because both play the
 * exact same map on their own lane. Icons tick as that side breaks towers; the fill also counts
 * damage on the live ones. A short toast under it says who cleared a fight first.
 */
export function RaceBar() {
  const race = useHud((s) => s.race);
  const names = useHud((s) => s.names);
  const gold = useHud((s) => s.gold);
  const toast = useHud((s) => s.toast);
  const ended = useHud((s) => s.ended);
  return (
    <div className="hud race" aria-label="Race to the towers">
      <Track t={race[0]} name={names[0]} gold={gold[0]} side="me" />
      <Track t={race[1]} name={names[1]} gold={gold[1]} side="them" />
      {toast && !ended && (
        <div key={toast.at} className={`race-toast ${toast.tone}`} role="status">
          {toast.text}
        </div>
      )}
    </div>
  );
}

function Track({ t, name, gold, side }: { t: RaceTrack; name: string; gold: number; side: 'me' | 'them' }) {
  const slots: { kind: 'tower' | 'hall'; state: 'up' | 'down' | 'on'; first: boolean }[] = [];
  t.towers.forEach((n, s) => {
    for (let i = 0; i < n; i++) slots.push({ kind: 'tower', state: i < (t.down[s] ?? 0) ? 'down' : 'up', first: i === 0 && s > 0 });
  });
  slots.push({ kind: 'hall', state: t.hall === 2 ? 'down' : t.hall === 1 ? 'on' : 'up', first: true });
  const broken = t.down.reduce((a, b) => a + b, 0);
  const total = t.towers.reduce((a, b) => a + b, 0);
  return (
    <div className={`race-row ${side} ${t.dead ? 'dead' : ''}`}>
      <b className="race-name">{name}</b>
      <span className="race-track" aria-label={`${name}: ${broken} of ${total} towers`}>
        <i className="race-fill" style={{ width: `${Math.round(t.fill * 100)}%` }} />
        {slots.map((s, i) => (
          <span key={i} className={`race-slot ${s.kind} ${s.state} ${s.first ? 'gap' : ''}`}>
            {s.state === 'down' ? <Tick /> : s.kind === 'hall' ? <Hall /> : <Tower />}
          </span>
        ))}
      </span>
      <span className="race-gold">{gold}</span>
    </div>
  );
}

const Tower = () => (
  <svg viewBox="0 0 12 12" aria-hidden>
    <path d="M2.5 11V3.5h1.6v1.4h1.1V3.5h1.6v1.4h1.1V3.5h1.6V11z" />
  </svg>
);

const Hall = () => (
  <svg viewBox="0 0 12 12" aria-hidden>
    <path d="M1.2 6.4 6 1.8l4.8 4.6V11H7.2V8.4H4.8V11H1.2z" />
  </svg>
);

const Tick = () => (
  <svg viewBox="0 0 12 12" aria-hidden>
    <path d="M2.6 6.3 5 8.6l4.4-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
