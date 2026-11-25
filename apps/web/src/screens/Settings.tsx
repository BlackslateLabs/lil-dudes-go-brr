import { useEffect, useRef, useState } from 'react';
import { getVolumes, setSoundEnabled, setVibeEnabled, setVolumes, sfx, soundEnabled, vibeEnabled, vibeSupported } from '../feel/sound';
import './settings.css';

const CLOSE_MS = 150;
const REPO = 'https://github.com/BlackslateLabs/lil-dudes-go-brr';

/**
 * Sound on/off, music and effects volume, vibration. Shared by Home's Settings and the in-match
 * cog. Everything is saved on this device.
 */
export function SoundControls() {
  const [on, setOn] = useState(soundEnabled());
  const [vol, setVol] = useState(getVolumes());
  const [vibe, setVibe] = useState(vibeEnabled());
  const pct = (v: number) => Math.round(v * 100);
  return (
    <div className="set-group">
      <button
        className={`set-row ${on ? 'on' : ''}`}
        role="switch"
        aria-checked={on}
        onClick={() => {
          setSoundEnabled(!on);
          setOn(!on);
        }}
      >
        <span>Sound</span>
        <i className="set-switch" aria-hidden />
      </button>
      <label className={`set-slider ${on ? '' : 'off'}`}>
        <span>Music</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct(vol.music)}
          disabled={!on}
          style={{ '--v': `${pct(vol.music)}%` } as React.CSSProperties}
          onChange={(e) => {
            const music = Number(e.target.value) / 100;
            setVolumes({ music });
            setVol((v) => ({ ...v, music }));
          }}
          aria-label="Music volume"
        />
        <b>{pct(vol.music)}</b>
      </label>
      <label className={`set-slider ${on ? '' : 'off'}`}>
        <span>Effects</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={pct(vol.fx)}
          disabled={!on}
          style={{ '--v': `${pct(vol.fx)}%` } as React.CSSProperties}
          onChange={(e) => {
            const fx = Number(e.target.value) / 100;
            setVolumes({ fx });
            setVol((v) => ({ ...v, fx }));
          }}
          // A click at the new level once the thumb is let go, so you hear what you picked.
          onPointerUp={() => sfx.click()}
          onKeyUp={() => sfx.click()}
          aria-label="Effects volume"
        />
        <b>{pct(vol.fx)}</b>
      </label>
      {vibeSupported() && (
        <button
          className={`set-row ${vibe ? 'on' : ''}`}
          role="switch"
          aria-checked={vibe}
          onClick={() => {
            setVibeEnabled(!vibe);
            setVibe(!vibe);
          }}
        >
          <span>Vibration</span>
          <i className="set-switch" aria-hidden />
        </button>
      )}
    </div>
  );
}

/** Home's Settings: sound, then the links (how to play, about, credits, source, report a bug). */
export function SettingsSheet({ onClose, onHowToPlay }: { onClose: () => void; onHowToPlay: () => void }) {
  const [closing, setClosing] = useState(false);
  const after = useRef<() => void>(onClose);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const close = (then: () => void) => {
    if (closing) return;
    after.current = then;
    setClosing(true);
    timer.current = setTimeout(() => after.current(), CLOSE_MS);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close(onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className={`sheet-wrap ${closing ? 'closing' : ''}`} onClick={() => close(onClose)}>
      <div className="sheet set-sheet" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <i className="sheet-grip" aria-hidden />
        <h3>Settings</h3>

        <SoundControls />

        <nav className="set-links" aria-label="Links">
          <button onClick={() => close(onHowToPlay)}>
            How to play <small>a guided bot match</small>
          </button>
          <a href="/">
            About the game <small>↗</small>
          </a>
          <a href="/credits/">
            Credits <small>↗</small>
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source code <small>GitHub ↗</small>
          </a>
          <a href={`${REPO}/issues/new`} target="_blank" rel="noreferrer">
            Report a bug <small>GitHub ↗</small>
          </a>
        </nav>

        <p className="set-fine">Devnet play money. Settings are saved on this device.</p>
        <button className="sheet-cancel" onClick={() => close(onClose)}>
          Done
        </button>
      </div>
    </div>
  );
}
