import type { MatchFeed } from './feed';

/**
 * Whether tapping gate `slot` of my current stage would rig the opponent's copy (SPEC v4 §6): once
 * per stage, while we're both still playing, and only if they haven't passed this stage or opened
 * that gate yet. The sim is the judge; this only decides what the UI offers, so it never sends a
 * rig the sim would refuse (a refused rig isn't used up, but a dead tap feels broken).
 */
export function canRigSlot(feed: MatchFeed, slot: number): boolean {
  const me = feed.me;
  const them = feed.them;
  if (!me || !them || me.rigUsed) return false;
  if (me.phase === 'dead' || me.phase === 'done' || them.phase === 'dead' || them.phase === 'done') return false;
  if (!me.gates.some((g) => g.slot === slot)) return false;
  if (them.stage > me.stage) return false;
  if (them.stage < me.stage) return true;
  const theirs = them.gates.find((g) => g.slot === slot);
  return !!theirs && !theirs.revealed;
}

/** Whether any gate of my current stage can be rigged right now. */
export function canRig(feed: MatchFeed): boolean {
  return feed.me?.gates.some((g) => canRigSlot(feed, g.slot)) ?? false;
}
