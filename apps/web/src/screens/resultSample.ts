// SAMPLE reveal boards for the Result screen. MatchView v0 carries only the current deal, so the full
// reveal of all 3 deals (with rigs and peeks) needs deal history from the contract (asked in the log).

export interface RevealCell {
  label: string;
  kind: 'good' | 'bad' | 'gold' | 'trap';
  /** You peeked this cell. */
  peeked?: boolean;
}

const g = (label: string, kind: RevealCell['kind'] = 'good', peeked = false): RevealCell => ({ label, kind, peeked });

export const SAMPLE_PHASES: RevealCell[][] = [
  [g('÷2', 'trap'), g('+10'), g('−6', 'bad'), g('+6'), g('×3', 'good', true), g('÷2', 'bad'), g('×2'), g('×3', 'gold'), g('+6')],
  [g('+6'), g('÷2', 'bad', true), g('×2'), g('×3', 'gold'), g('×2'), g('+10'), g('−6', 'bad'), g('÷2', 'trap'), g('×3')],
  [g('×3'), g('+6'), g('÷3', 'gold'), g('−6', 'bad'), g('×2', 'good', true), g('+10'), g('÷2', 'trap'), g('×2'), g('÷2', 'bad')],
];

export const SAMPLE_RIG_LINES = [
  'Your rig: their centre ×3 → caught them (GOTCHA)',
  'Your rig: their left +6 → never triggered',
  'Your rig: their right ×2 → caught them (GOTCHA)',
];

export function sol(lamports: number): string {
  return (lamports / 1e9).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
