# @lil-dudes/sim-wasm

Prebuilt browser build of the match rules (`crates/sim` via `crates/sim-wasm`). The `pkg/` output is
**committed**, so the web app can use the real rules with only Node + pnpm. Kai rebuilds it whenever the
sim changes:

```bash
wasm-pack build crates/sim-wasm --target web --out-dir ../../packages/sim-wasm/pkg
```

Empty until M1 (`OfflineSource` in `@lil-dudes/client` will wrap it).
