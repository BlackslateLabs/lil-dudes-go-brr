export function sol(lamports: number): string {
  return (lamports / 1e9).toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
}
