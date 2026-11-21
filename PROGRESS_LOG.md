# Progress log

Shared, append-only log for Kai and Suparno. **Add new entries at the bottom.** Never
edit or delete someone else's entry. Read the last ~10 entries at the start of every session.

Tags (use any that apply): `CONTRACT` (changes `packages/client` / `MatchView`), `BLOCKER`,
`DECISION`, `HANDOFF` (asks the other person to do something), `STAGE` (a stage exit test passed).

Template:

```
## YYYY-MM-DD HH:MM IST · <Kai|Suparno> · <area> · [TAGS]
**Did:** what changed (files/areas), in 1–4 bullets
**Decided:** decisions and why (or "none")
**Blocked / risks:** (or "none")
**Next / handoff:** what comes next, and anything the other person must do
```

---

## 2026-11-21 · Kai · planning · [DECISION]
**Did:**
- Reviewed the v1 design. Ran balance sims (`tools/balance/balance_sim.py`)
  and a settlement fuzzer (`tools/balance/settle_fuzz.py`, 300k cases, conservation exact).
- Wrote `docs/SPEC.md` (game v2), `docs/TECH.md` (architecture, PROPOSED), this log.
- Verified on devnet: TEE ER, VRF oracle and pricing oracle are live; ER slots are ~10 ms; ER VRF is
  free and <50 ms (docs); Private ER permissions are per account; Magic Actions can move funds; the RPS
  example's web stack works with Anchor 1.0.2.

**Decided:**
- v2 rule changes vs v1: re-deal gates every 40 s; gold ×3/÷3 (not ×10/÷10); HP tuned for ~25% KO
  (v1 gave 60–95% KO); Raise → Double-or-Toll at 1:20 (stretch), because v1's Raise ended ~60% of
  matches at halftime; keep the mirrored layout; Rig + Peek once per phase; no power-up meter in the MVP.
- Hidden `?` values (not just rigs) must live in private TEE accounts.
- Stack (PROPOSED): web PWA, TS + Vite + React 19 + Three.js/R3F; Anchor 1.0.2 + ER SDK 0.18.x;
  shared integer Rust sim crate; web3.js + @coral-xyz/anchor 0.32.1 client; burner keys; devnet SOL
  stakes; Hono server for faucet/matchmaking; pnpm + Cargo monorepo.

**Blocked / risks:** Deploy wallet has 0 devnet SOL (need ~5). Stage 0 unknowns: TEE tx-data
privacy, crank on the TEE, burner with 0 SOL on the ER.

**Next / handoff:** Kai and Suparno confirm the stack → `git init` + scaffold (Stage 0/1). Suparno:
add the two MCP servers, start collecting CC0 low-poly assets (crowd unit, cannon,
gates, arena) and log them in `CREDITS.md` once `apps/web` exists.

## 2026-11-21 · Kai · repo setup · [DECISION]
**Did:**
- `git init` (branch `main`), first commit: docs, this log, balance sims, `.gitignore`, `.gitattributes`.
- Removed the working name from all docs. Program/crate id is `duel` until we choose a name.
- `docs/TECH.md` §5: client runs the sim as WASM for smooth prediction + an offline mode; crowd/look budget.

**Decided:**
- **Each person keeps a private, gitignored notes file.** Put one line in yours:
  "read the last ~10 entries of PROGRESS_LOG.md at the start, append an entry after each piece of work".
- Game name: not chosen yet; decide together later.
- Stages in TECH.md §7 are a draft only; Kai is reviewing them.

**Blocked / risks:** deploy wallet still 0 devnet SOL. No GitHub remote yet.

**Next / handoff:** Kai: create the GitHub repo and invite Suparno. Suparno: clone, write your own
your own notes file, add the two MCPs, start the arena feel prototype in `apps/web` (look notes in TECH.md §5).

## 2026-11-21 · Kai · docs · [DECISION]
**Did:**
- Added `docs/IDEA.md`: what we're building, why it needs Solana + MagicBlock, who it's for, the player
  journey, how a match feels, look and identity, what makes it different.
- Removed every mention of other games' names from the docs.

**Decided:** we target a genre, not one game. **Never name other games** anywhere in the repo, docs,
code or UI (it reads as a clone in the submission). Say "crowd-cannon genre" or "the game from the ads".

**Blocked / risks:** none new.

**Next / handoff:** Suparno: read `docs/IDEA.md` first. It's the one-page picture, and the look section is yours to shape.

## 2026-11-21 · Kai · docs · [DECISION]
**Did:** Put the name in IDEA/SPEC/TECH. Code ids: repo `lil-dudes-go-brr`, Anchor program `lil_dudes`.

**Decided:** The game is called **Lil Dudes Go Brr**.

**Blocked / risks:** none.

**Next / handoff:** Kai is doing genre research (gameplay recording + game data) outside the repo. Findings
come back as generic mechanics edits to SPEC/TECH.
