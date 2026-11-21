"""Balance + money sim (rough model, not the real game).

Model: each second each side fires B units down one of 3 columns; the stream passes
3 gate rows (affine ops), then the two streams cancel; the surplus hits the other cannon.
Players pick the column with the best *expected* flow given what they know
(revealed gates, peeks, honest-ish hints, rig risk); with prob (1-skill) they misplay.
"""
import random, statistics as st, sys

ROWS, COLS, T, B = 3, 3, 120, 6.0
DECK = [('x', 2), ('x', 2), ('x', 3), ('+', 6), ('+', 10), ('-', 6), ('/', 2), ('x', 2), ('+', 6)]
TRAP = ('/', 2)

def affine(g, cfg):
    op, v = g
    if op == 'x': return (v, 0.0)
    if op == '+': return (1.0, v)
    if op == '-': return (1.0, -v)
    if op == '/': return (1.0 / v, 0.0)
    if op == 'gold': return (cfg['gold'], 0.0) if v else (1.0 / cfg['gold'], 0.0)

def pos(g): return g[0] in 'x+' or (g[0] == 'gold')

def mean_aff(gs, cfg):
    a = [affine(g, cfg) for g in gs]
    return (sum(x for x, _ in a) / len(a), sum(y for _, y in a) / len(a))

def flow(col_gates, cfg, mult=1.0):
    c = B * mult
    for g in col_gates:
        a, b = affine(g, cfg)
        c = max(0.0, a * c + b)
    return c

class Side:
    def __init__(s, skill): s.skill = skill

def new_phase(sides, cfg, rng, first):
    if cfg['mirror']:
        base = DECK[:]; rng.shuffle(base)
        layouts = [base[:], base[:]]
    else:
        layouts = []
        for _ in sides:
            d = DECK[:]; rng.shuffle(d); layouts.append(d)
    gold_val = rng.random() < 0.5
    gold_cell = rng.randrange(9)
    for i, s in enumerate(sides):
        g = layouts[i][:]
        gc = gold_cell if cfg['mirror'] else rng.randrange(9)
        g[gc] = ('gold', gold_val)
        s.grid = g
        s.true_hint = [('gold' if x[0] == 'gold' else ('blue' if pos(x) else 'red')) if rng.random() < cfg['hint_p'] or x[0] == 'gold' else 'gray' for x in g]
        s.known = [None] * 9
        s.rigged = [False] * 9
    # plant phase: each side rigs one opponent cell (blind to hints, not gold)
    for i, s in enumerate(sides):
        o = sides[1 - i]
        if cfg['rigs']:
            cand = [k for k in range(9) if o.grid[k][0] != 'gold']
            k = rng.choice(cand)
            o.grid[k] = TRAP; o.rigged[k] = True; o.true_hint[k] = 'blue'
        o.rig_pending = cfg['rigs']
    for s in sides: s.peek_left = cfg['peeks']

def belief(s, o, k, cfg):
    if s.known[k] is not None: return affine(s.known[k], cfg)
    if cfg['mirror'] and o.known[k] is not None:  # mirror revealed on their side
        mv = o.known[k] if not o.rigged[k] else None
        if mv is not None and mv[0] != 'gold':
            if not pos(mv) and s.true_hint[k] == 'blue':
                return affine(TRAP, cfg)  # contradiction -> it's a rig
            return affine(mv, cfg)
        if mv is not None: return affine(mv, cfg)
    h = s.true_hint[k]
    if h == 'gold': return mean_aff([('gold', True), ('gold', False)], cfg)
    if h == 'blue':
        pool = [g for g in DECK if pos(g)]
        a, b = mean_aff(pool, cfg)
        nblue = sum(1 for j in range(9) if s.true_hint[j] == 'blue' and s.known[j] is None)
        pr = (1.0 / max(1, nblue)) if s.rig_pending else 0.0
        ta, tb = affine(TRAP, cfg)
        return (a * (1 - pr) + ta * pr, b * (1 - pr) + tb * pr)
    if h == 'red': return mean_aff([g for g in DECK if not pos(g)], cfg)
    return mean_aff(DECK, cfg)

def exp_flow(s, o, col, cfg):
    c = B
    for r in range(ROWS):
        a, b = belief(s, o, r * COLS + col, cfg)
        c = max(0.0, a * c + b)
    return c

def choose(s, o, cfg, rng):
    if rng.random() > s.skill: return rng.randrange(COLS)
    return max(range(COLS), key=lambda c: exp_flow(s, o, c, cfg))

def play(cfg, skA, skB, rng, record_half=False):
    sides = [Side(skA), Side(skB)]
    hp = [cfg['hp'], cfg['hp']]
    dmg_total = 0.0; dmg_surge = 0.0; half = None
    for t in range(T):
        if t % cfg['phase_len'] == 0: new_phase(sides, cfg, rng, t == 0)
        # peeks: use one at phase start+2s on best column's first unknown
        for i, s in enumerate(sides):
            o = sides[1 - i]
            if s.peek_left and t % cfg['phase_len'] == 2:
                col = max(range(COLS), key=lambda c: exp_flow(s, o, c, cfg))
                for r in range(ROWS):
                    k = r * COLS + col
                    if s.known[k] is None:
                        s.known[k] = s.grid[k]; s.peek_left -= 1; break
        mult = cfg['surge'] if t >= T - 15 else 1.0
        f = []
        for i, s in enumerate(sides):
            o = sides[1 - i]
            col = choose(s, o, cfg, rng)
            gates = [s.grid[r * COLS + col] for r in range(ROWS)]
            f.append(flow(gates, cfg, mult))
            for r in range(ROWS):
                k = r * COLS + col
                if s.known[k] is None: s.known[k] = s.grid[k]
                if s.rigged[k]: s.rig_pending = False
        net = f[0] - f[1]
        if net > 0: hp[1] -= net
        else: hp[0] += net
        dmg_total += abs(net)
        if mult > 1: dmg_surge += abs(net)
        if t == 59: half = (hp[0] - hp[1]) / cfg['hp']
        if hp[0] <= 0 or hp[1] <= 0: break
    hp = [max(0.0, h) for h in hp]
    ko = hp[0] == 0 or hp[1] == 0
    return dict(hp=hp, ko=ko, t=t + 1, dmg=dmg_total, surge=dmg_surge, half=half)

