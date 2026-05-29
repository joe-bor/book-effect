import { describe, expect, it } from 'vitest';

import { defaultCorpusRoot, loadCorpus } from './corpus/loadCorpus';
import { FuzzyMatcher } from './matchers/fuzzy';
import { replay } from './replay';
import { constructionChristmasTriggers } from './triggers';

describe('fuzzy matcher over the full corpus', () => {
  const trials = loadCorpus(defaultCorpusRoot());
  const report = replay(trials, constructionChristmasTriggers, new FuzzyMatcher());
  const fired = new Map(report.groups.map((g) => [`${g.provider}/${g.slug}`, g.fired]));

  it('does not regress whisper (still 30/30/30)', () => {
    expect(fired.get('whisper-rn/deadline')).toBe(30);
    expect(fired.get('whisper-rn/massive-gift')).toBe(30);
    expect(fired.get('whisper-rn/pushes-hard')).toBe(30);
  });

  it('recovers sherpa misses: deadline 29 (INE unrecoverable), massive-gift 30, pushes-hard 30', () => {
    expect(fired.get('sherpa-onnx/deadline')).toBe(29);
    expect(fired.get('sherpa-onnx/massive-gift')).toBe(30);
    expect(fired.get('sherpa-onnx/pushes-hard')).toBe(30);
  });

  it('introduces 0 false fires', () => {
    expect(report.totalFalseFires).toBe(0);
  });

  it('lifts total recovery from 161 to 179/180 (>= 95%)', () => {
    expect(report.totalFired).toBe(179);
    expect(report.totalFired / report.totalTrials).toBeGreaterThanOrEqual(0.95);
  });
});
