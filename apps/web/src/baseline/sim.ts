// Baseline crowd sim (client only, for look and feel). Units are agents with real positions, so the crowd
// flows around rails, piles on blocks and clashes body to body. Numbers come from the reference teardown.
import { LANE, type Layout } from './layouts';

export const P = {
  speed: 2.7, // u/s cruise (reference 2.5–2.9)
  boost: 9, // u/s at the muzzle, easing to cruise
  boostTime: 0.3,
  fireInterval: 0.24, // s between shots (reference base cannon 0.38)
  perShot: 1,
  radius: 0.22, // body radius for spacing
  clashR: 0.5,
  waveFirst: 3,
  waveGap: 6.5,
  waveSize: 8,
  waveGrow: 3,
  towerHp: 150,
  baseHp: 400,
  cannonHp: 25,
  champTime: 8, // seconds of firing to charge the champion
  champValue: 8,
};

export type Fx =
  | { k: 'poof'; x: number; z: number; team: number }
  | { k: 'gate'; i: number; x: number; z: number }
  | { k: 'hit'; x: number; z: number; target: number }
  | { k: 'block'; i: number; x: number; z: number; broke: boolean }
  | { k: 'wave'; tower: number }
  | { k: 'shot' }
  | { k: 'down'; target: number }; // target: 0,1 towers, 2 base, 3 cannon

export const CAP = 3000;

export class Sim {
  n = 0;
  x = new Float32Array(CAP); z = new Float32Array(CAP);
  vx = new Float32Array(CAP); vz = new Float32Array(CAP);
  team = new Uint8Array(CAP); hp = new Uint8Array(CAP); big = new Uint8Array(CAP);
  mask = new Uint32Array(CAP); age = new Float32Array(CAP); fresh = new Float32Array(CAP);
  phase = new Float32Array(CAP); steer = new Float32Array(CAP);
  gates: { x: number; z: number; w: number; mul: number; vx: number; min: number; max: number }[] = [];
  blocks: { x: number; z: number; size: number; hp: number; max: number }[] = [];
  walls: { x0: number; x1: number; z0: number; z1: number }[] = [];
  towers = [0, 1].map((i) => ({ x: i ? LANE.towerX : -LANE.towerX, z: LANE.towerZ, hp: P.towerHp, max: P.towerHp, r: 0.9, pulse: 0 }));
  base = { hp: P.baseHp, max: P.baseHp };
  cannon = { x: 0, target: 0, hp: P.cannonHp, firing: false, cool: 0, recoil: 0 };
  champ = 0; // 0..1 meter
  t = 0; nextWave = P.waveFirst; wave = 0;
  over: 0 | 1 | 2 = 0; // 1 win, 2 lose
  fx: Fx[] = [];
  private head = new Int32Array(28 * 64); private next = new Int32Array(CAP);

  constructor(public layout: Layout) {
    this.gates = layout.gates.map((g) => ({ x: g.x, z: g.z, w: g.w, mul: g.mul, vx: g.slide?.speed ?? 0, min: g.slide?.min ?? g.x, max: g.slide?.max ?? g.x }));
    this.blocks = layout.blocks.map((b) => ({ ...b, max: b.hp }));
    this.walls = layout.walls.map((w) => ({ x0: w.x - w.w / 2, x1: w.x + w.w / 2, z0: w.z - w.d / 2, z1: w.z + w.d / 2 }));
    for (const t of this.towers) { t.hp = P.towerHp; t.max = P.towerHp; }
    this.base = { hp: P.baseHp, max: P.baseHp };
    this.cannon.hp = P.cannonHp;
  }

  spawn(team: number, x: number, z: number, vz: number, mask: number, big = 0): number {
    if (this.n >= CAP) return -1;
    const i = this.n++;
    this.x[i] = x; this.z[i] = z; this.vx[i] = 0; this.vz[i] = vz;
    this.team[i] = team; this.big[i] = big; this.hp[i] = big ? P.champValue : 1;
    this.mask[i] = mask; this.steer[i] = 0; this.age[i] = 0; this.fresh[i] = 0; this.phase[i] = Math.random() * 6.283;
    return i;
  }

  private kill(i: number) { this.hp[i] = 0; }