def moved_frac(r, cfg):
    a, b = r['hp']
    if a == b: return 0.0, 0
    w = 0 if a > b else 1
    if r['ko']: return 1.0, w
    lead = abs(a - b) / cfg['hp']
    return cfg['floor'] + (1 - cfg['floor']) * lead, w

def summarize(name, cfg, n=4000, seed=1):
    rng = random.Random(seed)
    eq = [play(cfg, 0.85, 0.85, rng) for _ in range(n)]
    gap = [play(cfg, 0.90, 0.60, rng) for _ in range(n)]
    def stats(rs):
        ko = sum(r['ko'] for r in rs) / len(rs)
        mf = [moved_frac(r, cfg) for r in rs]
        winsA = sum(1 for (m, w) in mf if m > 0 and w == 0) / len(rs)
        ties = sum(1 for (m, w) in mf if m == 0) / len(rs)
        leads = [abs(r['hp'][0] - r['hp'][1]) / cfg['hp'] for r in rs if not r['ko']]
        surge = sum(r['surge'] for r in rs) / max(1e-9, sum(r['dmg'] for r in rs))
        return ko, winsA, ties, st.mean(m for m, _ in mf), (st.median(leads) if leads else 0), surge, st.mean(r['t'] for r in rs)
    print(f"\n== {name} ==")
    for lbl, rs in (("equal skill 0.85 v 0.85", eq), ("skill gap 0.90 v 0.60", gap)):
        ko, wa, ti, mm, ml, sg, tl = stats(rs)
        print(f"  {lbl:24s} KO {ko:5.1%} | A wins {wa:5.1%} | ties {ti:4.1%} | avg moved {mm:5.1%} of S"
              f" | median timer lead {ml:5.1%} | dmg in Surge {sg:5.1%} | avg len {tl:5.1f}s")
    return eq, gap

DOC = dict(mirror=True, gold=10.0, surge=4.0, phase_len=120, hp=1000, hint_p=0.6, rigs=True, peeks=1, floor=0.5)
REF = dict(mirror=False, gold=3.0, surge=1.5, phase_len=40, hp=1500, hint_p=0.6, rigs=True, peeks=1, floor=0.5)

def raise_table(cfg, n=6000, seed=7):
    """At 1:00, bucket the HP lead; estimate trailing player's P(win) and money outcomes."""
    rng = random.Random(seed)
    buckets = {}
    for _ in range(n):
        r = play(cfg, 0.85, 0.85, rng)
        if r['half'] is None: continue  # KO before halftime
        lead = r['half']  # + means A ahead
        trail = 1 if lead > 0 else 0
        m, w = moved_frac(r, cfg)
        bk = min(4, int(abs(lead) * 100 // 10))  # 0-10%,10-20%,...,40%+
        buckets.setdefault(bk, []).append((w == trail and m > 0, m, abs(lead)))
    print(f"\n  Raise at 1:00 (equal skill) | fee 5% | trailing player's view")
    print("  lead bucket | n    | P(trailer wins) | fold cost (xS) | EV if call at 2S (xS) | right call")
    for bk in sorted(buckets):
        rows = buckets[bk]
        p = sum(1 for x in rows if x[0]) / len(rows)
        fold = st.mean(cfg['floor'] + (1 - cfg['floor']) * x[2] for x in rows)
        ev = st.mean((2 * m * 0.95) if won else (-2 * m) for won, m, _ in rows)
        print(f"  {bk*10:>3d}-{bk*10+10 if bk<4 else 100:<3d}%    | {len(rows):<4d} | {p:14.1%} | {-fold:13.2f} | {ev:20.2f} | {'CALL' if ev > -fold else 'FOLD'}")

if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'tune':
    MIR = dict(mirror=True, gold=3.0, surge=1.5, phase_len=40, hint_p=0.6, rigs=True, peeks=1, floor=0.5)
    for hp in (3000, 4500, 6000):
        summarize(f"TUNED mirrored, re-deal 40s, gold x3/÷3, Surge x1.5, HP {hp}", {**MIR, 'hp': hp}, n=2500)
    sys.exit()

if __name__ == '__main__' and len(sys.argv) > 1 and sys.argv[1] == 'raise':
    cfg = dict(mirror=True, gold=3.0, surge=1.5, phase_len=40, hint_p=0.6, rigs=True, peeks=1, floor=0.5, hp=int(sys.argv[2]))
    raise_table(cfg)
    sys.exit()

if __name__ == '__main__':
    summarize("DOC as written (mirrored, gold x10/÷10, Surge doubles gates ~x4 flow, fixed gates, HP 1000)", DOC)
    summarize("DOC but gold x3/÷3 only", {**DOC, 'gold': 3.0})
    summarize("REFINED (same deck shuffled per side, gold x3/÷3, Surge x1.5 fire rate, re-deal every 40s, HP 1500)", REF)
    summarize("REFINED but HP 1000", {**REF, 'hp': 1000})
    summarize("REFINED but no rigs/peeks (control)", {**REF, 'rigs': False, 'peeks': 0})
