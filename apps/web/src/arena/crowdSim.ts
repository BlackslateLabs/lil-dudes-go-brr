// A cheap per-unit crowd layer on top of the sim's cohorts (purely cosmetic).
//
// The sim's cohort (x, y, count) stays the truth for where a crowd is and how many it has. Each
// drawn dude here is an agent with its own persistent position, pooled per cohort id + slot index
// (typed arrays, no per-frame allocation). Every frame each agent:
//   1. steers toward a formation slot around its cohort's centre (a sunflower blob that widens with
//      the count up to the free width at that y: walls, obstacles, lane edges), with the cohort's
//      own velocity fed forward so the crowd keeps up without lag (critically damped spring);
//   2. near a tower (or the town hall in the Rush) blends toward slots wrapped round its front and
//      sides, so the crowd swarms the building instead of queueing into one point;
//   3. is pushed apart from its neighbours (spatial hash, O(n)) and out of obstacles, walls,
//      towers, crates and the lane edges, so crowds pile up, widen and flow round solid things.
// A cohort that vanishes (a tower hit, loot, a crate) leaves its dudes lingering at their slots for
// a moment with a hop before they pop; dudes removed by a clash or a bad gate pop where they are.
// Every pop is pushed to `pops` (popQueue.ts) with why it happened, for Fx.tsx's bursts. Each agent
// also carries a walk-cycle phase, advanced by its speed, that drives the baked walk (models/vat.ts).
//
// Giants are agents too: a Champion cohort is one purple giant per CHAMP_COUNT dudes and an enemy
// giant cohort is one big troop. They use the same formation, swarm and collision as the dudes with
// a bigger body and spacing, shove the dudes aside, squash a little to fit a narrow gap, and die
// one at a time (staggered) with a pop flagged `PopFlag.Giant` (the last of a cohort: `Last`).
// Enemy crowds never die at a crate: held behind a live one, they pile up against its far face.

