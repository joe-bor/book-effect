import { requireNativeModule } from 'expo-modules-core';

type NativeAudioPlayerModule = {
  init(opts?: { maxVoices?: number }): Promise<void>;
  preload(voices: { id: string; uri: string }[]): Promise<void>;
  play(id: string): void;
  stopAll(): void;
  teardown(): Promise<void>;
};

export default requireNativeModule<NativeAudioPlayerModule>('AudioPlayer');
