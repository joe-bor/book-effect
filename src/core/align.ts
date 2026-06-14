import { fuzzyTokenEqual } from './tokens';

const MAX_MERGE = 3;

export type Alignment = {
  distance: number;
  end: number;
};

export function approxSubstringAlign(
  target: readonly string[],
  recent: readonly string[],
): Alignment {
  const m = target.length;
  const n = recent.length;
  if (m === 0) {
    return { distance: 0, end: -1 };
  }

  const width = n + 1;
  const dp = new Array<number>((m + 1) * width).fill(0);
  for (let i = 1; i <= m; i += 1) {
    dp[i * width] = i;
  }

  for (let i = 1; i <= m; i += 1) {
    const targetToken = target[i - 1] as string;
    for (let j = 1; j <= n; j += 1) {
      const recentToken = recent[j - 1] as string;
      const subCost = fuzzyTokenEqual(targetToken, recentToken) ? 0 : 1;

      let best = Math.min(
        (dp[(i - 1) * width + (j - 1)] as number) + subCost,
        (dp[(i - 1) * width + j] as number) + 1,
        (dp[i * width + (j - 1)] as number) + 1,
      );

      for (let k = 2; k <= MAX_MERGE && j >= k; k += 1) {
        const merged = recent.slice(j - k, j).join('');
        if (fuzzyTokenEqual(targetToken, merged)) {
          best = Math.min(best, dp[(i - 1) * width + (j - k)] as number);
        }
      }

      dp[i * width + j] = best;
    }
  }

  let distance = Number.POSITIVE_INFINITY;
  let endColumn = 0;
  for (let j = 0; j <= n; j += 1) {
    const cost = dp[m * width + j] as number;
    if (cost < distance) {
      distance = cost;
      endColumn = j;
    }
  }

  return { distance, end: endColumn - 1 };
}

export function phraseEditDistance(target: readonly string[], recent: readonly string[]): number {
  return approxSubstringAlign(target, recent).distance;
}