import {
  CHAMP_COUNT,
  CLASH_REACH,
  FINAL_STAGE,
  HALL_X,
  LANE_LENGTH,
  LANE_WIDTH,
  TICKS_PER_SEC,
  TOWER_HALF_W,
  TOWER_Y,
  VAULT_Y,
  covers,
  stageDef,
  type CohortView,
  type LaneView,
} from '@lil-dudes/client';
import { Euler, type InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three';
import { columnWidth, spanAt, wallsOf, type WallDef } from './columns';
import { wx, wz } from './layout';
import { narrowSpan, pipesOf, pushOut, solidsOf, type Solids } from './levelDefs';
import { PopFlag, PopKind, pops } from './popQueue';

// ---- Tuning (sim units: 1 world unit = 200) ---------------------------------------------------

/** Alive dudes drawn per crowd at most (TECH §5: ~1,500 per mesh on a phone). */
export const MAX_UNITS = 1500;
/** Pool size: alive dudes plus the ones still lingering / popping. */
export const POOL = 1900;
/** A cohort is drawn 1:1 up to this many dudes, then grows only slowly (to MAX_PER). */
const COHORT_FULL = 250;
const MAX_PER = 400;
/** Sunflower step: a dude's footprint is ~π·SPACING², so neighbours touch (dudes are ~1.2 units wide). */
const SPACING = 84;
/** Body radius against solids, and the edge margin inside the lane. */
const BODY_R = 76;
const EDGE = 96;
/** Neighbours closer than this are pushed apart (a bit under the slot spacing: no fight at rest). */
const SEP_D = 120;
const SEP_K = 0.55;
/** A blob in a roomy corridor spreads up to this much wider than round (and flatter). */
const KX_WIDE = 1.45;
/** A blob squeezed across grows along the lane, at most this much; past that it packs tighter. */
const KZ_MAX = 2.4;
/** Small cohorts are at least this long either side of their centre (volleys are ~480 apart). */
const STREAM_HALF = 220;
/** Spring rate (1/s), critically damped. */
const OMEGA = 7.5;
/** Integration substep (s). */
const MAX_STEP = 1 / 40;
/** New dudes pour out of the cohort's centre (a gate, the tower): the whole blob over POUR_* s,
 *  at least SPAWN_MIN a second. */
const POUR_MINE = 0.4;
const POUR_ENEMY = 0.6;
const SPAWN_MIN = 60;
const GROW_TIME = 0.16;
/** Towers: drawn ~3.4 wide; the solid core the dudes keep off. */
const TOWER_R = 300;
/**
 * Swarming: blend toward the building's slots only over the last APPROACH of the way (~1 s at
 * cruise), easing in, so a crowd walks straight and turns at the end, like the sim's cohorts.
 * The blend is complete TURN_DONE short of the building's line.
 */
const APPROACH = 1250;
const TURN_DONE = 220;
const RING_D = 112;
const ARC = 1.95; // rad either side of the front
/** The town hall's front face (Base.tsx: 0.4 world past VAULT_Y) and half its width. */
const HALL_FRONT = VAULT_Y + 80;
const HALL_HALF = 1000;
/** Lingering at a building before popping (s), and the pop itself. */
const LINGER_MIN = 0.3;
const LINGER_RAND = 0.2;
const POP_TIME = 0.12;
/** Pipes: each dude shrinks into the entrance over SHRINK, staggered by up to STAGGER. */
const PIPE_SHRINK = 0.14;
const PIPE_STAGGER = 0.16;
const PIPE_JUMP = 700;
/** Speed above which dudes stretch (boosted by the cannon or a speed pad), sim units/s. */
const STRETCH_FROM = 1700;
/**
 * Walk cycle (the baked `walk` loop, 0.67 s native): cycles per second at a speed, and the blend
 * into `sprint` once boosted. Cruise (1,200/s) is a brisk ~2.2 cycles/s; standing still marches.
 */
const CYC_MIN = 1.3;
const CYC_PER_SPEED = 2.2 / 1200;
const CYC_WALK_MAX = 2.6;
const CYC_SPRINT = 2.4;
const CYC_SPRINT_MAX = 3.4;
const SPRINT_FROM = 1600;
const SPRINT_FULL = 2600;
/** Giants walk a slower, heavier cycle (loops per second at cruise, and the range). */
const G_CYC = 1.25;
const G_CYC_MIN = 0.8;
const G_CYC_MAX = 1.9;
/** A clash pop: a foe cohort centre within this of the crowd's centre (sim units). */
const FOE_DX = CLASH_REACH + 300;
const FOE_DY = 900;

/** Agent kinds: a dude, a Champion giant (mine, purple), an enemy giant (one big troop). */
export const Big = {
  Dude: 0,
  Champ: 1,
  Troop: 2,
} as const;
export type Big = (typeof Big)[keyof typeof Big];
/** Most giants drawn for one Champion cohort (a ×8 gate on a fresh Champion makes 8). */
export const MAX_GIANTS = 16;
/**
 * Body radius against solids per kind (sim units). A Champion giant is ~730 wide as drawn; 240
 * fits the narrowest gap (a comb arm to its wall, ~550) and the drawn body squashes to fit (G_SQUASH).
 */
const RAD = [BODY_R, 240, 170];
/**
 * A giant's radius against obstacles (pillars, blocks, wedges; walls use RAD). Smaller than its
 * body so it fits the pillar field's ~440 gaps; the drawn body squashes across to match. A head-on
 * hit turns into a sideways slide round the obstacle instead of a stop (see collide).
 */
const SOLID_R = [BODY_R, 150, 130];
/** Formation step for giants (neighbours ~1.9 steps apart, about two bodies). */
const G_SPACING = [SPACING, 235, 150];
/** Drawn half-width of a giant (sim units) and the most it squashes across to fit a gap. */
const G_HALF = [0, 360, 210];
const G_SQUASH = 0.68;
/** A giant column can stretch this much along the lane (more than a blob of dudes: they're big). */
const G_KZ_MAX = 5;
/** Giants and dudes: a dude is shoved out to the giant's radius plus this. */
const G_SHOVE = 70;
/** Giants die one at a time: this far apart (s), plus a little jitter. */
const G_STAGGER = 0.14;
/** Enemies held behind a live crate lean on it this hard (sim units/s of feed-forward). */
const PRESS = 320;
/** An enemy cohort this close behind a live crate's far face (sim units) is held there. */
const PRESS_REACH = 900;

const enum St {
  Free = 0,
  Alive = 1,
  Dying = 2,
}

/** Visible units for a cohort: 1:1 up to COHORT_FULL, then sub-linear. */
export function unitsFor(count: number): number {
  if (count <= 0) return 0;
  return count <= COHORT_FULL ? count : Math.min(MAX_PER, Math.round(COHORT_FULL + Math.sqrt(count - COHORT_FULL) * 3));
}

/** Centre-out order across a row: 0, +1, −1, +2, −2, … */
const alt = (p: number) => (p === 0 ? 0 : p % 2 ? (p + 1) / 2 : -p / 2);

// Slot tables, built once: unit sunflower offsets, tower-wrap offsets and hall-front offsets.
const SFX = new Float32Array(MAX_PER);
const SFY = new Float32Array(MAX_PER);
const TSX = new Float32Array(MAX_PER);
const TSY = new Float32Array(MAX_PER);
const HSX = new Float32Array(MAX_PER);
const HSY = new Float32Array(MAX_PER);
// Giants: a sunflower with the first one on the centre, and their own tower and hall wraps.
const GSX = new Float32Array(MAX_GIANTS);
const GSY = new Float32Array(MAX_GIANTS);
const GTSX = new Float32Array(MAX_GIANTS);
const GTSY = new Float32Array(MAX_GIANTS);
const GHSX = new Float32Array(MAX_GIANTS);
const GHSY = new Float32Array(MAX_GIANTS);
{
  for (let j = 0; j < MAX_PER; j++) {
    const r = Math.sqrt(j + 0.5);
    SFX[j] = r * Math.cos(j * 2.39996);
    SFY[j] = r * Math.sin(j * 2.39996);
  }
  // Tower: rings round the front (−y, toward the cannon) and sides, filled centre-out.
  let j = 0;
  for (let m = 0; j < MAX_PER; m++) {
    const r = TOWER_R + BODY_R + 20 + m * RING_D;
    const step = (RING_D * 0.95) / r;
    for (let p = 0; j < MAX_PER; p++) {
      const phi = alt(p) * step;
      if (Math.abs(phi) > ARC) break;
      TSX[j] = r * Math.sin(phi);
      TSY[j] = -r * Math.cos(phi);
      j++;
    }
  }
  // Hall: rows across its front, centre-out, stacking back toward the cannon.
  const per = Math.floor((2 * HALL_HALF) / RING_D) + 1;
  for (let k = 0; k < MAX_PER; k++) {
    const row = Math.floor(k / per);
    const p = k % per;
    HSX[k] = alt(p) * RING_D + (row % 2 ? RING_D / 2 : 0);
    HSY[k] = -(BODY_R + 30 + row * RING_D * 0.85);
  }
  const gr = RAD[Big.Champ]!;
  const gd = gr * 1.9;
  for (let j = 0; j < MAX_GIANTS; j++) {
    const r = Math.sqrt(j);
    GSX[j] = r * Math.cos(j * 2.39996);
    GSY[j] = r * Math.sin(j * 2.39996);
  }
  j = 0;
  for (let m = 0; j < MAX_GIANTS; m++) {
    const r = TOWER_R + gr + 30 + m * gd;
    const step = (gd * 0.95) / r;
    for (let p = 0; j < MAX_GIANTS; p++) {
      const phi = alt(p) * step;
      if (Math.abs(phi) > ARC) break;
      GTSX[j] = r * Math.sin(phi);
      GTSY[j] = -r * Math.cos(phi);
      j++;
    }
  }
  const gper = Math.floor((2 * HALL_HALF) / gd) + 1;
  for (let k = 0; k < MAX_GIANTS; k++) {
    const row = Math.floor(k / gper);
    GHSX[k] = alt(k % gper) * gd + (row % 2 ? gd / 2 : 0);
    GHSY[k] = -(gr + 30 + row * gd * 0.85);
  }
}

/**
 * How many giants a Champion cohort is: one per CHAMP_COUNT dudes, rounded up (SPEC_V5 §4: the
 * Champion multiplies through gates like any cohort, so a ×3 gate makes three giants).
 */
export function giantsFor(count: number): number {
  return count <= 0 ? 0 : Math.min(MAX_GIANTS, Math.ceil(count / CHAMP_COUNT));
}

/** One cohort's agents and its formation this frame. */
interface Rec {
  id: number;
  agents: Int32Array;
  n: number;
  seen: number;
  /** Centre (interpolated) and velocity (sim units / s). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Last snapshot position (for where it vanished). */
  lastX: number;
  lastY: number;
  /** What its agents are (Big), and whether it is held behind a live crate (enemies). */
  big: Big;
  press: boolean;
  /** Blob centre, axis scales, spacing and rotation. */
  bx: number;
  by: number;
  kx: number;
  kz: number;
  c: number;
  cos: number;
  sin: number;
  /** Swarm blend 0..1 toward the anchor's slots (1 = tower, 2 = hall). */
  k: number;
  kind: number;
  ax: number;
  ay: number;
  /** Pipe in progress: start time (−1 = none), entrance centre. */
  pipeT0: number;
  pipeX: number;
  pipeY: number;
  pipeOutX: number;
  pipeOutY: number;
  spawnAcc: number;
  instant: boolean;
}

const m4 = new Matrix4();
const q = new Quaternion();
const eul = new Euler();
const pos = new Vector3();
const scl = new Vector3();
const span = { lo: 0, hi: 0 };
const hitOut = { x: 0, y: 0, nx: 0, ny: 0 };

/** Grid for the neighbour hash (cells of SEP_D over the lane, a little past both ends). */
const CELL = SEP_D;
const GY0 = -600;
const GNX = Math.ceil(LANE_WIDTH / CELL) + 1;
const GNY = Math.ceil((LANE_LENGTH + 1200) / CELL) + 1;

export interface CrowdInput {
  lane: LaneView;
  layout: number;
  list: readonly CohortView[];
  /** The other team's cohorts in this lane (clash fronts). */
  foes: readonly CohortView[];
  prevById: ReadonlyMap<number, CohortView>;
  alpha: number;
  time: number;
  dt: number;
}

export class CrowdSim {
  // Agents.
  readonly x = new Float32Array(POOL);
  readonly y = new Float32Array(POOL);
  readonly vx = new Float32Array(POOL);
  readonly vy = new Float32Array(POOL);
  readonly s = new Float32Array(POOL);
  readonly yaw = new Float32Array(POOL);
  readonly phase = new Float32Array(POOL);
  readonly t = new Float32Array(POOL);
  readonly life = new Float32Array(POOL);
  readonly tx = new Float32Array(POOL);
  readonly ty = new Float32Array(POOL);
  readonly face = new Float32Array(POOL);
  readonly st = new Uint8Array(POOL);
  readonly piped = new Uint8Array(POOL);
  readonly hop = new Uint8Array(POOL);
  readonly owner = new Int16Array(POOL);
  readonly slot = new Int16Array(POOL);
  /** Walk-cycle phase (0..1) and why a dying agent dies (PopKind, + building / crate index). */
  readonly cyc = new Float32Array(POOL);
  readonly why = new Uint8Array(POOL);
  readonly whyIx = new Int8Array(POOL);
  /** Kind (Big) and pop flags (PopFlag: a giant, the last of its cohort). */
  readonly big = new Uint8Array(POOL);
  readonly flags = new Uint8Array(POOL);
  private free = new Int32Array(POOL);
  private nFree = POOL;
  /** Active agent list (alive + dying), rebuilt each frame. */
  private act = new Int32Array(POOL);
  private nAct = 0;
  // Neighbour hash.
  private cellOf = new Int32Array(POOL);
  private cellStart = new Int32Array(GNX * GNY + 1);
  private cellItems = new Int32Array(POOL);
  // Cohorts.
  private recs: Rec[] = [];
  private freeRecs: number[] = [];
  private byId = new Map<number, number>();
  private stamp = 0;
  private stageKey = '';
  /** Pipe events waiting for their cohort: id → pipe index. */
  private pendingPipe = new Map<number, number>();
  /** Per-frame building/crate state. */
  private crateBox = new Float32Array(16);
  private nCrates = 0;
  private towerX = new Float32Array(4);
  private towerY = new Float32Array(4);
  private towerLive = new Uint8Array(4);
  private nTowers = 0;
  /** The other team's cohort centres this frame (for telling a clash from a bad gate). */
  private foeX = new Float32Array(64);
  private foeY = new Float32Array(64);
  private nFoes = 0;
  private time = 0;
  /** This frame's solids (giants squash to the room between them). */
  private walls: readonly WallDef[] = [];
  private solids: Solids | null = null;
  /** Active giants this frame (a short list: separation is pairwise). */
  private giants = new Int32Array(POOL);
  private nGiants = 0;
  /** Stats: alive / dying agents and the step cost (ms, smoothed). */
  alive = 0;
  dying = 0;
  ms = 0;

  constructor(readonly enemy: boolean) {
    for (let i = 0; i < POOL; i++) this.free[i] = POOL - 1 - i;
    for (let i = 0; i < 64; i++) {
      this.recs.push(newRec());
      this.freeRecs.push(63 - i);
    }
    for (let i = 0; i < POOL; i++) this.phase[i] = Math.random() * 100;
    for (let i = 0; i < POOL; i++) this.cyc[i] = Math.random();
  }

  /** A `pipe` event: cohort `id` went into pipe `ix` this tick. */
  pipe(id: number, ix: number) {
    this.pendingPipe.set(id, ix);
  }

  clear() {
    for (let i = 0; i < POOL; i++) this.st[i] = St.Free;
    for (let i = 0; i < POOL; i++) this.free[i] = POOL - 1 - i;
    this.nFree = POOL;
    this.byId.clear();
    this.freeRecs.length = 0;
    for (let i = 0; i < this.recs.length; i++) this.freeRecs.push(this.recs.length - 1 - i);
    this.pendingPipe.clear();
  }

  private alloc(): number {
    return this.nFree > 0 ? this.free[--this.nFree]! : -1;
  }

  private release(a: number) {
    this.st[a] = St.Free;
    this.free[this.nFree++] = a;
  }

  update(inp: CrowdInput) {
    const t0 = performance.now();
    const { lane, layout, list, foes, prevById, alpha } = inp;
    const dt = Math.min(0.25, Math.max(0.0001, inp.dt));
    this.time = inp.time;
    const key = `${layout}|${lane.stage}`;
    if (key !== this.stageKey) {
      this.stageKey = key;
      this.clear();
    }
    const solids = solidsOf(layout, lane.stage);
    const walls = wallsOf(layout, lane.stage);
    this.solids = solids;
    this.walls = walls;
    const col = columnWidth(layout, lane.stage);
    const st = stageDef(layout, lane.stage);
    const pipes = pipesOf(layout, lane.stage);
    const rush = lane.phase === 'rush';
    // Crowds wiped by the stage ending (transit, the end) vanish without bursts.
    const quiet = lane.phase !== 'fight' && lane.phase !== 'rush';
    const hallUp = lane.stage === FINAL_STAGE && lane.phase !== 'transit';

    // Per-frame solids that change: live crates and towers.
    this.nCrates = 0;
    for (const c of lane.crates) {
      if (c.hp <= 0 || this.nCrates >= 4) continue;
      const half = c.width / 2;
      const depth = crateDepth(c.width, isLockCrate(st, c.x, c.y));
      const o = this.nCrates++ * 4;
      this.crateBox[o] = c.x - half;
      this.crateBox[o + 1] = c.y - depth / 2;
      this.crateBox[o + 2] = c.x + half;
      this.crateBox[o + 3] = c.y + depth / 2;
    }
    this.nTowers = 0;
    for (const tw of lane.towers) {
      if (this.nTowers >= 4) break;
      this.towerX[this.nTowers] = tw.x;
      this.towerY[this.nTowers] = tw.y;
      this.towerLive[this.nTowers] = tw.hp > 0 ? 1 : 0;
      this.nTowers++;
    }

    this.nFoes = 0;
    for (const f of foes) {
      if (f.count <= 0 || this.nFoes >= 64) continue;
      this.foeX[this.nFoes] = f.x;
      this.foeY[this.nFoes++] = f.y;
    }

    // Global cap: past MAX_UNITS every crowd keeps the same share of its units (blobs keep their size).
    let total = 0;
    for (const c of list) if (c.count > 0 && !c.champion && !c.giant) total += unitsFor(c.count);
    const keep = total > MAX_UNITS ? MAX_UNITS / total : 1;

    const stamp = ++this.stamp;
    for (const c of list) {
      if (c.count <= 0) continue;
      const big: Big = c.champion ? Big.Champ : c.giant ? Big.Troop : Big.Dude;
      let ri = this.byId.get(c.id);
      const p = prevById.get(c.id);
      if (ri !== undefined && this.recs[ri]!.big !== big) {
        // A cohort that changed kind (never in the rules today): start its agents over.
        const r = this.recs[ri]!;
        for (let i = 0; i < r.n; i++) this.release(r.agents[i]!);
        r.n = 0;
        r.big = big;
      }
      if (ri === undefined) {
        const fresh = this.freeRecs.pop();
        if (fresh === undefined) continue;
        ri = fresh;
        this.byId.set(c.id, ri);
        resetRec(this.recs[ri]!, c.id, big);
        const r = this.recs[ri]!;
        // An enemy wave pours out of its tower; one first seen mid-lane (a reload) just appears.
        r.instant = this.enemy ? c.y < TOWER_Y - 500 : false;
        r.cos = Math.cos(c.id * 0.7);
        r.sin = Math.sin(c.id * 0.7);
      }
      const r = this.recs[ri]!;
      r.seen = stamp;
      // Interpolate one tick behind, except across a teleport (a pipe).
      const jump = !!p && Math.abs(c.x - p.x) + Math.abs(c.y - p.y) > PIPE_JUMP;
      if (p && !jump) {
        r.x = p.x + (c.x - p.x) * alpha;
        r.y = p.y + (c.y - p.y) * alpha;
        r.vx = (c.x - p.x) * TICKS_PER_SEC;
        r.vy = (c.y - p.y) * TICKS_PER_SEC;
      } else {
        r.x = c.x;
        r.y = c.y;
        if (!p) {
          r.vx = 0;
          r.vy = this.enemy ? -300 : 300;
        }
      }
      r.lastX = c.x;
      r.lastY = c.y;

      // Pipes: from the event, or (fallback) a jump that lands on a pipe's exit.
      let pix = this.pendingPipe.get(c.id);
      if (pix !== undefined) this.pendingPipe.delete(c.id);
      else if (jump && p && r.pipeT0 < 0) {
        for (let i = 0; i < pipes.length; i++) {
          const pp = pipes[i]!;
          if (Math.abs(pp.outX - c.x) + Math.abs(pp.outY - c.y) < 500) pix = i;
        }
      }
      const pd = pix !== undefined ? pipes[pix] : undefined;
      if (pd) {
        r.pipeT0 = this.time;
        r.pipeX = (pd.x0 + pd.x1) / 2;
        r.pipeY = (pd.y0 + pd.y1) / 2;
        r.pipeOutX = pd.outX;
        r.pipeOutY = pd.outY;
        for (let i = 0; i < r.n; i++) this.piped[r.agents[i]!] = 0;
      } else if (r.pipeT0 >= 0 && this.time - r.pipeT0 > PIPE_SHRINK + PIPE_STAGGER + 0.05) {
        // Done: anyone still outside the pipe (a slow frame) is put through now.
        for (let i = 0; i < r.n; i++) {
          const a = r.agents[i]!;
          if (!this.piped[a]) this.popOutOfPipe(r, a);
          this.piped[a] = 0;
        }
        r.pipeT0 = -1;
      }

      // Formation: a blob as wide as the free span allows (walls, obstacles beside it, the lane).
      // Giants keep a whole body off the sides and may stretch into a longer column.
      const units = big === Big.Champ ? giantsFor(c.count) : big === Big.Troop ? 1 : unitsFor(c.count);
      const step = G_SPACING[big]!;
      const body = RAD[big]!;
      const R = step * Math.sqrt(units + 0.5);
      // Open sides (no wall) give a big blob room to stay round: max(half a column, its radius).
      spanAt(walls, Math.max(col, 2 * R), r.x, r.y, span);
      // Giants follow the cohort's own line (the sim already threads it round obstacles): aiming
      // them at the middle of a gap puts them on the next pillar in a staggered field.
      if (!big) narrowSpan(solids, r.x, r.y, R, span);
      const lo = big ? Math.max(body, span.lo + body) : Math.max(EDGE, span.lo + BODY_R * 0.5);
      const hi = big ? Math.min(LANE_WIDTH - body, span.hi - body) : Math.min(LANE_WIDTH - EDGE, span.hi - BODY_R * 0.5);
      const half = Math.max(30, (hi - lo) / 2);
      const kx = Math.min(KX_WIDE, half / R);
      r.kx = kx;
      // A small cohort stretches along the lane to about half the volley spacing, so a stream of
      // volleys reads as one flowing crowd rather than a line of separate clumps.
      r.kz = big
        ? Math.min(G_KZ_MAX, 1 / Math.max(kx, 1e-3))
        : Math.max(Math.min(KZ_MAX, 1 / Math.max(kx, 1e-3)), Math.min(STREAM_HALF / R, 3));
      const w = R * kx;
      r.bx = hi - lo > 2 * w ? Math.max(lo + w, Math.min(hi - w, r.x)) : (lo + hi) / 2;
      r.by = r.y;
      r.c = big ? step : SPACING / Math.sqrt(keep);
      // Enemies held behind a live crate: the blob sits against its far face and leans on it.
      r.press = false;
      if (this.enemy) {
        const top = this.crateAhead(r.x, r.y, R * r.kx);
        if (top > -Infinity) {
          r.press = true;
          r.by = Math.max(r.y, top + body + R * r.kz * 0.7);
        }
      }

      // Swarm a building as the crowd closes in on it (mine only).
      r.k = 0;
      r.kind = 0;
      if (!this.enemy) {
        if (rush && hallUp) {
          r.k = lateTurn(r.y, VAULT_Y);
          r.kind = 2;
          r.ax = HALL_X;
          r.ay = HALL_FRONT;
        } else if (!rush) {
          const ti = this.towerNear(r.x, true);
          if (ti >= 0) {
            r.k = lateTurn(r.y, this.towerY[ti]!);
            r.kind = 1;
            r.ax = this.towerX[ti]!;
            r.ay = this.towerY[ti]!;
          }
        }
      }

      // Grow or shrink the agent set to the visible count.
      const want = big ? units : Math.min(MAX_PER, Math.max(c.count > 0 ? 1 : 0, Math.round(units * keep)));
      if (r.n < want) {
        r.spawnAcc += Math.max(SPAWN_MIN, want / (this.enemy ? POUR_ENEMY : POUR_MINE)) * dt;
        let budget = r.instant ? want : Math.max(1, Math.floor(r.spawnAcc));
        r.spawnAcc -= Math.floor(r.spawnAcc);
        while (r.n < want && budget-- > 0) {
          const a = this.alloc();
          if (a < 0) break;
          const j = r.n;
          r.agents[r.n++] = a;
          this.st[a] = St.Alive;
          this.owner[a] = ri;
          this.slot[a] = j;
          this.big[a] = big;
          this.flags[a] = big ? PopFlag.Giant : 0;
          this.piped[a] = r.pipeT0 >= 0 ? 1 : 0;
          this.hop[a] = 0;
          if (r.instant) {
            this.slotTarget(r, j);
            this.x[a] = sx;
            this.y[a] = sy;
            this.s[a] = 1;
          } else {
            // Pour out of the centre (the gate just crossed; for a wave, the tower's front).
            this.x[a] = r.x + (((j * 37) % 7) - 3) * 9;
            this.y[a] = (this.enemy && r.y > TOWER_Y - 400 ? r.y - TOWER_R - body : r.y) + (((j * 53) % 5) - 2) * 9;
            this.s[a] = 0.25;
          }
          this.vx[a] = r.vx;
          this.vy[a] = r.vy;
          this.yaw[a] = this.enemy ? 0 : Math.PI;
        }
        r.instant = false;
      } else if (r.n > want) {
        // Fewer: the outer ring goes (a clash, a bad gate, a crate), popping where it stands.
        // Enemies never lose dudes to a crate (they wait behind it), only to a clash or the end.
        const crate = this.enemy || quiet ? -1 : this.crateNear(st, r.lastX, r.lastY);
        const why = quiet ? PopKind.None : this.foeNear(r.x, r.y) ? PopKind.Clash : PopKind.Gate;
        let order = 0;
        while (r.n > want) {
          const a = r.agents[--r.n]!;
          if (crate >= 0) this.dieAtCrate(a, st, crate, r.n, order++);
          else this.dieInPlace(a, r, why, order++);
        }
      }
    }

    // Cohorts gone this tick: their dudes linger at the building they hit, or pop.
    for (const [id, ri] of this.byId) {
      const r = this.recs[ri]!;
      if (r.seen === stamp) continue;
      this.byId.delete(id);
      this.freeRecs.push(ri);
      let kind = 0;
      let ax = 0;
      let ay = 0;
      if (!this.enemy) {
        if (rush && hallUp && r.lastY >= VAULT_Y - 400) {
          kind = 2;
          ax = HALL_X;
          ay = HALL_FRONT;
        } else if (r.lastY >= TOWER_Y - 400) {
          const ti = this.towerNear(r.lastX, false);
          if (ti >= 0) {
            kind = 1;
            ax = this.towerX[ti]!;
            ay = this.towerY[ti]!;
          }
        }
      }
      const crate = kind === 0 && !this.enemy && !quiet ? this.crateNear(st, r.lastX, r.lastY) : -1;
      const why = quiet ? PopKind.None : this.foeNear(r.lastX, r.lastY) ? PopKind.Clash : PopKind.Gate;
      const ti = kind === 1 ? this.towerNear(r.lastX, false) : -1;
      const g = r.big !== Big.Dude;
      for (let i = 0; i < r.n; i++) {
        const a = r.agents[i]!;
        if (kind) {
          const j = this.slot[a]!;
          this.st[a] = St.Dying;
          this.tx[a] = ax + (g ? (kind === 1 ? GTSX[j]! : GHSX[j]!) : kind === 1 ? TSX[j]! : HSX[j]!);
          this.ty[a] = ay + (g ? (kind === 1 ? GTSY[j]! : GHSY[j]!) : kind === 1 ? TSY[j]! : HSY[j]!);
          this.t[a] = 0;
          // Giants go one at a time (in slot order, front first); dudes all at about once.
          this.life[a] = g ? LINGER_MIN + G_STAGGER * j + 0.05 * fract(this.phase[a]!) : LINGER_MIN + LINGER_RAND * fract(this.phase[a]!);
          this.hop[a] = 1;
          this.face[a] = Math.atan2(wx(ax) - wx(this.tx[a]!), wz(ay) - wz(this.ty[a]!));
          this.why[a] = kind === 1 ? PopKind.Tower : PopKind.Hall;
          this.whyIx[a] = ti;
        } else if (crate >= 0) this.dieAtCrate(a, st, crate, i, i);
        else this.dieInPlace(a, r, why, i);
      }
      // The giant that goes last shakes the screen a little.
      if (g && r.n > 0 && why !== PopKind.None) {
        let last = r.agents[0]!;
        for (let i = 1; i < r.n; i++) if (this.life[r.agents[i]!]! > this.life[last]!) last = r.agents[i]!;
        this.flags[last]! |= PopFlag.Last;
      }
      r.n = 0;
    }

    this.integrate(dt);
    this.separate();
    this.collide(solids, hallUp);
    const ms = performance.now() - t0;
    this.ms = this.ms * 0.95 + ms * 0.05;
  }

  /** Nearest tower within the sim's hit reach of x (live ones only, or any). */
  private towerNear(x: number, liveOnly: boolean): number {
    let best = -1;
    let bd = TOWER_HALF_W + CLASH_REACH;
    for (let i = 0; i < this.nTowers; i++) {
      if (liveOnly && !this.towerLive[i]) continue;
      const d = Math.abs(this.towerX[i]! - x);
      if (d <= bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  /** Whether a foe crowd is close enough to (x, y) for losses there to be a clash. */
  private foeNear(x: number, y: number): boolean {
    for (let i = 0; i < this.nFoes; i++) {
      if (Math.abs(this.foeX[i]! - x) <= FOE_DX && Math.abs(this.foeY[i]! - y) <= FOE_DY) return true;
    }
    return false;
  }

  /** A crate (stage def index) the cohort at (x, y) is crossing right now, or −1. */
  private crateNear(st: ReturnType<typeof stageDef>, x: number, y: number): number {
    for (let i = 0; i < st.crates.length; i++) {
      const c = st.crates[i]!;
      if (y >= c.y - 320 && y <= c.y + 120 && covers(x, c.x, c.width)) return i;
    }
    return -1;
  }

  /**
   * The far face (y) of a live crate an enemy blob at (x, y) is held behind (its centre at most
   * PRESS_REACH past the face, a little into it at most, and the crate across its path), or −∞.
   */
  private crateAhead(x: number, y: number, halfW: number): number {
    let best = -Infinity;
    for (let k = 0; k < this.nCrates; k++) {
      const o = k * 4;
      const top = this.crateBox[o + 3]!;
      // Rules v10 hold the cohort at `crate.y + CRATE_HOLD`, inside the drawn crate: anything from
      // the crate's middle line to PRESS_REACH past its far face counts.
      const mid = (this.crateBox[o + 1]! + top) / 2;
      if (y < mid - 40 || y - top > PRESS_REACH) continue;
      const reach = Math.min(halfW, 200);
      if (x + reach < this.crateBox[o]! || x - reach > this.crateBox[o + 2]!) continue;
      best = Math.max(best, top);
    }
    return best;
  }

  private dieInPlace(a: number, r: Rec, why: PopKind, order: number) {
    this.st[a] = St.Dying;
    this.why[a] = why;
    this.whyIx[a] = -1;
    this.t[a] = 0;
    const g = this.big[a] !== Big.Dude && why !== PopKind.None;
    this.life[a] = g ? 0.12 + G_STAGGER * order + 0.04 * fract(this.phase[a]!) : 0.1 + 0.12 * fract(this.phase[a]! * 3.1);
    // A little lunge the way the crowd was going (into the clash).
    const sp = Math.hypot(r.vx, r.vy) || 1;
    this.tx[a] = this.x[a]! + (r.vx / sp) * 70;
    this.ty[a] = this.y[a]! + (r.vy / sp) * 70;
    this.hop[a] = 0;
  }

  /** My dude (or giant) spent on a crate: it lines up on the crate's near face, hops and pops. */
  private dieAtCrate(a: number, st: ReturnType<typeof stageDef>, ci: number, j: number, order: number) {
    const c = st.crates[ci]!;
    const depth = crateDepth(c.width, isLockCrate(st, c.x, c.y));
    const g = this.big[a] !== Big.Dude;
    const body = RAD[this.big[a]!]!;
    const gap = g ? body * 1.9 : 90;
    const half = Math.max(60, c.width / 2 - 40);
    const per = Math.max(1, Math.floor((2 * half) / gap));
    this.st[a] = St.Dying;
    this.why[a] = PopKind.Crate;
    this.whyIx[a] = ci;
    this.t[a] = 0;
    this.life[a] = g ? 0.2 + G_STAGGER * order + 0.04 * fract(this.phase[a]!) : 0.18 + 0.15 * fract(this.phase[a]!);
    this.tx[a] = c.x + Math.max(-half, Math.min(half, alt(j % per) * gap));
    this.ty[a] = c.y - depth / 2 - body - Math.floor(j / per) * gap * 0.95;
    this.hop[a] = 1;
    this.face[a] = Math.PI;
  }

  private popOutOfPipe(r: Rec, a: number) {
    const j = this.slot[a]!;
    this.x[a] = r.pipeOutX + ((j * 37) % 7 - 3) * 10;
    this.y[a] = r.pipeOutY + ((j * 53) % 5 - 2) * 10;
    this.vx[a] = r.vx * 0.5;
    this.vy[a] = Math.max(r.vy, 600);
    this.s[a] = 0.05;
    this.piped[a] = 1;
  }

  /** Writes the formation slot of index j into (sx, sy). */
  private slotTarget(r: Rec, j: number) {
    const g = r.big !== Big.Dude;
    const fx = g ? GSX[j]! : SFX[j]!;
    const fy = g ? GSY[j]! : SFY[j]!;
    const ox = fx * r.cos - fy * r.sin;
    const oy = fx * r.sin + fy * r.cos;
    let x = r.bx + ox * r.c * r.kx;
    let y = r.by + oy * r.c * r.kz;
    if (r.k > 0) {
      const bx = r.ax + (r.kind === 1 ? (g ? GTSX[j]! : TSX[j]!) : g ? GHSX[j]! : HSX[j]!);
      const by = r.ay + (r.kind === 1 ? (g ? GTSY[j]! : TSY[j]!) : g ? GHSY[j]! : HSY[j]!);
      x += (bx - x) * r.k;
      y += (by - y) * r.k;
    }
    sx = x;
    sy = y;
  }

  private integrate(dt: number) {
    const w2 = OMEGA * OMEGA;
    const w2x = 2 * OMEGA;
    // Fixed small substeps, so a slow frame never leaves the crowd behind its cohort.
    const steps = Math.ceil(dt / MAX_STEP);
    const h = dt / steps;
    let n = 0;
    let alive = 0;
    let dying = 0;
    for (let a = 0; a < POOL; a++) {
      const state = this.st[a];
      if (state === St.Free) continue;
      let tx: number;
      let ty: number;
      let fx = 0;
      let fy = 0;
      if (state === St.Alive) {
        const r = this.recs[this.owner[a]!]!;
        const j = this.slot[a]!;
        if (r.pipeT0 >= 0 && !this.piped[a]) {
          // Into the pipe: run to the entrance and shrink into it, then out of the exit.
          const tau = this.time - r.pipeT0 - (j / Math.max(1, r.n)) * PIPE_STAGGER;
          tx = r.pipeX;
          ty = r.pipeY;
          if (tau >= PIPE_SHRINK) {
            this.popOutOfPipe(r, a);
            this.slotTarget(r, j);
            tx = sx;
            ty = sy;
          } else if (tau > 0) this.s[a] = Math.min(this.s[a]!, 1 - tau / PIPE_SHRINK);
        } else {
          this.slotTarget(r, j);
          tx = sx;
          ty = sy;
          fx = r.vx * (1 - r.k);
          fy = r.press ? -PRESS : r.vy * (1 - r.k);
          this.s[a] = Math.min(1, this.s[a]! + dt / GROW_TIME);
        }
        alive++;
      } else {
        this.t[a]! += dt;
        if (this.t[a]! >= this.life[a]!) {
          // The pop itself: hand it to the effects (one record, no allocation).
          if (this.why[a]) pops.push(this.why[a]! as PopKind, this.enemy ? 1 : 0, this.x[a]!, this.y[a]!, this.whyIx[a]!, this.flags[a]!);
          this.release(a);
          continue;
        }
        tx = this.tx[a]!;
        ty = this.ty[a]!;
        dying++;
      }
      let vx = this.vx[a]!;
      let vy = this.vy[a]!;
      let x = this.x[a]!;
      let y = this.y[a]!;
      for (let k = 0; k < steps; k++) {
        vx += (w2 * (tx - x) + w2x * (fx - vx)) * h;
        vy += (w2 * (ty - y) + w2x * (fy - vy)) * h;
        x += vx * h;
        y += vy * h;
      }
      this.vx[a] = vx;
      this.vy[a] = vy;
      this.x[a] = x;
      this.y[a] = y;
      this.act[n++] = a;
    }
    this.nAct = n;
    let ng = 0;
    for (let i = 0; i < n; i++) if (this.big[this.act[i]!]) this.giants[ng++] = this.act[i]!;
    this.nGiants = ng;
    this.alive = alive;
    this.dying = dying;
  }

  /**
   * Light separation: neighbours closer than SEP_D push apart (spatial hash of the dudes, counting
   * sort); then giants push each other apart and shove the dudes round them out of the way.
   */
  private separate() {
    const n = this.nAct;
    const start = this.cellStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      const a = this.act[i]!;
      if (this.big[a]) {
        this.cellOf[a] = -1;
        continue;
      }
      const cx = Math.min(GNX - 1, Math.max(0, Math.floor(this.x[a]! / CELL)));
      const cy = Math.min(GNY - 1, Math.max(0, Math.floor((this.y[a]! - GY0) / CELL)));
      const c = cx + cy * GNX;
      this.cellOf[a] = c;
      start[c + 1]!++;
    }
    for (let c = 0; c < GNX * GNY; c++) start[c + 1]! += start[c]!;
    // Fill (using cellOf scratch order via a running cursor in `cellItems`).
    const cursor = this.cellItemsCursor;
    cursor.set(start.subarray(0, GNX * GNY));
    for (let i = 0; i < n; i++) {
      const a = this.act[i]!;
      if (this.cellOf[a]! >= 0) this.cellItems[cursor[this.cellOf[a]!]!++] = a;
    }
    const d2min = SEP_D * SEP_D;
    for (let i = 0; i < n; i++) {
      const a = this.act[i]!;
      const c = this.cellOf[a]!;
      if (c < 0) continue;
      const cx = c % GNX;
      const cy = (c - cx) / GNX;
      for (let oy = -1; oy <= 1; oy++) {
        const yy = cy + oy;
        if (yy < 0 || yy >= GNY) continue;
        for (let ox = -1; ox <= 1; ox++) {
          const xx = cx + ox;
          if (xx < 0 || xx >= GNX) continue;
          const cc = xx + yy * GNX;
          for (let k = start[cc]!; k < start[cc + 1]!; k++) {
            const b = this.cellItems[k]!;
            if (b <= a) continue;
            const dx = this.x[b]! - this.x[a]!;
            const dy = this.y[b]! - this.y[a]!;
            const d2 = dx * dx + dy * dy;
            if (d2 >= d2min) continue;
            let d = Math.sqrt(d2);
            let ux: number;
            let uy: number;
            if (d < 1) {
              // Exactly on top of each other: split along a fixed per-pair direction.
              const ang = (a * 2.39996 + b) % 6.283;
              ux = Math.cos(ang);
              uy = Math.sin(ang);
              d = 0;
            } else {
              ux = dx / d;
              uy = dy / d;
            }
            const push = (SEP_D - d) * 0.5 * SEP_K;
            this.x[a]! -= ux * push;
            this.y[a]! -= uy * push;
            this.x[b]! += ux * push;
            this.y[b]! += uy * push;
          }
        }
      }
    }
    if (this.nGiants > 0) this.separateGiants();
  }
  private cellItemsCursor = new Int32Array(GNX * GNY);

  private separateGiants() {
    const gs = this.giants;
    const ng = this.nGiants;
    // Giant against giant: apart to about two bodies (they're few, so pairwise).
    for (let i = 0; i < ng; i++) {
      const a = gs[i]!;
      for (let k = i + 1; k < ng; k++) {
        const b = gs[k]!;
        const want = (RAD[this.big[a]!]! + RAD[this.big[b]!]!) * 0.92;
        const dx = this.x[b]! - this.x[a]!;
        const dy = this.y[b]! - this.y[a]!;
        const d2 = dx * dx + dy * dy;
        if (d2 >= want * want) continue;
        let d = Math.sqrt(d2);
        let ux: number;
        let uy: number;
        if (d < 1) {
          const ang = (a * 2.39996 + b) % 6.283;
          ux = Math.cos(ang);
          uy = Math.sin(ang);
          d = 0;
        } else {
          ux = dx / d;
          uy = dy / d;
        }
        const push = (want - d) * 0.5 * 0.6;
        this.x[a]! -= ux * push;
        this.y[a]! -= uy * push;
        this.x[b]! += ux * push;
        this.y[b]! += uy * push;
      }
    }
    // Giant against dude: the dude is shoved out (a giant barely notices).
    const start = this.cellStart;
    for (let i = 0; i < ng; i++) {
      const g = gs[i]!;
      const R = RAD[this.big[g]!]! + G_SHOVE;
      const gx = this.x[g]!;
      const gy = this.y[g]!;
      const span = Math.ceil(R / CELL);
      const cx = Math.floor(gx / CELL);
      const cy = Math.floor((gy - GY0) / CELL);
      for (let yy = Math.max(0, cy - span); yy <= Math.min(GNY - 1, cy + span); yy++) {
        for (let xx = Math.max(0, cx - span); xx <= Math.min(GNX - 1, cx + span); xx++) {
          const cc = xx + yy * GNX;
          for (let k = start[cc]!; k < start[cc + 1]!; k++) {
            const b = this.cellItems[k]!;
            const dx = this.x[b]! - gx;
            const dy = this.y[b]! - gy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= R * R) continue;
            const d = Math.sqrt(d2);
            const ux = d < 1 ? Math.cos(b * 2.39996) : dx / d;
            const uy = d < 1 ? Math.sin(b * 2.39996) : dy / d;
            const push = R - d;
            this.x[b]! += ux * push * 0.85;
            this.y[b]! += uy * push * 0.85;
            this.x[g]! -= ux * push * 0.05;
            this.y[g]! -= uy * push * 0.05;
          }
        }
      }
    }
  }

  /** Out of obstacles, walls, towers, crates, the hall and the lane edges. */
  private collide(solids: Solids, hallUp: boolean) {
    const n = this.nAct;
    for (let i = 0; i < n; i++) {
      const a = this.act[i]!;
      const big = this.big[a]!;
      const BODY = RAD[big]!;
      const edge = big ? BODY : EDGE;
      const yMax = hallUp ? HALL_FRONT - BODY : LANE_LENGTH - 120;
      let x = this.x[a]!;
      let y = this.y[a]!;
      for (let k = 0; k < solids.n; k++) {
        const obstacle = solids.defs[k] != null;
        const pen = pushOut(solids, k, x, y, big && obstacle ? SOLID_R[big]! : BODY, hitOut);
        if (pen > 0) {
          x = hitOut.x;
          y = hitOut.y;
          this.killInto(a, hitOut.nx, hitOut.ny);
          // A giant hitting an obstacle's front or back face slides off sideways (to the side
          // it's already on), so it walks round a pillar instead of stalling against it.
          if (big && obstacle && Math.abs(hitOut.ny) > 0.7) {
            const mid = (solids.box[k * 4]! + solids.box[k * 4 + 2]!) / 2;
            x += (x >= mid ? 1 : -1) * Math.min(pen * 1.5, 40);
          }
        }
      }
      for (let k = 0; k < this.nCrates; k++) {
        const o = k * 4;
        const x0 = this.crateBox[o]! - BODY;
        const y0 = this.crateBox[o + 1]! - BODY;
        const x1 = this.crateBox[o + 2]! + BODY;
        const y1 = this.crateBox[o + 3]! + BODY;
        if (x <= x0 || x >= x1 || y <= y0 || y >= y1) continue;
        const l = x - x0;
        const rr = x1 - x;
        const b = y - y0;
        const tt = y1 - y;
        const m = Math.min(l, rr, b, tt);
        if (m === b) y = y0;
        else if (m === tt) y = y1;
        else if (m === l) x = x0;
        else x = x1;
      }
      for (let k = 0; k < this.nTowers; k++) {
        if (!this.towerLive[k]) continue;
        const dx = x - this.towerX[k]!;
        const dy = y - this.towerY[k]!;
        const R = TOWER_R + BODY;
        const d2 = dx * dx + dy * dy;
        if (d2 >= R * R) continue;
        const d = Math.sqrt(d2) || 1;
        x = this.towerX[k]! + (dx / d) * R;
        y = this.towerY[k]! + (dy / d) * R;
      }
      if (y > yMax) y = yMax;
      if (x < edge) x = edge;
      else if (x > LANE_WIDTH - edge) x = LANE_WIDTH - edge;
      this.x[a] = x;
      this.y[a] = y;
    }
  }

  private killInto(a: number, nx: number, ny: number) {
    const vn = this.vx[a]! * nx + this.vy[a]! * ny;
    if (vn < 0) {
      this.vx[a]! -= vn * nx;
      this.vy[a]! -= vn * ny;
    }
  }

  /**
   * Writes every active agent of kind `kind` (Big) into `mesh` (from instance `from`); returns the
   * next free instance. Giants walk a slower, heavier cycle and squash across to fit a gap.
   */
  write(mesh: InstancedMesh, from: number, kind: Big, scale: number, time: number, dt: number, anim: Float32Array | null): number {
    let n = from;
    const cap = mesh.instanceMatrix.count;
    const turn = Math.min(1, dt * (kind ? 5 : 8));
    for (let i = 0; i < this.nAct && n < cap; i++) {
      const a = this.act[i]!;
      if (this.st[a] === St.Free || this.big[a] !== kind) continue;
      const vx = this.vx[a]!;
      const vy = this.vy[a]!;
      const sp = Math.hypot(vx, vy);
      const dying = this.st[a] === St.Dying;
      // Boosted (cannon launch, speed pad): the cohort itself is fast, so its dudes stretch.
      const owner = dying ? null : this.recs[this.owner[a]!]!;
      const boost = owner ? Math.hypot(owner.vx, owner.vy) : 0;
      // Heading: face where it runs (world: x right, z toward the camera = −y).
      let want = this.yaw[a]!;
      if (dying && this.hop[a]) want = this.face[a]!;
      else if (sp > 260) want = Math.atan2(vx, -vy);
      let d = want - this.yaw[a]!;
      d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      const yaw = (this.yaw[a] = this.yaw[a]! + d * turn);
      // Walk cycle: faster with speed, into the sprint loop once boosted; lingering dudes march.
      const run = Math.max(sp, boost);
      const sprint = kind ? 0 : smooth((run - SPRINT_FROM) / (SPRINT_FULL - SPRINT_FROM));
      const walkRate = kind
        ? Math.min(G_CYC_MAX, Math.max(G_CYC_MIN, (G_CYC * run) / 1200))
        : Math.min(CYC_WALK_MAX, Math.max(CYC_MIN, run * CYC_PER_SPEED));
      const sprintRate = Math.min(CYC_SPRINT_MAX, CYC_SPRINT * Math.max(1, run / SPRINT_FULL));
      const rate = dying && this.hop[a] ? (kind ? 1.6 : 2.4) : walkRate + (sprintRate - walkRate) * sprint;
      const cyc = (this.cyc[a] = fract(this.cyc[a]! + dt * rate));
      let s = this.s[a]!;
      // The baked cycle has its own bob; this is just a little extra spring in the step.
      let lift = Math.abs(Math.sin(cyc * Math.PI * 2)) * (kind ? 0.08 : sp > 150 ? 0.06 : 0.02);
      if (dying) {
        const left = this.life[a]! - this.t[a]!;
        if (this.hop[a]) lift = kind ? Math.abs(Math.sin(time * 8 + this.phase[a]!)) * 0.45 : Math.abs(Math.sin(time * 15 + this.phase[a]!)) * 0.4;
        if (left < POP_TIME) {
          const u = 1 - left / POP_TIME;
          s *= u < 0.4 ? 1 + u * 0.8 : 1.32 * (1 - (u - 0.4) / 0.6);
        }
      }
      if (s <= 0.01) continue;
      // Boosted (cannon launch, speed pad): stretch along the run.
      const k = Math.min(1, Math.max(0, (boost - STRETCH_FROM) / 1400));
      const base = scale * s;
      // A giant in a gap narrower than its drawn body squashes across (and grows a touch taller).
      const sq = kind ? this.squash(this.x[a]!, this.y[a]!, G_HALF[kind]!) : 1;
      const tall = sq < 1 ? 1 + (1 - sq) * 0.35 : 1;
      scl.set(base * (1 - 0.12 * k) * sq, base * (1 - 0.05 * k) * tall, base * (1 + 0.4 * k) * tall);
      eul.set(0, yaw + Math.sin(time * 2.3 + this.phase[a]!) * 0.06, 0);
      q.setFromEuler(eul);
      pos.set(wx(this.x[a]!), lift, wz(this.y[a]!));
      m4.compose(pos, q, scl);
      if (anim) {
        anim[n * 2] = cyc;
        anim[n * 2 + 1] = sprint;
      }
      mesh.setMatrixAt(n++, m4);
    }
    return n;
  }

  /** How much a giant of drawn half-width `half` at (x, y) squashes across to fit (G_SQUASH..1). */
  private squash(x: number, y: number, half: number): number {
    if (!this.solids) return 1;
    spanAt(this.walls, 2 * LANE_WIDTH, x, y, span);
    narrowSpan(this.solids, x, y, half * 0.6, span);
    const room = Math.min(x - span.lo, span.hi - x);
    return Math.max(G_SQUASH, Math.min(1, room / half));
  }
}

/** The slot target scratch (set by slotTarget). */
let sx = 0;
let sy = 0;

function newRec(): Rec {
  return {
    id: -1,
    agents: new Int32Array(MAX_PER),
    n: 0,
    seen: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    lastX: 0,
    lastY: 0,
    big: Big.Dude,
    press: false,
    bx: 0,
    by: 0,
    kx: 1,
    kz: 1,
    c: SPACING,
    cos: 1,
    sin: 0,
    k: 0,
    kind: 0,
    ax: 0,
    ay: 0,
    pipeT0: -1,
    pipeX: 0,
    pipeY: 0,
    pipeOutX: 0,
    pipeOutY: 0,
    spawnAcc: 0,
    instant: false,
  };
}

function resetRec(r: Rec, id: number, big: Big) {
  r.id = id;
  r.big = big;
  r.press = false;
  r.n = 0;
  r.k = 0;
  r.kind = 0;
  r.pipeT0 = -1;
  r.spawnAcc = 0;
}

const smooth = (u: number) => {
  const k = Math.min(1, Math.max(0, u));
  return k * k * (3 - 2 * k);
};

/** Swarm blend for a crowd at y heading for a building line at `ty`: 0 until APPROACH out, eased in. */
const lateTurn = (y: number, ty: number) => {
  const u = Math.min(1, Math.max(0, (y - (ty - APPROACH)) / (APPROACH - TURN_DONE)));
  return smooth(u * u);
};

const fract = (v: number) => v - Math.floor(v);

/**
 * A crate that locks a big gate sits just below that gate's row (a wide, thin plank); a
 * stand-alone one is a chunky block. Both are drawn and collided with this depth (sim units).
 */
export function crateDepth(width: number, lock: boolean): number {
  return lock ? 300 : Math.max(260, Math.min(460, width));
}

/** Whether the crate at (x, y) locks a big gate (a big gate's row is just above it, over its span). */
export function isLockCrate(st: ReturnType<typeof stageDef>, x: number, y: number): boolean {
  for (const g of st.gates) {
    if (!g.big) continue;
    const rowY = st.rows[g.row];
    if (rowY !== undefined && Math.abs(x - g.x) * 2 <= g.width && y < rowY && rowY - y <= 500) return true;
  }
  return false;
}
