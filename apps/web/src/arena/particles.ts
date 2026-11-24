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
 * from one 4 × 2 atlas (Kenney Particle Pack, CC0, plus our own coin). CPU-simulated in flat typed
 * arrays (no object per particle; a full layer recycles its slots), up to 900 per layer, two draw
 * calls. Crowd pops use the positional `emit` and the `pop` bursts, which allocate nothing.
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

const WHITE = new Color('#ffffff');

/** Per-particle fields, structure-of-arrays (no object per particle, no allocation per spawn). */
const F = {
  x: 0, y: 1, z: 2, vx: 3, vy: 4, vz: 5, gravity: 6, drag: 7, life: 8, size: 9, grow: 10,
  frame: 11, alpha: 12, rot: 13, spin: 14, flip: 15, popIn: 16, age: 17, r: 18, g: 19, b: 20,
} as const;
const STRIDE = 21;

class Layer {
  readonly mesh: InstancedMesh;
  private pos: InstancedBufferAttribute;
  private shape: InstancedBufferAttribute;
  private frame: InstancedBufferAttribute;
  private color: InstancedBufferAttribute;
  private p: Float32Array;
  private n = 0;
  /** Where the next spawn goes once full (the oldest-ish slot is overwritten, round robin). */
  private steal = 0;

  constructor(
    readonly max: number,
    additive: boolean,
  ) {
    const geo = new PlaneGeometry(1, 1);
    this.p = new Float32Array(max * STRIDE);
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

  get live() {
    return this.n;
  }

  /** Spawn one particle (positional: the hot path for crowd pops allocates nothing). */
  emit(
    frame: Frame, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    gravity: number, drag: number, life: number, size: number, grow: number,
    r: number, g: number, b: number, alpha: number, rot: number, spin: number, flip: number, popIn: boolean,
  ) {
    let i: number;
    if (this.n < this.max) i = this.n++;
    else {
      i = this.steal;
      this.steal = (this.steal + 1) % this.max;
    }
    const p = this.p;
    const o = i * STRIDE;
    p[o + F.x] = x;
    p[o + F.y] = y;
    p[o + F.z] = z;
    p[o + F.vx] = vx;
    p[o + F.vy] = vy;
    p[o + F.vz] = vz;
    p[o + F.gravity] = gravity;
    p[o + F.drag] = drag;
    p[o + F.life] = life;
    p[o + F.size] = size;
    p[o + F.grow] = grow;
    p[o + F.frame] = frame;
    p[o + F.alpha] = alpha;
    p[o + F.rot] = rot;
    p[o + F.spin] = spin;
    p[o + F.flip] = flip;
    p[o + F.popIn] = popIn ? 1 : 0;
    p[o + F.age] = 0;
    p[o + F.r] = r;
    p[o + F.g] = g;
    p[o + F.b] = b;
  }

  update(dt: number) {
    const pos = this.pos.array as Float32Array;
    const shape = this.shape.array as Float32Array;
    const frame = this.frame.array as Float32Array;
    const color = this.color.array as Float32Array;
    const p = this.p;
    let i = 0;
    while (i < this.n) {
      const o = i * STRIDE;
      const age = (p[o + F.age]! += dt);
      const life = p[o + F.life]!;
      if (age >= life) {
        // Swap-remove: the last live particle takes this slot.
        const last = --this.n;
        if (i !== last) p.copyWithin(o, last * STRIDE, last * STRIDE + STRIDE);
        continue;
      }
      const drag = p[o + F.drag]!;
      const gravity = p[o + F.gravity]!;
      const damp = drag > 0 ? Math.exp(-drag * dt) : 1;
      let vx = p[o + F.vx]! * damp;
      let vy = p[o + F.vy]! * damp - gravity * dt;
      let vz = p[o + F.vz]! * damp;
      let x = p[o + F.x]! + vx * dt;
      let y = p[o + F.y]! + vy * dt;
      const z = p[o + F.z]! + vz * dt;
      if (gravity > 0 && y < 0.15) {
        y = 0.15;
        vy = Math.abs(vy) * 0.35;
        vx *= 0.6;
        vz *= 0.6;
      }
      p[o + F.vx] = vx;
      p[o + F.vy] = vy;
      p[o + F.vz] = vz;
      p[o + F.x] = x;
      p[o + F.y] = y;
      p[o + F.z] = z;
      const rot = (p[o + F.rot]! += p[o + F.spin]! * dt);
      const k = age / life;
      let size = p[o + F.size]! * (1 + (p[o + F.grow]! - 1) * k);
      if (p[o + F.popIn]) size *= Math.min(1, age / 0.08);
      const fade = k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4;
      const flip = p[o + F.flip]!;
      const sx = flip ? size * Math.max(0.15, Math.abs(Math.cos(age * flip))) : size;
      pos[i * 3] = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      shape[i * 3] = sx;
      shape[i * 3 + 1] = size;
      shape[i * 3 + 2] = rot;
      frame[i] = p[o + F.frame]!;
      color[i * 4] = p[o + F.r]!;
      color[i * 4 + 1] = p[o + F.g]!;
      color[i * 4 + 2] = p[o + F.b]!;
      color[i * 4 + 3] = p[o + F.alpha]! * fade;
      i++;
    }
    if (this.steal >= this.n) this.steal = 0;
    this.mesh.count = this.n;
    if (this.n > 0) {
      upload(this.pos, this.n);
      upload(this.shape, this.n);
      upload(this.frame, this.n);
      upload(this.color, this.n);
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as ShaderMaterial).dispose();
  }
}

function upload(a: InstancedBufferAttribute, n: number) {
  a.clearUpdateRanges();
  a.addUpdateRange(0, n * a.itemSize);
  a.needsUpdate = true;
}

const isGlow = (frame: Frame, bright: number) =>
  frame === Frame.Sparkle || frame === Frame.Burst || frame === Frame.Ring || (frame === Frame.Dot && bright > 1);

/** Glowing things (sparkles, rings, flashes) add; solid things (smoke, debris, coins) blend. */
export class Particles {
  readonly glow = new Layer(900, true);
  readonly solid = new Layer(900, false);

