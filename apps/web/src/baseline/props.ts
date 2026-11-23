// Our own prop kit for the beach arena, built to the genre's look: chunky bevelled shapes, matcap
// plastic, saturated team colours. Palms use a cut-out frond texture so their shadows read as leaves.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type Mk = (color: string) => THREE.Material;

function tex(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
export function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// ---------- ground ----------
export function sandTexture() {
  const r = rng(11);
  const t = tex(512, 2048, (g) => {
    g.fillStyle = '#ffdb94'; g.fillRect(0, 0, 512, 2048);
    for (let i = 0; i < 90; i++) { // dune patches, light and dark
      const x = r() * 512, y = r() * 2048, rx = 60 + r() * 160, ry = 30 + r() * 80, light = r() > 0.5;
      const s = g.createRadialGradient(x, y, 0, x, y, rx);
      s.addColorStop(0, light ? 'rgba(255,236,185,0.6)' : 'rgba(236,186,110,0.28)'); s.addColorStop(1, 'rgba(0,0,0,0)');
      g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y); g.fillStyle = s; g.fillRect(x - rx, y - rx, rx * 2, rx * 2); g.restore();
    }
    g.strokeStyle = 'rgba(214,160,92,0.22)'; g.lineWidth = 3; // wind ripples
    for (let i = 0; i < 160; i++) { const x = r() * 512, y = r() * 2048, w = 20 + r() * 50; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y - 6, x + w, y); g.stroke(); }
    for (let i = 0; i < 4000; i++) { g.fillStyle = r() > 0.5 ? 'rgba(190,130,70,0.22)' : 'rgba(255,245,220,0.4)'; g.fillRect(r() * 512, r() * 2048, 2, 2); }
    const peb = ['#ff6b5e', '#ffd23f', '#8f6bff', '#3fb8ff', '#ff9ad0'];
    for (let i = 0; i < 26; i++) { g.fillStyle = peb[i % 5]!; g.beginPath(); g.ellipse(r() * 512, r() * 2048, 3 + r() * 2, 2 + r() * 1.5, r() * 3, 0, 7); g.fill(); }
  });
  return t;
}

