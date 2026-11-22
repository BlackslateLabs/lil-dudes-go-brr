import type { MatchFeed } from './feed';

/**
 * Whether tapping gate `slot` of my current stage would rig the opponent's copy (SPEC v4 §6). The
 * source asks the sim itself (`can_rig`), so the UI never offers a rig the sim would refuse.
 */
export function canRigSlot(feed: MatchFeed, slot: number): boolean {
  return feed.source.canRig(slot);
}

/** Whether any gate of my current stage can be rigged right now. */
export function canRig(feed: MatchFeed): boolean {
  return feed.me?.gates.some((g) => feed.source.canRig(g.slot)) ?? false;
}
