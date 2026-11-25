import { useEffect, useState } from 'react';
import { OfflineSource } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { sfx, unlockSound } from '../feel/sound';
import { hasBurner } from '../live/device';
import { checkResume, hostRoom, lookupRoom, quickMatch, recoverStale, refreshBalance, resume, topUpFor, useLive } from '../live/session';
import { useFeed } from '../match/useFeed';
import { setTutorialDone, tutorialDone, useApp } from '../store';
import { FriendSheet } from './FriendSheet';
import { StakePicker, checkStake } from './StakePicker';
import { StakeSheet } from './StakeSheet';
import { sol } from './format';
import './flow.css';
import './live.css';

const NOTE_MS = 2600;

/**
 * Home (SPEC v5 §8, MVP §3.3). Free → PLAY VS BOT (instant, offline, no wallet); a stake → QUICK
 * MATCH at exactly that amount, with Play a Friend (room code) beside it. Live play also works
 * free from the small buttons (the server's Bot takes a free Quick Match after ~5 s). Staked play
 * unlocks after the first bot match (or skip). A silent bot-vs-bot match loops behind it.
 */
export function Home() {
  const { free, stake, go, setTutorialAgain } = useApp();
  const balance = useLive((s) => s.balance);
  const [bgKey, setBgKey] = useState(0);
  const [unlocked, setUnlocked] = useState(tutorialDone);
  const [sheet, setSheet] = useState<'quick' | 'friend' | null>(null);
  const [note, setNote] = useState<{ text: string; at: number } | null>(null);
  const [topping, setTopping] = useState(false);
  const back = useLive((s) => s.resume);
  const live = free ? 0 : stake;
  const check = free ? { ok: true, hint: '', short: false, notLive: false } : checkStake(stake, balance);
  const say = (text: string) => setNote({ text, at: performance.now() });

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);

  // A reloaded tab (or one left mid-match): offer to go back (this device's match, else /me).
  useEffect(() => {
    void checkResume();
  }, []);

  // The burner is made on first live use; once it exists, show its balance and refund anything a
  // crashed tab left behind (MVP §4).
  useEffect(() => {
    if (!unlocked) return;
    const had = hasBurner();
    void refreshBalance();
    if (had) void recoverStale().then((t) => t && say(t));
  }, [unlocked]);

  const playBot = (tutorial: boolean) => {
    unlockSound();
    setTutorialAgain(tutorial);
    go('vs');
  };

  const doTopUp = async (amount = live) => {
    setTopping(true);
    const r = await topUpFor(amount);
    setTopping(false);
    say(r.text);
  };

  // The stake can't be played as is: why, for the Create button and the sheet.
  const blocked = check.ok ? null : check.hint;

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
          {back && (
            <button className="rejoin-card" onClick={() => void resume()}>
              <span>{back.label}</span>
              <b className="rejoin-go">{back.kind === 'match' ? 'Rejoin' : 'Resume'}</b>
            </button>
          )}

          <StakePicker locked={!unlocked} balance={balance} onTopUp={() => void doTopUp()} toppingUp={topping} />
          {!unlocked && (
            <p className="unlock-line on-sky">
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

          {free || !unlocked ? (
            <button
              className="big primary play"
              onClick={() => {
                sfx.playButton();
                playBot(false);
              }}
            >
              PLAY VS BOT <small>free</small>
            </button>
          ) : check.short && !check.notLive ? (
            <button className="big primary play" disabled={topping} onClick={() => void doTopUp()}>
              TOP UP <small>{sol(stake)} SOL</small>
            </button>
          ) : (
            <button
              className="big primary play"
              disabled={!check.ok}
              onClick={() => {
                unlockSound();
                sfx.playButton();
                setSheet('quick');
              }}
            >
              QUICK MATCH <small>{sol(stake)} SOL</small>
            </button>
          )}

          {unlocked && (
            <div className="actions row2 home-pvp">
              {free ? (
                <button
                  className="big secondary"
                  onClick={() => {
                    unlockSound();
                    void quickMatch(0);
                  }}
                >
                  Quick Match <small>online</small>
                </button>
              ) : (
                <button className="big secondary" onClick={() => playBot(false)}>
                  vs Bot <small>free</small>
                </button>
              )}
              <button className="big secondary" onClick={() => setSheet('friend')}>
                Play a Friend
              </button>
            </div>
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

      {sheet === 'quick' && (
        <StakeSheet
          title="Quick Match"
          stake={stake}
          balance={balance}
          onClose={() => setSheet(null)}
          onSign={() => {
            setSheet(null);
            void quickMatch(stake);
          }}
        />
      )}

      {sheet === 'friend' && (
        <FriendSheet
          stake={live}
          blocked={blocked}
          onClose={() => setSheet(null)}
          onCreate={() => {
            setSheet(null);
            unlockSound();
            void hostRoom(live);
          }}
          onJoin={(code) => {
            setSheet(null);
            unlockSound();
            void lookupRoom(code);
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
