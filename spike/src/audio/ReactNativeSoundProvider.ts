import Sound = require('react-native-sound');
import { Image } from 'react-native';

import type { BookTrigger } from '../books/types';
import type { AudioProvider } from './AudioProvider';
import { resolveAudioAsset } from './audioAssets';

type AudioAssetResolver = (sound: string) => number;

export class ReactNativeSoundProvider implements AudioProvider {
  readonly name = 'react-native-sound' as const;

  private readonly sounds = new Map<string, Sound>();

  constructor(private readonly resolveAsset: AudioAssetResolver = resolveAudioAsset) {}

  async preload(triggers: BookTrigger[]): Promise<void> {
    await this.dispose();
    Sound.setCategory('Playback', true);

    await Promise.all(triggers.map((trigger) => this.loadTrigger(trigger)));
  }

  async play(id: string): Promise<void> {
    const sound = this.getSound(id);
    sound.setCurrentTime(0);
    sound.play();
  }

  async stop(id: string): Promise<void> {
    const sound = this.getSound(id);

    await new Promise<void>((resolve) => {
      sound.stop(resolve);
    });
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.sounds.values()].map(
        (sound) =>
          new Promise<void>((resolve) => {
            sound.stop(() => {
              sound.release();
              resolve();
            });
          }),
      ),
    );
    this.sounds.clear();
  }

  private async loadTrigger(trigger: BookTrigger): Promise<void> {
    const source = this.resolveSoundUri(trigger.sound);

    await new Promise<void>((resolve, reject) => {
      let loadedSound: Sound | undefined;
      loadedSound = new Sound(source, (error) => {
        if (error) {
          reject(
            new Error(`Failed to load sound "${trigger.sound}" for "${trigger.id}": ${error}`),
          );
          return;
        }

        if (loadedSound === undefined || !loadedSound.isLoaded()) {
          reject(new Error(`Sound "${trigger.sound}" for "${trigger.id}" did not report loaded`));
          return;
        }

        loadedSound.setNumberOfLoops(0);
        loadedSound.setVolume(1);
        this.sounds.set(trigger.id, loadedSound);
        resolve();
      });
    });
  }

  private getSound(id: string): Sound {
    const sound = this.sounds.get(id);

    if (sound === undefined || !sound.isLoaded()) {
      throw new Error(`No react-native-sound instance loaded for trigger "${id}"`);
    }

    return sound;
  }

  private resolveSoundUri(sound: string): string {
    const resolved = Image.resolveAssetSource(this.resolveAsset(sound));

    if (resolved?.uri === undefined) {
      throw new Error(`No react-native-sound URI resolved for "${sound}"`);
    }

    return resolved.uri;
  }
}