  fireChampion() {
    if (this.champ < 1 || this.over) return;
    this.champ = 0;
    this.spawn(0, this.cannon.x, LANE.cannonZ + 0.8, P.boost * 0.6, 0, 1);
    this.fx.push({ k: 'shot' });
  }

  step(dt: number) {
    if (this.over) { this.compact(); return; }
    this.t += dt;
    const c = this.cannon;
    c.x += (Math.max(-LANE.cannonClamp, Math.min(LANE.cannonClamp, c.target)) - c.x) * Math.min(1, dt * 30);
    c.recoil = Math.max(0, c.recoil - dt * 6);
    c.cool -= dt;
    if (c.firing) {
      this.champ = Math.min(1, this.champ + dt / P.champTime);
      if (c.cool <= 0) {
        c.cool = P.fireInterval; c.recoil = 1;
        for (let k = 0; k < P.perShot; k++) {
          const off = P.perShot > 1 ? (k / (P.perShot - 1) - 0.5) * 0.6 : 0;
          const i = this.spawn(0, c.x + off, LANE.cannonZ + 0.8, P.boost, 0);
          if (i >= 0) this.fresh[i] = -0.06; // negative = muzzle white
        }
        this.fx.push({ k: 'shot' });
      }
    }

    // gates slide
    for (const g of this.gates) if (g.vx) { g.x += g.vx * dt; if (g.x > g.max || g.x < g.min) { g.vx = -g.vx; g.x = Math.max(g.min, Math.min(g.max, g.x)); } }

    // enemy waves
    if (this.t >= this.nextWave) {
      this.nextWave += P.waveGap;
      const size = P.waveSize + this.wave * P.waveGrow; this.wave++;
      this.towers.forEach((tw, ti) => {
        if (tw.hp <= 0) return;
        tw.pulse = 1; this.fx.push({ k: 'wave', tower: ti });
        for (let k = 0; k < size; k++) {
          const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 1.1;
          this.spawn(1, tw.x + Math.cos(a) * r, tw.z - 1.2 - Math.abs(Math.sin(a) * r), -P.speed, 0);
        }
      });
    }
    for (const tw of this.towers) tw.pulse = Math.max(0, tw.pulse - dt * 2);

    this.grid();
    const n = this.n, X = this.x, Z = this.z;
    for (let i = 0; i < n; i++) {
      if (!this.hp[i]) continue;
      this.age[i] += dt;
      if (this.fresh[i] !== 0) this.fresh[i] = this.fresh[i] > 0 ? Math.max(0, this.fresh[i] - dt) : Math.min(0, this.fresh[i] + dt);
      const blue = this.team[i] === 0;
      const sp = P.speed * (this.big[i] ? 0.85 : 1);
      let dx = 0, dz = blue ? 1 : -1;
      // targets
      const seek = blue ? (Z[i] > LANE.steerZ ? 4 : 2.2) : 3.5;
      const e = this.nearestEnemy(i, seek);
      if (e >= 0) { dx = X[e] - X[i]; dz = Z[e] - Z[i]; }
      else if (blue && Z[i] > LANE.steerZ) {
        let best = -1, bd = 1e9;
        this.towers.forEach((tw, ti) => { if (tw.hp > 0) { const d = (tw.x - X[i]) ** 2 + (tw.z - Z[i]) ** 2; if (d < bd) { bd = d; best = ti; } } });
        if (best >= 0) { dx = this.towers[best].x - X[i]; dz = this.towers[best].z - Z[i]; }
        else { dx = -X[i] * 0.3; dz = 1; }
      } else if (!blue && Z[i] < 8) { dx = c.x - X[i]; dz = -Z[i]; }
      { const l0 = Math.hypot(dx, dz) || 1; dx = dx / l0 + this.steer[i] * 1.6; dz /= l0; this.steer[i] *= 1 - Math.min(1, dt * 1.5); }
      const l = Math.hypot(dx, dz) || 1;
      const boost = blue && !this.big[i] && this.age[i] < P.boostTime ? P.boost + (sp - P.boost) * (this.age[i] / P.boostTime) : sp;
      const tvx = (dx / l) * boost, tvz = (dz / l) * boost;
      const k = Math.min(1, dt * 8);
      this.vx[i] += (tvx - this.vx[i]) * k; this.vz[i] += (tvz - this.vz[i]) * k;
      const oz = Z[i];
      X[i] += this.vx[i] * dt; Z[i] += this.vz[i] * dt;
      if (blue) this.crossGates(i, oz);
    }
    this.separate();
    this.collide();
    this.compact();
    if (this.base.hp <= 0 && !this.over) { this.over = 1; this.fx.push({ k: 'down', target: 2 }); }
    if (this.cannon.hp <= 0 && !this.over) { this.over = 2; this.fx.push({ k: 'down', target: 3 }); }
  }

