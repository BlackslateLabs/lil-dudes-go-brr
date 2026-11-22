import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
} from 'three';

/**
 * A tiny pooled particle system: camera-facing quads in one InstancedMesh per blend mode, sprites
 * from one 4 × 2 atlas (Kenney Particle Pack, CC0, plus our own coin). CPU-simulated, a few hundred
 * at most, so it costs two draw calls.
 */
export const Frame = {
  Sparkle: 0,
  Burst: 1,
  Dot: 2,
  Puff: 3,
  Cloud: 4,
  Debris: 5,
  Ring: 6,
  Coin: 7,
} as const;
export type Frame = (typeof Frame)[keyof typeof Frame];

const ATLAS_URL = '/assets/fx/particles.webp';
let atlas: Texture | null = null;
function getAtlas(): Texture {
  if (!atlas) {
    atlas = new TextureLoader().load(ATLAS_URL);
    atlas.colorSpace = SRGBColorSpace;
  }
  return atlas;
}

const vertex = /* glsl */ `
attribute vec3 iPos;
attribute vec3 iShape; // size x, size y, rotation
attribute float iFrame;
attribute vec4 iColor;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iShape.z);
  float s = sin(iShape.z);
  vec2 q = position.xy * iShape.xy;
  mv.xy += vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  gl_Position = projectionMatrix * mv;
  float col = mod(iFrame, 4.0);
  float row = floor(iFrame / 4.0);
  vUv = vec2((col + uv.x) / 4.0, (1.0 - row + uv.y) / 2.0);
  vColor = iColor;
}`;

