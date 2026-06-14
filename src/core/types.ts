export type TriggerType = 'single-word' | 'phrase' | 'sentence';

export type AsrChunk = {
  kind: 'partial' | 'final';
  text: string;
};

export type Trigger = {
  id: string;
  phrase: string;
  wordIndex: number;
  type: TriggerType;
};

export type FireDecision = {
  triggerId: string;
  chunkIndex: number;
};
