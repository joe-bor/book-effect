import { describe, expect, it } from 'vitest';

import { defaultCorpusRoot, loadCorpus } from './corpus/loadCorpus';
import { BaselineMatcher } from './matchers/baseline';
import { replay } from './replay';
import { formatReport } from './report';
import { constructionChristmasTriggers } from './triggers';

describe('formatReport', () => {
  const report = replay(
    loadCorpus(defaultCorpusRoot()),
    constructionChristmasTriggers,
    new BaselineMatcher(),
  );
  const md = formatReport(report);

  it('names the matcher and reports totals + harness fidelity', () => {
    expect(md).toContain('baseline-substring');
    expect(md).toContain('161/180');
    expect(md).toContain('mismatches: 0');
  });

  it('shows each provider/trigger fired count', () => {
    expect(md).toContain('sherpa-onnx');
    expect(md).toContain('27/30');
    expect(md).toContain('23/30');
    expect(md).toContain('21/30');
    expect(md).toContain('30/30');
  });

  it('surfaces sherpa miss text as P2 recovery targets', () => {
    expect(md.toLowerCase()).toContain('guest'); // MASSIVE GUEST substitution miss
  });
});
