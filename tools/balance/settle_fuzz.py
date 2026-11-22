"""Integer settlement, SPEC v3 section 8 (lamports). Fuzz: every lamport in == every lamport out.

- A death: the survivor wins, moved = S (the loser's whole stake).
- Both survive: the pot 2S splits in the ratio of gold, so the winner (more gold) gains
  moved = floor(S * (g_w - g_l) / (g_w + g_l)) (floored for the loser).
- Both dead on the same tick, or equal gold (incl. 0 / 0): draw, nothing moves.
- Fee = floor(moved * FEE_BPS / 10_000), out of the winner's gain, to the treasury.
"""
import random

FEE_BPS = 500


def settle(dep_a, dep_b, dead_a, dead_b, gold_a, gold_b):
    """dep_* = what each player escrowed; S = the matched (lower) stake. Returns payouts + treasury."""
    s = min(dep_a, dep_b)
    out = {'a': dep_a, 'b': dep_b, 'treasury': 0}  # start from a full refund
    if dead_a and dead_b:
        return out
    if dead_a or dead_b:
        w, l = ('b', 'a') if dead_a else ('a', 'b')
        moved = s
    else:
        if gold_a == gold_b:
            return out
        w, l = ('a', 'b') if gold_a > gold_b else ('b', 'a')
        gw, gl = max(gold_a, gold_b), min(gold_a, gold_b)
        moved = s * (gw - gl) // (gw + gl)
    fee = moved * FEE_BPS // 10_000
    out[l] -= moved
    out[w] += moved - fee
    out['treasury'] += fee
    return out


def random_case(rng):
    def dep():
        return rng.choice([0, 1, 50, 100, 250]) * 1_000_000 + rng.randrange(0, 1_000_000)
    da, db = dep(), dep()
    dead_a, dead_b = rng.random() < 0.1, rng.random() < 0.1
    big = rng.random() < 0.1
    ga = rng.randrange(0, 4_000_000_000 if big else 5_000)
    gb = rng.randrange(0, 4_000_000_000 if big else 5_000)
    if rng.random() < 0.05:
        gb = ga
    return da, db, dead_a, dead_b, ga, gb


def main():
    rng = random.Random(0)
    for i in range(300_000):
        da, db, xa, xb, ga, gb = random_case(rng)
        o = settle(da, db, xa, xb, ga, gb)
        assert o['a'] + o['b'] + o['treasury'] == da + db, (i, da, db, o)
        assert o['a'] >= 0 and o['b'] >= 0, (i, da, db, xa, xb, ga, gb, o)
        # Nobody loses more than the matched stake.
        s = min(da, db)
        assert da - o['a'] <= s and db - o['b'] <= s, (i, o)
    print("300k random settlements: conservation exact, no negative balance, loss <= S. OK")
    S = 1_000_000_000
    print("SPEC table, S = 1 SOL:")
    print("  B dies          ", settle(S, S, False, True, 0, 0))
    print("  900 vs 600 gold ", settle(S, S, False, False, 900, 600))
    print("  700 vs 650 gold ", settle(S, S, False, False, 700, 650))
    print("  500 vs 500 gold ", settle(S, S, False, False, 500, 500))


if __name__ == "__main__":
    main()