export function waterMaterial(time: { value: number }) {
  const m = new THREE.MeshStandardMaterial({ color: '#41d6e8', roughness: 0.2, metalness: 0, emissive: '#1aa6c8', emissiveIntensity: 0.35 });
  m.onBeforeCompile = (s) => {
    s.uniforms.uTime = time;
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec2 wp = vUv * vec2(3.0, 40.0);
        float w = sin(wp.x * 3.1 + uTime * 1.3 + sin(wp.y * 0.9)) * sin(wp.y * 1.7 - uTime * 0.8);
        totalEmissiveRadiance += vec3(0.35, 0.45, 0.5) * smoothstep(0.55, 0.95, w);`);
    s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv = uv;');
    s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv;');
  };
  return m;
}

// ---------- palms ----------
let frondTex: THREE.Texture | null = null;
function frond() {
  return (frondTex ??= tex(128, 512, (g) => {
    g.clearRect(0, 0, 128, 512);
    g.fillStyle = '#3cb44a'; g.strokeStyle = '#2b8a3a'; g.lineWidth = 6;
    g.beginPath(); g.moveTo(64, 0); g.lineTo(64, 512); g.stroke();
    for (let y = 20; y < 500; y += 22) { // leaflets
      const w = 58 * Math.sin((y / 512) * Math.PI) + 6;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + s * w * 0.7, y + 4, 64 + s * w, y + 30); g.lineTo(64 + s * w * 0.8, y + 34); g.quadraticCurveTo(64 + s * w * 0.4, y + 18, 64, y + 14); g.fill(); }
    }
  }));
}

export function palm(r: () => number, mk: Mk) {
  const g = new THREE.Group();
  const trunkM = mk('#c48a52'), ringM = mk('#a8703e');
  const h = 3.2 + r() * 1.6, segs = 8, lean = (r() - 0.5) * 0.9;
  let x = 0, y = 0;
  for (let i = 0; i < segs; i++) {
    const rad = 0.2 - i * 0.012;
    const s = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad + 0.03, h / segs + 0.02, 8), i % 2 ? ringM : trunkM);
    const t = i / segs; x = lean * t * t * 1.6; s.position.set(x, y + h / segs / 2, 0); s.rotation.z = -lean * t * 0.9; g.add(s); y += h / segs;
  }
  const leafM = new THREE.MeshStandardMaterial({ map: frond(), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.7, color: '#ffffff' });
  const n = 8;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r() * 0.4, len = 2.2 + r() * 0.6;
    const geo = new THREE.PlaneGeometry(0.9, len, 1, 6);
    const pos = geo.attributes.position!;
    for (let v = 0; v < pos.count; v++) { // arch the frond: up first, then drooping
      const py = pos.getY(v) / len + 0.5; pos.setZ(v, Math.sin(py * Math.PI) * 0.5 - py * py * 1.1); pos.setY(v, py * len);
    }
    geo.computeVertexNormals();
    const leaf = new THREE.Mesh(geo, leafM);
    leaf.rotation.order = 'YXZ'; leaf.rotation.y = a; leaf.rotation.x = -Math.PI / 2 + 0.35;
    leaf.position.set(x, y, 0); g.add(leaf);
  }
  const nuts = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), mk('#6b4a2a')); nuts.position.set(x, y - 0.12, 0); g.add(nuts);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  return g;
}

export function rock(r: () => number, mk: Mk, s = 1) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 * s, 1), mk(r() > 0.5 ? '#a99bc4' : '#b9a98f'));
  const p = m.geometry.attributes.position!;
  for (let i = 0; i < p.count; i++) { const k = 0.85 + r() * 0.3; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k); }
  m.geometry.computeVertexNormals();
  m.scale.set(1 + r() * 0.5, 0.65 + r() * 0.35, 1 + r() * 0.4); m.rotation.y = r() * 6; m.castShadow = true; m.receiveShadow = true;
  return m;
}

// ---------- gate row rail ----------
export function gateRail(mk: Mk, half = 6.6) {
  const g = new THREE.Group();
  const bar = new THREE.Mesh(new RoundedBoxGeometry(half * 2, 0.26, 0.55, 2, 0.1), mk('#1f2b66')); bar.position.y = 0.13; g.add(bar);
  const lip = new THREE.Mesh(new RoundedBoxGeometry(half * 2, 0.06, 0.6, 2, 0.03), mk('#3f6fe0')); lip.position.y = 0.27; g.add(lip);
  for (const s of [-1, 1]) {
    const post = new THREE.Mesh(new RoundedBoxGeometry(1.2, 1.3, 1.3, 3, 0.2), mk('#2f8dff')); post.position.set(s * (half + 0.55), 0.65, 0);
    const top = new THREE.Mesh(new RoundedBoxGeometry(1.26, 0.22, 1.36, 2, 0.1), mk('#7fd0ff')); top.position.set(s * (half + 0.55), 1.3, 0);
    const face = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.7, 0.05, 2, 0.08), mk('#16205a')); face.position.set(s * (half + 0.55), 0.7, 0.66);
    g.add(post, top, face);
  }
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function spikeBlock(mk: Mk, s: number) {
  const geo = new THREE.ConeGeometry(s * 0.72, s * 0.95, 4, 1); geo.rotateY(Math.PI / 4 + Math.PI / 4);
  const m = new THREE.Mesh(geo, mk('#e7b878')); m.position.y = s * 0.475; m.castShadow = true; m.receiveShadow = true;
  const g = new THREE.Group(); g.add(m);
  const base = new THREE.Mesh(new RoundedBoxGeometry(s * 1.02, 0.12, s * 1.02, 2, 0.05), mk('#d29d5c')); base.rotation.y = Math.PI / 4; base.position.y = 0.06; g.add(base);
  return g;
}

// ---------- cannon ----------
export function cannonMech(mk: Mk, glass: THREE.Material) {
  const c = new THREE.Group(), barrel = new THREE.Group();
  const frame = mk('#4c5371'), frameL = mk('#7a82a0'), tire = mk('#1d1f29'), hub = mk('#c9d0e0'), accent = mk('#2f8dff');
  const deck = new THREE.Mesh(new RoundedBoxGeometry(1.7, 0.45, 1.9, 3, 0.16), frame); deck.position.y = 0.62; c.add(deck);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(1.5, 0.12, 1.7, 2, 0.05), frameL); plate.position.y = 0.88; c.add(plate);
  for (const [x, z] of [[-0.92, 0.62], [0.92, 0.62], [-0.92, -0.62], [0.92, -0.62]] as const) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.46, 20), tire); w.rotation.z = Math.PI / 2; w.position.set(x, 0.46, z); c.add(w);
    const tread = new THREE.Mesh(new THREE.TorusGeometry(0.44, 0.06, 6, 20), tire); tread.rotation.y = Math.PI / 2; tread.position.set(x, 0.46, z); c.add(tread);
    const h = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12), hub); h.rotation.z = Math.PI / 2; h.position.set(x * 1.03, 0.46, z); c.add(h);
  }
  for (const s of [-1, 1]) { // twin glass-dome barrels
    const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.4, 0.5, 16), frameL); housing.position.set(s * 0.38, 1.12, 0.1);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 18, 14), glass); dome.position.set(s * 0.38, 1.32, 0.05); dome.scale.set(1, 0.95, 1.15);
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.8, 14), frame); tube.rotation.x = Math.PI / 2; tube.position.set(s * 0.38, 1.2, -0.55);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.06, 8, 16), accent); ring.position.set(s * 0.38, 1.2, -0.95);
    barrel.add(housing, dome, tube, ring);
  }
  c.add(barrel);
  c.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = true; });
  return { root: c, barrel };
}

// ---------- enemy tower ----------
export function robotTower(mk: Mk) {
  const g = new THREE.Group();
  const metal = mk('#c3c9da'), metalD = mk('#8a90a6'), red = mk('#ff3b4e'), redD = mk('#c8192e'), black = mk('#1a1c26');
  const foot = new THREE.Mesh(new RoundedBoxGeometry(1.9, 0.5, 1.9, 3, 0.18), metalD); foot.position.y = 0.25;
  const body = new THREE.Mesh(new RoundedBoxGeometry(1.5, 2.0, 1.5, 4, 0.3), metal); body.position.y = 1.5;
  const band = new THREE.Mesh(new RoundedBoxGeometry(1.58, 0.42, 1.58, 3, 0.12), red); band.position.y = 0.78;
  const plate = new THREE.Mesh(new RoundedBoxGeometry(1.0, 0.34, 0.06, 2, 0.06), black); plate.position.set(0, 0.78, 0.8);
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.78, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), red); cap.position.y = 2.48;
  const capRim = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.82, 0.16, 20), redD); capRim.position.y = 2.5;
  const vents = [-1, 1].map((s) => {
    const v = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.42, 0.12, 2, 0.08), black); v.position.set(s * 0.32, 1.85, 0.76);
    const slat = new THREE.Mesh(new RoundedBoxGeometry(0.34, 0.06, 0.04, 1, 0.02), metalD); slat.position.set(s * 0.32, 1.85, 0.83);
    return [v, slat];
  }).flat();
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.6, 6), black); ant.position.set(0.5, 2.9, 0);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshStandardMaterial({ color: '#ff5a5a', emissive: '#ff2020', emissiveIntensity: 2 })); tip.position.set(0.5, 3.22, 0);
  g.add(foot, body, band, plate, cap, capRim, ...vents, ant, tip);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

// ---------- enemy base: armoured mech fortress ----------
export function mechFortress(mk: Mk) {
  const g = new THREE.Group();
  const red = mk('#ff3b4e'), redD = mk('#c41a30'), metal = mk('#8d93a8'), metalD = mk('#4d5168'), black = mk('#1a1c26');
  const back = new THREE.Mesh(new RoundedBoxGeometry(15, 2.2, 2.6, 3, 0.3), metalD); back.position.set(0, 1.1, -1.4);
  g.add(back);
  for (const s of [-1, 1]) { // angled armour wings
    const wing = new THREE.Mesh(new RoundedBoxGeometry(5.4, 2.4, 1.0, 3, 0.3), red); wing.position.set(s * 4.6, 1.5, 0.2); wing.rotation.y = s * 0.18;
    const trim = new THREE.Mesh(new RoundedBoxGeometry(5.5, 0.3, 1.06, 2, 0.12), redD); trim.position.set(s * 4.6, 2.65, 0.2); trim.rotation.y = s * 0.18;
    const bolt = [0, 1, 2].map((k) => { const b = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), metal); b.position.set(s * (2.6 + k * 1.7), 1.6, 0.75 + (s > 0 ? -k : -k) * 0.0); return b; });
    const tower = new THREE.Mesh(new RoundedBoxGeometry(1.6, 3.6, 1.8, 3, 0.3), redD); tower.position.set(s * 6.6, 1.8, -0.6);
    g.add(wing, trim, ...bolt, tower);
  }
  const core = new THREE.Mesh(new RoundedBoxGeometry(3.6, 2.8, 1.4, 4, 0.35), metal); core.position.set(0, 1.4, 0.3);
  const door = new THREE.Mesh(new RoundedBoxGeometry(2.6, 2.0, 0.2, 3, 0.25), metalD); door.position.set(0, 1.25, 1.0);
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.2, 6), red); hex.rotation.x = Math.PI / 2; hex.position.set(0, 1.45, 1.12);
  const hexG = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.24, 6), new THREE.MeshStandardMaterial({ color: '#ff7a7a', emissive: '#ff2030', emissiveIntensity: 1.6 })); hexG.rotation.x = Math.PI / 2; hexG.position.set(0, 1.45, 1.16);
  const brow = new THREE.Mesh(new RoundedBoxGeometry(4.2, 0.5, 1.6, 3, 0.2), red); brow.position.set(0, 2.9, 0.3);
  const lights = [-1, 1].map((s) => { const l = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.3, 0.1, 2, 0.06), new THREE.MeshStandardMaterial({ color: '#ffd23f', emissive: '#ff9a00', emissiveIntensity: 1.5 })); l.position.set(s * 1.2, 2.9, 1.12); return l; });
  const grille = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.18, 0.1, 1, 0.04), black); grille.position.set(0, 0.45, 1.12);
  g.add(core, door, hex, hexG, brow, ...lights, grille);
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
