import { registerSW } from 'virtual:pwa-register';
import { useApp } from './store';

/**
 * The offline cache (service worker) and updates. A new deploy installs in the background; the game
 * switches to it the moment you're on Home (never mid-match, in a queue or on a result), so an open
 * tab or the installed app never keeps running an old build. It also checks for one every 15 min.
 */
let pending = false;

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    pending = true;
    tryUpdate();
  },
  onRegisteredSW(_url, reg) {
    if (reg) setInterval(() => void reg.update().catch(() => undefined), 15 * 60_000);
  },
});

function tryUpdate() {
  if (pending && useApp.getState().screen === 'home') {
    pending = false;
    void updateSW(true); // activates the new build and reloads
  }
}

useApp.subscribe(tryUpdate);
