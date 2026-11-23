export function sol(lamports: number): string {
  return (lamports / 1e9).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}

/** "+0.038 SOL" / "−0.02 SOL" (a real minus sign) / "0 SOL". */
export function signedSol(lamports: number): string {
  if (lamports === 0) return '0 SOL';
  return `${lamports > 0 ? '+' : '−'}${sol(Math.abs(lamports))} SOL`;
}

/** A fee in basis points as a percentage label: 500 → "5%". */
export function bpsLabel(bps: number): string {
  return `${Math.round(bps) / 100}%`;
}
