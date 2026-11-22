# Asset credits

Every asset in the game, with its source and licence. Only CC0 or properly licensed assets.
Nothing copied from any existing game.

| Asset | Used for | Source (URL) | Author | Licence |
|---|---|---|---|---|
| Lilita One (`public/fonts/LilitaOne-Regular.ttf`) | Display font: logo, numbers, gate labels | https://github.com/google/fonts/tree/main/ofl/lilitaone | Juan Montoreano | SIL OFL 1.1 (`public/fonts/LilitaOne-OFL.txt`) |
| Baloo 2 (`public/fonts/Baloo2-Latin-Variable.woff2`) | UI text | https://fonts.google.com/specimen/Baloo+2 (https://github.com/EkType/Baloo2) | The Baloo 2 Project Authors (Ek Type) | SIL OFL 1.1 (`public/fonts/Baloo2-OFL.txt`) |
| Particle Pack (`public/assets/fx/particles.webp`: star_06, star_09, circle_05, smoke_04, dirt_01, circle_02, recoloured and resized) | Sparkles, glows, rings, smoke, debris | https://kenney.nl/assets/particle-pack | Kenney | CC0 1.0 |
| Puff and coin cells in `public/assets/fx/particles.webp` | Cartoon puffs, coins | drawn in code by us | ours | — |
| Mini Characters (`public/assets/models/dudes.glb`: character-knight, character-robot) | Your dudes (knight, team blue) and the base's troops (robot, team red) | https://kenney.nl/assets/mini-characters | Kenney | CC0 1.0 |
| Blaster Kit (`public/assets/models/blaster.glb`: blaster-b, crate-wide) | Cannon launcher; gate-lock crates | https://kenney.nl/assets/blaster-kit | Kenney | CC0 1.0 |
| Tower Defense Kit (`public/assets/models/towers.glb`: tower-round-bottom-a, tower-round-roof-b) | Enemy towers; cannon base | https://kenney.nl/assets/tower-defense-kit | Kenney | CC0 1.0 |
| Fantasy Town Kit (`public/assets/models/hall.glb`: walls, doorway, windows, pillars, banner, roofs, lantern, wall-block) | Town hall and base wall | https://kenney.nl/assets/fantasy-town-kit | Kenney | CC0 1.0 |
| Nature Kit (`public/assets/models/nature.glb`: trees, bushes, grass, flowers, rocks, stump, log) | Scenery around the lane | https://kenney.nl/assets/nature-kit | Kenney | CC0 1.0 |
| Impact Sounds (`public/assets/sfx/`: impactSoft, impactPunch, impactMining, impactWood, impactPlank, impactBell) | Shot thump, clash, wave, tower hit, crate hit/break, tower down, KO, fight bell | https://kenney.nl/assets/impact-sounds | Kenney | CC0 1.0 |
| Interface Sounds (`public/assets/sfx/`: drop, confirmation, question, select) | Shot pop, gate good/bad, UI click | https://kenney.nl/assets/interface-sounds | Kenney | CC0 1.0 |
| Digital Audio (`public/assets/sfx/`: phaserDown3, powerUp7, powerUp1, zapThreeToneDown) | GOTCHA, raid start, win, lose | https://kenney.nl/assets/digital-audio | Kenney | CC0 1.0 |
| Casino Audio (`public/assets/sfx/`: chips-stack, chip-lay, chips-handle) | Loot coins; debris under tower down and KO | https://kenney.nl/assets/casino-audio | Kenney | CC0 1.0 |

Gates, labels and the arena ground are built in code. Model files are re-packed from the Kenney kits (see `src/arena/models/tools/build-models.mjs`); sound files are trimmed and normalised Kenney recordings.
