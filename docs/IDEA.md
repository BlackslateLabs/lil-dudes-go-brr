# Lil Dudes Go Brr

The idea in plain words. Rules in detail: [SPEC.md](SPEC.md) (base) and [SPEC_V5.md](SPEC_V5.md)
(rules v5 and later, the current game). How it's built: [TECH.md](TECH.md).

## In one line

**The game from the mobile ads, made real, and made 1v1.** You steer a cannon that pours a crowd
through multiplier gates at an enemy base that sends waves back at you. You and your opponent race
through identical copies of the same level: survive, knock down the towers, breach the town hall
and rush it. Every gate is a hidden `?` until your dudes touch it.

## What we're building

A short, one-thumb, real-time race that runs in the browser on any phone. Two players (or a player
and the bot) each get an identical copy of one level: an enemy base whose towers release waves of
troops down the lane, and gates in between that multiply your crowd. Hold to fire, drag to aim.
Grind down the waves, drop the towers, then breach the hall: every dude that reaches it in the Rush
scores. If a single enemy reaches your cannon line, you're overrun and lose.

What turns a simple ad-style game into a real duel is **hidden information and a fair deal**:

- **`?` gates:** you don't know what a gate does until your dudes pass through it. Most multiply
  (×2–×5, +N), some hurt (÷2, ÷3, −N). The values are the same in both copies, so luck is equal.
- **Scout:** once per stage, you privately see the true value of one of your face-down gates. Only
  you can read it.
- **Big gates in awkward spots or behind crates, a timing gate that cycles ×1 → ×5:** real choices
  about where to aim and when.
- **Champion:** shooting charges a meter; let go with it full and a giant worth 8 dudes marches out,
  multiplying through gates like any crowd. The base sends giants of its own.

So every match is a race and a read: *Do I go for the crated ×8 or play it safe? Is that `?` worth
my Scout? Can I breach before they do without getting overrun?*

Players can put play money (devnet SOL) on a match. Get overrun and you lose your whole stake. If
both survive, the higher score wins, and the payout scales with the margin: the winner keeps their
stake plus 2 × the winning margin of the loser's (all of it at 3× the score). Equal scores are a
draw. A 5% fee applies only to what moves.

## Why it needs Solana + MagicBlock

A real-time 1v1 game with hidden information and stakes normally needs a server everyone has to trust.
Here, the chain replaces that server:

| Need | How we solve it |
|---|---|
| 20 updates per second, no wallet popups | The match runs in a MagicBlock **Ephemeral Rollup**, signed by a throwaway in-browser key |
| Nobody can see unrevealed gates or Scouts, not even with a modified client | They live in **private accounts** inside MagicBlock's **Private Ephemeral Rollup** (TEE) |
| Fair, unpredictable gate values and level choice | **VRF** randomness, identical in both copies |
| The game clock never stops, even if a player leaves | An on-chain **crank** advances the match |
| Instant, automatic payout | The match result settles to the base layer and pays from escrow on its own |
| "Prove you didn't cheat" | After the match the seed and every Scout are public; **Verify** rebuilds the level and every gate from the seed |

## Who it's for

1. **The casual phone player** who knows this kind of game from ads. They open a link and are playing
   the bot within seconds: no wallet, no download, no sign-up.
2. **The competitive crypto player** who wants skill-based PvP with something on the line: Quick
   Match at a chosen stake, or a room code with a friend.
3. **Judges and first-time visitors.** One link, a first match in under 30 seconds, and a result
   screen that shows exactly what happened on-chain.

## The player's journey

1. **Open the link.** The landing page says what the game is; one tap opens the game. A burner
   wallet is created silently in the browser. A first-time visitor gets a short **guided match
   against the bot** that teaches one thing at a time; "How to play" replays it later.
2. **Home:** **Play vs Bot** (free), or pick a stake for **Quick Match** (paired with someone at the
   same amount) or **Play a Friend** (room code or link). Devnet SOL tops up from a faucet.
3. **The match** (about a minute, capped at 3:00; details below).
4. **Result screen:** win or lose, the score, the payout and why, every hidden gate revealed, a
   **Verify** button, and links to the transactions.
5. **Rematch** with one tap.

## How a match feels, moment by moment

- **0:00, fire.** The countdown ends and your cannon opens up. Drag your thumb and the stream follows
  instantly. Your first dude hits a `?`, it flips to **×3**, and the crowd pours out of the gate.
- **The waves.** The tower releases a wave. Your crowd meets it mid-lane and they grind each other
  down. Miss the gates and the wave walks straight at your cannon line.
- **Reading the board.** A big gate sits behind a crate, another on the far side of a wall. Spend
  your Scout on the far `?`: it's a **×4**. Worth it.
- **Champion.** The meter fills; you let go and a giant stomps up the lane, through a ×2, and now
  there are two.
- **Tower down.** The tower falls and Fight 2 starts: two towers guarding the town hall. The race bar
  at the bottom shows your opponent is still on Fight 1.
- **BREACH.** The last tower drops and the hall opens: a 3.5 s **Rush** where every dude that reaches
  it scores.
- **The end.** Get overrun and you lose your stake. Survive and the higher score wins, by as much as
  you out-scored them.

**The feel we're aiming for:** instantly readable, loud, juicy numbers, one thumb, and a match short
enough that you immediately want another.

## Look and identity

- Portrait, a tilted camera looking up a single lane, bright low-poly toy world.
- Our own characters and world, designed by us (Suparno leads art direction). Your blue dudes, the
  base's red troops, chunky gates and towers, big outlined numbers on things you hit.
- Every asset is original or openly licensed and credited ([credits](../apps/web/public/assets/CREDITS.md)).

## What makes it different

- It takes a genre everyone has seen in ads and makes it a **live head-to-head race**, skill-based and fair
  (identical copies, no rubber-banding).
- **Hidden information in an action game:** sealed gates and private Scouts, made trustless by a
  private rollup.
- **Margin-based payout:** getting overrun loses everything; otherwise you win by as much as you
  out-scored them, so the whole match matters.
- **Provably fair:** every match's deal can be rebuilt and checked after it ends.

## What it is not

- Not a casino. The bot never plays for stakes, and Free mode is the full game.
- No real money. Devnet only, play money.
- Not a copy of any game. We build on a genre, with our own rules, characters, world and code.
