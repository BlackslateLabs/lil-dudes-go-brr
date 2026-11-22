import { useApp } from './store';
import { Home } from './screens/Home';
import { Match } from './screens/Match';
import { Result } from './screens/Result';

export function App() {
  const screen = useApp((s) => s.screen);
  return (
    <div className="frame">
      {screen === 'home' && <Home />}
      {screen === 'match' && <Match />}
      {screen === 'result' && <Result />}
    </div>
  );
}
