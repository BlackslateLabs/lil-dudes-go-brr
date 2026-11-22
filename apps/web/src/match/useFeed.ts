import { useEffect, useMemo } from 'react';
import type { MatchSource } from '@lil-dudes/client';
import { MatchFeed } from './feed';

/** One MatchFeed for the component's lifetime: started on mount, stopped on unmount. */
export function useFeed(makeSource: () => MatchSource): MatchFeed {
  // makeSource is only read on the first render, by design.
  const feed = useMemo(() => new MatchFeed(makeSource()), []);
  useEffect(() => {
    feed.start();
    return () => feed.stop();
  }, [feed]);
  return feed;
}
