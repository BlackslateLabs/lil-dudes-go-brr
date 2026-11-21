#!/usr/bin/env bash
# Rebuild the prebuilt browser sim from crates/sim-wasm and commit packages/sim-wasm/pkg.
# Needs Rust with the wasm32-unknown-unknown target and wasm-pack (Kai's machine only).
set -euo pipefail
cd "$(dirname "$0")/../.."
wasm-pack build crates/sim-wasm --release --target web --no-pack \
  --out-dir ../../packages/sim-wasm/pkg --out-name sim
rm -f packages/sim-wasm/pkg/.gitignore
node packages/sim-wasm/inline.mjs
ls -l packages/sim-wasm/pkg
