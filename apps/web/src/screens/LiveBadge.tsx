import { useEffect, useState } from 'react';
import { useLive } from '../live/session';
import './live.css';

/** No new rollup snapshot for this long mid-match = show "Reconnecting…" (the feed reopens itself). */
const STALL_MS = 2_500;

/**
 * Live matches only: a small "LIVE · devnet" tag under the top bar, which turns into
 * "Reconnecting…" when the rollup feed stalls (tab was asleep, network dropped). LiveSource
 * reopens its websocket and catches up on its own; this only tells the player.
 */
export function LiveBadge() {
  const source = useLive((s) => (s.phase === 'playing' || s.phase === 'ended' ? s.source : null));
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!source) return;
    let last = Date.now();
    const off = source.subscribe(() => {
      last = Date.now();
    });
    const t = setInterval(() => {
      const ended = source.view.status === 'ended';
      setStalled(!ended && !document.hidden && Date.now() - last > STALL_MS);
    }, 500);
    const onVis = () => {
      last = Date.now();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off();
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [source]);
  if (!source) return null;
  return <div className={`live-badge ${stalled ? 'stalled' : ''}`}>{stalled ? 'Reconnecting…' : 'LIVE · devnet'}</div>;
}