const fragment = /* glsl */ `
uniform sampler2D uMap;
varying vec2 vUv;
varying vec4 vColor;
void main() {
  vec4 t = texture2D(uMap, vUv);
  gl_FragColor = vec4(t.rgb * vColor.rgb, t.a * vColor.a);
  if (gl_FragColor.a < 0.004) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface Spawn {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  /** Downward acceleration (units/s²). */
  gravity?: number;
  /** Velocity damping per second (0 = none). */
  drag?: number;
  life: number;
  size: number;
  /** Size multiplier at end of life (1 = constant). */
  grow?: number;
  frame: Frame;
  color?: Color;
  /** HDR boost on the colour (>1 blooms on the high tier). */
  bright?: number;
  alpha?: number;
  rot?: number;
  spin?: number;
  /** Coin-style flip: x scale follows |cos(t · flip)|. */
  flip?: number;
  /** Pop in quickly instead of starting full size. */
  popIn?: boolean;
}

interface P extends Required<Omit<Spawn, 'color'>> {
  age: number;
  r: number;
  g: number;
  b: number;
}

const WHITE = new Color('#ffffff');

class Layer {
  readonly mesh: InstancedMesh;
  private pos: InstancedBufferAttribute;
  private shape: InstancedBufferAttribute;
  private frame: InstancedBufferAttribute;
  private color: InstancedBufferAttribute;
  private live: P[] = [];

  constructor(
    readonly max: number,
    additive: boolean,
  ) {
    const geo = new PlaneGeometry(1, 1);
    this.pos = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.shape = new InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(DynamicDrawUsage);
    this.frame = new InstancedBufferAttribute(new Float32Array(max), 1).setUsage(DynamicDrawUsage);
    this.color = new InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('iPos', this.pos);
    geo.setAttribute('iShape', this.shape);
    geo.setAttribute('iFrame', this.frame);
    geo.setAttribute('iColor', this.color);
    const mat = new ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uMap: { value: getAtlas() } },
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
    });
    this.mesh = new InstancedMesh(geo, mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 31 : 30;
    this.mesh.userData.noShadow = true;
  }

  add(s: Spawn) {
    if (this.live.length >= this.max) this.live.shift();
    const c = s.color ?? WHITE;
    const k = s.bright ?? 1;
    this.live.push({
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx ?? 0,
      vy: s.vy ?? 0,
      vz: s.vz ?? 0,
      gravity: s.gravity ?? 0,
      drag: s.drag ?? 0,
      life: s.life,
      size: s.size,
      grow: s.grow ?? 1,
      frame: s.frame,
      bright: k,
      alpha: s.alpha ?? 1,
      rot: s.rot ?? Math.random() * Math.PI * 2,
      spin: s.spin ?? 0,
      flip: s.flip ?? 0,
      popIn: s.popIn ?? false,
      age: 0,
      r: c.r * k,
      g: c.g * k,
      b: c.b * k,
    });
  }

  update(dt: number) {
    const pos = this.pos.array as Float32Array;
    const shape = this.shape.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const color = this.color.array as Float32Array;
    let n = 0;
    for (let i = this.live.length - 1; i >= 0; i--) {
      const p = this.live[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        this.live[i] = this.live[this.live.length - 1]!;
        this.live.pop();
        continue;
      }
      const damp = p.drag > 0 ? Math.exp(-p.drag * dt) : 1;
      p.vx *= damp;
      p.vy = p.vy * damp - p.gravity * dt;
      p.vz *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.gravity > 0 && p.y < 0.15) {
        p.y = 0.15;
        p.vy = Math.abs(p.vy) * 0.35;
        p.vx *= 0.6;
        p.vz *= 0.6;
      }
      p.rot += p.spin * dt;
      const k = p.age / p.life;
      let size = p.size * (1 + (p.grow - 1) * k);
      if (p.popIn) size *= Math.min(1, p.age / 0.08);
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const sx = p.flip ? size * Math.max(0.15, Math.abs(Math.cos(p.age * p.flip))) : size;
      pos[n * 3] = p.x;
      pos[n * 3 + 1] = p.y;
      pos[n * 3 + 2] = p.z;
      shape[n * 3] = sx;
      shape[n * 3 + 1] = size;
      shape[n * 3 + 2] = p.rot;
      frame[n] = p.frame;
      color[n * 4] = p.r;
      color[n * 4 + 1] = p.g;
      color[n * 4 + 2] = p.b;
      color[n * 4 + 3] = p.alpha * fade;
      n++;
    }
    this.mesh.count = n;
    if (n > 0) {
      this.pos.needsUpdate = true;
      this.shape.needsUpdate = true;
      this.frame.needsUpdate = true;
      this.color.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

/** Glowing things (sparkles, rings, flashes) add; solid things (smoke, debris, coins) blend. */
export class Particles {
  readonly glow = new Layer(260, true);
  readonly solid = new Layer(260, false);

  add(s: Spawn) {
    const additive = s.frame === Frame.Sparkle || s.frame === Frame.Burst || s.frame === Frame.Ring || (s.frame === Frame.Dot && (s.bright ?? 1) > 1);
    (additive ? this.glow : this.solid).add(s);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.solid.update(dt);
  }

  dispose() {
    this.glow.dispose();
    this.solid.dispose();
  }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Ready-made bursts. Positions are world space. */
export const burst = {
  /** Gate multiply: sparkles fountain up off the top of the panel (never over its number), and a ring. */
  multiply(px: Particles, x: number, y: number, z: number, color: Color, power: number, width: number) {
    const n = Math.min(14, 4 + Math.round(power * 1.5));
    for (let i = 0; i < n; i++) {
      const side = Math.random() < 0.5 ? -1 : 1;
      px.add({ x: x + side * rand(0.3, width / 2 + 0.2), y: y + 1.2, z: z - 0.3, vx: side * rand(0.5, 3), vy: rand(4, 8), vz: rand(-0.5, 1), gravity: 12, drag: 1.5, life: rand(0.45, 0.7), size: rand(0.5, 0.9), grow: 0.3, frame: Frame.Sparkle, color, bright: 2.2, spin: rand(-4, 4) });
    }
    px.add({ x, y: y + 1.3, z: z - 0.3, life: 0.3, size: 1.2, grow: 2.2, frame: Frame.Ring, color, bright: 1.6, alpha: 0.8 });
  },
  /** Something got smaller (a ÷ gate): a red puff and a few dull sparks. */
  shrink(px: Particles, x: number, y: number, z: number) {
    const red = new Color('#ff3b4e');
    for (let i = 0; i < 4; i++) px.add({ x: x + rand(-1, 1), y: y + rand(-0.3, 0.5), z, vx: rand(-1.5, 1.5), vy: rand(0.5, 1.8), drag: 2, life: rand(0.5, 0.8), size: rand(1.2, 1.8), grow: 1.6, frame: Frame.Puff, color: red, alpha: 0.75 });
  },
  /** GOTCHA on my side: red shards, a red ring, a red cloud. */
  gotcha(px: Particles, x: number, y: number, z: number) {
    const red = new Color('#ff2a3c');
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(4, 9);
      px.add({ x, y, z, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7 + 3, vz: rand(0, 3), gravity: 14, drag: 1, life: rand(0.5, 0.9), size: rand(0.5, 0.9), frame: Frame.Sparkle, color: red, bright: 2.4, spin: rand(-8, 8) });
    }
    px.add({ x, y, z: z + 0.3, life: 0.5, size: 2, grow: 3.2, frame: Frame.Ring, color: red, bright: 2 });
    for (let i = 0; i < 5; i++) px.add({ x: x + rand(-1.5, 1.5), y: y + rand(-0.5, 0.5), z, vx: rand(-1, 1), vy: rand(0.3, 1.2), drag: 1.5, life: rand(0.7, 1.1), size: rand(1.6, 2.4), grow: 1.7, frame: Frame.Cloud, color: red, alpha: 0.7 });
  },
  /** Reveal: a ring and a few sparkles in the gate colour. */
  reveal(px: Particles, x: number, y: number, z: number, color: Color) {
    px.add({ x, y, z: z + 0.2, life: 0.45, size: 2.2, grow: 2.6, frame: Frame.Ring, color, bright: 1.8 });
    for (let i = 0; i < 6; i++) px.add({ x: x + rand(-2, 2), y: y + rand(-0.8, 1), z, vy: rand(1, 3), drag: 2, life: rand(0.4, 0.7), size: rand(0.5, 0.9), grow: 0.4, frame: Frame.Sparkle, color, bright: 2, popIn: true });
  },
  /** A hit on a tower or crate: a small dust puff and a couple of sparks. */
  hit(px: Particles, x: number, y: number, z: number, tint: Color) {
    px.add({ x: x + rand(-0.6, 0.6), y: y + rand(-0.4, 0.4), z: z + rand(0.4, 1), vx: rand(-1, 1), vy: rand(0.4, 1.4), drag: 2.5, life: rand(0.4, 0.6), size: rand(1, 1.5), grow: 1.7, frame: Frame.Puff, color: tint, alpha: 0.85 });
    for (let i = 0; i < 2; i++) px.add({ x, y, z: z + 0.8, vx: rand(-3, 3), vy: rand(1, 4), gravity: 10, life: 0.35, size: rand(0.4, 0.6), frame: Frame.Sparkle, color: WHITE, bright: 1.6 });
  },
  /** Tower down: a column of smoke, debris chunks, coins and a shockwave. */
  collapse(px: Particles, x: number, z: number, tint: Color, coins: number) {
    const grey = new Color('#f4ede6');
    for (let i = 0; i < 9; i++) px.add({ x: x + rand(-1.6, 1.6), y: rand(0.5, 3.5), z: z + rand(-1, 1.5), vx: rand(-1.2, 1.2), vy: rand(1, 3.2), drag: 1.4, life: rand(0.9, 1.5), size: rand(2.2, 3.4), grow: 1.8, frame: i % 2 ? Frame.Puff : Frame.Cloud, color: grey, alpha: 0.95, spin: rand(-0.6, 0.6) });
    for (let i = 0; i < 14; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(3, 8);
      px.add({ x, y: rand(1.5, 4), z, vx: Math.cos(a) * sp, vy: rand(4, 9), vz: Math.sin(a) * sp, gravity: 18, life: rand(0.8, 1.2), size: rand(0.6, 1.1), frame: Frame.Debris, color: tint, spin: rand(-8, 8) });
    }
    burst.coins(px, x, 3, z, coins);
    px.add({ x, y: 0.6, z, life: 0.6, size: 3, grow: 4, frame: Frame.Ring, color: WHITE, bright: 1.4, alpha: 0.8 });
  },
  /** Coins pop up and tumble down. */
  coins(px: Particles, x: number, y: number, z: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1.5, 4.5);
      px.add({ x, y, z, vx: Math.cos(a) * sp, vy: rand(6, 10), vz: Math.sin(a) * sp * 0.6 + 1.5, gravity: 20, life: rand(0.8, 1.1), size: rand(0.75, 1), frame: Frame.Coin, flip: rand(8, 14), rot: 0, popIn: true });
    }
  },
  /** Crate smashed: wood chunks and dust. */
  smash(px: Particles, x: number, z: number, width: number, tint: Color) {
    const dust = new Color('#f6e2c4');
    for (let i = 0; i < 12; i++) px.add({ x: x + rand(-width / 2, width / 2), y: rand(0.4, 1.8), z: z + rand(-0.5, 0.8), vx: rand(-4, 4), vy: rand(4, 8), vz: rand(-1, 3), gravity: 18, life: rand(0.7, 1), size: rand(0.6, 1), frame: Frame.Debris, color: tint, spin: rand(-9, 9) });
    for (let i = 0; i < 5; i++) px.add({ x: x + rand(-width / 2, width / 2), y: rand(0.3, 1.2), z: z + 0.5, vx: rand(-1, 1), vy: rand(0.4, 1.3), drag: 2, life: rand(0.6, 0.9), size: rand(1.6, 2.4), grow: 1.6, frame: Frame.Puff, color: dust, alpha: 0.9 });
  },
  /** Clash between dudes and troops: a small white poof. */
  poof(px: Particles, x: number, z: number) {
    px.add({ x: x + rand(-0.3, 0.3), y: 0.6, z: z + rand(-0.3, 0.3), vy: rand(0.6, 1.4), drag: 2, life: rand(0.35, 0.5), size: rand(0.9, 1.3), grow: 1.7, frame: Frame.Puff, color: WHITE, alpha: 0.9 });
    px.add({ x, y: 0.7, z, life: 0.18, size: 1.1, grow: 1.6, frame: Frame.Burst, color: WHITE, bright: 1.3, alpha: 0.7 });
  },
  /** Muzzle puff when the cannon fires. */
  muzzle(px: Particles, x: number, y: number, z: number) {
    px.add({ x, y, z, vy: 1.2, vz: -1.5, drag: 3, life: 0.4, size: 1.2, grow: 2, frame: Frame.Puff, color: WHITE, alpha: 0.8 });
    px.add({ x, y, z, life: 0.12, size: 1.6, grow: 1.2, frame: Frame.Burst, color: new Color('#fff2b0'), bright: 1.6 });
  },
  /** Overrun: a big red cloud along the cannon line. */
  overrun(px: Particles, x: number, z: number) {
    const red = new Color('#ff5866');
    for (let i = 0; i < 12; i++) px.add({ x: x + rand(-6, 6), y: rand(0.4, 2.4), z: z + rand(-1, 1), vx: rand(-1, 1), vy: rand(0.6, 2.2), drag: 1.2, life: rand(1, 1.5), size: rand(2.4, 3.6), grow: 1.8, frame: Frame.Cloud, color: red, alpha: 0.85 });
  },
};
