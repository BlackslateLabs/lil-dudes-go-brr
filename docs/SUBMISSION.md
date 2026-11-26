# Submission: MagicBlock Solana Blitz v10

Text ready to paste into the submission form. Deadline: **Fri 27 Nov 2026, ~14:00 UTC (19:30 IST)**.
Fill every `TBD` before submitting; each one has a TODO saying who fills it.

---

## Project name

Lil Dudes Go Brr

## Tagline (≤ 80 chars)

> Crowd-cannon PvP with hidden gates and real stakes, sealed in a private rollup.

## Short description (≤ 280 chars)

> The crowd-cannon game from the ads, made a live 1v1 race. Fire crowds through hidden `?` gates,
> break the towers, storm the town hall. Gate values hide in a MagicBlock Private Ephemeral Rollup,
> VRF deals the level, a 20 Hz crank runs the clock, and the pot settles on Solana.

## Long description

> **Lil Dudes Go Brr** takes the crowd-cannon game everyone has seen in mobile ads and turns it into
> a fair, live head-to-head duel with something on the line.
>
> Two players race identical copies of the same level. Hold to fire, drag to aim, and pour your dudes
> through gates that are hidden `?`s until they touch them: most multiply, some halve or subtract.
> Scout privately reveals one gate per fight; a Champion giant charges as you shoot, and the base
> sends Champions of its own. Break one tower, then two more guarding the town hall, and BREACH into a
> 3.5-second Rush where every dude that gets in scores. Let a single enemy reach your cannon and you lose the whole stake. If both survive, the
> winner keeps their stake and takes twice the winning margin of the loser's, minus a 5% fee on what
> moves.
>
> The whole match runs on chain, inside a **MagicBlock Private Ephemeral Rollup** on the TEE
> validator. The seed and every true gate value live in an account with no readers; each Scout result
> lives in an account only its player can read. **VRF** mixed with both players' private salts deals
> the level, a **crank** advances the deterministic Rust rules every 50 ms, and at the end the match
> **commits and undelegates once**, with a Magic Action that pays out from the base-layer vault.
> After the match the seed is public, so anyone can rebuild every gate and check the deal.
>
> Open the link and you're playing the bot in seconds: no wallet, no popups. A game key in the browser
> signs every in-match move for free. For staked play, sign in with a Solana wallet: one signature
> derives your game key, so the same wallet brings back the same balance and history on any device.
> Quick Match pairs any stake with any stake (both play for the lower one), a room code plays a friend,
> and the bot joins only if you ask. In a live match, **Try to peek** makes your own browser try to
> read the sealed gates and shows every read coming back empty; afterwards **Verify** rebuilds the
> deal from the public seed.

## Categories (pick 3; use the form's exact option names)

The labels below are our guesses: match them to the options the form actually lists.

1. **Gaming**: a real-time action game whose whole match is simulated on chain at 20 Hz.
2. **Entertainment Finance / DeFi**: a skill game with a staked prize pool, escrowed in a vault PDA
   and paid out by a margin-scaled formula on settlement.
3. **Privacy**: hidden information enforced by Private Ephemeral Rollup permissions, tested against
   the opponent, strangers and token-less clients.

## Website

https://ldgb.blackslate.me

