// Landing page script: the hero lane, reveal-on-scroll, the gate flips and the race bars.
import { startLane } from './lane';

const lane = document.getElementById('lane');
if (lane instanceof HTMLCanvasElement) startLane(lane);

const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts a race score up to its data-to value over the bar's fill time. */
function countUp(el: HTMLElement) {
  const to = Number(el.dataset.to) || 0;
  if (still) {
    el.textContent = String(to);
    return;
  }
  const t0 = performance.now();
  const ms = 2400;
  const tick = (now: number) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = String(Math.round(to * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const show = (el: Element) => {
  el.classList.add('in');
  if (el.classList.contains('race')) el.querySelectorAll<HTMLElement>('.race-score').forEach(countUp);
};

const targets = document.querySelectorAll('.reveal, .flip-row, .race');
if (!('IntersectionObserver' in window)) {
  targets.forEach(show);
} else {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        show(e.target);
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.15 },
  );
  targets.forEach((t) => io.observe(t));
}
