import { useEffect, useRef } from 'react';
import { playMusic, setBattleDuck } from './feel/sound';
import { useApp, type Screen } from './store';
import { Home } from './screens/Home';
import { Match } from './screens/Match';
import { Result } from './screens/Result';
import { VsScreen } from './screens/Vs';
import { Wipe } from './screens/Wipe';

type Track = Parameters<typeof playMusic>[0];

/** Music per screen: menu on Home/VS, battle in the match, win/lose on the result (overrun = lose). */
function trackFor(screen: Screen): Track {
  if (screen === 'match') return 'match';
  if (screen === 'result') {
    const m = useApp.getState().lastMatch;
    if (!m) return 'menu';
    if (m.result.died === m.mySide) return 'lose';
    if (m.result.winner === null) return 'menu';
    return m.result.winner === m.mySide ? 'win' : 'lose';
  }
  return 'menu';
}

export function App() {
  const screen = useApp((s) => s.screen);
  const prev = useRef<Screen | null>(null);
  const track = useRef<Track | undefined>(undefined);

  useEffect(() => {
    if (prev.current === 'match' && screen !== 'match') setBattleDuck(false);
    prev.current = screen;
    const t = trackFor(screen);
    if (t !== track.current) {
      track.current = t;
      playMusic(t);
    }
  }, [screen]);

  return (
    <div className="frame">
      {screen === 'home' && <Home />}
      {screen === 'vs' && <VsScreen />}
      {screen === 'match' && <Match />}
      {screen === 'result' && <Result />}
      <Wipe />
    </div>
  );
}