(Also https://lil-dudes-go-brr.vercel.app. Game server: https://lil-dudes-server.onrender.com.)

## Public GitHub repo

https://github.com/BlackslateLabs/lil-dudes-go-brr

## Pitch & Demo

> Everyone has seen the crowd-cannon ad: dudes pour through ×3 gates and swarm a base. We made it a
> real 1v1 with stakes, and the hard part was hidden information. If a gate's value sits anywhere a
> client can read, a modified client wins every match. So the whole match runs inside a MagicBlock
> Private Ephemeral Rollup: true gate values and the seed live in an account nobody can read, each
> Scout result in an account only its player can read. We attacked our own live match on devnet as
> the opponent, a stranger and a token-less client: zero leaks, and the app's Try to peek console lets
> any player repeat that from their own browser. VRF deals the
> level, a 50 ms crank runs the clock so nobody can stall it, and one commit at the end pays the pot
> from escrow through a Magic Action. Take any of those out and the game stops being fair, live or
> paid. Then the seed goes public and anyone can verify the deal. Open the link, play the bot in
> seconds, no wallet.

Video (≤ 2 min: hook → gameplay → denied read → Verify → payout landing on Solana):

<!-- TODO(Suparno): record and upload; paste the link here and in the form. -->
TBD

## Explorer link (integration proof)

https://explorer.solana.com/tx/3ZkGQkU38QF7sTmB6X3qbrD39tKB2zy8TZBZRQV7GdbrJ3YJ83QuHvPM8DyrztGg9v4wyZk1TcH74zJwn1rNqiFn?cluster=devnet
(A 0.03 SOL room-code match through the hosted server on the final program, rules v11; swap in one from the
two-phone test if you like.) Program activity: https://explorer.solana.com/address/4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa?cluster=devnet

**Which transaction:** the base-layer **settle transaction of a real staked match** on the final
program: the one transaction in which the TEE validator commits and undelegates the match accounts
and the `settle_action` Magic Action pays winner, loser and fee out of the vault PDA. Why this one:
it shows, in a single explorer page, our program, the Ephemeral Rollup delegation coming back to
base, and a real payout. The form says ordinary transfers and swaps don't count; this is program
activity end to end. It is a v1 transaction, so open it on an explorer that decodes v1.
Backup: the match account's page (its history shows create, join, delegate and settle).

## Addresses

| Field | Value |
|---|---|
| Program ID | `4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa` (devnet, rules v11) |
| Fee vault (treasury) | `FdZLtcw7CMAHk2bsnqesxcYj3Ybjgux3GcqtDy63rfbB` (the program's `TREASURY`; 5% of what moves) |
| App wallet (faucet sponsor) | `8vJsz4WH7YrVzztA5U87fwsm8D4Lg18d8FUQduj3eVHr` (the hosted server's sponsor: faucet top-ups, sweeper, settle-now) |
| Prize wallet | <!-- TODO(Suparno + Kai): agree on the prize wallet --> TBD |

## Judge-facing checklist

- [x] Play vs the bot instantly, no wallet popups, from the hosted link (https://ldgb.blackslate.me)
- [x] Share link / room code for a 1v1, and Quick Match at any stake (both play for the lower stake)
- [x] Wallet sign-in for staked play: the game key comes from one wallet signature (same wallet, same key, any device)
- [x] PWA build: manifest, icons, offline precache
- [ ] Installed and played from the hosted link on a real phone
- [ ] 2-minute video
- [x] Explorer link to a staked match's settle transaction on the final program
- [ ] Devnet usage numbers (matches played, players, SOL staked)
- [x] README with the "remove it and what breaks" table, a step-by-step match lifecycle, Limits, the TEE trust note, and a claim-by-claim code index for AI reviewers (permalinks)
- [x] Privacy check against the opponent, a stranger and a token-less client: PASS, 0 leaks on the deployed program (rules v11)
- [x] In-app proof: Try to peek (live match) and Verify (after the match)
- [x] MagicSVM suite green (19/19 on rules v11); rules 116 + 7 integration, WASM 11, client 37, server 35 tests

## Talking points for judges

- **Five MagicBlock pieces, each load-bearing.** Private ER for sealed gates and Scouts, the ER for
  20 Hz on-chain play, VRF for the deal, the crank for a clock nobody can stall, and delegation with a
  commit + Magic Action for automatic payout. Remove any one and the game stops being fair, live or paid.
- **We attacked our own match.** On devnet, the opponent, a stranger and a token-less client tried
  every RPC and websocket path to the sealed accounts during a live match: zero leaks.
- **One rules engine everywhere.** The same deterministic, integer-only Rust crate runs in the
  program, in the browser (offline play and Verify) and in the server bot, kept identical by golden
  tests and a WASM parity digest.
- **Built to the compute budget.** The full rules run on chain every 50 ms; the worst possible tick is
  ~49k CU (every slot full; a real match peaks near 15k), and the crank's 3-tick catch-up stays under
  the ER's 200k CU per instruction. We measured it and froze the rules around it.
- **Anyone can try to cheat.** In a live match the Try to peek console reads the sealed accounts from
  your own browser with your real login; after the match Verify rebuilds the deal from the seed.
- **A playable product, not a demo.** Wallet sign-in that survives cleared site data, add and withdraw
  SOL to your wallet, any-stake matchmaking, room codes and rematches, match history.
- **Zero-friction onboarding, honest limits.** Play the bot in seconds with no wallet; stakes are
  devnet only; the README states the TEE trust assumption (Intel hardware) and what is still in
  progress.
