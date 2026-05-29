import { describe, expect, it } from 'vitest';

import type { HumanRead } from './corpus/loadHumanReads';
import { constructionChristmasBookTokens } from './engine/book';
import { injectErrors, readStream } from './engine/readStream';
import { replayHumanReads } from './humanReplay';
import { normalizeWords } from './normalize';
import { constructionChristmasTriggers } from './triggers';
import type { AsrChunk } from './matchers/types';

const trueTokens = [...constructionChristmasBookTokens];

// Stamp a monotonic wallClock (1s apart) on a synthesized chunk stream so latency math has input.
const withClocks = (chunks: AsrChunk[], startMs = 0): AsrChunk[] =>
  chunks.map((c, i) => ({ ...c, wallClock: new Date(startMs + i * 1000).toISOString() }));

// Build a one-session read. Cues are placed (in reading order) at the wallClock of the chunk that
// completes each trigger phrase, simulating the reader pressing "phrase end" right after saying it.
const buildRead = (id: string, spoken: readonly string[]): HumanRead => {
  const chunks = withClocks(readStream(spoken, 6));
  // Reading order: deadline(67) -> pushes(87) -> massive gift(121). Approx phrase-completion chunks.
  const cueChunkIndices = [80, 110, 150].map((n) => Math.min(n, chunks.length - 1));
  const cues = cueChunkIndices.map((idx) => ({
    wallClock: chunks[idx]!.wallClock,
    latestPartial: '',
    latestFinal: '',
  }));
  return { id, chunks, cues, completeness: { ok: true, issues: [] } };
};

describe('replayHumanReads', () => {
  it('recovers all three triggers in-corridor on a clean full read, 0 false-stale / 0 wrong-occurrence', () => {
    const report = replayHumanReads(
      [buildRead('clean', trueTokens)],
      trueTokens,
      constructionChristmasTriggers,
    );

    expect(report.totalFired).toBe(3);
    expect(report.totalOccurrences).toBe(3);
    expect(report.recoveryPct).toBe(100);
    expect(report.falseStaleCount).toBe(0);
    expect(report.wrongOccurrenceCount).toBe(0);
    for (const t of report.reads[0]!.triggers) {
      expect(t.fired, t.triggerId).toBe(true);
      expect(t.inCorridor, t.triggerId).toBe(true);
      expect(typeof t.latencyMs, `${t.triggerId} latency`).toBe('number');
    }
  });

  it('preserves P2 recoveries under injected sherpa miss shapes', () => {
    const spoken = injectErrors(trueTokens, [
      { at: 67, replaceWith: ['dead', 'line'] }, // split compound
      { at: 87, replaceWith: [] }, // dropped leading token
      { at: 122, replaceWith: ['guest'] }, // substitution
    ]);
    const report = replayHumanReads([buildRead('noisy', spoken)], trueTokens, [
      ...constructionChristmasTriggers,
    ]);

    expect(report.recoveryPct).toBe(100);
    expect(report.falseStaleCount).toBe(0);
    expect(report.wrongOccurrenceCount).toBe(0);
  });

  it('aggregates recovery across multiple reads', () => {
    const clean = buildRead('r1', trueTokens);
    // A read that never reaches the triggers -> all three miss.
    const truncated: HumanRead = {
      id: 'r2',
      chunks: withClocks(readStream(trueTokens.slice(0, 40), 6)),
      cues: [],
      completeness: { ok: true, issues: [] },
    };
    const report = replayHumanReads([clean, truncated], trueTokens, constructionChristmasTriggers);

    expect(report.totalOccurrences).toBe(6);
    expect(report.totalFired).toBe(3);
    expect(report.recoveryPct).toBe(50);
    for (const t of report.perTrigger) {
      expect(t.recoveryPct).toBe(50);
    }
  });
});
