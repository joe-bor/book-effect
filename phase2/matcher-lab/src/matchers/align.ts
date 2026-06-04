import { fuzzyTokenEqual } from './tokens';

const MAX_MERGE = 3; // a target token may match up to 3 adjacent recent tokens joined (dead line -> deadline)

export type Alignment = {
  /** Minimum token-level edits to align the whole `target` as an approximate substring of `recent`. */
  distance: number;
  /**
   * 0-based index in `recent` of the last token consumed by a minimal-distance alignment, or -1
   * when `target` is empty. Ties break toward the earliest end so a cursor reading this never
   * over-advances on a repeated token.
   */
  end: number;
};

/**
 * Approximate-substring alignment of the full `target` token sequence within `recent` (Sellers'
 * algorithm): leading/trailing recent tokens are free, a substitution or a dropped target token or
 * an extra interspersed token each cost 1, and a target token may also match the concatenation of
 * up to MAX_MERGE adjacent recent tokens (cost 0) to absorb split compounds. Returns both the
 * minimal distance (for phrase spotting) and the end column (for advancing a forward cursor).
 */
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

  let distance = Number.POSITIVE_INFINITY;
  let endColumn = 0;
  for (let j = 0; j <= n; j += 1) {
    const cost = dp[m * width + j] as number;
    if (cost < distance) {
      distance = cost;
      endColumn = j; // earliest j wins ties: strict `<` keeps the first minimum seen
    }
  }
  return { distance, end: endColumn - 1 };
}

/**
 * Minimum token-level edits to align the full `target` token sequence as an approximate substring
 * of `recent`. Thin wrapper over {@link approxSubstringAlign} for phrase spotting (P2).
 */
export function phraseEditDistance(target: readonly string[], recent: readonly string[]): number {
  return approxSubstringAlign(target, recent).distance;
}
