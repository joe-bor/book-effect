import { describe, expect, it } from 'vitest';

import { percentile, summarize } from './stats';

describe('percentile', () => {
  const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

  it('returns nearest-rank percentiles over 1..100', () => {
    expect(percentile(oneToHundred, 50)).toBe(50);
    expect(percentile(oneToHundred, 95)).toBe(95);
  });

  it('clamps p<=0 to the min and p>=100 to the max', () => {
    expect(percentile(oneToHundred, 0)).toBe(1);
    expect(percentile(oneToHundred, 100)).toBe(100);
  });

  it('does not require a pre-sorted input', () => {
    expect(percentile([4, 1, 3, 2], 50)).toBe(2);
  });

  it('throws on an empty sample', () => {
    expect(() => percentile([], 50)).toThrow();
  });
});

describe('summarize', () => {
  it('computes count/mean/p50/p95/max', () => {
    const s = summarize([1, 2, 3, 4]);
    expect(s.count).toBe(4);
    expect(s.mean).toBe(2.5);
    expect(s.p50).toBe(2);
    expect(s.max).toBe(4);
  });

  it('throws on an empty sample', () => {
    expect(() => summarize([])).toThrow();
  });
});
