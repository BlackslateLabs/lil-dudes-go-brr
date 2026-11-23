// Baseline scene: world, our own procedural models, and the per-frame draw of the sim.
// World mapping: lane x -> world x, lane z -> world -z (the camera sits behind the cannon looking up the lane).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LANE } from './layouts';
import { P, CAP, type Sim, type Fx } from './sim';

export const COL = {
  blue: new THREE.Color('#2f8dff'), blueFresh: new THREE.Color('#9ff4ff'), white: new THREE.Color('#ffffff'),
  red: new THREE.Color('#ff4655'), gold: new THREE.Color('#ffc531'),
  sand: '#f4d7a1', sandDark: '#e6bf80', water: '#5fd3e6', grass: '#62c25a', grassDark: '#47a649',
  navy: '#1c2c6b', glass: '#58b6ff',
};

// ---------- helpers ----------
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646; }

function canvasTex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** A toy-plastic matcap: soft key light top-left, warm fill, dark rim. Tinted by material/instance colour. */
export function toyMatcap() {
  return canvasTex(256, 256, (g) => {
    const s = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    s.addColorStop(0, '#f2f2f2'); s.addColorStop(0.7, '#d0d0d0'); s.addColorStop(0.93, '#8a8a8a'); s.addColorStop(1, '#5a5a5a');
    g.fillStyle = s; g.fillRect(0, 0, 256, 256);
    const k = g.createRadialGradient(92, 78, 0, 92, 78, 90);
    k.addColorStop(0, 'rgba(255,255,255,1)'); k.addColorStop(0.25, 'rgba(255,255,255,0.55)'); k.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = k; g.fillRect(0, 0, 256, 256);
    const b = g.createRadialGradient(128, 230, 10, 128, 210, 110);
    b.addColorStop(0, 'rgba(40,40,60,0.55)'); b.addColorStop(1, 'rgba(40,40,60,0)');
    g.fillStyle = b; g.fillRect(0, 0, 256, 256);
  });
}

function colored(geo: THREE.BufferGeometry, c: number) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(c);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Our dude: bean body, big round head, a hair tuft, two eyes. ~0.75 u tall, ~0.5 u wide. */
export function dudeGeometry() {
  const body = new THREE.SphereGeometry(0.22, 12, 9); body.scale(1, 1.05, 0.95); body.translate(0, 0.24, 0);
  const head = new THREE.SphereGeometry(0.21, 14, 10); head.translate(0, 0.55, 0.02);
  const tuft = new THREE.ConeGeometry(0.06, 0.14, 6); tuft.rotateX(-0.3); tuft.translate(0, 0.79, 0.0);
  const armL = new THREE.SphereGeometry(0.075, 6, 5); armL.translate(-0.22, 0.3, 0.02);
  const armR = armL.clone(); armR.translate(0.44, 0, 0);
  const eyeL = new THREE.SphereGeometry(0.035, 6, 5); eyeL.scale(1, 1.4, 0.6); eyeL.translate(-0.075, 0.58, 0.2);
  const eyeR = eyeL.clone(); eyeR.translate(0.15, 0, 0);
  // the face looks at the enemy (world -z)
  const g = mergeGeometries([colored(body, 0.82), colored(head, 1), colored(tuft, 0.7), colored(armL, 0.9), colored(armR, 0.9), colored(eyeL, 0.08), colored(eyeR, 0.08)]);
  g.rotateY(Math.PI);
  return g;
}

function blobTex() {
  return canvasTex(64, 64, (g) => {
    const s = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    s.addColorStop(0, 'rgba(0,0,0,0.5)'); s.addColorStop(0.6, 'rgba(0,0,0,0.3)'); s.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = s; g.fillRect(0, 0, 64, 64);
  });
}

