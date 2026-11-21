# Lil Dudes Go Brr

The idea in plain words. Rules in detail: [SPEC.md](SPEC.md). How it's built: [TECH.md](TECH.md).

## In one line

**The game from the mobile ads, made real, and made 1v1.** You steer a cannon that pours a crowd
through math gates (×3, +10, ÷2…), smash your crowd into your opponent's, and knock out their cannon.
Every gate is hidden until someone runs through it, and your opponent may have secretly rigged one.

## What we're building

A two-minute, one-thumb, real-time duel that runs in the browser on any phone. Two players (or a player
and the bot) face each other on one lane. Each side has a cannon that fires nonstop, and a grid of
hidden gates that multiply, add to, or cut down the crowd passing through. The crowds meet in the
middle and cancel out; whatever gets through hits the enemy cannon.

What turns a simple ad-style game into a real duel is **hidden information**:

- **`?` gates:** you don't know what a gate does until a unit passes through it. Some show a coloured
  hint (blue = good, red = bad), but hints are only right most of the time.
- **Rig:** once per phase, you secretly turn one of your opponent's gates into a trap.
- **Peek:** once per phase, you secretly check one of your own gates before committing to it.
- **Gold gate:** ×3 or ÷3. A coin flip you choose whether to take.

So every match becomes a mind game: *Is that blue hint real? Did they rig the obvious lane? Do I gamble
on gold while I'm ahead?*

Players can put play money (devnet SOL) on a match. The winner takes more the bigger the win, so
every unit counts right to the last second.

## Why it needs Solana + MagicBlock

A real-time 1v1 game with hidden information and stakes normally needs a server everyone has to trust.
Here, the chain replaces that server:

| Need | How we solve it |
|---|---|
| 20 updates per second, no wallet popups | The match runs in a MagicBlock **Ephemeral Rollup**, signed by a throwaway in-browser key |
| Nobody can see hidden gates, rigs or peeks, not even with a modified client | They live in **private accounts** inside MagicBlock's **Private Ephemeral Rollup** (TEE) |
| Fair, unpredictable gate deals | **VRF** randomness for every deal |
| The game clock never stops, even if a player leaves | An on-chain **crank** advances the match |
| Instant, automatic payout | The match result settles to the base layer and pays from escrow on its own |
| "Prove you didn't cheat" | After the match the seed and every rig are published; the result screen replays the whole match and checks it |

## Who it's for

1. **The casual phone player** who knows this kind of game from ads. They open a link and are playing
   the bot within seconds: no wallet, no download, no sign-up.
2. **The competitive crypto player** who wants skill-based PvP with something on the line: quick
   match or a room code with a friend, then stakes.
3. **Judges and first-time visitors.** One link, a first match in under 30 seconds, and a result
   screen that shows exactly what happened on-chain.

## The player's journey

1. **Open the link.** The home screen shows a crowd stream on a loop. A burner wallet is created
   silently in the browser.
2. **Play vs Bot** (free), **Quick Match**, or **Room Code**. Pick a stake (Free, 0.05, 0.1, 0.25
   devnet SOL). A first-timer gets topped up with devnet SOL automatically.
3. **The match** (2:00, details below).
4. **Result screen:** win or lose, the payout and why ("you won by 22% → you take 61% of the stake"),
   every hidden gate and rig revealed, a **Verify** button, and links to the transactions.
5. **Rematch** with one tap, or **Withdraw** winnings to a real wallet (Phantom).

## How a match feels, moment by moment

- **0:00, the plant.** Both boards appear covered in `?`. You have three seconds to tap one of your
  opponent's gates and rig it. Your heart rate goes up before a single shot is fired.
- **0:03, fire.** Cannons open up. Hints fade in. You drag your thumb and your stream follows instantly.
  Your first cohort hits a `?`, it flips to **×3**, and the crowd balloons with a pop and a number burst.
- **Reading the board.** Do you stay on the gate you know is good, or try the blue hint next to it?
  You spend your peek: it's a **÷2**. Good thing you checked.
- **The clash.** The two crowds collide mid-lane and grind each other down, numbers ticking. Whoever
  built the bigger crowd pushes through and chips the other cannon.
- **GOTCHA.** Your opponent's stream hits your rigged gate. Both screens flash, and their crowd halves.
- **0:40 and 1:20, re-deal.** The whole board flips face-down again: new gates, a new plant, a new rig
  and peek. Nobody can coast on knowledge.
- **1:45, Surge.** Fire rate doubles for both sides. It's loud and chaotic, and this is when comebacks happen.
- **2:00 or KO.** Knock out the cannon to win outright, or have more HP when the timer ends. The payout
  scales with the margin, so the leader keeps attacking and the trailing player keeps defending.

**The feel we're aiming for:** instantly readable, loud, juicy numbers, one thumb, and a match short
enough that you immediately want another. Easy to understand, hard to read your opponent.

## Look and identity

- Portrait, a tilted camera looking up a single lane, bright low-poly toy world.
- Our own characters and world, designed by us (Suparno leads art direction). Two clearly coloured
  armies, chunky gates whose colour tells you their type, big outlined numbers everywhere.
- Every asset is original or openly licensed and credited.

## What makes it different

- It takes a genre everyone has seen in ads and makes it **head-to-head and skill-based**.
- **Bluffing in an action game:** hidden gates, fake hints, secret traps and peeks, made trustless by a
  private rollup.
- **Payout by margin of victory**, not winner-takes-all, so the whole match matters.
- **Provably fair:** every match can be replayed and verified after it ends.

## What it is not

- Not a casino. The bot never plays for stakes, and Free mode is the full game.
- No real money. Devnet only, play money.
- Not a copy of any game. We build on a genre, with our own rules, characters, world and code.
