import { useEffect, useMemo } from 'react';
import type { MatchSource } from '@lil-dudes/client';
import { MatchFeed } from './feed';

/**
 * One MatchFeed for the component's lifetime: started on mount, stopped on unmount. With `gate`,
 * the feed starts only once that promise settles (the match waits for the models), and never if
 * the component unmounts first.
 */
export function useFeed(makeSource: () => MatchSource, gate?: () => Promise<unknown>): MatchFeed {
  // makeSource and gate are only read on the first render, by design.
  const feed = useMemo(() => new MatchFeed(makeSource()), []);
  useEffect(() => {
    if (!gate) {
      feed.start();
      return () => feed.stop();
    }
    let live = true;
    let started = false;
    // A failed load still starts the match: the arena shows its own error, the HUD stays usable.
    void gate()
      .catch(() => undefined)
      .then(() => {
        if (!live) return;
        started = true;
        feed.start();
      });
    return () => {
      live = false;
      if (started) feed.stop();
    };
  }, [feed]);
  return feed;
}
