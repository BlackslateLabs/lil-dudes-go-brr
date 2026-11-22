import { CanvasTexture, SRGBColorSpace } from 'three';

export const DISPLAY_FONT = '"Lilita One", "Arial Black", sans-serif';

interface LabelOpts {
  color?: string;
  outline?: string;
  /** Canvas size in px. Numbers use a small canvas; gate faces a square one. */
  width?: number;
  height?: number;
  /** Outline thickness as a fraction of the font size. Keep it thin enough that the dots of ÷ survive. */
  stroke?: number;
}

const cache = new Map<string, CanvasTexture>();
const CACHE_MAX = 400;

/**
 * Bold outlined text drawn to a canvas, for gate faces, badges and pops.
 * Cached by text + style. When the cache is full it is disposed and rebuilt; a disposed texture
 * that is still on a material is simply re-uploaded by three.js on its next use.
 */
export function labelTexture(text: string, opts: LabelOpts = {}): CanvasTexture {
  const { color = '#ffffff', outline = '#1b1530', width = 256, height = 256, stroke = 0.09 } = opts;
  const key = `${text}|${color}|${outline}|${width}x${height}|${stroke}`;
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= CACHE_MAX) {
    for (const t of cache.values()) t.dispose();
    cache.clear();
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = height * 0.72;
  ctx.font = `${size}px ${DISPLAY_FONT}`;
  const maxW = width * 0.86;
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    size *= maxW / w;
    ctx.font = `${size}px ${DISPLAY_FONT}`;
  }
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size * stroke);
  ctx.strokeStyle = outline;
  const y = height / 2 + size * 0.06;
  ctx.strokeText(text, width / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, y);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
