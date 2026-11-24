import { LAYOUTS } from '@lil-dudes/client';

// The next match's seed, picked before the match so the VS screen can show its level (the seed
// decides the layout: `seed % LAYOUTS.length`, MatchView.layout). `?seed=123` pins it (testing).

let pending: bigint | null = null;

function urlSeed(): bigint | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = new URLSearchParams(window.location.search).get('seed');
  return raw && /^\d+$/.test(raw) ? BigInt(raw) : undefined;
}

function randomSeed(): bigint {
  const a = new BigUint64Array(1);
  crypto.getRandomValues(a);
  return a[0]!;
}

/** The seed the next (or current) match uses: picked on first ask, kept until `clearSeed`. */
export function peekSeed(): bigint {
  pending ??= urlSeed() ?? randomSeed();
  return pending;
}

/** A match is over (its screen unmounted): the next one gets a fresh seed. */
export function clearSeed() {
  pending = null;
}

/** The layout index a seed plays on. */
export function layoutOfSeed(seed: bigint): number {
  return Number(seed % BigInt(LAYOUTS.length));
}
