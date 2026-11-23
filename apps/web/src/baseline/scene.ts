// Baseline scene v2: a candy meadow arena (main's palette and Kenney kit scenery), our crowd character,
// glowing gates, our block kit, main's town hall + towers, and juicy effects.
// World mapping: lane x -> world x, lane z -> world -z (the camera sits behind the cannon looking up the lane).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { loadPack, mergeParts, tintedMap, type Part, type TintRule } from '../arena/models/assets';
import { hallParts, wallParts } from '../arena/models/hall';
import { LANE } from './layouts';
import { P, CAP, type Sim, type Fx } from './sim';
import { dudeGeometry, dudeMaterial, dynamicMatcap, TEAM_LOOK } from './dude';
import type { Audio } from './audio';
import { cannonMech, gateRail, mechFortress, palm, robotTower, rock as rockProp, sandTexture, spikeBlock, waterMaterial, rng as rng2 } from './props';

const THEME = new URLSearchParams(location.search).get('theme') === 'candy' ? 'candy' : 'beach';

export const COL = {
  blue: new THREE.Color('#3fa0ff'), blueFresh: new THREE.Color('#a8f6ff'), white: new THREE.Color('#ffffff'), muzzle: new THREE.Color('#dfe6f5'),
  red: new THREE.Color('#ff4152'), gold: new THREE.Color('#ffc531'),
  navy: '#1c2c6b', enemy: '#f2404f', hall: '#f3e3c8',
};
/** Gate colours by multiplier: the colour tells you the size before you read the number. */
const GATE_COL: Record<number, [string, string, string]> = { // glass, rim, label stroke
  2: ['#4fb0ff', '#7fe0ff', '#14407a'], 3: ['#3fd0c9', '#8ffff0', '#0b5a55'], 4: ['#a36bff', '#d8b8ff', '#3e1a7a'],
  5: ['#ffb321', '#ffe27a', '#7a4200'],
};
const gateCol = (m: number) => GATE_COL[Math.min(5, Math.max(2, m))]!;

// ---------- helpers ----------
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

/** A toy-plastic matcap: bright key top-left, soft fill, dark rim. Tinted by vertex/instance colour. */
export function toyMatcap() {
  return canvasTex(256, 256, (g) => {
    const s = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    s.addColorStop(0, '#f4f4f4'); s.addColorStop(0.62, '#d6d6d6'); s.addColorStop(0.9, '#9a9aa6'); s.addColorStop(1, '#6a6a7a');
    g.fillStyle = s; g.fillRect(0, 0, 256, 256);
    const k = g.createRadialGradient(88, 72, 0, 88, 72, 95);
    k.addColorStop(0, 'rgba(255,255,255,1)'); k.addColorStop(0.2, 'rgba(255,255,255,0.6)'); k.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = k; g.fillRect(0, 0, 256, 256);
    const b = g.createRadialGradient(128, 236, 10, 128, 214, 110);
    b.addColorStop(0, 'rgba(50,40,90,0.45)'); b.addColorStop(1, 'rgba(50,40,90,0)');
    g.fillStyle = b; g.fillRect(0, 0, 256, 256);
  });
}

function blobTex() {
  return canvasTex(64, 64, (g) => {
    const s = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    s.addColorStop(0, 'rgba(20,10,50,0.55)'); s.addColorStop(0.6, 'rgba(20,10,50,0.3)'); s.addColorStop(1, 'rgba(20,10,50,0)');
    g.fillStyle = s; g.fillRect(0, 0, 64, 64);
  });
}

