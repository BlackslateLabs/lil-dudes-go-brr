import { useEffect, useState } from 'react';
import { OfflineSource } from '@lil-dudes/client';
import { Arena } from '../arena/Arena';
import { modelsReady } from '../arena/models/assets';
import { sfx, unlockSound } from '../feel/sound';
import { signedIn, sweepGuest, useAccount } from '../live/account';
import { hasBurner } from '../live/device';
import {
  checkResume,
  faucetCovers,
  hostRoom,
  loadFaucetPolicy,
  lookupRoom,
  needFor,
  quickMatch,
  recoverStale,
  refreshBalance,
  resume,
  short,
  topUpFor,
  useCountdown,
  useFaucet,
  useLive,
  useWhosAround,
} from '../live/session';
import { useFeed } from '../match/useFeed';
import { setTutorialDone, tutorialDone, useApp } from '../store';
import { AccountSheet } from './AccountSheet';
import { FriendSheet } from './FriendSheet';
import { StakePicker, checkStake } from './StakePicker';
import { StakeSheet } from './StakeSheet';
import { sol } from './format';
import './flow.css';
import './live.css';
import './profile.css';

const NOTE_MS = 2600;
/** Refused top-ups and other errors stay up longer (they say when to try again). */
const NOTE_LONG_MS = 4500;
/** The live background has faded in once this session (no fade on later visits to Home). */
let bgShown = false;

/**
 * Home (SPEC v5 §8, MVP §3.3). Free → PLAY VS BOT (instant, offline, no wallet); a stake → FIND
 * MATCH at exactly that amount (always the big button; a short balance is handled in its sheet),
 * with Play a Friend (room code) beside it. Live play also works
 * free from the small buttons (the server's Bot takes a free Quick Match after ~5 s). Staked play
 * unlocks after the first bot match (or skip). A silent bot-vs-bot match loops behind it.
 */
