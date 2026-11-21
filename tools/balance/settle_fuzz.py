"""Integer settlement (micro-USDC). Fuzz: every unit in == every unit out."""
import random

HP_MAX, FEE_BPS, FLOOR_PM, TOLL_PM = 2200, 500, 500, 150  # floor 50%, toll 15%

def settle(dep_a, dep_b, hp_a, hp_b, raised, declined_by):
    """dep_* = what each player deposited (2x their chosen stake). Returns payouts + treasury."""
    s = min(dep_a, dep_b) // 2                      # matched stake S
    out = {'a': dep_a, 'b': dep_b, 'treasury': 0}   # start from full refund
    level = s
    if raised and declined_by is None: level = 2 * s
    if declined_by is not None:                     # toll moves first, no fee on tolls? -> fee applies too
        toll = s * TOLL_PM // 1000
        payer, recv = declined_by, ('b' if declined_by == 'a' else 'a')
        fee = toll * FEE_BPS // 10000
        out[payer] -= toll; out[recv] += toll - fee; out['treasury'] += fee
    if hp_a == hp_b: return out
    w, l = ('a', 'b') if hp_a > hp_b else ('b', 'a')
    hw, hl = max(hp_a, hp_b), min(hp_a, hp_b)
    if hl == 0: moved = level                                    # KO
    else:
        lead_pm = (hw - hl) * 1000 // HP_MAX                     # floor() -> loser-favourable
        moved = level * (FLOOR_PM * 1000 + (1000 - FLOOR_PM) * lead_pm) // 1_000_000
    fee = moved * FEE_BPS // 10000
    out[l] -= moved; out[w] += moved - fee; out['treasury'] += fee
    return out

def main():
    rng = random.Random(0); worst = 0
    for i in range(300_000):
        da = 2 * rng.choice([0, 1, 5, 6, 10, 11, 20]) * 1_000_000 + 2 * rng.randrange(0, 1_000_000)
        db = 2 * rng.choice([0, 1, 5, 6, 10, 11, 20]) * 1_000_000 + 2 * rng.randrange(0, 1_000_000)
        ha, hb = rng.randrange(0, HP_MAX + 1), rng.randrange(0, HP_MAX + 1)
        if rng.random() < 0.2: ha = 0 if rng.random() < .5 else ha
        if ha == 0 and hb == 0: hb = 1
        raised = rng.random() < 0.4
        dec = rng.choice([None, 'a', 'b']) if raised else None
        o = settle(da, db, ha, hb, raised, dec)
        assert o['a'] + o['b'] + o['treasury'] == da + db, (i, da, db, o)
        assert o['a'] >= 0 and o['b'] >= 0, (i, da, db, ha, hb, raised, dec, o)
    print("300k random settlements: conservation exact, no negative balance. OK")
    # worst-case escrow need: raise accepted + KO = 2S moved; toll path = 0.15S + S
    print("escrow needed per player = 2S covers max loss 2S (raise+KO) and 1.15S (toll+KO).")
    print("example S=$10: KO", settle(20_000_000, 20_000_000, 900, 0, False, None))
    print("example S=$10: 60% vs 40% HP", settle(20_000_000, 20_000_000, 1320, 880, False, None))
    print("example S=$10: raise taken, 51/49", settle(20_000_000, 20_000_000, 1122, 1078, True, None))
    print("example S=$10: b declines raise, then loses 40/60", settle(20_000_000, 20_000_000, 1320, 880, True, 'b'))


if __name__ == "__main__":
    main()
