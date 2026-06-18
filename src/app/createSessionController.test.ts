import { describe, expect, it, vi } from 'vitest';

import type { AsrEvent } from '../session/types';

vi.mock('../../content/compiled/assets', () => ({
  contentAssets: {
    'test/sound.wav': 42,
  },
}));

vi.mock('react-native', () => ({
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'android.permission.RECORD_AUDIO' },
    RESULTS: { GRANTED: 'granted' },
    request: vi.fn(),
  },
  Platform: { OS: 'android' },
}));

vi.mock('../audio/AudioPlayer', () => ({
  createAudioPlayer: vi.fn(),
}));

import { createSessionController } from './createSessionController';

describe('createSessionController', () => {
  it('wires permissions, assets, audio, ASR, and the real tracker', async () => {
    const audioCalls: unknown[] = [];
    let asrHandler: ((event: AsrEvent) => void) | undefined;
    const controller = createSessionController({
      asr: {
        name: 'fake-asr',
        start: async (handler) => {
          asrHandler = handler;
        },
        stop: async () => {},
        dispose: async () => {},
      },
      audio: {
        init: async (opts) => {
          audioCalls.push(['init', opts]);
        },
        preload: async (voices) => {
          audioCalls.push(['preload', voices]);
        },
        play: (id) => {
          audioCalls.push(['play', id]);
        },
        stopAll: () => {
          audioCalls.push(['stopAll']);
        },
        teardown: async () => {
          audioCalls.push(['teardown']);
        },
      },
      permissions: {
        requestMicrophone: async () => 'granted',
      },
    });

    await controller.start({
      id: 'test-book',
      title: 'Test Book',
      tokens: ['boom'],
      triggers: [
        {
          id: 'boom-sound',
          phrase: 'boom',
          sound: 'test/sound.wav',
          wordIndex: 0,
          type: 'single-word',
        },
      ],
      sourceHash: 'hash',
      warnings: [],
    });
    asrHandler?.({ type: 'final', text: 'boom', timestamp: 1 });

    expect(controller.status).toBe('listening');
    expect(audioCalls).toEqual([
      ['init', { maxVoices: 4 }],
      ['preload', [{ id: 'boom-sound', module: 42 }]],
      ['play', 'boom-sound'],
    ]);
  });
});
