// MockSource: a scripted, approximate match so the front end can be built before the real rules
// exist. It produces every MatchView field and every MatchEvent type. It is NOT the rules: numbers,
// clash and bot behaviour are rough. The real rules arrive as OfflineSource (WASM) in M1.
import * as C from './constants';
import type { MatchListener, MatchSource } from './source';
import type {
  CohortView,
  GateOp,
  GateView,
  Hint,
  MatchEvent,
  MatchResult,
  MatchView,
  PrivateView,
  Side,
} from './types';

interface Gate {
  op: GateOp;
  gold: boolean;
  hint: Hint;
  revealed: boolean;
  riggedBy: Side | null;
}

interface Cohort extends CohortView {
  lastRow: number;
}

interface SideState {
  name: string;
  isBot: boolean;
  hp: number;
  cannonX: number;
  aimX: number;
  cohorts: Cohort[];
  gates: Gate[];
  rigUsed: boolean;
  peekUsed: boolean;
}

export interface MockOptions {
  /** Which side the viewer plays. Default 0. */
  mySide?: Side;
  myName?: string;
  opponentName?: string;
  /** Lamports. Default 0 (free). */
  stake?: number;
  /** Playback speed multiplier for testing (2 = twice as fast). Default 1. */
  speed?: number;
  /** Start at this tick (e.g. C.SURGE_TICK to jump to Surge). Default 0. */
  startTick?: number;
}

const DECK: GateOp[] = [
  { kind: 'mul', value: 2 },
  { kind: 'mul', value: 2 },
  { kind: 'mul', value: 2 },
  { kind: 'mul', value: 3 },
  { kind: 'add', value: 6 },
  { kind: 'add', value: 6 },
  { kind: 'add', value: 10 },
  { kind: 'sub', value: 6 },
  { kind: 'div', value: 2 },
];

const isGood = (op: GateOp) => op.kind === 'mul' || op.kind === 'add';

