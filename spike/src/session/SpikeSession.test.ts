import { describe, expect, it } from 'vitest';
import type { ASRProvider } from '../asr/ASRProvider';
import type { AudioProvider } from '../audio/AudioProvider';
import type { SpikeBook } from '../books/types';
import { SpikeSession } from './SpikeSession';

const book: SpikeBook = {
  id: 'test',
  title: 'Test',
  author: 'Tester',
  text: 'the truck went boom in the snow',
  triggers: [{ id: 'boom', phrase: 'went boom', wordIndex: 2, sound: 'boom.wav', type: 'phrase' }],
};

describe('SpikeSession', () => {
  it('fires a trigger once when recent ASR text contains the phrase', async () => {
    const played: string[] = [];
    let onEvent: Parameters<ASRProvider['start']>[0] | undefined;

    const asr: ASRProvider = {
      name: 'whisper-rn',
      async start(handler) {
        onEvent = handler;
      },
      async stop() {},
      async dispose() {},
    };

    const audio: AudioProvider = {
      name: 'expo-audio',
      async preload() {},
      async play(id) {
        played.push(id);
      },
      async stop() {},
      async dispose() {},
    };

    const session = new SpikeSession({ asr, audio, book, now: () => 100 });
    await session.start();

    onEvent?.({ type: 'partial', text: 'the truck went boom', timestamp: 100 });
    onEvent?.({ type: 'partial', text: 'the truck went boom', timestamp: 120 });

    expect(played).toEqual(['boom']);
    await session.stop();
  });
});
