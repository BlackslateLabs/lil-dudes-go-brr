"""Re-record crates/sim/tests/golden.rs GOLDEN and crates/sim-wasm PARITY_DIGEST from the tests'
own output (after an intended rule change; bump RULES_VERSION first, rebuild packages/sim-wasm
after). Run from the repo root:  python tools/balance/regen_golden.py
"""
import pathlib
import re
import subprocess

ROOT = pathlib.Path(__file__).parents[2]
GOLDEN = ROOT / "crates/sim/tests/golden.rs"
WASM = ROOT / "crates/sim-wasm/src/lib.rs"


def test_output(*args):
    cmd = ["cargo", "test", *args, "--", "--nocapture"]
    return subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True).stdout


out = test_output("-p", "lil-dudes-sim", "--test", "golden")
lines = [l[len("GOLDEN"):] for l in out.splitlines() if l.startswith("GOLDEN")]
assert lines, out
src = GOLDEN.read_text(encoding="utf-8")
body = "const GOLDEN: &[Golden] = &[\n" + "\n".join(lines) + "\n];"
src = re.sub(r"const GOLDEN: &\[Golden\] = &\[.*?\n\];", lambda _: body, src, flags=re.S)
GOLDEN.write_text(src, encoding="utf-8", newline="\n")
print("\n".join(lines))

out = test_output("-p", "lil-dudes-sim-wasm", "parity_match_digest")
m = re.search(r"PARITY_DIGEST = (\d+)", out)
assert m, out
digest = f"{int(m.group(1)):_}"
src = re.sub(r"const PARITY_DIGEST: u64 = [\d_]+;", f"const PARITY_DIGEST: u64 = {digest};",
             WASM.read_text(encoding="utf-8"))
WASM.write_text(src, encoding="utf-8", newline="\n")
print("PARITY_DIGEST", digest)
subprocess.run(["cargo", "fmt", "-p", "lil-dudes-sim", "-p", "lil-dudes-sim-wasm"], cwd=ROOT, check=True)
