# Lil Dudes Go Brr

A live 1v1 crowd-cannon duel on Solana. Steer a cannon, pour your dudes through hidden math gates,
rig your opponent's gates, and knock out their cannon. Every match runs in a MagicBlock Private
Ephemeral Rollup with VRF-dealt gates and on-chain settlement. Devnet only, play money.

- What it is: [docs/IDEA.md](docs/IDEA.md) · Rules: [docs/SPEC.md](docs/SPEC.md) ·
  Tech: [docs/TECH.md](docs/TECH.md) · MVP and build order: [docs/MVP.md](docs/MVP.md)
- Team log: [PROGRESS_LOG.md](PROGRESS_LOG.md)

## Layout

| Path | What |
|---|---|
| `apps/web` | the game client (Vite + React + Three.js / R3F) |
| `apps/server` | faucet top-up + quick-match queue (Hono) |
| `packages/client` | the contract: `MatchView`, events, constants, `MatchSource` (mock / offline / live) |
| `packages/sim-wasm` | prebuilt browser build of the rules |
| `crates/sim` | the match rules: deterministic, integer-only Rust |
| `crates/sim-wasm` | wasm-bindgen wrapper around `crates/sim` |
| `programs/lil_dudes` | Anchor program (MagicBlock ER SDK 0.18) |
| `tests-magicsvm` | MagicSVM integration tests |
| `tools/balance` | balance and settlement simulations |

## Commands

```bash
pnpm install
pnpm dev:web            # game client, reachable from a phone on the same Wi-Fi
pnpm dev:server         # server on :8787
pnpm typecheck          # all TS packages
pnpm test:sim           # cargo test -p lil-dudes-sim
pnpm build:program      # anchor build --ignore-keys
```

Front-end work needs only Node ≥ 22.12 and pnpm 10. Rust, Anchor and the Solana CLI are only needed
for `crates/` and `programs/`.
