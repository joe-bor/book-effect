import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Asset } from 'expo-asset';

vi.mock('expo-asset', () => ({
  Asset: {
    fromModule: vi.fn(),
  },
}));

vi.mock('../../modules/audio-player/src/AudioPlayerModule', () => ({
  default: {
    init: vi.fn(),
    preload: vi.fn(),
    play: vi.fn(),
    stopAll: vi.fn(),
    teardown: vi.fn(),
  },
}));

import { createAudioPlayer } from './AudioPlayer';

beforeEach(() => {
  vi.clearAllMocks();
});

function createRecordingNative() {
  const nativeCalls: unknown[] = [];
  return {
    nativeCalls,
    native: {
      init: async (opts?: { maxVoices?: number }) => {
        nativeCalls.push(['init', opts]);
      },
      preload: async (voices: { id: string; uri: string }[]) => {
        nativeCalls.push(['preload', voices]);
      },
      play: (id: string) => {
        nativeCalls.push(['play', id]);
      },
      stopAll: () => {
        nativeCalls.push(['stopAll']);
      },
      teardown: async () => {
        nativeCalls.push(['teardown']);
      },
    },
  };
}

describe('createAudioPlayer', () => {
  it('initializes, resolves modules to URIs, preloads voices, plays, stops, and tears down', async () => {
    const { native, nativeCalls } = createRecordingNative();
    const player = createAudioPlayer({
      native,
      resolveAssetUri: async (module) => `file:///asset-${module}.wav`,
    });

    await player.init({ maxVoices: 3 });
    await player.preload([{ id: 'boom', module: 7 }]);
    player.play('boom');
    player.stopAll();
    await player.teardown();

    expect(nativeCalls).toEqual([
      ['init', { maxVoices: 3 }],
      ['preload', [{ id: 'boom', uri: 'file:///asset-7.wav' }]],
      ['play', 'boom'],
      ['stopAll'],
      ['teardown'],
    ]);
  });

  it('downloads Expo assets and preloads local asset URIs by default', async () => {
    const downloadAsync = vi.fn().mockResolvedValue(undefined);
    vi.mocked(Asset.fromModule).mockReturnValue({
      downloadAsync,
      localUri: 'file:///local-boom.wav',
      uri: 'https://example.invalid/remote-boom.wav',
    } as never);
    const { native, nativeCalls } = createRecordingNative();
    const player = createAudioPlayer({ native });

    await player.preload([{ id: 'boom', module: 7 }]);

    expect(Asset.fromModule).toHaveBeenCalledWith(7);
    expect(downloadAsync).toHaveBeenCalledOnce();
    expect(nativeCalls).toEqual([['preload', [{ id: 'boom', uri: 'file:///local-boom.wav' }]]]);
  });

  it('falls back to the Expo asset URI when no local URI is available', async () => {
    vi.mocked(Asset.fromModule).mockReturnValue({
      downloadAsync: vi.fn().mockResolvedValue(undefined),
      localUri: null,
      uri: 'https://example.invalid/remote-boom.wav',
    } as never);
    const { native, nativeCalls } = createRecordingNative();
    const player = createAudioPlayer({ native });

    await player.preload([{ id: 'boom', module: 7 }]);

    expect(nativeCalls).toEqual([
      ['preload', [{ id: 'boom', uri: 'https://example.invalid/remote-boom.wav' }]],
    ]);
  });

  it('fails when Expo cannot resolve an asset URI', async () => {
    vi.mocked(Asset.fromModule).mockReturnValue({
      downloadAsync: vi.fn().mockResolvedValue(undefined),
      localUri: null,
      uri: null,
    } as never);
    const { native } = createRecordingNative();
    const player = createAudioPlayer({ native });

    await expect(player.preload([{ id: 'boom', module: 7 }])).rejects.toThrow(
      'Unable to resolve audio asset module 7',
    );
  });
});
