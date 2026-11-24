# Submission: MagicBlock Solana Blitz v10

Text ready to paste into the submission form. Deadline: **Thu 27 Nov 2026, ~14:00 UTC**.
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
> Scout privately reveals one gate per stage; a Champion giant charges as you shoot. Break one tower,
> then two more guarding the town hall, and BREACH into a 3.5-second Rush where every dude that gets in
> scores. Let a single enemy reach your cannon and you lose the whole stake. If both survive, the
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
> Open the link and you're playing the bot in seconds: no wallet, no popups. A burner key in the
> browser signs every in-match move for free; a top-up from our faucet covers devnet stakes.

## Categories (pick 3; use the form's exact option names)

The labels below are our guesses: match them to the options the form actually lists.

1. **Gaming**: a real-time action game whose whole match is simulated on chain at 20 Hz.
2. **Entertainment Finance / DeFi**: a skill game with a staked prize pool, escrowed in a vault PDA
   and paid out by a margin-scaled formula on settlement.
3. **Privacy**: hidden information enforced by Private Ephemeral Rollup permissions, tested against
   the opponent, strangers and token-less clients.

## Website

<!-- TODO(Kai): the hosted web URL from [DEPLOYED]. -->
TBD

## Public GitHub repo

<!-- TODO(Suparno): the public repo URL (make sure CLAUDE.md, pvt-docs/ and keys are not in it). -->
TBD

## Pitch & Demo

> Everyone has seen the crowd-cannon ad: dudes pour through ×3 gates and swarm a base. We made it a
> real 1v1 with stakes, and the hard part was hidden information. If a gate's value sits anywhere a
> client can read, a modified client wins every match. So the whole match runs inside a MagicBlock
> Private Ephemeral Rollup: true gate values and the seed live in an account nobody can read, each
> Scout result in an account only its player can read. We attacked our own live match on devnet as
> the opponent, a stranger and a token-less client: zero leaks. VRF deals the
> level, a 50 ms crank runs the clock so nobody can stall it, and one commit at the end pays the pot
> from escrow through a Magic Action. Take any of those out and the game stops being fair, live or
> paid. Then the seed goes public and anyone can verify the deal. Open the link, play the bot in
> seconds, no wallet.

Video (≤ 2 min: hook → gameplay → denied read → Verify → payout landing on Solana):

<!-- TODO(Suparno): record and upload; paste the link here and in the form. -->
TBD

## Explorer link (integration proof)

<!-- TODO(Kai): after the v10 deploy, play one staked live match and paste its settle transaction. -->
TBD

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
| Program ID | <!-- TODO(Kai): confirm after the v10 deploy --> `4QFSXrcGWGKhFZR6iBweLoiPU4ixrE95sTsKdg9n9FDa` (devnet; today it still runs a pre-v10 build) |
| Fee vault (treasury) | <!-- TODO(Kai): confirm the treasury wallet the final program pays the 5% fee to --> TBD |
| App wallet (faucet sponsor) | <!-- TODO(Kai): confirm the sponsor wallet the hosted server uses --> TBD |
| Prize wallet | <!-- TODO(Suparno + Kai): agree on the prize wallet --> TBD |

## Judge-facing checklist

- [ ] Play vs the bot instantly, no wallet popups, from the hosted link (works locally; needs the hosted URL)
- [ ] Share link / room code for a 1v1 (server routes done; web wiring in progress)
- [x] PWA build: manifest, icons, offline precache
- [ ] Installed and played from the hosted link on a real phone
- [ ] 2-minute video
- [ ] Explorer link to a staked match's settle transaction on the final program
- [ ] Devnet usage numbers (matches played, players, SOL staked)
- [x] README with the "remove it and what breaks" table, a Limits section and the TEE trust note
- [x] Privacy check against the opponent, a stranger and a token-less client (devnet, earlier program; re-run on the final one)
- [x] MagicSVM suite green (19/19 on rules v9)

## Talking points for judges

- **Five MagicBlock pieces, each load-bearing.** Private ER for sealed gates and Scouts, the ER for
  20 Hz on-chain play, VRF for the deal, the crank for a clock nobody can stall, and delegation with a
  commit + Magic Action for automatic payout. Remove any one and the game stops being fair, live or paid.
- **We attacked our own match.** On devnet, the opponent, a stranger and a token-less client tried
  every RPC and websocket path to the sealed accounts during a live match: zero leaks.
- **One rules engine everywhere.** The same deterministic, integer-only Rust crate runs in the
  program, in the browser (offline play and Verify) and in the server bot, kept identical by golden
  tests and a WASM parity digest.
- **Built to the compute budget.** The full rules run on chain every 50 ms; the worst tick is ~44k CU,
  and the 8-tick crank catch-up fits in 400k. We measured it and froze the rules around it.
- **Zero-friction onboarding, honest limits.** Play the bot in seconds with no wallet; stakes are
  devnet only; the README states the TEE trust assumption (Intel hardware) and what is still in
  progress.
