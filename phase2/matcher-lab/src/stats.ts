/** Summary statistics for a sample of per-eval timings (or any numeric sample). */
export type Summary = {
  count: number;
  mean: number;
  p50: number;
  p95: number;
  max: number;
};

/**
 * Nearest-rank percentile of a numeric sample. `p` is in [0, 100]. The input need not be sorted.
 * p<=0 returns the min, p>=100 returns the max. Throws on an empty sample.
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) {
    throw new Error('percentile of an empty sample');
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0] as number;
  if (p >= 100) return sorted[sorted.length - 1] as number;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[rank - 1] as number;
}

/** Sort once and compute count/mean/p50/p95/max. Throws on an empty sample. */
export function summarize(values: readonly number[]): Summary {
  if (values.length === 0) {
    throw new Error('summarize of an empty sample');
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] as number,
  };
}
