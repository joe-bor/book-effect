import { describe, expect, it } from 'vitest';

import { defaultCorpusRoot, loadCorpus } from './corpus/loadCorpus';
import { BaselineMatcher } from './matchers/baseline';
import { replay } from './replay';
import { constructionChristmasTriggers } from './triggers';

describe('baseline replay reproduces Phase 1', () => {
  const trials = loadCorpus(defaultCorpusRoot());
  const report = replay(trials, constructionChristmasTriggers, new BaselineMatcher());

  it('reproduces the published per-trigger success counts from docs/03', () => {
    const fired = new Map(report.groups.map((g) => [`${g.provider}/${g.slug}`, g.fired]));
    expect(fired.get('sherpa-onnx/deadline')).toBe(27);
    expect(fired.get('sherpa-onnx/massive-gift')).toBe(23);
    expect(fired.get('sherpa-onnx/pushes-hard')).toBe(21);
    expect(fired.get('whisper-rn/deadline')).toBe(30);
    expect(fired.get('whisper-rn/massive-gift')).toBe(30);
    expect(fired.get('whisper-rn/pushes-hard')).toBe(30);
  });

  it('replayed fire decision matches recorded success for every trial (0 mismatches)', () => {
    const mismatched = report.results
      .filter((r) => r.mismatch)
      .map((r) => `${r.trial.provider}/${r.trial.slug}/${r.trial.trialNumber}`);
    expect(mismatched).toEqual([]);
  });

  it('totals 161/180 fired (sherpa 71 + whisper 90) for the baseline substring matcher', () => {
    expect(report.totalFired).toBe(161);
    expect(report.totalTrials).toBe(180);
    expect(report.totalMismatches).toBe(0);
  });
});
