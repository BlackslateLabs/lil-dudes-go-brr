// Landing page: arcade attract mode. The CRT cycles demo → title → how to play → demo → fair play, like a real
// cabinet idling; Enter / Space / 1 / 2 press Start. No game code here.

import { registerSW } from 'virtual:pwa-register';

// The landing has no state to lose: take a new build as soon as it's ready (it also precaches the game).
const updateLanding = registerSW({ immediate: true, onNeedRefresh: () => void updateLanding(true) });

const crt = document.getElementById('crt') as HTMLElement | null;
const demo = document.getElementById('demo') as HTMLVideoElement | null;
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Seconds on each attract screen. */
const CYCLE: [string, number][] = [
  ['demo', 12],
  ['title', 4],
  ['how', 6],
  ['demo', 12],
  ['fair', 6],
];

if (crt && demo) {
  if (reduce) {
    // A still frame (the poster) and the title card over it; nothing moves.
    crt.dataset.slide = 'title';
  } else {
    const play = () => void demo.play().catch(() => undefined);
    let i = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const next = () => {
      const [slide, secs] = CYCLE[i % CYCLE.length]!;
      crt.dataset.slide = slide;
      i++;
      timer = setTimeout(next, secs * 1000);
    };
    // Only run while the cabinet is on screen and the tab is visible.
    let onScreen = true;
    const sync = () => {
      const live = onScreen && document.visibilityState === 'visible';
      if (live) {
        play();
        if (timer === undefined) next();
      } else {
        demo.pause();
        clearTimeout(timer);
        timer = undefined;
      }
    };
    new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting);
      sync();
    }).observe(crt);
    document.addEventListener('visibilitychange', sync);
    sync();
  }
}

// Press Start from the keyboard, like the cabinet's buttons.
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === '1' || e.key === '2') {
    if (e.key === ' ' && (e.target as HTMLElement | null)?.closest('a, button')) return;
    e.preventDefault();
    document.body.classList.add('starting');
    window.setTimeout(() => window.location.assign('/play/'), reduce ? 0 : 180);
  }
});
