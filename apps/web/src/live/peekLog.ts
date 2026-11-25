import { create } from 'zustand';
import { peekAttempts, type LiveSource, type PeekAttempt } from '@lil-dudes/client';

/**
 * The "try to cheat" attempts of the current live match: the ones made during play (shown again
 * in Verify, next to what's public after the end) and the ones made after. Real requests only
 * (peekAttempts in @lil-dudes/client); nothing here is simulated.
 */
interface PeekLog {
  matchId: string | null;
  during: PeekAttempt[];
  after: PeekAttempt[];
  running: 'during' | 'after' | null;
}

export const usePeekLog = create<PeekLog>(() => ({ matchId: null, during: [], after: [], running: null }));

/** Runs every read attempt as this player; lines land in the log one by one. */
export async function runPeek(src: LiveSource): Promise<void> {
  const id = src.matchId.toString();
  if (usePeekLog.getState().running) return;
  if (usePeekLog.getState().matchId !== id) usePeekLog.setState({ matchId: id, during: [], after: [] });
  const phase = src.reveal() ? 'after' : 'during';
  usePeekLog.setState({ running: phase, [phase]: [] });
  try {
    await peekAttempts(src, { onAttempt: (a) => usePeekLog.setState((s) => ({ [phase]: [...s[phase], a] })) });
  } finally {
    usePeekLog.setState({ running: null });
  }
}
