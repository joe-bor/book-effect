import type { AsrChunk } from '../matchers/types';

/**
 * Synthesize a streaming ASR read from a spoken-token sequence: for each segment of `segmentSize`
 * tokens, emit growing partial hypotheses one token at a time (as a real recognizer does within a
 * VAD segment) followed by one final. Token-by-token partials are what make trigger corridors
 * exercisable — the trigger word appears in a partial while the cursor is right at it, before a
 * later chunk can overshoot the corridor.
 */
export function readStream(spoken: readonly string[], segmentSize = 6): AsrChunk[] {
  const chunks: AsrChunk[] = [];
  for (let i = 0; i < spoken.length; i += segmentSize) {
    const segment = spoken.slice(i, i + segmentSize);
    for (let j = 1; j <= segment.length; j += 1) {
      chunks.push({ kind: 'partial', text: segment.slice(0, j).join(' '), wallClock: '' });
    }
    chunks.push({ kind: 'final', text: segment.join(' '), wallClock: '' });
  }
  return chunks;
}

export type Injection = {
  /** Index into the true token stream to replace. */
  at: number;
  /** Tokens to emit instead: many (split compound), one (substitution), or none (a dropped token). */
  replaceWith: string[];
};

/**
 * Apply recognition-error shapes to a true token stream, producing what the recognizer "heard".
 * Used to reproduce the known sherpa miss shapes (split compound, dropped token, substitution) at
 * the trigger positions of an otherwise-clean read.
 */
export function injectErrors(truth: readonly string[], injections: readonly Injection[]): string[] {
  const byIndex = new Map(injections.map((inj) => [inj.at, inj.replaceWith]));
  const spoken: string[] = [];
  truth.forEach((token, index) => {
    const replacement = byIndex.get(index);
    spoken.push(...(replacement ?? [token]));
  });
  return spoken;
}