  add(s: Spawn) {
    const c = s.color ?? WHITE;
    const k = s.bright ?? 1;
    this.emit(s.frame, s.x, s.y, s.z, s.vx ?? 0, s.vy ?? 0, s.vz ?? 0, s.gravity ?? 0, s.drag ?? 0, s.life, s.size, s.grow ?? 1,
      c.r * k, c.g * k, c.b * k, s.alpha ?? 1, s.rot ?? Math.random() * Math.PI * 2, s.spin ?? 0, s.flip ?? 0, s.popIn ?? false, k);
  }

  /** `add` without the options object (r, g, b already include any HDR boost; `bright` picks the layer for dots). */
  emit(
    frame: Frame, x: number, y: number, z: number, vx: number, vy: number, vz: number,
    gravity: number, drag: number, life: number, size: number, grow: number,
    r: number, g: number, b: number, alpha: number, rot: number, spin: number, flip: number, popIn: boolean, bright = 1,
  ) {
    (isGlow(frame, bright) ? this.glow : this.solid).emit(frame, x, y, z, vx, vy, vz, gravity, drag, life, size, grow, r, g, b, alpha, rot, spin, flip, popIn);
  }

  /** Live particles in both layers. */
  get live() {
    return this.glow.live + this.solid.live;
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

const RED = new Color('#ff3b4e');
const GREY = new Color('#f4ede6');
const DUST = new Color('#f6e2c4');
const OVERRUN_RED = new Color('#ff5866');
const MUZZLE = new Color('#fff2b0');
const WOOD = new Color('#8a3417');
const WOOD_LIGHT = new Color('#f08a4b');

// Pop colours, linear RGB (the shader multiplies the atlas by them).
const STAR = new Color('#ffd84a');
const PUFF = new Color('#fffaf0');
const GATE_DUST = new Color('#e9dfd2');

/**
 * Crowd pops (Fx.tsx drains popQueue.ts into these): small, cheap bursts at a dude's feet, world
 * x / z. `k` ≥ 1 when one burst stands for k pops (a big crowd at once): it grows a little.
 */
export const pop = {
  /** Popped against a tower (or the hall in the Rush: `coin` adds a tiny coin glint). */
  tower(px: Particles, x: number, z: number, k: number, coin: boolean) {
    const g = 1 + 0.12 * (k - 1);
    px.solid.emit(Frame.Puff, x + rand(-0.2, 0.2), rand(0.6, 1.1), z + rand(-0.2, 0.2), rand(-0.6, 0.6), rand(0.8, 1.6), rand(-0.3, 0.6), 0, 3, rand(0.3, 0.4), 0.85 * g, 1.6, PUFF.r, PUFF.g, PUFF.b, 0.95, rand(0, 6.28), 0, 0, true);
    px.glow.emit(Frame.Burst, x, 1, z + 0.2, 0, 0, 0, 0, 0, 0.12, 1.1 * g, 1.4, 1.6, 1.5, 1.2, 0.8, rand(0, 6.28), 0, 0, false);
    const stars = k > 1 ? 3 : 2 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < stars; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1.6, 3.6);
      // Stars blend normally (not additive), so they read on the light lane too.
      px.solid.emit(Frame.Sparkle, x, rand(0.9, 1.4), z, Math.cos(a) * sp, rand(3, 5.5), Math.sin(a) * sp * 0.6 + 0.6, 10, 1, rand(0.38, 0.52), rand(0.7, 0.95) * g, 0.45, STAR.r * 1.3, STAR.g * 1.3, STAR.b * 1.3, 1, rand(0, 6.28), rand(-6, 6), 0, true);
    }
    if (coin) px.solid.emit(Frame.Coin, x, 1.2, z, rand(-1.2, 1.2), rand(3.5, 5.5), rand(0, 1.2), 16, 0, rand(0.45, 0.6), 0.5 * g, 1, 1, 1, 1, 1, 0, 0, rand(10, 15), true);
  },
  /** Popped on a clash front: a puff in the team colour (`team`, linear RGB) and white stars. */
  clash(px: Particles, x: number, z: number, k: number, team: Color) {
    const g = 1 + 0.12 * (k - 1);
    px.solid.emit(Frame.Puff, x + rand(-0.15, 0.15), rand(0.5, 0.9), z + rand(-0.15, 0.15), rand(-0.5, 0.5), rand(0.6, 1.4), rand(-0.4, 0.4), 0, 3, rand(0.3, 0.42), 0.8 * g, 1.6, team.r * 1.1, team.g * 1.1, team.b * 1.1, 0.95, rand(0, 6.28), 0, 0, true);
    const stars = k > 1 ? 3 : 2;
    for (let i = 0; i < stars; i++) {
      const a = rand(0, Math.PI * 2);
      const sp = rand(1.5, 3.2);
      px.solid.emit(Frame.Sparkle, x, rand(0.8, 1.2), z, Math.cos(a) * sp, rand(2.4, 4.4), Math.sin(a) * sp * 0.6, 9, 1, rand(0.32, 0.45), rand(0.6, 0.8) * g, 0.45, 1.3, 1.3, 1.3, 1, rand(0, 6.28), rand(-6, 6), 0, true);
    }
  },
  /** Popped against a crate or block: wood chips and a dust puff. */
  crate(px: Particles, x: number, z: number, k: number) {
    const g = 1 + 0.12 * (k - 1);
    for (let i = 0; i < 2; i++) {
      const c = i ? WOOD_LIGHT : WOOD;
      px.solid.emit(Frame.Debris, x + rand(-0.3, 0.3), rand(0.6, 1.2), z + rand(-0.2, 0.2), rand(-2.5, 2.5), rand(3, 5.5), rand(-0.5, 2), 16, 0, rand(0.5, 0.7), rand(0.75, 1) * g, 1, c.r, c.g, c.b, 1, rand(0, 6.28), rand(-10, 10), 0, false);
    }
    px.solid.emit(Frame.Puff, x + rand(-0.2, 0.2), rand(0.4, 0.8), z + 0.2, rand(-0.6, 0.6), rand(0.4, 1.1), 0, 0, 2.5, rand(0.35, 0.5), 0.8 * g, 1.6, DUST.r, DUST.g, DUST.b, 0.8, rand(0, 6.28), 0, 0, true);
  },
  /** Lost to a bad gate (or anything else): a small dust puff. */
  dust(px: Particles, x: number, z: number, k: number) {
    const g = 1 + 0.12 * (k - 1);
    px.solid.emit(Frame.Puff, x + rand(-0.2, 0.2), rand(0.35, 0.7), z + rand(-0.2, 0.2), rand(-0.5, 0.5), rand(0.4, 1), rand(-0.3, 0.3), 0, 2.5, rand(0.3, 0.42), 0.6 * g, 1.5, GATE_DUST.r, GATE_DUST.g, GATE_DUST.b, 0.6, rand(0, 6.28), 0, 0, true);
  },
};

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
    for (let i = 0; i < 4; i++) px.add({ x: x + rand(-1, 1), y: y + rand(-0.3, 0.5), z, vx: rand(-1.5, 1.5), vy: rand(0.5, 1.8), drag: 2, life: rand(0.5, 0.8), size: rand(1.2, 1.8), grow: 1.6, frame: Frame.Puff, color: RED, alpha: 0.75 });
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
    const grey = GREY;
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
  /** Crate smashed: a big break, wood chunks flying, a dust cloud and a shock ring. */
  smash(px: Particles, x: number, z: number, width: number, tint: Color) {
    const dust = DUST;
    for (let i = 0; i < 22; i++) px.add({ x: x + rand(-width / 2, width / 2), y: rand(0.4, 1.8), z: z + rand(-0.5, 0.8), vx: rand(-5, 5), vy: rand(4.5, 10), vz: rand(-1, 4), gravity: 18, life: rand(0.75, 1.1), size: rand(0.6, 1.2), frame: Frame.Debris, color: i % 3 ? tint : WOOD_LIGHT, spin: rand(-9, 9) });
    for (let i = 0; i < 8; i++) px.add({ x: x + rand(-width / 2, width / 2), y: rand(0.3, 1.4), z: z + 0.5, vx: rand(-1.5, 1.5), vy: rand(0.5, 1.6), drag: 2, life: rand(0.7, 1.05), size: rand(1.8, 2.8), grow: 1.7, frame: i % 2 ? Frame.Puff : Frame.Cloud, color: dust, alpha: 0.9 });
    for (let i = 0; i < 6; i++) px.add({ x: x + rand(-width / 2, width / 2), y: rand(0.8, 1.6), z: z + 0.6, vx: rand(-3, 3), vy: rand(2, 5), gravity: 8, life: rand(0.35, 0.5), size: rand(0.5, 0.8), frame: Frame.Sparkle, color: WHITE, bright: 1.8 });
    px.add({ x, y: 0.5, z, life: 0.45, size: Math.max(2.5, width * 0.8), grow: 2.4, frame: Frame.Ring, color: WHITE, bright: 1.3, alpha: 0.7 });
  },
  /** A hit on a crate or block: wood chips and a dust puff. */
  chip(px: Particles, x: number, y: number, z: number, width: number) {
    for (let i = 0; i < 4; i++) px.add({ x: x + rand(-width / 3, width / 3), y: y + rand(-0.2, 0.4), z: z + rand(0.3, 0.9), vx: rand(-2.5, 2.5), vy: rand(3, 6), vz: rand(0, 2), gravity: 16, life: rand(0.5, 0.7), size: rand(0.7, 1), frame: Frame.Debris, color: i % 2 ? WOOD : WOOD_LIGHT, spin: rand(-10, 10) });
    px.add({ x: x + rand(-0.5, 0.5), y: y + rand(-0.3, 0.2), z: z + rand(0.4, 1), vx: rand(-1, 1), vy: rand(0.4, 1.2), drag: 2.5, life: rand(0.4, 0.6), size: rand(1.1, 1.6), grow: 1.7, frame: Frame.Puff, color: DUST, alpha: 0.85 });
  },
  /** Clash between dudes and troops: a small white poof. */
  poof(px: Particles, x: number, z: number) {
    px.add({ x: x + rand(-0.3, 0.3), y: 0.6, z: z + rand(-0.3, 0.3), vy: rand(0.6, 1.4), drag: 2, life: rand(0.35, 0.5), size: rand(0.9, 1.3), grow: 1.7, frame: Frame.Puff, color: WHITE, alpha: 0.9 });
    px.add({ x, y: 0.7, z, life: 0.18, size: 1.1, grow: 1.6, frame: Frame.Burst, color: WHITE, bright: 1.3, alpha: 0.7 });
  },
  /** Muzzle puff when the cannon fires. */
  muzzle(px: Particles, x: number, y: number, z: number) {
    px.add({ x, y, z, vy: 1.2, vz: -1.5, drag: 3, life: 0.4, size: 1.2, grow: 2, frame: Frame.Puff, color: WHITE, alpha: 0.8 });
    px.add({ x, y, z, life: 0.12, size: 1.6, grow: 1.2, frame: Frame.Burst, color: MUZZLE, bright: 1.6 });
  },
  /** Overrun: a big red cloud along the cannon line. */
  overrun(px: Particles, x: number, z: number) {
    const red = OVERRUN_RED;
    for (let i = 0; i < 12; i++) px.add({ x: x + rand(-6, 6), y: rand(0.4, 2.4), z: z + rand(-1, 1), vx: rand(-1, 1), vy: rand(0.6, 2.2), drag: 1.2, life: rand(1, 1.5), size: rand(2.4, 3.6), grow: 1.8, frame: Frame.Cloud, color: red, alpha: 0.85 });
  },
};
