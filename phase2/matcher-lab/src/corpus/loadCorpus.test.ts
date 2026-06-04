import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { loadCorpus } from './loadCorpus';

// The committed Phase 1 corpus (P0): phase2/corpus/raw, relative to this test file.
const CORPUS_ROOT = fileURLToPath(new URL('../../../corpus/raw', import.meta.url));

describe('loadCorpus', () => {
  const trials = loadCorpus(CORPUS_ROOT);

  it('loads all 180 trials (3 triggers x 30 x 2 providers)', () => {
    expect(trials.length).toBe(180);
  });

  it('has 30 trials per provider/trigger group', () => {
    const groups = new Map<string, number>();
    for (const t of trials) {
      const key = `${t.provider}/${t.slug}`;
      groups.set(key, (groups.get(key) ?? 0) + 1);
    }
    expect([...groups.values()]).toEqual([30, 30, 30, 30, 30, 30]);
  });

  it('extracts the ordered ASR chunk stream and metadata for a known trial', () => {
    const t = trials.find(
      (x) => x.provider === 'sherpa-onnx' && x.slug === 'deadline' && x.trialNumber === 1,
    );
    expect(t).toBeDefined();
    if (!t) return;

    expect(t.chunks.length).toBe(6); // 5 partials + 1 final
    expect(t.chunks[0]).toEqual({
      kind: 'partial',
      text: 'THE',
      wallClock: '2026-05-28T18:32:35.360Z',
    });
    expect(t.chunks.at(-1)).toEqual({
      kind: 'final',
      text: 'THE WORD IS DEADLINE',
      wallClock: '2026-05-28T18:32:38.314Z',
    });
    expect(t.triggerId).toBe('trigger-1');
    expect(t.meta.success).toBe(true);
    expect(t.meta.latestFinal).toBe('THE WORD IS DEADLINE');
  });

  it('marks every trial complete (has session.stop, under the 500-event cap)', () => {
    const incomplete = trials.filter((t) => !t.completeness.ok);
    expect(incomplete.map((t) => `${t.provider}/${t.slug}/${t.trialNumber}`)).toEqual([]);
  });
});
