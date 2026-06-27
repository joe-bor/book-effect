import { describe, expect, it } from 'vitest';

import {
  createHumanReplayCommand,
  formatReferenceWarnings,
  parseHumanReplaySummary,
} from './check-phase2-regression';

describe('parseHumanReplaySummary', () => {
  it('accepts the Phase 2 reference signal shape', () => {
    const summary = parseHumanReplaySummary(
      ['Total recovery: 20/21 (95.2%)', 'False-stale: 0', 'Wrong-occurrence: 0'].join('\n'),
    );

    expect(summary).toEqual({ recovered: 20, total: 21, falseStale: 0, wrongOccurrence: 0 });
  });

  it('accepts the actual bold Markdown summary line', () => {
    const summary = parseHumanReplaySummary(
      '**Total recovery: 20/21 (95.2%). False-stale: 0. Wrong-occurrence: 0.**',
    );

    expect(summary).toEqual({ recovered: 20, total: 21, falseStale: 0, wrongOccurrence: 0 });
  });

  it('accepts extra whitespace and CRLF output', () => {
    const summary = parseHumanReplaySummary(
      ['  Total recovery:   19 / 21 (90.5%)  ', 'False-stale:   1', 'Wrong-occurrence:  2'].join(
        '\r\n',
      ),
    );

    expect(summary).toEqual({ recovered: 19, total: 21, falseStale: 1, wrongOccurrence: 2 });
  });

  it('uses the last summary when output contains multiple summary-like blocks', () => {
    const summary = parseHumanReplaySummary(
      [
        'Total recovery: 1/3 (33.3%)',
        'False-stale: 4',
        'Wrong-occurrence: 5',
        '**Total recovery: 20/21 (95.2%). False-stale: 0. Wrong-occurrence: 0.**',
      ].join('\n'),
    );

    expect(summary).toEqual({ recovered: 20, total: 21, falseStale: 0, wrongOccurrence: 0 });
  });

  it('throws when required fields are missing', () => {
    expect(() => parseHumanReplaySummary('Total recovery: 20/21 (95.2%)')).toThrow(
      'Unable to parse human replay summary.',
    );
  });
});

describe('formatReferenceWarnings', () => {
  it('does not warn for the Phase 2 reference values', () => {
    expect(
      formatReferenceWarnings({ recovered: 20, total: 21, falseStale: 0, wrongOccurrence: 0 }),
    ).toEqual([]);
  });

  it('warns without failing when reference values move', () => {
    expect(
      formatReferenceWarnings({ recovered: 19, total: 21, falseStale: 1, wrongOccurrence: 2 }),
    ).toEqual([
      'Recovery changed from reference 20/21 to 19/21.',
      'False-stale changed from reference 0 to 1.',
      'Wrong-occurrence changed from reference 0 to 2.',
    ]);
  });
});

describe('createHumanReplayCommand', () => {
  it('runs the Phase 2 replay through node import hooks without the tsx CLI IPC server', () => {
    expect(createHumanReplayCommand('/repo', '/node')).toEqual({
      command: '/node',
      args: ['--import', 'tsx', 'src/cli/replayHuman.ts'],
      cwd: '/repo/phase2/matcher-lab',
    });
  });
});
