// Trigger types mirror spike/src/books/types.ts (offline harness omits `sound`).
export type TriggerType = 'single-word' | 'phrase' | 'sentence';

// One ordered ASR emission from a recorded trial (asr.partial / asr.final).
export type AsrChunk = {
  kind: 'partial' | 'final';
  text: string;
  wallClock: string;
};

export type Trigger = {
  id: string;
  phrase: string;
  wordIndex: number;
  type: TriggerType;
};

// Where a matcher decided to fire a trigger: the index into the replayed chunk stream.
export type FireDecision = {
  triggerId: string;
  chunkIndex: number;
};

// Pluggable matcher contract. P1 ships BaselineMatcher; P2/P3 add smarter implementations
// behind this same interface so the replay harness never changes.
export interface Matcher {
  readonly name: string;
  run(chunks: readonly AsrChunk[], triggers: readonly Trigger[]): FireDecision[];
}
