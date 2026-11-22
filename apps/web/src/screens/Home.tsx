import { useEffect, useState } from 'react';
import { OfflineSource } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { unlockSound } from '../feel/sound';
import { useFeed } from '../match/useFeed';
import { STAKE_TIERS, useApp } from '../store';

/** Home (MVP §3.3): one big Play vs Bot, then PvP options. A silent mock match loops behind it. */
export function Home() {
  const { stake, setStake, go } = useApp();
  const [bgKey, setBgKey] = useState(0);
  return (
    <div className="screen home">
      <div className="home-bg" aria-hidden>
        <Background key={bgKey} onEnd={() => setBgKey((k) => k + 1)} />
      </div>
      <div className="home-ui">
        <h1 className="logo">
          Lil Dudes
          <br />
          <span>Go Brr</span>
        </h1>

        <button
          className="big primary play"
          onClick={() => {
            unlockSound();
            go('match');
          }}
        >
          PLAY VS BOT <small>free</small>
        </button>

        {/* PvP only: the bot never plays for stakes (SPEC §9). */}
        <div className="pvp">
          <div className="stakes" role="radiogroup" aria-label="PvP stake (devnet SOL)">
            {STAKE_TIERS.map((t) => (
              <button
                key={t.id}
                role="radio"
                aria-checked={stake === t.id}
                className={stake === t.id ? 'chip on' : 'chip'}
                onClick={() => setStake(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="actions row2">
            <button className="big" disabled title="Needs the back end (M3)">
              Quick Match
            </button>
            <button className="big" disabled title="Needs the back end (M3)">
              Room Code
            </button>
          </div>
        </div>

        <footer className="home-foot">
          <button disabled title="Tutorial comes in M6">
            How to play
          </button>
          <span>Devnet play money</span>
        </footer>
      </div>
    </div>
  );
}

/** A bot-vs-bot offline match on loop behind the menu. Silent, not interactive. */
function Background({ onEnd }: { onEnd: () => void }) {
  const feed = useFeed(() => new OfflineSource({ myName: 'You', selfBot: true }));
  useEffect(() => {
    const off = feed.onEvent((e) => {
      if (e.type === 'end') setTimeout(onEnd, 1500);
    });
    return off;
  }, [feed, onEnd]);
  return <Arena feed={feed} />;
}
