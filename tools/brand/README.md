# Brand masters

Vector masters for the Face-Off logo and app icon (drawn in code by us; the wordmark is Luckiest Guy
glyph outlines, Apache 2.0). The game ships raster exports, not these files:

| Master | Export in `apps/web/public/` |
|---|---|
| `logo.svg` | `brand/logo.webp` (1200×720, transparent) |
| `icon.svg` | `icon.svg`, `icon-192.png`, `icon-512.png` |
| `icon-maskable.svg` (heads scaled into the 80% safe circle) | `icon-maskable-512.png`, `apple-touch-icon.png` (180) |

Re-export by opening a master in a browser at the target size and saving a screenshot.