  private crossGates(i: number, oz: number) {
    const z = this.z[i], x = this.x[i];
    for (let g = 0; g < this.gates.length; g++) {
      const G = this.gates[g];
      if (oz < G.z && z >= G.z && Math.abs(x - G.x) <= G.w / 2 && !(this.mask[i] & (1 << g))) {
        this.mask[i] |= 1 << g;
        this.fx.push({ k: 'gate', i: g, x, z: G.z });
        for (let c = 1; c < G.mul; c++) {
          const j = this.spawn(0, Math.max(G.x - G.w * 0.45, Math.min(G.x + G.w * 0.45, x + (Math.random() - 0.5) * 1.4)), G.z + 0.1 + Math.random() * 0.5, P.speed * 1.4, this.mask[i]);
          if (j >= 0) { this.fresh[j] = 0.18; this.age[j] = P.boostTime; }
        }
      }
    }
  }

  private nearestEnemy(i: number, r: number): number {
    const X = this.x, Z = this.z, t = this.team[i];
    const cx = this.cell(X[i], Z[i]), R = Math.ceil(r / 0.6);
    let best = -1, bd = r * r;
    const gx = cx % 28, gz = (cx / 28) | 0;
    for (let a = Math.max(0, gz - R); a <= Math.min(63, gz + R); a++)
      for (let b = Math.max(0, gx - R); b <= Math.min(27, gx + R); b++)
        for (let j = this.head[a * 28 + b]; j >= 0; j = this.next[j]) {
          if (this.team[j] === t || !this.hp[j]) continue;
          const d = (X[j] - X[i]) ** 2 + (Z[j] - Z[i]) ** 2;
          if (d < bd) { bd = d; best = j; }
        }
    return best;
  }

  private cell(x: number, z: number) {
    const gx = Math.max(0, Math.min(27, ((x + 8.4) / 0.6) | 0));
    const gz = Math.max(0, Math.min(63, ((z + 3) / 0.6) | 0));
    return gz * 28 + gx;
  }

  private grid() {
    this.head.fill(-1);
    for (let i = 0; i < this.n; i++) { if (!this.hp[i]) continue; const c = this.cell(this.x[i], this.z[i]); this.next[i] = this.head[c]; this.head[c] = i; }
  }

  private separate() {
    const X = this.x, Z = this.z;
    for (let i = 0; i < this.n; i++) {
      if (!this.hp[i]) continue;
      const c = this.cell(X[i], Z[i]), gx = c % 28, gz = (c / 28) | 0;
      const ri = this.big[i] ? 0.6 : P.radius;
      for (let a = Math.max(0, gz - 1); a <= Math.min(63, gz + 1); a++)
        for (let b = Math.max(0, gx - 1); b <= Math.min(27, gx + 1); b++)
          for (let j = this.head[a * 28 + b]; j >= 0; j = this.next[j]) {
            if (j <= i || !this.hp[j] || !this.hp[i]) continue;
            const dx = X[j] - X[i], dz = Z[j] - Z[i], d2 = dx * dx + dz * dz;
            if (this.team[j] !== this.team[i]) {
              if (d2 < P.clashR * P.clashR * (this.big[i] || this.big[j] ? 2.2 : 1)) {
                const bi = this.big[i] ? i : j, o = bi === i ? j : i;
                this.fx.push({ k: 'poof', x: (X[i] + X[j]) / 2, z: (Z[i] + Z[j]) / 2, team: 2 });
                if (this.big[i] || this.big[j]) { this.kill(o); if (--this.hp[bi] === 0) this.fx.push({ k: 'poof', x: X[bi], z: Z[bi], team: 0 }); }
                else { this.kill(i); this.kill(j); }
              }
              continue;
            }
            const rr = ri + (this.big[j] ? 0.6 : P.radius);
            if (d2 < rr * rr && d2 > 1e-6) {
              const d = Math.sqrt(d2), push = (rr - d) * 0.5 / d;
              X[i] -= dx * push; Z[i] -= dz * push; X[j] += dx * push; Z[j] += dz * push;
            }
          }
    }
  }

