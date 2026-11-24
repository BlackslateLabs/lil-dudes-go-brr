"""Auto-tune `TUNE` in crates/sim/src/layouts.rs (tower HP and wave_base per layout) with the
bot-vs-bot balance runner, so every layout plays about as long and as dangerously as the others.

    python tools/balance/tune_layouts.py [--rounds 14] [--matches 400] [--final 1000]
        [--f1 21] [--f2 36] [--deaths 12]

Each round writes TUNE, runs `cargo run -p lil-dudes-sim --example balance --release -- N`,
and nudges each layout toward the targets: Fight 1 / Fight 2 time in seconds (tower HP) and the
death rate in percent of matches (wave_base; split ~55% Fight 1, ~45% Fight 2, as in v6).
Capped matches count as a slow Fight 2, so tower HP comes down until (almost) none hit 3:00.
Damped multiplicative steps, so a few rounds converge; the last run uses --final matches.
Run from the repo root. Leaves the tuned TUNE in layouts.rs (review the diff, then re-record
the goldens with tools/balance/regen_golden.py).
"""
import argparse
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).parents[2]
LAYOUTS = ROOT / "crates/sim/src/layouts.rs"
TUNE_RE = re.compile(r"(const TUNE: \[\(u16, u16, u16, u16\); LAYOUT_COUNT\] = \[\n)(.*?)(\n\];)", re.S)
ROW_RE = re.compile(
    r"^(?P<name>.{12}) +(?P<death>[\d.]+)% +(?P<d1>\d+)/ *(?P<d2>\d+)/ *(?P<d3>\d+) +(?P<cap>[\d.]+)%"
    r" +(?P<draw>[\d.]+)% +(?P<len>[\d.]+) +(?P<f1>[\d.]+) +(?P<f2>[\d.]+)"
)


def read_tune():
    body = TUNE_RE.search(LAYOUTS.read_text(encoding="utf-8")).group(2)
    return [[float(v) for v in re.findall(r"\d+", line)] for line in body.strip().splitlines()]


def write_tune(tune):
    lines = "\n".join(f"    ({round(a)}, {round(b)}, {round(c)}, {round(d)})," for a, b, c, d in tune)
    src = LAYOUTS.read_text(encoding="utf-8")
    src = TUNE_RE.sub(lambda m: m.group(1) + lines + m.group(3), src)
    LAYOUTS.write_text(src, encoding="utf-8", newline="\n")


def run(n):
    cmd = ["cargo", "run", "-q", "-p", "lil-dudes-sim", "--example", "balance", "--release", "--", str(n)]
    out = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True, check=True).stdout
    rows = [m.groupdict() for m in map(ROW_RE.match, out.splitlines()) if m]
    return out, rows[:-1]  # the last row is ALL


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rounds", type=int, default=14)
    ap.add_argument("--matches", type=int, default=400)
    ap.add_argument("--final", type=int, default=1000)
    ap.add_argument("--f1", type=float, default=21.0)
    ap.add_argument("--f2", type=float, default=36.0)
    ap.add_argument("--deaths", type=float, default=12.0)
    a = ap.parse_args()
    want_d = [a.deaths * 0.55, a.deaths * 0.45]
    tune = read_tune()
    for r in range(a.rounds):
        write_tune(tune)
        _, rows = run(a.matches)
        n = a.matches
        for t, row in zip(tune, rows):
            # Stage times only count sides that finished; a capped match (a side still
            # fighting at 3:00) counts as a long Fight 2.
            capped = float(row["cap"]) / 100
            times = [float(row["f1"]), float(row["f2"]) + capped * 120]
            deaths = [100 * int(row["d1"]) / n, 100 * (int(row["d2"]) + int(row["d3"])) / n]
            for k, want_t in enumerate([a.f1, a.f2]):
                hp, wave = 2 * k, 2 * k + 1
                # Fight time follows tower HP; deaths follow wave size.
                t[hp] = clamp(t[hp] * clamp((want_t / max(times[k], 1)) ** 0.8, 0.75, 1.35), 20, 65_000)
                ratio = want_d[k] / max(deaths[k], 0.4)
                t[wave] = clamp(t[wave] * clamp(ratio ** 0.25, 0.85, 1.2), 1, 5_000)
        print(f"round {r}: " + "  ".join(
            f"{row['name'].strip()[:6]} {row['death']}% {row['f1']}/{row['f2']}s" for row in rows))
    write_tune(tune)
    out, _ = run(a.final)
    print(out)
    print("TUNE =", [tuple(round(v) for v in t) for t in tune])


if __name__ == "__main__":
    main()
