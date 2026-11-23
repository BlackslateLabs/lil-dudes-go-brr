// Baseline playground: one portrait screen, the whole level visible, hold to fire, drag to aim.
// URL flags: ?layout=0..3  ?auto=1 (self-play for screenshots)  ?full=1 (fill the window)  ?panel=1
import * as THREE from 'three';
import './baseline.css';
import { LAYOUTS } from './layouts';
import { Sim, P } from './sim';
import { World } from './scene';
import { Audio } from './audio';
import { BloomEffect, EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode, VignetteEffect } from 'postprocessing';

const q = new URLSearchParams(location.search);
const auto = q.get('auto') === '1';
let layoutIdx = Math.max(0, Math.min(LAYOUTS.length - 1, Number(q.get('layout') ?? 0)));

const stage = document.getElementById('stage')!;
const frame = el('div', 'frame', stage);
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: auto });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
frame.appendChild(renderer.domElement);

const world = new World();
const audio = new Audio(); world.audio = audio;
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: devicePixelRatio < 1.5 ? 4 : 0 });
composer.addPass(new RenderPass(world.scene, world.camera));
composer.addPass(new EffectPass(world.camera,
  new BloomEffect({ mipmapBlur: true, luminanceThreshold: 1.0, luminanceSmoothing: 0.25, intensity: 0.9, radius: 0.7 }),
  new VignetteEffect({ offset: 0.35, darkness: 0.35 }),
  new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL })));
let sim = new Sim(LAYOUTS[layoutIdx]);
world.build(sim);

// ---------- HUD ----------
const hud = el('div', 'hud', frame);
const top = el('div', 'top', hud);
const you = el('div', 'pill you', top); you.innerHTML = '<span class="ico"></span><b>You</b><i>0</i>';
const title = el('div', 'title', hud);
const foe = el('div', 'pill foe', top); foe.innerHTML = '<i>0</i><b>Enemy</b><span class="ico"></span>';
const hpRow = el('div', 'cannonhp', hud);
const champBtn = el('button', 'champ', hud); champBtn.innerHTML = '<span class="fill"></span><span class="lbl">CHAMP</span>';
const hint = el('div', 'hint', hud); hint.textContent = 'Hold to fire · drag to aim';
const banner = el('div', 'banner', hud); banner.hidden = true;
const gear = el('button', 'gear', hud); gear.textContent = '⚙';

champBtn.addEventListener('pointerdown', (e) => { e.stopPropagation(); void audio.start(); if (sim.champ >= 1) audio.play('champ'); sim.fireChampion(); });

function restart(idx = layoutIdx) {
  layoutIdx = idx; sim = new Sim(LAYOUTS[layoutIdx]); world.build(sim); banner.hidden = true;
  title.textContent = LAYOUTS[layoutIdx].name; title.style.animation = 'none'; void title.offsetWidth; title.style.animation = ''; hint.hidden = false;
  layoutSel.value = String(layoutIdx);
}

// ---------- input ----------
let dragging = false, lastX = 0;
const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => { void audio.start(); dragging = true; lastX = e.clientX; sim.cannon.firing = true; hint.hidden = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const w = canvas.clientWidth; sim.cannon.target = Math.max(-5.3, Math.min(5.3, sim.cannon.target + ((e.clientX - lastX) / w) * 14)); lastX = e.clientX;
});
const up = () => { dragging = false; sim.cannon.firing = false; };
canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
addEventListener('keydown', (e) => {
  if (e.key === 'r') restart();
  if (e.key >= '1' && e.key <= String(LAYOUTS.length)) restart(Number(e.key) - 1);
  if (e.key === 'c') sim.fireChampion();
  if (e.key === 'p') panel.hidden = !panel.hidden;
  if (e.key === 'm') audio.toggle();
});

