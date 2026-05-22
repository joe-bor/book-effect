export type TriggerType = 'single-word' | 'phrase' | 'sentence';

export type BookTrigger = {
  id: string;
  phrase: string;
  wordIndex: number;
  sound: string;
  type: TriggerType;
};

export type SpikeBook = {
  id: string;
  title: string;
  author: string;
  text: string;
  triggers: BookTrigger[];
};