function labelTex(text: string, opts: { w?: number; h?: number; fg?: string; size?: number; stroke?: string } = {}) {
  const w = opts.w ?? 256, h = opts.h ?? 128;
  const tex = canvasTex(w, h, () => {});
  const draw = (t: string) => {
    const c = tex.image as HTMLCanvasElement, g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    g.font = `900 ${opts.size ?? 84}px "Lilita One", "Baloo 2", system-ui, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 14; g.strokeStyle = opts.stroke ?? COL.navy; g.strokeText(t, w / 2, h / 2 + 4);
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

// ---------- props ----------
function palm(r: () => number) {
  const g = new THREE.Group();
  const trunkM = std('#b9814f'), ringM = std('#9a6a3e');
  const lean = (r() - 0.5) * 0.5, h = 2.6 + r() * 1.4, segs = 6;
  let y = 0, x = 0;
  for (let i = 0; i < segs; i++) {
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.17 - i * 0.012, 0.2 - i * 0.012, h / segs, 7), i % 2 ? ringM : trunkM);
    x += lean * (i / segs) * 0.25; s.position.set(x, y + h / segs / 2, 0); s.rotation.z = -lean * 0.3; g.add(s); y += h / segs;
  }
  const leafM = std('#3fb24d', { flatShading: true }), leafM2 = std('#2f9a40', { flatShading: true });
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + r();
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(1, 7, 4), i % 2 ? leafM : leafM2);
    leaf.scale.set(1.25, 0.1, 0.36); leaf.position.set(x + Math.cos(a) * 1.0, y - 0.15, Math.sin(a) * 1.0);
    leaf.rotation.set(0, -a, -0.45); g.add(leaf);
  }
  const nut = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), std('#6b4a2a')); nut.position.set(x, y - 0.1, 0); g.add(nut);
  return shadowed(g);
}

function rock(r: () => number, s = 1) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 * s, 0), std(r() > 0.5 ? '#9b93b3' : '#a8a0bd', { flatShading: true, roughness: 0.8 }));
  m.scale.set(1 + r() * 0.6, 0.6 + r() * 0.5, 1 + r() * 0.5); m.rotation.y = r() * 6;
  return shadowed(m);
}

function bush(r: () => number) {
  const g = new THREE.Group(), m = std(r() > 0.5 ? '#4cb850' : '#3ea446', { flatShading: true });
  for (let i = 0; i < 3; i++) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.45 + r() * 0.3, 0), m);
    b.position.set((r() - 0.5) * 0.8, 0.25, (r() - 0.5) * 0.8); g.add(b);
  }
  return shadowed(g);
}

function cloud(s: number) {
  const g = new THREE.Group(), m = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: '#e8f4ff', emissiveIntensity: 0.55 });
  [[0, 0, 0, 1.4], [1.3, -0.2, 0.2, 1.1], [-1.2, -0.3, 0.1, 1.0], [0.4, 0.6, -0.2, 1.0], [-0.5, 0.4, 0.4, 0.9]].forEach(([x, y, z, r]) => {
    const b = new THREE.Mesh(new THREE.SphereGeometry(r * s, 14, 10), m); b.position.set(x * s, y * s, z * s); g.add(b);
  });
  return g;
}

// ---------- the scene ----------
export class World {
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(30, 9 / 19.5, 1, 400);
  cam = { pitch: 44, dist: 55, fov: 30, focusZ: 12 };
  dudeScale = 1.0;
  private matcap = toyMatcap();
  private blue!: THREE.InstancedMesh; private red!: THREE.InstancedMesh; private champ!: THREE.InstancedMesh;
  private shadows!: THREE.InstancedMesh;
  private cannon = new THREE.Group(); private barrel = new THREE.Group();
  private gateObjs: { root: THREE.Group; label: THREE.Mesh; punch: number }[] = [];
  private blockObjs: { root: THREE.Group; draw: (t: string) => void; shake: number; shown: number }[] = [];
  private towerObjs: { root: THREE.Group; bar: ReturnType<typeof hpSprite>; shown: number }[] = [];
  private baseObj!: { root: THREE.Group; bar: ReturnType<typeof hpSprite>; shown: number };
  private dyn = new THREE.Group();
  private parts = new Particles();
  private shake = 0;

  constructor() {
    const s = this.scene;
    s.background = new THREE.Color('#8fd3ff');
    s.add(new THREE.HemisphereLight('#ffffff', '#ffe2b0', 1.7));
    const sun = new THREE.DirectionalLight('#fff4e0', 2.2);
    sun.position.set(-15, 17, -3); sun.target.position.set(0, 0, -14);
    sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 26, bottom: -26, near: 1, far: 70 });
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; sun.shadow.radius = 3;
    s.add(sun, sun.target);
    this.ground();
    this.props();
    this.makeCrowds();
    this.makeCannon();
    s.add(this.dyn, this.parts.points);
  }

  private ground() {
    const r = rng(7);
    const sandTex = canvasTex(512, 1024, (g) => {
      g.fillStyle = COL.sand; g.fillRect(0, 0, 512, 1024);
      for (let i = 0; i < 26; i++) { // big soft blotches
        const x = r() * 512, y = r() * 1024, rad = 40 + r() * 90;
        const s = g.createRadialGradient(x, y, 0, x, y, rad);
        s.addColorStop(0, 'rgba(226,182,118,0.35)'); s.addColorStop(1, 'rgba(226,182,118,0)');
        g.fillStyle = s; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
      }
      for (let i = 0; i < 2600; i++) { g.fillStyle = r() > 0.5 ? 'rgba(200,150,90,0.25)' : 'rgba(255,240,210,0.35)'; g.fillRect(r() * 512, r() * 1024, 2, 2); }
      for (let i = 0; i < 40; i++) { // pebbles
        g.fillStyle = ['#f08a6a', '#7cc4f0', '#f5c84a', '#c7a0e8'][i % 4]; g.beginPath(); g.arc(r() * 512, r() * 1024, 3 + r() * 3, 0, 7); g.fill();
      }
    });
    const sand = new THREE.Mesh(new THREE.PlaneGeometry(15.4, 60), std('#ffffff', { map: sandTex, roughness: 0.95 }));
    sand.rotation.x = -Math.PI / 2; sand.position.set(0, 0, -16); sand.receiveShadow = true; this.scene.add(sand);
    // lane edge lips
    for (const sx of [-1, 1]) {
      const lip = new THREE.Mesh(new RoundedBoxGeometry(0.5, 0.3, 60, 2, 0.12), std('#e9c58c'));
      lip.position.set(sx * 7.45, 0.1, -16); lip.receiveShadow = true; lip.castShadow = true; this.scene.add(lip);
      const water = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 60), std(COL.water, { roughness: 0.25, emissive: '#2aa8c4', emissiveIntensity: 0.25 }));
      water.rotation.x = -Math.PI / 2; water.position.set(sx * 9.0, -0.12, -16); water.receiveShadow = true; this.scene.add(water);
      const foam = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 60), new THREE.MeshBasicMaterial({ color: '#dffbff' }));
      foam.rotation.x = -Math.PI / 2; foam.position.set(sx * 7.85, -0.08, -16); this.scene.add(foam);
      const grass = new THREE.Mesh(new THREE.PlaneGeometry(14, 60), std(COL.grass, { roughness: 0.9 }));
      grass.rotation.x = -Math.PI / 2; grass.position.set(sx * 17.2, 0, -16); grass.receiveShadow = true; this.scene.add(grass);
      const bank = new THREE.Mesh(new RoundedBoxGeometry(1.2, 0.7, 60, 2, 0.3), std('#d9b179'));
      bank.position.set(sx * 10.6, 0.0, -16); bank.receiveShadow = true; this.scene.add(bank);
    }
    // cannon track line
    const track = new THREE.Mesh(new THREE.PlaneGeometry(13, 0.09), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.7 }));
    track.rotation.x = -Math.PI / 2; track.position.set(0, 0.02, -LANE.cannonZ); this.scene.add(track);
  }

  private props() {
    const r = rng(42);
    for (const sx of [-1, 1]) {
      for (let z = -6; z < 42; z += 2.2 + r() * 2.5) {
        const p = palm(r); p.position.set(sx * (8.3 + r() * 2.2), 0, -z); p.scale.setScalar(0.9 + r() * 0.4); p.rotation.y = r() * 6; this.scene.add(p);
        if (r() > 0.4) { const b = bush(r); b.position.set(sx * (8.4 + r() * 4), 0, -z - 1); this.scene.add(b); }
        if (r() > 0.5) { const k = rock(r, 0.8 + r() * 0.8); k.position.set(sx * (8.3 + r() * 4), 0.1, -z + 1); this.scene.add(k); }
      }
      for (let z = 2; z < 34; z += 5 + r() * 6) { // a few rocks in the water edge
        const k = rock(r, 0.5 + r() * 0.4); k.position.set(sx * (8.6 + r() * 0.8), 0, -z); this.scene.add(k);
      }
    }
    const c1 = cloud(1.3); c1.position.set(-5.5, 2.5, 6.5); this.scene.add(c1);
    const c2 = cloud(1.1); c2.position.set(6, 2.2, 6.0); this.scene.add(c2);
  }

  private makeCrowds() {
    const geo = dudeGeometry();
    const mat = (c: THREE.Color) => new THREE.MeshMatcapMaterial({ matcap: this.matcap, color: c, vertexColors: true });
    this.blue = new THREE.InstancedMesh(geo, mat(new THREE.Color('#ffffff')), CAP);
    this.red = new THREE.InstancedMesh(geo, mat(new THREE.Color('#ffffff')), CAP);
    this.champ = new THREE.InstancedMesh(geo, mat(new THREE.Color('#ffffff')), 64);
    for (const m of [this.blue, this.red, this.champ]) { m.frustumCulled = false; m.count = 0; m.setColorAt(0, COL.white); this.scene.add(m); }
    const sh = new THREE.PlaneGeometry(1, 1); sh.rotateX(-Math.PI / 2);
    this.shadows = new THREE.InstancedMesh(sh, new THREE.MeshBasicMaterial({ map: blobTex(), transparent: true, depthWrite: false }), CAP + 64);
    this.shadows.frustumCulled = false; this.shadows.renderOrder = 1; this.scene.add(this.shadows);
  }

  private makeCannon() {
    const c = this.cannon;
    const body = std('#2f7dff', { roughness: 0.35 }), dark = std('#1d2a52', { roughness: 0.5 }), hub = std('#cfd8ea', { roughness: 0.3 });
    const chassis = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.6, 1.7, 3, 0.22), body); chassis.position.y = 0.6; c.add(chassis);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.62, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), body); dome.position.set(0, 0.85, 0.15); c.add(dome);
    for (const [x, z] of [[-0.82, 0.55], [0.82, 0.55], [-0.82, -0.55], [0.82, -0.55]]) {
      const w = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.38, 16), dark); w.rotation.z = Math.PI / 2; w.position.set(x, 0.4, z); c.add(w);
      const h = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.4, 10), hub); h.rotation.z = Math.PI / 2; h.position.set(x * 1.02, 0.4, z); c.add(h);
    }
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.36, 1.3, 16), body); tube.rotation.x = Math.PI / 2; tube.position.z = -0.65;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.09, 8, 18), dark); ring.position.z = -1.3;
    const bolt = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), std('#ffd23f', { emissive: '#ffb000', emissiveIntensity: 0.4 })); bolt.position.set(0, 0.25, -0.3);
    this.barrel.add(tube, ring, bolt); this.barrel.position.set(0, 1.05, 0.05); c.add(this.barrel);
    c.scale.setScalar(1.25); shadowed(c); this.scene.add(c);
  }

  /** Rebuild the static pieces of a level (gates, walls, blocks, towers, base). */
  build(sim: Sim) {
    this.dyn.clear(); this.gateObjs = []; this.blockObjs = []; this.towerObjs = [];
    const frameM = std(COL.navy, { roughness: 0.4 });
    sim.gates.forEach((g) => {
      const root = new THREE.Group();
      const gold = g.mul >= 5;
      const frame = new THREE.Mesh(new RoundedBoxGeometry(g.w, 1.6, 0.42, 3, 0.18), gold ? std('#8a4b00') : frameM);
      frame.position.y = 0.8;
      const glass = new THREE.Mesh(new RoundedBoxGeometry(g.w - 0.3, 1.3, 0.46, 3, 0.14),
        new THREE.MeshStandardMaterial({ color: gold ? '#ffcc33' : COL.glass, transparent: true, opacity: 0.88, roughness: 0.15, emissive: gold ? '#c98a00' : '#1f7fe0', emissiveIntensity: 0.55 }));
      glass.position.y = 0.82;
      const sheen = new THREE.Mesh(new THREE.PlaneGeometry(g.w - 0.4, 0.12), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.45 }));
      sheen.position.set(0, 1.36, 0.24);
      const caps = [-1, 1].map((s) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.75, 10), new THREE.MeshStandardMaterial({ color: '#bff3ff', emissive: '#59e1ff', emissiveIntensity: 1.2 })); m.position.set(s * (g.w / 2 - 0.02), 0.86, 0); return m; });
      const { tex } = labelTex(`×${g.mul}`, { stroke: gold ? "#6a3500" : COL.navy, size: 104 });
      const label = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.3), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
      label.position.set(0, 0.86, 0.32); label.rotation.x = -0.2;
      root.add(shadowed(frame), glass, sheen, ...caps, label);
      root.position.set(g.x, 0, -g.z);
      this.dyn.add(root); this.gateObjs.push({ root, label, punch: 0 });
    });
    const wallM = std('#ead2a4', { roughness: 0.7 }), wallTop = std('#f6e6c4', { roughness: 0.6 });
    sim.walls.forEach((w) => {
      const W = w.x1 - w.x0, D = w.z1 - w.z0;
      const m = new THREE.Mesh(new RoundedBoxGeometry(W, 1.4, D, 3, 0.16), wallM); m.position.set((w.x0 + w.x1) / 2, 0.7, -(w.z0 + w.z1) / 2);
      const t = new THREE.Mesh(new RoundedBoxGeometry(Math.max(0.2, W - 0.12), 0.12, Math.max(0.2, D - 0.12), 2, 0.05), wallTop); t.position.set(m.position.x, 1.42, m.position.z);
      this.dyn.add(shadowed(m, true), t);
    });
    sim.blocks.forEach((b) => {
      const root = new THREE.Group();
      const m = new THREE.Mesh(new RoundedBoxGeometry(b.size, b.size * 1.15, b.size, 4, 0.22), std('#3d8bff', { roughness: 0.3 }));
      m.position.y = b.size * 0.575;
      const panel = new THREE.Mesh(new RoundedBoxGeometry(b.size * 0.78, b.size * 0.5, 0.06, 2, 0.05), std('#dff1ff', { roughness: 0.4 }));
      panel.position.set(0, b.size * 0.5, b.size / 2 + 0.01);
      const { tex, draw } = labelTex(String(b.hp), { fg: COL.navy, stroke: '#ffffff', size: 92 });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(b.size * 0.75, b.size * 0.38), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
      lbl.position.set(0, b.size * 0.5, b.size / 2 + 0.05);
      root.add(shadowed(m), panel, lbl); root.position.set(b.x, 0, -b.z);
      this.dyn.add(root); this.blockObjs.push({ root, draw, shake: 0, shown: b.hp });
    });
    sim.towers.forEach((t, i) => {
      const root = tower(); root.position.set(t.x, 0, -t.z); root.scale.setScalar(1.25);
      const bar = hpSprite(); bar.sprite.position.set(0, 3.6, 0); root.add(bar.sprite); bar.draw(t.hp, t.max);
      this.dyn.add(root); this.towerObjs.push({ root, bar, shown: t.hp });
      void i;
    });
    const b = fortress(); b.position.set(0, 0, -LANE.baseZ - 1.4); this.dyn.add(b);
    const bar = hpSprite(1.6); bar.sprite.position.set(0, 3.4, -LANE.baseZ + 0.2); this.dyn.add(bar.sprite); bar.draw(sim.base.hp, sim.base.max);
    this.baseObj = { root: b, bar, shown: sim.base.hp };
  }

  setCamera(aspect: number) {
    const c = this.cam, p = THREE.MathUtils.degToRad(c.pitch);
    this.camera.fov = c.fov; this.camera.aspect = aspect;
    const target = new THREE.Vector3(0, 0, -c.focusZ);
    this.camera.position.set(0, Math.sin(p) * c.dist, -c.focusZ + Math.cos(p) * c.dist);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
  }

  private m4 = new THREE.Matrix4(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private sc = new THREE.Vector3(); private e = new THREE.Euler(); private tc = new THREE.Color();

  draw(sim: Sim, dt: number, time: number) {
    // fx events
    for (const f of sim.fx) this.onFx(f, sim);
    sim.fx.length = 0;
    // crowds
    let nb = 0, nr = 0, nc = 0, ns = 0;
    const S = this.dudeScale;
    for (let i = 0; i < sim.n; i++) {
      const big = sim.big[i], blue = sim.team[i] === 0;
      const run = time * 13 + sim.phase[i];
      const hop = Math.abs(Math.sin(run)) * 0.07 * (big ? 2 : 1);
      const sc = (big ? 2.3 : 1) * S;
      const sq = 1 + Math.sin(run * 2) * 0.05;
      const yaw = Math.atan2(sim.vx[i], sim.vz[i]);
      this.e.set(0, -yaw, Math.sin(run) * 0.12); this.q.setFromEuler(this.e);
      this.v.set(sim.x[i], hop, -sim.z[i]); this.sc.set(sc / Math.sqrt(sq), sc * sq, sc / Math.sqrt(sq));
      this.m4.compose(this.v, this.q, this.sc);
      if (big) {
        this.champ.setMatrixAt(nc, this.m4); this.champ.setColorAt(nc, COL.gold); nc++;
      } else if (blue) {
        this.blue.setMatrixAt(nb, this.m4);
        const f = sim.fresh[i];
        if (f > 0) this.tc.copy(COL.blue).lerp(COL.blueFresh, Math.min(1, f / 0.18));
        else if (f < 0) this.tc.copy(COL.blue).lerp(COL.white, Math.min(1, -f / 0.06));
        else this.tc.copy(COL.blue);
        this.blue.setColorAt(nb, this.tc); nb++;
      } else { this.red.setMatrixAt(nr, this.m4); this.red.setColorAt(nr, COL.red); nr++; }
      this.v.set(sim.x[i], 0.015, -sim.z[i]); this.sc.setScalar(0.62 * sc); this.m4.compose(this.v, this.q.identity(), this.sc);
      this.shadows.setMatrixAt(ns++, this.m4);
    }
    for (const [m, n] of [[this.blue, nb], [this.red, nr], [this.champ, nc], [this.shadows, ns]] as const) {
      m.count = n; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    // cannon
    const c = sim.cannon;
    this.cannon.position.set(c.x, 0, -LANE.cannonZ + c.recoil * 0.12);
    this.barrel.scale.set(1 + c.recoil * 0.12, 1 + c.recoil * 0.12, 1 - c.recoil * 0.15);
    // gates
    sim.gates.forEach((g, i) => {
      const o = this.gateObjs[i]; o.root.position.x = g.x;
      o.punch = Math.max(0, o.punch - dt * 6); o.label.scale.setScalar(1 + o.punch * 0.45);
    });
    sim.blocks.forEach((b, i) => {
      const o = this.blockObjs[i];
      if (b.hp <= 0) { o.root.visible = false; return; }
      if (o.shown !== b.hp) { o.shown = b.hp; o.draw(String(b.hp)); o.shake = 1; }
      o.shake = Math.max(0, o.shake - dt * 8);
      o.root.position.x = b.x + Math.sin(time * 70) * o.shake * 0.06; o.root.scale.setScalar(1 + o.shake * 0.04);
    });
    sim.towers.forEach((t, i) => {
      const o = this.towerObjs[i];
      if (o.shown !== t.hp) { o.shown = t.hp; o.bar.draw(t.hp, t.max); }
      const s = 1.25 * (1 + t.pulse * 0.12); o.root.scale.set(s, t.hp > 0 ? s : Math.max(0.01, o.root.scale.y - dt * 3), s);
      if (t.hp <= 0) o.bar.sprite.visible = false;
    });
    if (this.baseObj.shown !== sim.base.hp) { this.baseObj.shown = sim.base.hp; this.baseObj.bar.draw(sim.base.hp, sim.base.max); }
    // camera shake
    this.shake = Math.max(0, this.shake - dt * 3);
    if (this.shake > 0) { this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3; this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3; }
    this.parts.update(dt);
  }

  private onFx(f: Fx, sim: Sim) {
    const P_ = this.parts;
    switch (f.k) {
      case 'poof': P_.burst(f.x, 0.4, -f.z, 5, f.team === 2 ? '#ffffff' : '#ffd23f', 2.2, 0.35, 0.22); break;
      case 'gate': this.gateObjs[f.i].punch = 1; P_.burst(f.x, 0.6, -f.z, 3, '#ffffff', 2.5, 0.25, 0.32); break;
      case 'hit': P_.burst(f.x, 0.8, -f.z, 3, f.target === 3 ? '#ff4655' : '#ffb340', 3, 0.3, 0.2); break;
      case 'block': if (f.broke) { const b = sim.blocks[f.i]; P_.burst(b.x, 0.8, -b.z, 40, '#3d8bff', 7, 0.7, 0.35); this.shake = 0.6; } break;
      case 'down':
        if (f.target < 2) { const t = sim.towers[f.target]; P_.burst(t.x, 1.5, -t.z, 60, '#ff6a3d', 8, 0.8, 0.4); this.shake = 1; }
        if (f.target === 2) { P_.burst(0, 2, -LANE.baseZ - 1, 140, '#ffc531', 10, 1.2, 0.45); this.shake = 1.5; }
        break;
      default: break;
    }
  }
}

function hpSprite(scale = 1) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  sprite.scale.set(2.4 * scale, 0.9 * scale, 1); sprite.renderOrder = 10;
  const draw = (hp: number, max: number) => {
    const g = c.getContext('2d')!; g.clearRect(0, 0, 256, 96);
    g.fillStyle = '#1a1038'; roundRect(g, 18, 52, 220, 34, 12); g.fill();
    g.fillStyle = '#ff4655'; roundRect(g, 24, 58, Math.max(0, 208 * hp / max), 22, 8); g.fill();
    g.font = '900 46px "Lilita One","Baloo 2",system-ui,sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 10; g.strokeStyle = '#1a1038'; g.lineJoin = 'round';
    const t = hp >= 1000 ? (hp / 1000).toFixed(1) + 'K' : String(Math.ceil(hp));
    g.strokeText(t, 128, 28); g.fillStyle = '#fff'; g.fillText(t, 128, 28);
    tex.needsUpdate = true;
  };
  return { sprite, draw };
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

/** Enemy tower: a stubby red turret on a stone foot, with a dark slit and a beacon. */
function tower() {
  const g = new THREE.Group();
  const red = std('#e8434f', { roughness: 0.4 }), white = std('#f4f1f8', { roughness: 0.4 }), stone = std('#7c7494', { roughness: 0.8 }), dark = std('#2a1c3d');
  const foot = new THREE.Mesh(new RoundedBoxGeometry(2.0, 0.5, 2.0, 3, 0.18), stone); foot.position.y = 0.25;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.85, 1.9, 20), red); body.position.y = 1.45;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.22, 20), white); band.position.y = 1.15;
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.8, 0.45, 20), red); top.position.y = 2.6;
  const slit = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.28, 0.2, 2, 0.08), dark); slit.position.set(0, 1.75, 0.72);
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshBasicMaterial({ color: '#ff2a2a' })); eye.position.set(0, 1.75, 0.82);
  const crown = new THREE.Group();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const b = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.32, 0.34, 2, 0.06), red); b.position.set(Math.cos(a) * 0.78, 2.95, Math.sin(a) * 0.78); crown.add(b); }
  const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 8), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ff9a00', emissiveIntensity: 1 })); beacon.position.y = 3.05;
  g.add(foot, body, band, top, slit, eye, crown, beacon);
  g.rotation.y = Math.PI; // slit faces the player
  return shadowed(g);
}

/** Enemy base: a wide block fortress across the lane with corner keeps, battlements and a big door. */
function fortress() {
  const g = new THREE.Group();
  const wall = std('#c43a4a', { roughness: 0.5 }), trim = std('#f4e9f2'), stone = std('#6e6688', { roughness: 0.8 }), dark = std('#2a1c3d');
  const main = new THREE.Mesh(new RoundedBoxGeometry(13.5, 2.4, 2.4, 3, 0.25), wall); main.position.y = 1.2;
  const plinth = new THREE.Mesh(new RoundedBoxGeometry(14.2, 0.5, 3.0, 3, 0.18), stone); plinth.position.y = 0.25;
  g.add(main, plinth);
  for (let i = 0; i < 12; i++) { const b = new THREE.Mesh(new RoundedBoxGeometry(0.7, 0.55, 0.7, 2, 0.1), trim); b.position.set(-6.1 + i * 1.11, 2.6, 0.85); g.add(b); }
  for (const s of [-1, 1]) {
    const keep = new THREE.Mesh(new RoundedBoxGeometry(2.4, 4.2, 2.6, 3, 0.3), wall); keep.position.set(s * 5.8, 2.1, -0.2);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.6, 4), dark); cap.position.set(s * 5.8, 5.0, -0.2); cap.rotation.y = Math.PI / 4;
    const win = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.9, 0.1, 2, 0.12), std('#ffd23f', { emissive: '#ff9a00', emissiveIntensity: 0.8 })); win.position.set(s * 5.8, 2.8, 1.12);
    g.add(keep, cap, win);
  }
  const door = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.0, 0.3, 3, 0.3), dark); door.position.set(0, 1.0, 1.15);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.4, 6), dark); pole.position.set(0, 3.6, 0);
  const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.75), new THREE.MeshStandardMaterial({ color: '#ff4655', side: THREE.DoubleSide })); flag.position.set(0.62, 4.4, 0);
  g.add(door, pole, flag);
  g.rotation.y = Math.PI;
  return shadowed(g, true);
}

class Particles {
  max = 1500; n = 0;
  pos = new Float32Array(this.max * 3); vel = new Float32Array(this.max * 3); col = new Float32Array(this.max * 3);
  life = new Float32Array(this.max); size = new Float32Array(this.max); size0 = new Float32Array(this.max); maxLife = new Float32Array(this.max);
  geo = new THREE.BufferGeometry();
  points: THREE.Points;
  constructor() {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, vertexColors: true,
      vertexShader: `attribute float size; varying vec3 vC; void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_PointSize = size*600./-mv.z; gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ vec2 p = gl_PointCoord-.5; float d = length(p); if(d>.5) discard; gl_FragColor = vec4(vC, smoothstep(.5,.2,d)); }`,
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
  update(dt: number) {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      this.life[i] -= dt; if (this.life[i] <= 0) continue;
      if (w !== i) {
        this.pos.copyWithin(w * 3, i * 3, i * 3 + 3); this.vel.copyWithin(w * 3, i * 3, i * 3 + 3); this.col.copyWithin(w * 3, i * 3, i * 3 + 3);
        this.life[w] = this.life[i]; this.maxLife[w] = this.maxLife[i]; this.size0[w] = this.size0[i];
      }
      this.vel[w * 3 + 1] -= 12 * dt;
      for (let a = 0; a < 3; a++) this.pos[w * 3 + a] += this.vel[w * 3 + a] * dt;
      if (this.pos[w * 3 + 1] < 0.05) { this.pos[w * 3 + 1] = 0.05; this.vel[w * 3 + 1] *= -0.3; }
      this.size[w] = this.size0[w] * Math.min(1, this.life[w] / this.maxLife[w] * 2);
      w++;
    }
    this.n = w;
    this.geo.setDrawRange(0, w);
    for (const k of ['position', 'color', 'size']) (this.geo.attributes[k] as THREE.BufferAttribute).needsUpdate = true;
  }
}

export { P };
