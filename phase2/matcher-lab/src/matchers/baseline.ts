import { normalizeWords } from '../normalize';
import type { AsrChunk, FireDecision, Matcher, Trigger } from './types';

// Ported verbatim from spike/src/matcher/naiveMatcher.ts: exact normalized substring.
// This is the Phase 1 behavior the baseline must reproduce; do not "improve" it here.
export function findPhraseInRecentText(recentText: string, phrase: string): boolean {
  const recent = normalizeWords(recentText).join(' ');
  const target = normalizeWords(phrase).join(' ');

  if (target.length === 0) {
    return false;
  }

  return recent.includes(target);
}

// Faithful reproduction of spike/src/session/SpikeSession.ts: on every partial/final,
// fire any not-yet-fired trigger whose phrase is a substring of that emission's text.
export class BaselineMatcher implements Matcher {
  readonly name = 'baseline-substring';

  run(chunks: readonly AsrChunk[], triggers: readonly Trigger[]): FireDecision[] {
    const fired = new Set<string>();
    const fires: FireDecision[] = [];

    chunks.forEach((chunk, chunkIndex) => {
      for (const trigger of triggers) {
        if (fired.has(trigger.id)) {
          continue;
        }
        if (findPhraseInRecentText(chunk.text, trigger.phrase)) {
          fired.add(trigger.id);
          fires.push({ triggerId: trigger.id, chunkIndex });
        }
      }
    });

    return fires;
  }
}
