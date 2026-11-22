/**
 * Render quality tier, picked once per page load.
 * - `high`: soft shadows (2048), HDR post-processing (bloom + vignette + tone mapping in one pass).
 * - `low`: smaller shadow map, no post-processing (the renderer tone-maps directly).
 * `?fx=low` / `?fx=high` force a tier (testing); otherwise phones with ≤ 4 cores or ≤ 2 GB get `low`.
 */
export type FxTier = 'high' | 'low';

let cached: FxTier | null = null;

export function fxTier(): FxTier {
  if (cached) return cached;
  const forced = new URLSearchParams(window.location.search).get('fx');
  if (forced === 'low' || forced === 'high') return (cached = forced);
  const cores = navigator.hardwareConcurrency || 4;
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
  cached = cores <= 4 || mem <= 2 ? 'low' : 'high';
  return cached;
}
