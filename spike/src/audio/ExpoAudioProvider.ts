import {
  clearPreloadedSource,
  createAudioPlayer,
  preload,
  type AudioPlayer,
  type AudioSource,
} from 'expo-audio';

import type { BookTrigger } from '../books/types';
import type { AudioProvider } from './AudioProvider';
import { resolveExpoAudioSource } from './audioAssets';

type AudioSourceResolver = (sound: string) => AudioSource;

export class ExpoAudioProvider implements AudioProvider {
  readonly name = 'expo-audio' as const;

  private readonly players = new Map<string, AudioPlayer>();
  private readonly sources = new Map<string, AudioSource>();

  constructor(private readonly resolveSource: AudioSourceResolver = resolveExpoAudioSource) {}

  async preload(triggers: BookTrigger[]): Promise<void> {
    await this.dispose();

    for (const trigger of triggers) {
      const source = this.resolveSource(trigger.sound);
      await preload(source, { preferredForwardBufferDuration: 1 });

      const player = createAudioPlayer(source, {
        downloadFirst: true,
        keepAudioSessionActive: true,
        preferredForwardBufferDuration: 1,
        updateInterval: 1000,
      });
      player.loop = false;
      player.volume = 1;

      this.players.set(trigger.id, player);
      this.sources.set(trigger.id, source);
    }
  }

  async play(id: string): Promise<void> {
    const player = this.getPlayer(id);
    await player.seekTo(0);
    player.play();
  }

  async stop(id: string): Promise<void> {
    const player = this.getPlayer(id);
    player.pause();
    await player.seekTo(0);
  }

  async dispose(): Promise<void> {
    for (const player of this.players.values()) {
      player.pause();
      player.remove();
    }

    const uniqueSources = new Set(this.sources.values());
    this.players.clear();
    this.sources.clear();

    await Promise.all(
      [...uniqueSources].map(async (source) => {
        await clearPreloadedSource(source);
      }),
    );
  }

  private getPlayer(id: string): AudioPlayer {
    const player = this.players.get(id);

    if (player === undefined) {
      throw new Error(`No expo-audio player preloaded for trigger "${id}"`);
    }

    return player;
  }
}
