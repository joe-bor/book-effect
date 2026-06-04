import { normalizeWords } from '../normalize';
import { phraseEditDistance } from './align';
import type { AsrChunk, FireDecision, Matcher, Trigger } from './types';

/**
 * Allowed token-level edits before a phrase is considered a match.
 * Single words are strict (0 edits beyond fuzzy-equal/merge); short phrases tolerate one
 * substitution or drop; longer phrases scale up. Tuned against the Phase 1 sherpa miss shapes
 * (docs/03) and validated on the full corpus by the replay integration test.
 */
export function editBudget(tokenCount: number): number {
  if (tokenCount <= 1) return 0;
  if (tokenCount <= 3) return 1;
  if (tokenCount <= 6) return 2;
  return Math.floor(tokenCount / 3);
}

// Forgiving matcher: fires a trigger on the first chunk whose normalized text aligns to the
// trigger phrase within its edit budget. Still windowless (no cursor/corridor — that is P3).
export class FuzzyMatcher implements Matcher {
  readonly name = 'fuzzy-tokens';

  run(chunks: readonly AsrChunk[], triggers: readonly Trigger[]): FireDecision[] {
    const targets = triggers.map((trigger) => ({
      trigger,
      tokens: normalizeWords(trigger.phrase),
    }));

    const fired = new Set<string>();
    const fires: FireDecision[] = [];

    chunks.forEach((chunk, chunkIndex) => {
      const recent = normalizeWords(chunk.text);
      for (const { trigger, tokens } of targets) {
        if (tokens.length === 0 || fired.has(trigger.id)) {
          continue;
        }
        if (phraseEditDistance(tokens, recent) <= editBudget(tokens.length)) {
          fired.add(trigger.id);
          fires.push({ triggerId: trigger.id, chunkIndex });
        }
      }
    });

    return fires;
  }
}
