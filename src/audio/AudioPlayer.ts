import { Asset } from 'expo-asset';

import AudioPlayerModule from '../../modules/audio-player/src/AudioPlayerModule';
import type { AudioPlayer } from '../session/types';

type NativeAudioPlayer = {
  init(opts?: { maxVoices?: number }): Promise<void>;
  preload(voices: { id: string; uri: string }[]): Promise<void>;
  play(id: string): void;
  stopAll(): void;
  teardown(): Promise<void>;
};

type AudioPlayerDeps = {
  native?: NativeAudioPlayer;
  resolveAssetUri?: (module: number) => Promise<string>;
};

export function createAudioPlayer(deps: AudioPlayerDeps = {}): AudioPlayer {
  const native = deps.native ?? AudioPlayerModule;
  const resolveAssetUri = deps.resolveAssetUri ?? resolveExpoAssetUri;

  return {
    init: (opts) => native.init(opts),
    async preload(voices) {
      const resolved = await Promise.all(
        voices.map(async (voice) => ({
          id: voice.id,
          uri: await resolveAssetUri(voice.module),
        })),
      );

      await native.preload(resolved);
    },
    play: (id) => native.play(id),
    stopAll: () => native.stopAll(),
    teardown: () => native.teardown(),
  };
}

async function resolveExpoAssetUri(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();

  const uri = asset.localUri ?? asset.uri;
  if (uri === null) {
    throw new Error(`Unable to resolve audio asset module ${module}`);
  }

  return uri;
}