export function applyOp(op: GateOp, c: number): number {
  switch (op.kind) {
    case 'mul':
      return c * op.value;
    case 'add':
      return c + op.value;
    case 'sub':
      return Math.max(0, c - op.value);
    case 'div':
      return Math.floor(c / op.value);
  }
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** One mirrored deal: both sides get identical values (SPEC §2, §4). */
function deal(): [Gate[], Gate[]] {
  const ops = shuffle(DECK.map((o) => ({ ...o })));
  const goldCell = Math.floor(Math.random() * 9);
  const goldOp: GateOp = Math.random() < 0.5 ? { kind: 'mul', value: 3 } : { kind: 'div', value: 3 };
  const hints = ops.map((op) => (Math.random() < 0.6 ? (isGood(op) ? 'good' : 'bad') : 'none') as Hint);
  const make = (): Gate[] =>
    ops.map((op, i) => ({
      op: i === goldCell ? goldOp : op,
      gold: i === goldCell,
      hint: i === goldCell ? 'gold' : hints[i]!,
      revealed: false,
      riggedBy: null,
    }));
  return [make(), make()];
}

const colCenter = (col: number) => col * C.COL_WIDTH + C.COL_WIDTH / 2;
const clampX = (x: number) => Math.max(0, Math.min(C.LANE_WIDTH - 1, x));

export class MockSource implements MatchSource {
  readonly mySide: Side;
  private listeners = new Set<MatchListener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private tick: number;
  private nextId = 1;
  private sides: [SideState, SideState];
  private result: MatchResult | null = null;
  private myPeek: PrivateView['myPeek'] = null;
  private readonly stake: number;
  private readonly speed: number;
  private readonly matchId = `mock-${Math.random().toString(36).slice(2, 8)}`;

  constructor(opts: MockOptions = {}) {
    this.mySide = opts.mySide ?? 0;
    this.stake = opts.stake ?? 0;
    this.speed = opts.speed ?? 1;
    this.tick = opts.startTick ?? 0;
    const [a, b] = deal();
    const mk = (name: string, isBot: boolean, gates: Gate[]): SideState => ({
      name,
      isBot,
      hp: C.HP_MAX,
      cannonX: C.LANE_WIDTH / 2,
      aimX: C.LANE_WIDTH / 2,
      cohorts: [],
      gates,
      rigUsed: false,
      peekUsed: false,
    });
    const me = mk(opts.myName ?? 'You', false, a);
    const them = mk(opts.opponentName ?? 'Warlord', true, b);
    this.sides = this.mySide === 0 ? [me, them] : [them, me];
  }

  subscribe(listener: MatchListener): () => void {
    this.listeners.add(listener);
    listener(this.view(), this.priv(), []);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), C.TICK_MS / this.speed);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setAim(x: number): void {
    this.sides[this.mySide].aimX = clampX(x);
  }

  rig(cell: number): void {
    const me = this.sides[this.mySide];
    const target = this.sides[(1 - this.mySide) as Side].gates[cell];
    if (!target || me.rigUsed || this.status() !== 'plant' || target.gold) return;
    me.rigUsed = true;
    target.riggedBy = this.mySide;
    target.hint = 'good'; // fake blue
  }

  peek(cell: number): void {
    const me = this.sides[this.mySide];
    const g = me.gates[cell];
    if (!g || me.peekUsed || g.revealed || this.result) return;
    me.peekUsed = true;
    this.myPeek = { cell, op: g.riggedBy !== null ? { kind: 'div', value: 2 } : g.op, gold: g.gold };
  }

  /** Advance one tick. Public so tests and tools can drive the mock without timers. */
  step(): void {
    if (this.result) return;
    const ev: MatchEvent[] = [];
    const t = this.tick;

    const phaseStart = (C.PLANT_STARTS as readonly number[]).indexOf(t);
    if (phaseStart > 0) this.redeal(phaseStart, ev);
    if (phaseStart >= 0) {
      ev.push({ type: 'plant', phase: phaseStart });
      this.botRig();
    }
    if (t === C.SURGE_TICK) ev.push({ type: 'surge' });

    for (const s of [0, 1] as Side[]) this.moveCannon(s);

    if (this.status() === 'playing') {
      const every = t >= C.SURGE_TICK ? C.FIRE_TICKS_SURGE : C.FIRE_TICKS;
      if (t % every === 0) for (const s of [0, 1] as Side[]) this.fire(s, ev);
    }
    for (const s of [0, 1] as Side[]) this.advanceCohorts(s, ev);
    this.clash(ev);

    this.tick++;
    const [a, b] = this.sides;
    if (a.hp <= 0 || b.hp <= 0 || this.tick >= C.MATCH_TICKS) this.finish(ev);

    const view = this.view();
    const priv = this.priv();
    for (const l of this.listeners) l(view, priv, ev);
    if (this.result) this.stop();
  }

  // --- internals -------------------------------------------------------------------------------

  private phase(): number {
    return this.tick >= C.PLANT_STARTS[2] ? 2 : this.tick >= C.PLANT_STARTS[1] ? 1 : 0;
  }

  private status(): MatchView['status'] {
    if (this.result) return 'ended';
    const start = C.PLANT_STARTS[this.phase() as 0 | 1 | 2];
    return this.tick < start + C.PLANT_TICKS ? 'plant' : 'playing';
  }

  private redeal(phase: number, ev: MatchEvent[]) {
    const [a, b] = deal();
    this.sides[0].gates = a;
    this.sides[1].gates = b;
    for (const s of this.sides) {
      s.rigUsed = false;
      s.peekUsed = false;
    }
    this.myPeek = null;
    ev.push({ type: 'redeal', phase });
  }

  private botRig() {
    const botSide = (1 - this.mySide) as Side;
    const bot = this.sides[botSide];
    if (!bot.isBot || bot.rigUsed) return;
    const targets = this.sides[this.mySide].gates.filter((g) => !g.gold);
    const g = targets[Math.floor(Math.random() * targets.length)];
    if (!g) return;
    bot.rigUsed = true;
    g.riggedBy = botSide;
    g.hint = 'good';
  }

  private moveCannon(s: Side) {
    const side = this.sides[s];
    if (side.isBot && this.tick % 40 === 0) {
      // Rough bot: prefer a revealed good gate in row 0, else a random column.
      const good = [0, 1, 2].filter((c) => {
        const g = side.gates[c]!;
        return g.revealed && isGood(g.op);
      });
      const col = good.length ? good[Math.floor(Math.random() * good.length)]! : Math.floor(Math.random() * 3);
      side.aimX = colCenter(col);
    }
    const d = side.aimX - side.cannonX;
    side.cannonX += Math.max(-C.CANNON_STEP, Math.min(C.CANNON_STEP, d));
  }

  private fire(s: Side, ev: MatchEvent[]) {
    const side = this.sides[s];
    if (side.cohorts.length >= C.COHORT_CAP) return;
    const c: Cohort = { id: this.nextId++, count: C.VOLLEY_SIZE, x: side.cannonX, y: 0, age: 0, lastRow: 0 };
    side.cohorts.push(c);
    ev.push({ type: 'volley', side: s, cohortId: c.id, x: c.x, count: c.count });
  }

  private advanceCohorts(s: Side, ev: MatchEvent[]) {
    const side = this.sides[s];
    const enemy = this.sides[(1 - s) as Side];
    for (const c of side.cohorts) {
      c.y += c.age < C.LAUNCH_TICKS ? C.LAUNCH_SPEED : C.CRUISE_SPEED;
      c.age++;
      while (c.lastRow < C.ROWS && c.y >= C.ROW_Y[c.lastRow]!) {
        const row = c.lastRow;
        c.lastRow++;
        const col = Math.min(C.COLS - 1, Math.floor(c.x / C.COL_WIDTH));
        if (Math.abs(c.x - colCenter(col)) > C.GATE_WIDTH / 2) continue; // passed through a gap
        const cell = C.cellOf(row, col);
        const g = side.gates[cell]!;
        const rigged = g.riggedBy !== null;
        const op: GateOp = rigged ? { kind: 'div', value: 2 } : g.op;
        if (!g.revealed) {
          g.revealed = true;
          if (rigged) {
            ev.push({ type: 'gotcha', side: s, cell, riggedBy: g.riggedBy! });
            g.op = op;
          }
          ev.push({ type: 'reveal', side: s, cell, op, gold: g.gold });
        }
        const before = c.count;
        c.count = applyOp(op, c.count);
        ev.push({ type: 'gate', side: s, cell, cohortId: c.id, before, after: c.count });
      }
      if (c.y >= C.LANE_LENGTH && c.count > 0) {
        enemy.hp = Math.max(0, enemy.hp - c.count);
        ev.push({ type: 'hit', side: (1 - s) as Side, damage: c.count, hp: enemy.hp });
        c.count = 0;
      }
    }
    side.cohorts = side.cohorts.filter((c) => c.count > 0 && c.y < C.LANE_LENGTH);
  }

  private clash(ev: MatchEvent[]) {
    const [A, B] = this.sides;
    for (const a of A.cohorts) {
      for (const b of B.cohorts) {
        if (a.count === 0 || b.count === 0) continue;
        // Both measure y from their own cannon; they meet when the distances add up to the lane.
        if (a.y + b.y < C.LANE_LENGTH) continue;
        // B's x is mirrored on screen but both use the same lane coordinates here.
        if (Math.abs(a.x - b.x) > C.COL_WIDTH * 0.6) continue;
        const k = Math.min(a.count, b.count);
        a.count -= k;
        b.count -= k;
        ev.push({ type: 'clash', x: (a.x + b.x) / 2, y: a.y, killedA: k, killedB: k });
      }
    }
    A.cohorts = A.cohorts.filter((c) => c.count > 0);
    B.cohorts = B.cohorts.filter((c) => c.count > 0);
  }

  private finish(ev: MatchEvent[]) {
    const [a, b] = this.sides;
    const ko = a.hp <= 0 || b.hp <= 0;
    const winner: Side | null = a.hp === b.hp ? null : a.hp > b.hp ? 0 : 1;
    let moved = 0;
    if (winner !== null && this.stake > 0) {
      const hw = this.sides[winner].hp;
      const hl = this.sides[(1 - winner) as Side].hp;
      const leadPm = ko ? 1000 : Math.floor(((hw - hl) * 1000) / C.HP_MAX);
      moved = Math.floor((this.stake * (500 * 1000 + 500 * leadPm)) / 1_000_000);
    }
    this.result = { winner, ko, moved, fee: Math.floor((moved * 500) / 10_000) };
    ev.push({ type: 'end', result: this.result });
  }

  private view(): MatchView {
    const side = (s: SideState) => ({
      name: s.name,
      isBot: s.isBot,
      hp: s.hp,
      cannonX: s.cannonX,
      aimX: s.aimX,
      rigUsed: s.rigUsed,
      peekUsed: s.peekUsed,
      cohorts: s.cohorts.map(({ id, count, x, y, age }) => ({ id, count, x, y, age })),
      gates: s.gates.map(
        (g, cell): GateView => ({ cell, hint: g.revealed ? 'none' : g.hint, revealed: g.revealed ? g.op : null, gold: g.gold }),
      ),
    });
    return {
      matchId: this.matchId,
      tick: this.tick,
      status: this.status(),
      phase: this.phase(),
      surge: this.tick >= C.SURGE_TICK,
      stake: this.stake,
      sides: [side(this.sides[0]), side(this.sides[1])],
      result: this.result,
    };
  }

  private priv(): PrivateView {
    const theirs = this.sides[(1 - this.mySide) as Side].gates;
    const rigCell = theirs.findIndex((g) => g.riggedBy === this.mySide);
    return { myRig: rigCell >= 0 ? rigCell : null, myPeek: this.myPeek };
  }
}
