# Art and feel: the glow-up plan

Status: **PROPOSED** (Suparno, 2026-11-22). The mechanics are close to right; this doc is how we make
the game look and feel good without breaking the rules, the phone budget or the licence rules.

## Ground rules

- **Licences:** CC0 first. CC-BY is fine if we credit it. Nothing "free for personal use", nothing
  ripped, nothing that copies the look, names or characters of any existing game. Every file we ship
  gets a line in `apps/web/public/assets/CREDITS.md` (source URL, author, licence) in the same commit.
- **One family per job.** Mixed styles look cheap. We pick one character family and one props family
  and stick to them; colour and materials are unified in code (one palette, one lighting setup).
- **The front end never invents rules.** Art reads `MatchView` and events only (TECH §5). A visual
  that implies something the sim didn't do (a crowd overlapping a gate it missed) is a bug.
- **Phone budget:** ~1,500 instanced units at 60 fps on a mid phone. Whole game download ≤ 8 MB
  (glTF/GLB with meshopt or Draco, KTX2 or small PNG textures, OGG/M4A audio).

## Decisions (Suparno, 2026-11-22)

Picked from a shortlist with previews; the live pick sheet is a private page Suparno keeps, and this
table is the copy of record. Change a pick here and in the log together.

| Decision | Pick | Source | Licence |
|---|---|---|---|
| Overall look | Candy platformer: rounder, glossier, saturated; applied to every pack below through our own lighting and materials | (direction) | — |
| Team colours | Blue (us) vs red (base), gold for rewards (current palette) | ours | — |
| Our dudes | Mini Characters, one model recoloured to team blue | Kenney · Mini Characters | CC0 |
| Base troops | The villains from the same pack (robot / zombie), team red | Kenney · Mini Characters | CC0 |
| Cannon | Toy blaster, scaled up as a dude launcher | Kenney · Blaster Kit | CC0 |
| Enemy towers | Tower-defense towers, recoloured to the enemy team | Kenney · Tower Defense Kit | CC0 |
| Town hall | The big timbered hall with the archway (the vault door) | Kenney · Fantasy Town Kit | CC0 |
| Gates | Glowing glass panel (big gates gold), built in code | ours | — |
| Crates | Block crates (wooden crate, cage, safe). **For now:** Kenney Blaster Kit `crate-wide` until the KayKit pack is downloaded by hand (one constant, `CRATE_MODEL` in `Base.tsx`) | KayKit · Block Bits (free version) | CC0 |
| Around the lane | Nature Kit + tower-defense ground tiles | Kenney · Nature Kit, Tower Defense Kit | CC0 |
| Effects | Particle sprites driven by our code | Kenney · Particle Pack | CC0 |
| Buttons and panels | Our own chunky CSS (thick outlines, drop shadows, bouncy presses) | ours | — |
| Display font | Lilita One (current) | Google Fonts | OFL |
| UI text font | Baloo 2 | Google Fonts | OFL |
| Sound effects | Kenney recordings: Impact, Interface, Digital and Casino packs (26 short mono MP3s, ~117 KB) | Kenney | CC0 |
| Music | **Undecided.** Rejected: widely used stock tracks (too recognisable). Shortlist: lesser-known CC0 loops and stings from OpenGameArt (e.g. Fupi's Wacky Wobblings / Wacky Idlings / Win Jingle) | | CC0 |

## Where to find assets

| Need | Where | Licence | Notes |
|---|---|---|---|
| Characters (our dudes, base troops) | **KayKit** (kaylousberg.itch.io): Adventurers, Skeletons, Character Animations | CC0 | Rigged + animated, chunky toy style, consistent family |
| | **Quaternius** (quaternius.com): animated character and monster packs | CC0 | Same "toy" low-poly feel, many animations |
| | **Kenney** (kenney.nl): Mini Characters, Blocky Characters | CC0 | Very simple, cheapest to render |
| Towers, town hall, walls, crates | **Kenney**: Tower Defense Kit, Castle Kit, Fantasy Town Kit | CC0 | Modular pieces we can combine into our own buildings |
| | **KayKit**: Medieval Hexagon, Dungeon Remastered | CC0 | Buildings and props in the KayKit style |
| | **Quaternius**: Medieval Village / fantasy props packs | CC0 | |
| Cannon | **Kenney**: Blaster Kit, Tower Defense Kit (cannon turrets) | CC0 | Or we build it from code shapes + a good material |
| Any single model | **Poly Pizza** (poly.pizza) | CC0 or CC-BY per model | Check the licence on each model |
| | **Sketchfab** (filter: Downloadable + CC0 / CC-BY) | per model | Watch polycounts |
| Animations for any humanoid | **Mixamo** (mixamo.com) | free to use in a game, not to redistribute as raw files | Bake into our own GLB; don't commit raw Mixamo FBX |
| Textures, sky / lighting | **Poly Haven**, **ambientCG** | CC0 | HDRIs for lighting, ground textures |
| Particles, UI | **Kenney**: Particle Pack, UI Pack, Game Icons | CC0 | Sparks, smoke, coins, buttons |
| Sound effects | **Kenney** audio packs (Impact, Interface, RPG, Casino) | CC0 | Coin, hit, click, whoosh |
| | **freesound.org** (filter: CC0) | CC0 / CC-BY per sound | |
| | **Pixabay** sound effects | Pixabay licence (free, no credit needed) | |
| | **jsfxr / ChipTone** (generate our own) | ours | Fast for pops and blips |
| Music | **Pixabay** music, **incompetech.com** | Pixabay licence / CC-BY | One menu loop, one match loop, one win sting |
| Fonts | **Google Fonts** | OFL | Lilita One already in use |

Gate animations (sliding, reveal flip, multiply burst, the GOTCHA crack) are built in code and
shaders; no asset pack does these well.

## The order we do it in

Each step is shippable on its own; screenshots before/after go in the progress log.

1. **Lighting and materials (no assets needed).** Toon/gradient shading, one warm key light with
   soft shadows, sky gradient + light fog, outlines on units and buildings, bloom on gold and glowing
   gates, a proper ground (grass beyond the lane, a textured path, edge kerbs). This alone moves it
   from "prototype" to "game".
2. **Dudes.** One cute low-poly dude for us (blue team) and a distinct silhouette for base troops
   (red, helmets). Instanced; walk animation baked into the vertex shader (a 2–4 frame loop or a
   procedural waddle), because 1,500 skinned meshes won't run on a phone. Squash on spawn, poof on
   death.
3. **Cannon.** Model, recoil, muzzle flash, a faint aim line.
4. **Gates.** Glass/energy panels with big bold numbers, reveal flip, a burst and a "×8" pop when a
   crowd multiplies, a crack and red flash on a GOTCHA, a chain + padlock look on crate-locked gates.
5. **Base.** Towers with damage states, smoke and a collapse; the **town hall** as the hero building
   (health bar, shakes as the mob hits it, coins bursting out during the finale); crates that splinter.
6. **Juice.** Coins flying to the gold counter, hit-stop on tower kills, tuned screen shake, floating
   numbers, phone haptics.
7. **Audio.** Replace the synth blips with a real SFX set, add music, mix levels.
8. **UI skin.** Home, buttons, top bar, result screen, all in one style with the game.

## How picking works

- Suparno browses the sources above and drops links (or downloads) into a shortlist in
  `pvt-docs/` (private). Claude wires each candidate into a dev-only **asset gallery** screen
  (`?screen=gallery`) under the real game lighting, so we compare in context, not on a store page.
- Once picked: convert to GLB, compress, add to `apps/web/public/assets/`, log in `CREDITS.md`.
