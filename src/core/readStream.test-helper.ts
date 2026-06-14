import type { AsrChunk } from './types';

export function readStream(spoken: readonly string[], segmentSize = 6): AsrChunk[] {
  const chunks: AsrChunk[] = [];
  for (let i = 0; i < spoken.length; i += segmentSize) {
    const segment = spoken.slice(i, i + segmentSize);
    for (let j = 1; j <= segment.length; j += 1) {
      chunks.push({ kind: 'partial', text: segment.slice(0, j).join(' ') });
    }
    chunks.push({ kind: 'final', text: segment.join(' ') });
  }
  return chunks;
}

export type Injection = {
  at: number;
  replaceWith: string[];
};

export function injectErrors(truth: readonly string[], injections: readonly Injection[]): string[] {
  const byIndex = new Map(injections.map((inj) => [inj.at, inj.replaceWith]));
  const spoken: string[] = [];
  truth.forEach((token, index) => {
    const replacement = byIndex.get(index);
    spoken.push(...(replacement ?? [token]));
  });
  return spoken;
}
