import { useEffect, useState } from 'react';
import { OfflineSource } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { sfx, unlockSound } from '../feel/sound';
import { useFeed } from '../match/useFeed';
import { STAKE_TIERS, setTutorialDone, tierLamports, tutorialDone, useApp } from '../store';
import { StakeSheet } from './StakeSheet';
import './flow.css';

const NOTE_MS = 2600;

/**
 * Home (SPEC v5 §8): one big primary button. Free → PLAY VS BOT; a paid stake → QUICK MATCH (and
 * Room Code as the secondary). Staked PvP unlocks after the first bot match. A silent bot-vs-bot
 * match loops behind it.
 */
export function Home() {
  const { stake, setStake, go, setTutorialAgain } = useApp();
  const [bgKey, setBgKey] = useState(0);
  const [unlocked, setUnlocked] = useState(tutorialDone);
  const [sheet, setSheet] = useState<'Quick Match' | 'Room Code' | null>(null);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const paid = unlocked && stake !== 'free';

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  const playBot = (tutorial: boolean) => {
    unlockSound();
    setTutorialAgain(tutorial);
    go('vs');
  };

  return (
    <div className="screen home">
      <div className="home-bg" aria-hidden>
        <Background key={bgKey} onEnd={() => setBgKey((k) => k + 1)} />
      </div>
      <div className="home-ui flow-home">
        <h1 className="logo">
          <img src="/brand/logo.webp" alt="Lil Dudes Go Brr" width={1100} height={794} draggable={false} />
        </h1>

        <div className="home-bottom">
          <div className="stake-card">
            <span className="stake-head">Stake · devnet SOL</span>
            <div className="stakes" role="radiogroup" aria-label="Stake (devnet SOL)">
              {STAKE_TIERS.map((t) => {
                const locked = !unlocked && t.id !== 'free';
                return (
                  <button
                    key={t.id}
                    role="radio"
                    aria-checked={stake === t.id}
                    className={`chip ${stake === t.id ? 'on' : ''} ${locked ? 'locked' : ''}`}
                    disabled={locked}
                    onClick={() => setStake(t.id)}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            {!unlocked && (
              <p className="unlock-line">
                Staked PvP unlocks after your first bot match ·{' '}
                <button
                  className="link"
                  onClick={() => {
                    setTutorialDone();
                    setUnlocked(true);
                  }}
                >
                  skip
                </button>
              </p>
            )}
          </div>

          {paid ? (
            <button
              className="big primary play"
              onClick={() => {
                unlockSound();
                sfx.playButton();
                setSheet('Quick Match');
              }}
            >
              QUICK MATCH <small>{stake} SOL</small>
            </button>
          ) : (
            <button
              className="big primary play"
              onClick={() => {
                sfx.playButton();
                playBot(false);
              }}
            >
              PLAY VS BOT <small>free</small>
            </button>
          )}

          {paid && (
            <button className="big secondary" onClick={() => setSheet('Room Code')}>
              Room Code
            </button>
          )}

          <footer className="home-foot">
            <button onClick={() => playBot(true)}>How to play</button>
            <span>Devnet play money</span>
          </footer>
        </div>
      </div>

      {note && (
        <div key={note.at} className="toast" role="status">
          {note.text}
        </div>
      )}

      {sheet && (
        <StakeSheet
          title={sheet}
          stake={tierLamports(stake)}
          onClose={() => setSheet(null)}
          onSign={() => {
            setSheet(null);
            setNote({ text: 'Live matches open soon', at: performance.now() });
          }}
        />
      )}
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