  private collide() {
    const X = this.x, Z = this.z;
    for (let i = 0; i < this.n; i++) {
      if (!this.hp[i]) continue;
      const r = this.big[i] ? 0.6 : P.radius;
      // lane edges
      if (X[i] < -LANE.half + r) X[i] = -LANE.half + r;
      if (X[i] > LANE.half - r) X[i] = LANE.half - r;
      for (const w of this.walls) {
        if (X[i] > w.x0 - r && X[i] < w.x1 + r && Z[i] > w.z0 - r && Z[i] < w.z1 + r) {
          const l = X[i] - (w.x0 - r), rt = w.x1 + r - X[i], f = Z[i] - (w.z0 - r), bk = w.z1 + r - Z[i];
          const m = Math.min(l, rt, f, bk);
          if (m === l) X[i] = w.x0 - r; else if (m === rt) X[i] = w.x1 + r; else if (m === f) Z[i] = w.z0 - r; else Z[i] = w.z1 + r;
          if (m === f || m === bk) { // blocked head-on: commit to going around the nearer end (or the open side)
            const goL = w.x0 > -LANE.half + 0.6, goR = w.x1 < LANE.half - 0.6;
            const dir = goL && goR ? (X[i] < (w.x0 + w.x1) / 2 ? -1 : 1) : goL ? -1 : 1;
            if (Math.abs(this.steer[i]) < 0.5) this.steer[i] = dir;
          }
        }
      }
      if (this.team[i] === 0) {
        this.blocks.forEach((b, bi) => {
          if (b.hp <= 0) return;
          const h = b.size / 2 + r;
          if (Math.abs(X[i] - b.x) < h && Math.abs(Z[i] - b.z) < h) {
            const v = this.big[i] ? this.hp[i] : 1;
            b.hp -= v; this.kill(i);
            this.fx.push({ k: 'block', i: bi, x: X[i], z: b.z - b.size / 2, broke: b.hp <= 0 });
          }
        });
        if (!this.hp[i]) continue;
        this.towers.forEach((tw, ti) => {
          if (tw.hp <= 0 || !this.hp[i]) return;
          if ((X[i] - tw.x) ** 2 + (Z[i] - tw.z) ** 2 < (tw.r + r) ** 2) {
            tw.hp = Math.max(0, tw.hp - (this.big[i] ? P.champValue : 1)); this.kill(i);
            this.fx.push({ k: 'hit', x: X[i], z: Z[i], target: ti });
            if (tw.hp === 0) this.fx.push({ k: 'down', target: ti });
          }
        });
        if (this.hp[i] && Z[i] > LANE.baseZ - 1.2) {
          this.base.hp = Math.max(0, this.base.hp - (this.big[i] ? P.champValue : 1)); this.kill(i);
          this.fx.push({ k: 'hit', x: X[i], z: Z[i], target: 2 });
        }
      } else {
        if (Z[i] < LANE.cannonZ + 0.6) {
          this.cannon.hp = Math.max(0, this.cannon.hp - 1); this.kill(i);
          this.fx.push({ k: 'hit', x: X[i], z: Z[i], target: 3 });
        }
        for (const b of this.blocks) {
          if (b.hp <= 0) continue;
          const h = b.size / 2 + r;
          if (Math.abs(X[i] - b.x) < h && Math.abs(Z[i] - b.z) < h) { X[i] = X[i] < b.x ? b.x - h : b.x + h; }
        }
      }
    }
  }

  private compact() {
    let w = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.hp[i]) continue;
      if (w !== i) {
        this.x[w] = this.x[i]; this.z[w] = this.z[i]; this.vx[w] = this.vx[i]; this.vz[w] = this.vz[i];
        this.team[w] = this.team[i]; this.hp[w] = this.hp[i]; this.big[w] = this.big[i]; this.mask[w] = this.mask[i];
        this.age[w] = this.age[i]; this.fresh[w] = this.fresh[i]; this.phase[w] = this.phase[i]; this.steer[w] = this.steer[i];
      }
      w++;
    }
    this.n = w;
  }

  count(team: number) { let c = 0; for (let i = 0; i < this.n; i++) if (this.team[i] === team) c++; return c; }
}
