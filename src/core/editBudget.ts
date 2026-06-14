export function editBudget(tokenCount: number): number {
  if (tokenCount <= 1) return 0;
  if (tokenCount <= 3) return 1;
  if (tokenCount <= 6) return 2;
  return Math.floor(tokenCount / 3);
}
