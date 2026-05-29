import { fuzzyTokenEqual } from './tokens';

const MAX_MERGE = 3; // a target token may match up to 3 adjacent recent tokens joined (dead line -> deadline)

/**
 * Minimum token-level edits to align the full `target` token sequence as an approximate
 * substring of `recent` (Sellers' algorithm): leading/trailing recent tokens are free, a
 * substitution or a dropped target token or an extra interspersed token each cost 1, and a
 * target token may also match the concatenation of up to MAX_MERGE adjacent recent tokens
 * (cost 0) to absorb split compounds.
 */
export function phraseEditDistance(target: readonly string[], recent: readonly string[]): number {
  const m = target.length;
  const n = recent.length;
  if (m === 0) {
    return 0;
  }

  const width = n + 1;
  const dp = new Array<number>((m + 1) * width).fill(0);
  for (let i = 1; i <= m; i += 1) {
    dp[i * width] = i; // j = 0: drop all target tokens so far
  }
  // row i = 0 stays 0: the pattern may start anywhere in recent.

  for (let i = 1; i <= m; i += 1) {
    const targetToken = target[i - 1] as string;
    for (let j = 1; j <= n; j += 1) {
      const recentToken = recent[j - 1] as string;
      const subCost = fuzzyTokenEqual(targetToken, recentToken) ? 0 : 1;

      let best = Math.min(
        (dp[(i - 1) * width + (j - 1)] as number) + subCost, // match / substitution
        (dp[(i - 1) * width + j] as number) + 1, // dropped target token
        (dp[i * width + (j - 1)] as number) + 1, // extra interspersed recent token
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

  let answer = Number.POSITIVE_INFINITY;
  for (let j = 0; j <= n; j += 1) {
    answer = Math.min(answer, dp[m * width + j] as number);
  }
  return answer;
}
