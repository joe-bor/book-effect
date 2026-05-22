import type { AudioSource } from 'expo-audio';

const audioAssets: Record<string, number> = {
  'boom.wav': require('../../assets/audio/boom.wav'),
  'sparkle.wav': require('../../assets/audio/sparkle.wav'),
  'truck.wav': require('../../assets/audio/truck.wav'),
  'latency-click.wav': require('../../assets/audio/latency-click.wav'),
};

export function resolveAudioAsset(sound: string): number {
  const asset = audioAssets[sound];

  if (asset === undefined) {
    throw new Error(`No spike audio asset registered for "${sound}"`);
  }

  return asset;
}

export function resolveExpoAudioSource(sound: string): AudioSource {
  return resolveAudioAsset(sound);
}