function labelTex(text: string, opts: { w?: number; h?: number; fg?: string; size?: number; stroke?: string } = {}) {
  const w = opts.w ?? 256, h = opts.h ?? 128;
  const tex = canvasTex(w, h, () => {});
  const draw = (t: string) => {
    const c = tex.image as HTMLCanvasElement, g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.font = `${opts.size ?? 84}px "Lilita One", "Baloo 2", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = 18; g.strokeStyle = opts.stroke ?? COL.navy; g.strokeText(t, w / 2, h / 2 + 6);
    g.fillStyle = opts.fg ?? '#ffffff'; g.fillText(t, w / 2, h / 2 + 4);
    tex.needsUpdate = true;
  };
  draw(text);
  return { tex, draw };
}

const std = (color: THREE.ColorRepresentation, o: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0, ...o });

function shadowed<T extends THREE.Object3D>(o: T, recv = false): T {
  o.traverse((m) => { if ((m as THREE.Mesh).isMesh) { m.castShadow = true; m.receiveShadow = recv; } });
  return o;
}

function vcol(geo: THREE.BufferGeometry, c: string) {
  const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv');
  const col = new THREE.Color(c), n = g.attributes.position!.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}

function cloud(s: number) {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#eef7ff', emissiveIntensity: 0.6 });
  [[0, 0, 0, 1.4], [1.3, -0.2, 0.2, 1.1], [-1.2, -0.3, 0.1, 1.0], [0.4, 0.6, -0.2, 1.0], [-0.5, 0.4, 0.4, 0.9]].forEach(([x, y, z, r]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r! * s, 14, 10), m); b.position.set(x! * s, y! * s, z! * s); g.add(b);
  });
  return g;
}

const SCALE = 13 / 18; // main's arena is 18 u wide; ours is 13
const HALL_TINT: readonly TintRule[] = [
  { cells: [[0, 3], [1, 3]], ref: [1, 3], color: COL.enemy },
  { cells: [[2, 2], [3, 2]], ref: [3, 2], color: COL.hall },
];
const TOWER_TINT: readonly TintRule[] = [{ cells: [[14, 2], [15, 2]], ref: [15, 2], color: COL.enemy }];

// ---------- the scene ----------
export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 9 / 19.5, 1, 400);
  cam = { pitch: 44, dist: 56, fov: 30, focusZ: 12.8 };
  dudeScale = 0.95;
  time = { value: 0 };
  audio: Audio | null = null;
  private matcap = toyMatcap();
  private blue!: THREE.InstancedMesh; private red!: THREE.InstancedMesh; private champ!: THREE.InstancedMesh;
  private shadows!: THREE.InstancedMesh;
  private cannon = new THREE.Group(); private barrel = new THREE.Group();
  private gateObjs: { root: THREE.Group; label: THREE.Mesh; glow: THREE.Mesh; punch: number }[] = [];
  private blockObjs: { root: THREE.Group; draw: (t: string) => void; shake: number; shown: number }[] = [];
  private towerObjs: { root: THREE.Group; body: THREE.Group; mat: THREE.MeshStandardMaterial | null; bar: ReturnType<typeof hpSprite>; shown: number; flash: number; sink: number }[] = [];
  private baseObj!: { root: THREE.Group; bar: ReturnType<typeof hpSprite>; shown: number; shake: number };
  private towerKit: { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } | null = null;
  private hallKit: { hall: THREE.BufferGeometry; wall: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial } | null = null;
  private dyn = new THREE.Group();
  private sparks = new Particles(1500, 'star');
  private puffs = new Particles(500, 'soft');
  private shake = 0;
  private lastSim: Sim | null = null;
  ready: Promise<void>;

  constructor() {
    const s = this.scene;
    s.background = canvasTex(4, 256, (g) => {
      const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#5ec8ff'); gr.addColorStop(0.6, '#a6e3ff'); gr.addColorStop(1, '#dff6ff');
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256);
    });
    s.add(new THREE.HemisphereLight('#ffffff', THEME === 'beach' ? '#ffe2a8' : '#9fd28a', THEME === 'beach' ? 2.3 : 1.6));
    const sun = new THREE.DirectionalLight('#fff3df', 2.3);
    sun.position.set(THEME === 'beach' ? -17 : -14, THEME === 'beach' ? 15 : 20, -3); sun.target.position.set(0, 0, -14);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 28, bottom: -28, near: 1, far: 80 });
    sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03; sun.shadow.intensity = THEME === 'beach' ? 0.55 : 1;
    s.add(sun, sun.target);
    if (THEME === 'beach') this.beachGround(); else this.ground();
    this.makeCrowds();
    this.makeCannon();
    s.add(this.dyn, this.sparks.points, this.puffs.points);
    const c1 = cloud(1.3); c1.position.set(-5.8, 2.5, 7); s.add(c1);
    const c2 = cloud(1.1); c2.position.set(6.2, 2.2, 6.5); s.add(c2);
    this.ready = this.loadKits();
  }

  private async loadKits() {
    const [nature, towers, hall] = await Promise.all([loadPack('nature'), loadPack('towers'), loadPack('hall')]);
    const mesh = new THREE.Mesh(mergeParts(nature, sceneryParts(THEME === 'beach' ? 8.9 : 7.25)), nature.material); mesh.castShadow = true; mesh.receiveShadow = true; this.scene.add(mesh);
    const tm = towers.material.clone(); if (towers.material.map) tm.map = tintedMap(towers.material.map, 'bl-tower', TOWER_TINT);
    this.towerKit = {
      geo: mergeParts(towers, [{ piece: 'tower-bottom', x: 0, y: 0, z: 0 }, { piece: 'tower-roof', x: 0, y: 0.6, z: 0 }], 3.4 * SCALE),
      mat: tm,
    };
    const hm = hall.material.clone(); if (hall.material.map) hm.map = tintedMap(hall.material.map, 'bl-hall', HALL_TINT);
    const TILE = 2.2 * SCALE;
    this.hallKit = { hall: mergeParts(hall, hallParts(), TILE), wall: mergeParts(hall, wallParts(Math.ceil(15 / TILE)), TILE), mat: hm };
    if (this.lastSim) this.build(this.lastSim);
  }

  private ground() {
    const r = rng(7);
    const grassTex = canvasTex(256, 512, (g) => {
      for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#6fcf5a' : '#62c24f'; g.fillRect(0, i * 32, 256, 32); }
      for (let i = 0; i < 900; i++) { g.fillStyle = r() > 0.5 ? 'rgba(40,120,40,0.25)' : 'rgba(200,255,160,0.25)'; g.fillRect(r() * 256, r() * 512, 2, 3); }
      for (let i = 0; i < 70; i++) { g.fillStyle = ['#ffffff', '#ffe066', '#ff8fb1', '#b59cff'][i % 4]!; g.beginPath(); g.arc(r() * 256, r() * 512, 2 + r() * 2, 0, 7); g.fill(); }
    });
    grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(4, 4);
    const grass = new THREE.Mesh(new THREE.PlaneGeometry(90, 110), std('#ffffff', { map: grassTex, roughness: 0.95 }));
    grass.rotation.x = -Math.PI / 2; grass.position.set(0, -0.55, -20); grass.receiveShadow = true; this.scene.add(grass);

    // the lane: a raised slab with a tiled top (cream checker; blue apron at the cannon, red-tinted near the base)
    const L0 = -9, L1 = 40, len = L1 - L0;
    const tileTex = canvasTex(256, 1568, (g) => {
      const rows = 49, cols = 8, th = 1568 / rows;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const z = L1 - (y + 0.5) * (len / rows);
        const light = (x + y) % 2 === 0;
        let c = light ? '#fff1d6' : '#f7dfb4';
        if (z < 2.2) c = light ? '#d8ecff' : '#bcdcff';
        else if (z > 23.5) c = light ? '#ffe0da' : '#f9c9c1';
        g.fillStyle = c; g.fillRect(x * 32, y * th, 32, th);
        g.fillStyle = 'rgba(160,110,60,0.2)'; g.fillRect(x * 32, y * th, 32, 2); g.fillRect(x * 32, y * th, 2, th);
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.fillRect(x * 32 + 3, y * th + 3, 26, 3);
      }
      g.strokeStyle = 'rgba(255,255,255,0.85)'; g.lineWidth = 8; g.lineJoin = 'round'; g.lineCap = 'round';
      for (const z of [2.8, 3.8]) { const y = (L1 - z) / len * 1568; g.beginPath(); g.moveTo(106, y + 16); g.lineTo(128, y); g.lineTo(150, y + 16); g.stroke(); }
    });
    const slab = new THREE.Mesh(new RoundedBoxGeometry(13.4, 0.6, len, 3, 0.18), std('#e9c08a', { roughness: 0.8 }));
    slab.position.set(0, -0.3, -(L0 + L1) / 2); slab.receiveShadow = true; this.scene.add(slab);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(13.1, len), std('#ffffff', { map: tileTex, roughness: 0.85 }));
    top.rotation.x = -Math.PI / 2; top.position.set(0, 0.003, -(L0 + L1) / 2); top.receiveShadow = true; this.scene.add(top);

    // candy kerbs: alternating red/white rounded blocks along both edges, one merged mesh
    const seg: THREE.BufferGeometry[] = [];
    for (const sx of [-1, 1]) for (let z = L0, i = 0; z < L1; z += 0.7, i++) {
      const b = new RoundedBoxGeometry(0.42, 0.34, 0.66, 2, 0.12); b.translate(sx * 6.72, 0.17, -(z + 0.35));
      seg.push(vcol(b, i % 2 ? '#ffffff' : '#ff5a6e'));
    }
    const kerb = new THREE.Mesh(mergeGeometries(seg)!, new THREE.MeshMatcapMaterial({ matcap: this.matcap, vertexColors: true }));
    kerb.castShadow = true; this.scene.add(kerb);

    const track = new THREE.Mesh(new RoundedBoxGeometry(12.2, 0.05, 0.16, 2, 0.02), std('#ffffff', { emissive: '#9fd8ff', emissiveIntensity: 0.4 }));
    track.position.set(0, 0.03, -LANE.cannonZ); this.scene.add(track);
  }

  private makeCrowds() {
    const geo = dudeGeometry();
    const dm = dynamicMatcap();
    const mk = (n: number, look: keyof typeof TEAM_LOOK) => {
      const m = new THREE.InstancedMesh(geo, dudeMaterial(dm, this.time, TEAM_LOOK[look]), n); m.frustumCulled = false; m.count = 0; m.setColorAt(0, COL.white); this.scene.add(m);
      return m;
    };
    this.blue = mk(CAP, 'blue'); this.red = mk(CAP, 'red'); this.champ = mk(64, 'gold');
    const sh = new THREE.PlaneGeometry(1, 1); sh.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sh, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }), CAP * 2 + 64);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1; this.scene.add(this.shadows);
  }

  private makeCannon() {
    const glass = new THREE.MeshStandardMaterial({ color: '#3fa8ff', roughness: 0.1, emissive: '#1d6dff', emissiveIntensity: 0.9, transparent: true, opacity: 0.92 });
    const mech = cannonMech(this.mk, glass);
    this.cannon = mech.root; this.barrel = mech.barrel; this.cannon.scale.setScalar(1.15); this.scene.add(this.cannon);
  }
  private mk = (color: string) => new THREE.MeshMatcapMaterial({ matcap: this.matcap, color });

  private beachGround() {
    const r = rng2(5);
    const sand = sandTexture();
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(15, 64), std('#ffffff', { map: sand, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -16); ground.receiveShadow = true; this.scene.add(ground);
    const water = waterMaterial(this.time);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 64), water); w.rotation.x = -Math.PI / 2; w.position.set(sx * 8.6, -0.15, -16); w.receiveShadow = true; this.scene.add(w);
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 64), new THREE.MeshBasicMaterial({ color: '#f2feff' })); foam.rotation.x = -Math.PI / 2; foam.position.set(sx * 7.5, -0.1, -16); this.scene.add(foam);
      const lip = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.4, 64, 2, 0.18), std('#efc27e', { roughness: 0.9 })); lip.position.set(sx * 7.25, -0.1, -16); lip.receiveShadow = true; this.scene.add(lip);
      const bank = new THREE.Mesh(new THREE.PlaneGeometry(16, 64), std('#5cbf52', { roughness: 0.95 })); bank.rotation.x = -Math.PI / 2; bank.position.set(sx * 17.6, 0.05, -16); bank.receiveShadow = true; this.scene.add(bank);
      const sandBank = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.5, 64, 2, 0.25), std('#e9bd78', { roughness: 0.9 })); sandBank.position.set(sx * 10.2, -0.05, -16); sandBank.receiveShadow = true; this.scene.add(sandBank);
      for (let z = -8; z < 44; z += 2.4 + r() * 2.2) { // palms leaning over the lane edge
        const p = palm(r, this.mk); p.position.set(sx * (8.7 + r() * 1.6), 0, -z); p.rotation.y = sx > 0 ? Math.PI + (r() - 0.5) : (r() - 0.5); p.scale.setScalar(0.9 + r() * 0.35); this.scene.add(p);
        if (r() > 0.45) { const k = rockProp(r, this.mk, 0.7 + r() * 0.7); k.position.set(sx * (8.2 + r() * 1.2), -0.1, -z - 1.1); this.scene.add(k); }
      }
    }
    const track = new THREE.Mesh(new RoundedBoxGeometry(13, 0.05, 0.14, 2, 0.02), std('#ffffff', { emissive: '#bfe8ff', emissiveIntensity: 0.6, transparent: true, opacity: 0.85 }));
    track.position.set(0, 0.03, -LANE.cannonZ); this.scene.add(track);
  }

  /** Rebuild the static pieces of a level (gates, walls, blocks, towers, base). */
  build(sim: Sim) {
    this.lastSim = sim;
    this.dyn.clear(); this.gateObjs = []; this.blockObjs = []; this.towerObjs = [];
    const mc = (color: string) => new THREE.MeshMatcapMaterial({ matcap: this.matcap, color });
    sim.gates.forEach((g) => {
      const [glassC, rimC, strokeC] = gateCol(g.mul);
      const root = new THREE.Group();
      const frame = new THREE.Mesh(new RoundedBoxGeometry(g.w, 1.5, 0.44, 3, 0.2), mc('#22306e')); frame.position.y = 0.75;
      const glass = new THREE.Mesh(new RoundedBoxGeometry(g.w - 0.32, 1.18, 0.48, 3, 0.14),
        new THREE.MeshStandardMaterial({ color: glassC, transparent: true, opacity: 0.82, roughness: 0.1, emissive: glassC, emissiveIntensity: 0.65 }));
      glass.position.y = 0.76;
      const sheen = new THREE.Mesh(new THREE.PlaneGeometry(g.w - 0.5, 0.14), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55 }));
      sheen.position.set(0, 1.22, 0.25);
      const capM = new THREE.MeshStandardMaterial({ color: rimC, emissive: rimC, emissiveIntensity: 2.2 });
      const caps = [-1, 1].flatMap((s) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1.7, 12), capM); m.position.set(s * (g.w / 2 - 0.02), 0.85, 0);
        const k = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), capM); k.position.set(s * (g.w / 2 - 0.02), 1.78, 0);
        return [m, k];
      });
      const { tex } = labelTex(`×${g.mul}`, { stroke: strokeC, size: 108 });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      label.position.set(0, 0.85, 0.34); label.rotation.x = -0.2;
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(g.w + 0.8, 1.6), new THREE.MeshBasicMaterial({ map: glowTex(), color: rimC, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55 }));
      glow.rotation.x = -Math.PI / 2; glow.position.set(0, 0.02, 0.25);
      root.add(shadowed(frame), glass, sheen, ...caps, label, glow);
      root.position.set(g.x, 0, -g.z);
      if (THEME === 'beach') { root.position.y = 0.2; }
      this.dyn.add(root); this.gateObjs.push({ root, label, glow, punch: 0 });
    });
    if (THEME === 'beach') for (const z of [...new Set(sim.gates.map((g) => g.z))]) { const r = gateRail(this.mk); r.position.set(0, 0, -z); this.dyn.add(r); }
    const wallM = std('#ffd9a0', { roughness: 0.6 }), wallTop = std('#ff7a59', { roughness: 0.45 });
    sim.walls.forEach((w, wi) => {
      if (sim.layout.walls[wi]?.kind === 'spike') { const b = spikeBlock(this.mk, w.x1 - w.x0); b.position.set((w.x0 + w.x1) / 2, 0, -(w.z0 + w.z1) / 2); this.dyn.add(b); return; }
      const W = w.x1 - w.x0, D = w.z1 - w.z0;
      const m = new THREE.Mesh(new RoundedBoxGeometry(W, 1.3, D, 3, 0.2), wallM); m.position.set((w.x0 + w.x1) / 2, 0.65, -(w.z0 + w.z1) / 2);
      const t = new THREE.Mesh(new RoundedBoxGeometry(W + 0.08, 0.22, D + 0.08, 2, 0.1), wallTop); t.position.set(m.position.x, 1.32, m.position.z);
      this.dyn.add(shadowed(m, true), shadowed(t));
    });
    sim.blocks.forEach((b) => {
      const root = new THREE.Group();
      const h = b.size * 1.15;
      const m = new THREE.Mesh(new RoundedBoxGeometry(b.size, h, b.size, 4, 0.24), mc('#3d8cff')); m.position.y = h / 2;
      const rim = new THREE.Mesh(new RoundedBoxGeometry(b.size + 0.1, 0.18, b.size + 0.1, 2, 0.08), mc('#86cbff')); rim.position.y = h - 0.05;
      const iconP = new THREE.Mesh(new THREE.PlaneGeometry(b.size * 0.55, b.size * 0.42), new THREE.MeshBasicMaterial({ map: dudeIconTex(), transparent: true }));
      iconP.position.set(0, h * 0.72, b.size / 2 + 0.02);
      const { tex, draw } = labelTex(String(b.hp), { fg: '#ffffff', stroke: COL.navy, size: 100 });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(b.size * 0.85, b.size * 0.42), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      lbl.position.set(0, h * 0.34, b.size / 2 + 0.02);
      root.add(shadowed(m), rim, iconP, lbl); root.position.set(b.x, 0, -b.z);
      this.dyn.add(root); this.blockObjs.push({ root, draw, shake: 0, shown: b.hp });
    });
    sim.towers.forEach((t) => {
      const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
      let mat: THREE.MeshStandardMaterial | null = null;
      if (THEME === 'beach') body.add(robotTower(this.mk));
      else if (this.towerKit) {
        mat = this.towerKit.mat.clone(); mat.emissive.set('#ffffff'); mat.emissiveIntensity = 0;
        const m = new THREE.Mesh(this.towerKit.geo, mat); m.castShadow = true; m.receiveShadow = true; body.add(m);
      }
      root.position.set(t.x, 0, -t.z);
      const bar = hpSprite(); bar.sprite.position.set(0, 3.6, 0); root.add(bar.sprite); bar.draw(t.hp, t.max);
      this.dyn.add(root); this.towerObjs.push({ root, body, mat, bar, shown: t.hp, flash: 0, sink: 0 });
    });
    const base = new THREE.Group();
    if (THEME === 'beach') { const f = mechFortress(this.mk); f.position.set(0, 0, -LANE.baseZ - 1.6); base.add(f); }
    else if (this.hallKit) {
      const wall = new THREE.Mesh(this.hallKit.wall, this.hallKit.mat); wall.scale.set(1, 1.2, 0.9); wall.position.set(0, 0, -LANE.baseZ - 0.4);
      const hall = new THREE.Mesh(this.hallKit.hall, this.hallKit.mat); hall.position.set(0, 0, -LANE.baseZ - 3.2);
      base.add(shadowed(wall, true), shadowed(hall, true));
    }
    this.dyn.add(base);
    const bar = hpSprite(1.5); bar.sprite.position.set(0, 3.2, -LANE.baseZ + 0.4); this.dyn.add(bar.sprite); bar.draw(sim.base.hp, sim.base.max);
    this.baseObj = { root: base, bar, shown: sim.base.hp, shake: 0 };
  }

  setCamera(aspect: number) {
    const c = this.cam, p = THREE.MathUtils.degToRad(c.pitch);
    this.camera.fov = c.fov; this.camera.aspect = aspect;
    this.camera.position.set(0, Math.sin(p) * c.dist, -c.focusZ + Math.cos(p) * c.dist);
    this.camera.lookAt(0, 0, -c.focusZ);
    this.camera.updateProjectionMatrix();
  }

  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private e = new THREE.Euler(); private tc = new THREE.Color();

  draw(sim: Sim, dt: number, time: number) {
    this.time.value = time;
    for (const f of sim.fx) this.onFx(f, sim);
    sim.fx.length = 0;
    let nb = 0, nr = 0, nc = 0, ns = 0;
    const S = this.dudeScale;
    for (let i = 0; i < sim.n; i++) {
      const big = sim.big[i], blue = sim.team[i] === 0;
      const run = time * 14 + sim.phase[i];
      const f = sim.fresh[i];
      const pop = f > 0 ? Math.sin((1 - f / 0.18) * Math.PI) * 0.55 : 0; // clones hop out of the gate
      const hop = Math.abs(Math.sin(run)) * 0.05 * (big ? 2 : 1) + pop;
      const sc = (big ? 2.3 : 1) * S * (f < 0 ? 0.8 : 1);
      const yaw = Math.atan2(sim.vx[i], sim.vz[i]);
      this.e.set(0, -yaw, Math.sin(run) * 0.08); this.q.setFromEuler(this.e);
      this.v.set(sim.x[i], hop, -sim.z[i]); this.sc.setScalar(sc);
      this.m4.compose(this.v, this.q, this.sc);
      const flash = f > 0 ? 0.55 * Math.min(1, f / 0.18) : f < 0 ? Math.min(1, -f / 0.06) * 0.8 : 0;
      this.tc.setRGB(1, 1 - flash, 1);
      if (big) { this.champ.setMatrixAt(nc, this.m4); this.champ.setColorAt(nc, this.tc); nc++; }
      else if (blue) { this.blue.setMatrixAt(nb, this.m4); this.blue.setColorAt(nb, this.tc); nb++; }
      else { this.red.setMatrixAt(nr, this.m4); this.red.setColorAt(nr, this.tc); nr++; }
      this.v.set(sim.x[i], 0.012, -sim.z[i]); this.sc.setScalar(0.7 * sc * (1 - pop * 0.5)); this.m4.compose(this.v, this.q.identity(), this.sc);
      this.shadows.setMatrixAt(ns++, this.m4);
    }
    const counts = [nb, nr, nc];
    [this.blue, this.red, this.champ].forEach((m, k) => {
      m.count = counts[k]!; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
    this.shadows.count = ns; this.shadows.instanceMatrix.needsUpdate = true;
    const c = sim.cannon;
    this.cannon.position.set(c.x, 0, -LANE.cannonZ + c.recoil * 0.15);
    this.cannon.rotation.z = (c.target - c.x) * -0.04;
    this.barrel.scale.set(1 + c.recoil * 0.15, 1 + c.recoil * 0.15, 1 - c.recoil * 0.18);
    sim.gates.forEach((g, i) => {
      const o = this.gateObjs[i]!; o.root.position.x = g.x;
      o.punch = Math.max(0, o.punch - dt * 5);
      o.label.scale.setScalar(1 + o.punch * 0.4); o.label.position.y = 0.85 + Math.sin(time * 3 + i) * 0.04;
      (o.glow.material as THREE.MeshBasicMaterial).opacity = 0.45 + o.punch * 0.5;
    });
    sim.blocks.forEach((b, i) => {
      const o = this.blockObjs[i]!;
      if (b.hp <= 0) { o.root.visible = false; return; }
      if (o.shown !== b.hp) { o.shown = b.hp; o.draw(String(b.hp)); o.shake = 1; }
      o.shake = Math.max(0, o.shake - dt * 8);
      o.root.position.x = b.x + Math.sin(time * 70) * o.shake * 0.06; o.root.scale.set(1 + o.shake * 0.05, 1 - o.shake * 0.05, 1 + o.shake * 0.05);
    });
    sim.towers.forEach((t, i) => {
      const o = this.towerObjs[i]!;
      if (o.shown !== t.hp) { if (t.hp < o.shown) o.flash = 1; o.shown = t.hp; o.bar.draw(t.hp, t.max); }
      o.flash = Math.max(0, o.flash - dt * 7);
      if (o.mat) o.mat.emissiveIntensity = o.flash * 0.6;
      const s = 1 + t.pulse * 0.1 + o.flash * 0.04;
      o.body.scale.set(s, 1 - o.flash * 0.05, s);
      if (t.hp <= 0) { o.sink = Math.min(1, o.sink + dt * 1.6); o.body.position.y = -o.sink * o.sink * 5; o.body.rotation.z = o.sink * 0.4 * (i ? 1 : -1); o.bar.sprite.visible = false; }
    });
    const bo = this.baseObj;
    if (bo.shown !== sim.base.hp) { bo.shown = sim.base.hp; bo.bar.draw(sim.base.hp, sim.base.max); bo.shake = 1; }
    bo.shake = Math.max(0, bo.shake - dt * 6); bo.root.position.x = Math.sin(time * 60) * bo.shake * 0.08;
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3; }
    this.sparks.update(dt); this.puffs.update(dt, -1);
  }

  private onFx(f: Fx, sim: Sim) {
    const A = this.audio;
    switch (f.k) {
      case 'shot': A?.play('shot'); break;
      case 'poof':
        this.puffs.burst(f.x, 0.45, -f.z, 3, '#ffffff', 1.2, 0.35, 0.55);
        this.sparks.burst(f.x, 0.5, -f.z, 2, f.team === 2 ? '#ffe066' : '#ffffff', 2.5, 0.3, 0.3);
        A?.play('clash'); break;
      case 'gate': {
        const o = this.gateObjs[f.i]!; o.punch = 1;
        const rim = gateCol(sim.gates[f.i]!.mul)[1];
        this.sparks.burst(f.x, 0.9, -f.z, 4, '#ffffff', 3, 0.35, 0.55); this.sparks.burst(f.x, 0.9, -f.z, 3, rim, 2.5, 0.4, 0.35);
        A?.play('gate', 1 + Math.min(0.5, sim.gates[f.i]!.mul * 0.06)); break;
      }
      case 'hit': this.sparks.burst(f.x, 0.9, -f.z, 3, f.target === 3 ? '#ff4655' : '#ffb340', 3.5, 0.3, 0.35); A?.play('hit'); break;
      case 'block':
        if (f.broke) { const b = sim.blocks[f.i]!; this.sparks.burst(b.x, 1, -b.z, 50, '#5fb2ff', 8, 0.7, 0.45); this.puffs.burst(b.x, 1, -b.z, 12, '#ffffff', 3, 0.6, 1.2); this.shake = 0.6; A?.play('crateBreak'); }
        else A?.play('crate');
        break;
      case 'wave': A?.play('wave'); break;
      case 'down':
        if (f.target < 2) { const t = sim.towers[f.target]!; this.sparks.burst(t.x, 1.5, -t.z, 70, '#ff6a3d', 8, 0.8, 0.5); this.puffs.burst(t.x, 1, -t.z, 18, '#ffffff', 3, 0.9, 1.4); this.shake = 1; A?.play('towerDown'); }
        if (f.target === 2) { this.sparks.burst(0, 2, -LANE.baseZ - 1, 160, '#ffc531', 10, 1.2, 0.6); this.puffs.burst(0, 1.5, -LANE.baseZ, 30, '#ffffff', 4, 1.2, 1.8); this.shake = 1.5; A?.play('win'); }
        if (f.target === 3) A?.play('lose');
        break;
      default: break;
    }
  }
}

function sceneryParts(edgeIn = 7.25): Part[] {
  const r = rng(0x1d6e5);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const TREES = ['tree_default', 'tree_oak', 'tree_fat', 'tree_detailed', 'tree_cone', 'tree_pineRoundA', 'tree_blocks'];
  const BUSH = ['plant_bush', 'plant_bushLarge', 'plant_bushDetailed'];
  const SMALL = ['grass', 'grass_large', 'flower_redA', 'flower_yellowA', 'flower_purpleA', 'mushroom_red', 'rock_smallA', 'stone_smallC'];
  const ROCK = ['rock_largeA', 'rock_largeB', 'stone_largeB', 'stump_round', 'log'];
  const P: Part[] = [], taken: [number, number, number][] = [];
  const put = (piece: string, x: number, z: number, s: number, rad: number) => {
    if (!taken.every(([tx, tz, tr]) => (tx - x) ** 2 + (tz - z) ** 2 > (tr + rad) ** 2)) return;
    taken.push([x, z, rad]); P.push({ piece, x, y: -0.55, z, q: Math.floor(r() * 4) + r() * 0.2, s });
  };
  const edge = edgeIn;
  for (let i = 0; i < 220; i++) {
    const side = r() < 0.5 ? -1 : 1, out = edge + 1.4 + Math.pow(r(), 1.5) * 24, z = -12 - r() * 60;
    const s = 2.4 + r() * 1.9; put(pick(TREES), side * out, z, s, s * 0.3);
  }
  for (let i = 0; i < 60; i++) { const x = (r() * 2 - 1) * 20, z = -40 - r() * 20, s = 2.4 + r() * 2; put(pick(TREES), x, z, s, s * 0.3); }
  for (let i = 0; i < 120; i++) {
    const side = r() < 0.5 ? -1 : 1, out = edge + 0.5 + r() * 4, z = 8 - r() * 48;
    if (r() < 0.65) put(pick(BUSH), side * out, z, 1.6 + r() * 1.3, 0.55); else put(pick(ROCK), side * out, z, 1.3 + r() * 1.1, 0.6);
  }
  for (let i = 0; i < 260; i++) {
    const side = r() < 0.5 ? -1 : 1, out = edge + 0.3 + r() * 9, z = 10 - r() * 52;
    put(pick(SMALL), side * out, z, 1.1 + r() * 0.9, 0.25);
  }
  return P;
}

let _glow: THREE.Texture | null = null;
function glowTex() {
  return (_glow ??= canvasTex(128, 64, (g) => {
    const s = g.createRadialGradient(64, 64, 0, 64, 64, 64); s.addColorStop(0, 'rgba(255,255,255,0.9)'); s.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.scale(1, 0.5); g.fillStyle = s; g.fillRect(0, 0, 128, 128); g.restore();
  }));
}

let _icon: THREE.Texture | null = null;
function dudeIconTex() {
  return (_icon ??= canvasTex(128, 96, (g) => {
    g.fillStyle = '#ffffff'; roundRect(g, 4, 4, 120, 88, 18); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#22306e'; roundRect(g, 4, 4, 120, 88, 18); g.stroke();
    g.fillStyle = '#ffd9b8'; g.beginPath(); g.arc(64, 54, 28, 0, 7); g.fill();
    g.fillStyle = '#2f86ff'; g.beginPath(); g.arc(64, 50, 30, Math.PI, 0); g.fill(); g.fillRect(32, 46, 64, 7);
    g.fillStyle = '#fff'; for (const x of [54, 74]) { g.beginPath(); g.ellipse(x, 62, 7, 9, 0, 0, 7); g.fill(); }
    g.fillStyle = '#14112a'; for (const x of [54, 74]) { g.beginPath(); g.ellipse(x + 1, 63, 4, 5, 0, 0, 7); g.fill(); }
    g.lineWidth = 4; g.strokeStyle = '#22306e'; g.beginPath(); g.arc(64, 54, 28, 0, 7); g.stroke();
  }));
}

function hpSprite(scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.4 * scale, 0.9 * scale, 1); sprite.renderOrder = 10;
  const draw = (hp: number, max: number) => {
    const g = c.getContext('2d')!; g.clearRect(0, 0, 256, 96);
    g.fillStyle = '#1a1038'; roundRect(g, 18, 52, 220, 34, 12); g.fill();
    const gr = g.createLinearGradient(0, 58, 0, 80); gr.addColorStop(0, '#ff7a85'); gr.addColorStop(1, '#e02a3c');
    g.fillStyle = gr; roundRect(g, 24, 58, Math.max(0, 208 * hp / max), 22, 8); g.fill();
    g.font = '48px "Lilita One","Baloo 2",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#1a1038'; g.lineJoin = 'round';
    const t = hp >= 1000 ? (hp / 1000).toFixed(1) + 'K' : String(Math.ceil(hp));
    g.strokeText(t, 128, 28); g.fillStyle = '#fff'; g.fillText(t, 128, 28);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

class Particles {
  n = 0;
  pos: Float32Array; vel: Float32Array; col: Float32Array; life: Float32Array; size: Float32Array; size0: Float32Array; maxLife: Float32Array;
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  constructor(public max: number, shape: 'star' | 'soft') {
    this.pos = new Float32Array(max * 3); this.vel = new Float32Array(max * 3); this.col = new Float32Array(max * 3);
    this.life = new Float32Array(max); this.size = new Float32Array(max); this.size0 = new Float32Array(max); this.maxLife = new Float32Array(max);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const frag = shape === 'star'
      ? `varying vec3 vC; void main(){ vec2 p = abs(gl_PointCoord-.5)*2.; float s = max(1.-(p.x*6.+p.y)*.9, 1.-(p.y*6.+p.x)*.9); s = max(s, 1.-length(p)*2.2); if(s<=0.) discard; gl_FragColor = vec4(vC*1.6, clamp(s*2.,0.,1.)); }`
      : `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); if(d>.5) discard; float sh = .82 + .18*smoothstep(.3,-.2,p.y+p.x*.3); gl_FragColor = vec4(vC*sh, smoothstep(.5,.4,d)); }`;
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*700./-mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: frag,
    });
    this.points = new THREE.Points(this.geo, mat); this.points.frustumCulled = false; this.points.renderOrder = 5;
  }
  burst(x: number, y: number, z: number, n: number, color: string, speed: number, life: number, size: number) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n && this.n < this.max; k++) {
      const i = this.n++, a = Math.random() * 6.283, u = Math.random() * 0.9 + 0.1;
      this.pos.set([x, y, z], i * 3);
      this.vel.set([Math.cos(a) * speed * u, speed * (0.5 + Math.random()), Math.sin(a) * speed * u], i * 3);
      this.col.set([c.r, c.g, c.b], i * 3);
      this.life[i] = this.maxLife[i] = life * (0.6 + Math.random() * 0.6); this.size0[i] = size * (0.6 + Math.random() * 0.8);
    }
  }
  /** grow > 0: particles fall and shrink as they die; grow < 0: they slow and swell (puffs). */
  update(dt: number, grow = 1) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt; if (this.life[i] <= 0) continue;
      if (w !== i) {
        this.pos.copyWithin(w * 3, i * 3, i * 3 + 3); this.vel.copyWithin(w * 3, i * 3, i * 3 + 3); this.col.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.size0[w] = this.size0[i];
      }
      const k = this.life[w] / this.maxLife[w];
      if (grow > 0) { this.vel[w * 3 + 1] -= 12 * dt; this.size[w] = this.size0[w] * Math.min(1, k * 2); }
      else { for (let a = 0; a < 3; a++) this.vel[w * 3 + a] *= 1 - Math.min(1, dt * 5); this.size[w] = this.size0[w] * (0.5 + (1 - k) * 0.7) * Math.min(1, k * 3); }
      for (let a = 0; a < 3; a++) this.pos[w * 3 + a] += this.vel[w * 3 + a] * dt;
      if (this.pos[w * 3 + 1] < 0.05) { this.pos[w * 3 + 1] = 0.05; this.vel[w * 3 + 1] *= -0.3; }
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    for (const k of ['position', 'color', 'size']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

export { P };