export function Home() {
  const { free, stake, go, setTutorialAgain } = useApp();
  const balance = useLive((s) => s.balance);
  const [bgKey, setBgKey] = useState(0);
  const [unlocked, setUnlocked] = useState(tutorialDone);
  const [sheet, setSheet] = useState<'quick' | 'friend' | 'account' | null>(null);
  /** What to do once the wallet is connected (staked play needs an account). */
  const [then, setThen] = useState<(() => void) | null>(null);
  const account = useAccount((a) => a.wallet);
  const accountName = useAccount((a) => a.name);
  /** Staked play needs a connected wallet: connect first, then carry on. */
  const needAccount = (next: () => void) => {
    if (signedIn()) return next();
    setThen(() => next);
    setSheet('account');
  };
  const [note, setNote] = useState<{ text: string; at: number; ms: number } | null>(null);
  const [topping, setTopping] = useState(false);
  const back = useLive((s) => s.resume);
  const live = free ? 0 : stake;
  const check = free ? { ok: true, hint: '', short: false, notLive: false } : checkStake(stake, balance);
  const say = (text: string, ms = NOTE_MS) => setNote({ text, at: performance.now(), ms });
  const around = useWhosAround(stake, sheet === 'quick');
  const cooldown = useCountdown(useFaucet((f) => f.until));
  const [bgReady, setBgReady] = useState(bgShown);

  // Fade the live background in a few frames after every model is in (shaders compile on the
  // first frames). Once shown, later loops and visits skip the fade.
  useEffect(() => {
    if (bgReady) return;
    let on = true;
    void modelsReady()
      .catch(() => undefined)
      .then(() => {
        let n = 4;
        const tick = () => {
          if (!on) return;
          if (--n > 0) requestAnimationFrame(tick);
          else {
            bgShown = true;
            setBgReady(true);
          }
        };
        requestAnimationFrame(tick);
      });
    return () => {
      on = false;
    };
  }, [bgReady]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), note.ms);
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
    loadFaucetPolicy();
    const had = hasBurner();
    void refreshBalance();
    // Signed in: refunds of guest-era matches land on the guest key; sweep them (and anything else
    // it holds) into the account after the recovery.
    if (had)
      void recoverStale()
        .then((t) => t && say(t))
        .finally(() => {
          if (signedIn()) void sweepGuest();
        });
  }, [unlocked]);

  // "Moved 0.17 SOL from this browser into your account" (and other account notices).
  const notice = useAccount((a) => a.notice);
  useEffect(() => {
    if (notice && Date.now() - notice.at < 8000) say(notice.text, NOTE_LONG_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice]);

  const playBot = (tutorial: boolean) => {
    unlockSound();
    setTutorialAgain(tutorial);
    go('vs');
  };

  const doTopUp = async (amount = live) => {
    setTopping(true);
    const r = await topUpFor(amount);
    setTopping(false);
    say(r.text, r.ok ? NOTE_MS : NOTE_LONG_MS);
  };

  // The stake can't be played as is: why, for the Create button and the sheet.
  const blocked = check.ok ? null : check.hint;

  return (
    <div className="screen home">
      {/* A painted still shows at once; the live 3D loop fades in over it once its models are in. */}
      <div className={`home-bg ${bgReady ? 'ready' : ''}`} aria-hidden>
        <div className="home-bg-paint" />
        <div className="home-bg-live">
          <Background key={bgKey} onEnd={() => setBgKey((k) => k + 1)} />
        </div>
      </div>
      {unlocked && (
        <button
          className={`profile-btn ${account ? 'signed' : ''}`}
          onClick={() => {
            sfx.playButton();
            go('profile');
          }}
          aria-label="Your profile and wallet"
        >
          <img src="/brand/head-you.webp" alt="" width={30} height={30} />
          <span>{account ? (accountName ?? short(account)) : balance === null ? 'Profile' : `${sol(balance)} SOL`}</span>
        </button>
      )}
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

          <StakePicker
            locked={!unlocked}
            balance={balance}
            onTopUp={() => void doTopUp()}
            toppingUp={topping}
            onSkip={() => {
              setTutorialDone();
              setUnlocked(true);
            }}
          />

          {free || !unlocked ? (
            <button
              className="big primary play"
              onClick={() => {
                sfx.playButton();
                playBot(false);
              }}
            >
              PLAY VS BOT
            </button>
          ) : (
            <button
              className="big primary play"
              disabled={!check.ok && !check.short}
              onClick={() => {
                unlockSound();
                sfx.playButton();
                needAccount(() => setSheet('quick'));
              }}
            >
              FIND MATCH
            </button>
          )}

          {unlocked && (
            <div className="actions row2 home-pvp">
              {free ? (
                <button
                  className="big secondary two-line"
                  onClick={() => {
                    unlockSound();
                    void quickMatch(0);
                  }}
                >
                  Quick Match
                  <span>online · free</span>
                </button>
              ) : (
                <button className="big secondary two-line" onClick={() => playBot(false)}>
                  vs Bot
                  <span>free practice</span>
                </button>
              )}
              <button className="big secondary two-line" onClick={() => setSheet('friend')}>
                Play a Friend
                <span>{live ? `${sol(live)} SOL · room code` : 'room code · free'}</span>
              </button>
            </div>
          )}

          <footer className="home-foot">
            <button onClick={() => playBot(true)}>How to play</button>
            <a href="/">About</a>
            <span>Devnet play money</span>
          </footer>
        </div>
      </div>

      {note && (
        <div key={note.at} className={`toast ${note.text.length > 40 ? 'long' : ''}`} role="status">
          {note.text}
        </div>
      )}

      {sheet === 'quick' && (
        <StakeSheet
          title="Quick Match"
          stake={stake}
          balance={balance}
          around={around}
          short={
            check.short
              ? {
                  need: needFor(stake),
                  faucet: faucetCovers(stake),
                  cooldown,
                  topping,
                  onTopUp: () => void doTopUp(),
                  // Part 2 hook: "Add SOL from wallet" lives on the Profile screen.
                  onAddFromWallet: () => go('profile'),
                }
              : null
          }
          onClose={() => setSheet(null)}
          onSign={() => {
            setSheet(null);
            void quickMatch(stake);
          }}
        />
      )}

      {sheet === 'account' && (
        <AccountSheet
          onClose={() => {
            setSheet(null);
            setThen(null);
          }}
          onDone={() => {
            const next = then;
            setThen(null);
            setSheet(null);
            next?.();
          }}
        />
      )}

      {sheet === 'friend' && (
        <FriendSheet
          stake={live}
          blocked={blocked}
          onClose={() => setSheet(null)}
          onCreate={() => {
            unlockSound();
            const host = () => {
              setSheet(null);
              void hostRoom(live);
            };
            if (live > 0) needAccount(host);
            else host();
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
