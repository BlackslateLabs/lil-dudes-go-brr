# Lil Dudes Go Brr

The idea in plain words. Rules in detail: [SPEC.md](SPEC.md). How it's built: [TECH.md](TECH.md).

## In one line

**The game from the mobile ads, made real, and made 1v1.** You steer a cannon that pours a crowd
through multiplier gates at an enemy base that fires waves back at you. You and your opponent race
through identical copies of the same level: survive, knock out the towers, raid the vault for gold.
Every gate is hidden until your dudes run through it, and your opponent may have secretly rigged one.

## What we're building

A two-minute, one-thumb, real-time race that runs in the browser on any phone. Two players (or a
player and the bot) each get an identical copy of one level: an enemy base whose towers release
waves of troops down the lane, and gates in between that multiply your crowd. Your cannon fires
nonstop; you steer it. Grind down the waves, knock out the towers, then raid the vault: every dude
that gets in is loot. If a single enemy reaches your cannon, you're out and your opponent wins.

What turns a simple ad-style game into a real duel is **hidden information**:

- **`?` gates:** you don't know what a gate multiplies by until your dudes pass through it. The
  values are the same in both copies, so luck is equal.
- **Rig:** once per stage, you secretly turn one gate on your opponent's copy into a trap.
- **Peek:** once per stage, you secretly check one of your own gates before committing to it.
- **Big gates behind crates, sliding gates:** real choices about where to aim and when.

So every match becomes a race and a mind game: *Do I go for the locked ×10 or play it safe? Did they
rig the obvious gate? Can I build a bigger crowd for the raid without dying?*

Players can put play money (devnet SOL) on a match. Die and your opponent takes the pot; survive and
the pot is split by the gold you each earned, so every dude counts right to the vault.

## Why it needs Solana + MagicBlock

A real-time 1v1 game with hidden information and stakes normally needs a server everyone has to trust.
Here, the chain replaces that server:

| Need | How we solve it |
|---|---|
| 20 updates per second, no wallet popups | The match runs in a MagicBlock **Ephemeral Rollup**, signed by a throwaway in-browser key |
| Nobody can see hidden gates, rigs or peeks, not even with a modified client | They live in **private accounts** inside MagicBlock's **Private Ephemeral Rollup** (TEE) |
| Fair, unpredictable gate values and level choice | **VRF** randomness, identical in both copies |
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

1. **Open the link.** A burner wallet is created silently in the browser. A first-time visitor goes
   straight into a short **guided match against the bot** that teaches one thing at a time: aim,
   gates, waves, towers, rig, peek, raid. A **Skip** button is always there for anyone who already knows
   the genre, and "How to play" replays it later.
2. **Home:** a big **Play vs Bot** (free), plus **Quick Match** and **Room Code**. Pick a stake
   (Free, 0.05, 0.1, 0.25 devnet SOL). A first-timer gets topped up with devnet SOL automatically.
3. **The match** (about 1:30–2:00, details below).
4. **Result screen:** win or lose, the payout and why ("you earned 900 gold vs 600 → you take 60% of
   the pot"), every hidden gate and rig revealed, a **Verify** button, and links to the transactions.
5. **Rematch** with one tap, or **Withdraw** winnings to a real wallet (Phantom).

## How a match feels, moment by moment

- **0:00, the plant.** The first stage appears, its gates covered in `?`. You have three seconds to tap
  one gate on your opponent's copy and rig it. Your heart rate goes up before a single shot is fired.
- **0:03, fire.** Your cannon opens up. You drag your thumb and your stream follows instantly. Your
  first dude hits a `?`, it flips to **×3**, and the crowd pours out of the gate.
- **The waves.** The tower at the top pulses and releases a wave. Your crowd meets it mid-lane and they
  grind each other down. Miss the gates and the wave walks straight at your cannon.
- **Reading the board.** A row slides left and right; a big gate sits behind a crate. Spend your peek
  on the far `?`: it's a **×4**. Worth it.
- **GOTCHA.** Your opponent's stream hits the gate you rigged. Both screens flash, and their crowd halves.
- **Tower down.** The tower explodes, the field clears, and your cannon drives up to stage 2: two towers,
  new gates, a new rig and peek. In the corner you can see your opponent is still on stage 1.
- **The raid.** The base's towers are down; the vault opens. Eight seconds to pour everything you've
  got into it. Every dude that gets in is gold.
- **The end.** Die and your opponent takes the pot. Survive and the pot is split by gold, so the
  bigger raid wins more.

**The feel we're aiming for:** instantly readable, loud, juicy numbers, one thumb, and a match short
enough that you immediately want another. Easy to understand, hard to read your opponent.

## Look and identity

- Portrait, a tilted camera looking up a single lane, bright low-poly toy world.
- Our own characters and world, designed by us (Suparno leads art direction). Your blue dudes, the
  base's red troops, chunky gates and towers, big outlined numbers on things you hit.
- Every asset is original or openly licensed and credited.

## What makes it different

- It takes a genre everyone has seen in ads and makes it a **live head-to-head race**, skill-based and fair
  (identical copies, no rubber-banding).
- **Bluffing in an action game:** hidden gates, secret traps and peeks, made trustless by a private rollup.
- **Survive or split by gold:** dying loses everything; surviving splits the pot by the loot you earned,
  so the whole match matters.
- **Provably fair:** every match can be replayed and verified after it ends.

## What it is not

- Not a casino. The bot never plays for stakes, and Free mode is the full game.
- No real money. Devnet only, play money.
- Not a copy of any game. We build on a genre, with our own rules, characters, world and code.
