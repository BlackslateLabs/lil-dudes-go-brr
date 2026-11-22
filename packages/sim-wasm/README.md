# @lil-dudes/sim-wasm

Prebuilt browser build of the match rules (`crates/sim` via `crates/sim-wasm`, with the Warlord bot
built in). The `pkg/` output is **committed**, so the web app runs the real rules with only Node +
pnpm. You normally never import this directly: `OfflineSource` in `@lil-dudes/client` wraps it.

- `pkg/sim.js` + `pkg/sim.d.ts`: the wasm-bindgen API (`SimMatch`, `Bot`, `constants_json` with the
  layout pool, `deals_for`, `gate_x_at`, `rules_version`).
- `pkg/sim_inline.js`: the `.wasm` as base64, so it loads synchronously (`initSync`) in the browser,
  Vite and Node, with no fetch, asset URL or bundler plugin. ~90 KB.
- `pkg/sim_bg.wasm`: the raw module (~67 KB).

The flat view/event layouts are documented at the top of `crates/sim-wasm/src/lib.rs` and decoded
in `packages/client/src/offline.ts`.

Kai rebuilds it whenever the sim changes (needs Rust + `wasm32-unknown-unknown` + `wasm-pack`):

```bash
bash packages/sim-wasm/build.sh     # or: pnpm --filter @lil-dudes/sim-wasm rebuild
```
