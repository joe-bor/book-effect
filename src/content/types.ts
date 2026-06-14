import type { TriggerType } from '../core/types';

export type AuthoredTrigger = {
  id: string;
  phrase: string;
  sound: string;
  occurrence?: number;
};

export type AuthoredBook = {
  id: string;
  title: string;
  text: string;
  triggers: AuthoredTrigger[];
};

export type CompiledTrigger = {
  id: string;
  phrase: string;
  wordIndex: number;
  type: TriggerType;
  sound: string;
};

export type CompiledBook = {
  id: string;
  title: string;
  tokens: string[];
  triggers: CompiledTrigger[];
  sourceHash: string;
  warnings: string[];
};

export type BookIndexEntry = {
  id: string;
  title: string;
  sourceHash: string;
};
