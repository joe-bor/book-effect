import type { BookTrigger } from '../books/types';

export type AudioProviderName = 'expo-audio' | 'react-native-sound';

export type AudioProvider = {
  readonly name: AudioProviderName;
  preload(triggers: BookTrigger[]): Promise<void>;
  play(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  dispose(): Promise<void>;
};