// ---------- tuning panel ----------
const panel = el('div', 'panel', stage); panel.hidden = q.get('panel') !== '1';
gear.addEventListener('pointerdown', (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; });
const layoutSel = document.createElement('select');
LAYOUTS.forEach((l, i) => { const o = document.createElement('option'); o.value = String(i); o.textContent = `${i + 1}. ${l.name}`; layoutSel.appendChild(o); });
layoutSel.onchange = () => restart(Number(layoutSel.value));
panel.appendChild(row('Layout', layoutSel));
const btn = document.createElement('button'); btn.textContent = 'Restart (R)'; btn.onclick = () => restart(); panel.appendChild(btn);
type Knob = [string, object, string, number, number, number];
const knobs: Knob[] = [
  ['Camera pitch°', world.cam, 'pitch', 25, 75, 1], ['Camera distance', world.cam, 'dist', 25, 90, 0.5],
  ['FOV°', world.cam, 'fov', 15, 60, 1], ['Camera focus z', world.cam, 'focusZ', 5, 25, 0.5],
  ['Dude size', world, 'dudeScale', 0.5, 2, 0.05],
  ['Speed u/s', P, 'speed', 1, 6, 0.1], ['Fire interval s', P, 'fireInterval', 0.05, 0.6, 0.01], ['Dudes per shot', P, 'perShot', 1, 4, 1],
  ['Enemy wave size', P, 'waveSize', 0, 40, 1], ['Wave growth', P, 'waveGrow', 0, 10, 1], ['Wave gap s', P, 'waveGap', 2, 15, 0.5],
  ['Tower HP (restart)', P, 'towerHp', 20, 600, 10], ['Base HP (restart)', P, 'baseHp', 50, 2000, 50],
  ['Champion charge s', P, 'champTime', 1, 20, 0.5],
];
for (const [name, obj, key, min, max, step] of knobs) {
  const o = obj as Record<string, number>;
  const inp = document.createElement('input'); inp.type = 'range'; Object.assign(inp, { min, max, step, value: String(o[key]) });
  const val = document.createElement('span'); val.textContent = String(o[key]);
  inp.oninput = () => { o[key] = Number(inp.value); val.textContent = inp.value; resize(); };
  const r = row(name, inp); r.appendChild(val); panel.appendChild(r);
}
const dump = document.createElement('button'); dump.textContent = 'Copy settings';
dump.onclick = () => { const s = JSON.stringify({ cam: world.cam, dudeScale: world.dudeScale, P }); navigator.clipboard?.writeText(s); console.log(s); dump.textContent = 'Copied'; };
panel.appendChild(dump);

// ---------- sizing ----------
function resize() {
  const full = q.get('full') === '1';
  const H = innerHeight, W = innerWidth;
  let w = full ? W : Math.min(W, H * 9 / 19.5), h = full ? H : w * 19.5 / 9;
  if (h > H) { h = H; w = h * 9 / 19.5; }
  frame.style.width = `${w}px`; frame.style.height = `${h}px`;
  renderer.setSize(w, h); composer.setSize(w, h);
  world.setCamera(w / h);
}
addEventListener('resize', resize);
restart(layoutIdx);
resize();

// ---------- loop ----------
let last = performance.now(), acc = 0, time = 0, autoT = 0;
const STEP = 1 / 60;
const fixed = Number(q.get('dt') ?? 0); // screenshot mode: advance this much sim time per rendered frame
function frameLoop(now: number) {
  const dt = fixed || Math.min(0.1, (now - last) / 1000); last = now; acc += dt; time += dt;
  if (auto) {
    autoT += dt; sim.cannon.firing = !sim.over; hint.hidden = true;
    sim.cannon.target = Math.sin(autoT * 0.45) * 4.2;
    if (sim.champ >= 1) sim.fireChampion();
    if (sim.over && autoT > 0) { autoT = -3; }
    if (sim.over && autoT > -0.1 && autoT < 0) restart();
  }
  while (acc >= STEP) { sim.step(STEP); acc -= STEP; }
  world.setCamera(canvas.clientWidth / canvas.clientHeight);
  world.draw(sim, dt, time);
  composer.render(dt);
  // HUD
  (you.querySelector('i') as HTMLElement).textContent = String(sim.count(0));
  (foe.querySelector('i') as HTMLElement).textContent = String(sim.count(1));
  hpRow.style.setProperty('--hp', String(sim.cannon.hp / P.cannonHp));
  champBtn.style.setProperty('--fill', String(sim.champ));
  if (sim.champ >= 1 && !champBtn.classList.contains('ready')) audio.play('champReady');
  champBtn.classList.toggle('ready', sim.champ >= 1);
  if (sim.over && banner.hidden) {
    banner.hidden = false;
    banner.innerHTML = `<div class="word ${sim.over === 1 ? 'win' : 'lose'}">${sim.over === 1 ? 'VICTORY!' : 'DEFEAT'}</div>`;
    const again = el('button', 'again', banner); again.textContent = 'Play again'; again.onclick = () => restart();
    const nxt = el('button', 'again alt', banner); nxt.textContent = 'Next layout'; nxt.onclick = () => restart((layoutIdx + 1) % LAYOUTS.length);
  }
  requestAnimationFrame(frameLoop);
}
requestAnimationFrame(frameLoop);
Object.assign(window, { __sim: () => sim, __world: world });

// ---------- dom helpers ----------
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement) {
  const e = document.createElement(tag); e.className = cls; parent.appendChild(e); return e;
}
function row(label: string, input: HTMLElement) {
  const r = document.createElement('label'); r.className = 'row';
  const s = document.createElement('span'); s.textContent = label; r.append(s, input); return r;
}
