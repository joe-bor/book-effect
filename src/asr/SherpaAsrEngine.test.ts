import { describe, expect, it } from 'vitest';

import { SherpaAsrEngine } from './SherpaAsrEngine';
import type { SherpaAsrRuntime } from './types';

describe('SherpaAsrEngine', () => {
  it('emits changed partials and finals from streaming Sherpa results', async () => {
    const events: unknown[] = [];
    const stream = {
      calls: 0,
      async processAudioChunk() {
        this.calls += 1;
        return this.calls === 1
          ? { result: { text: 'boom' }, isEndpoint: false }
          : { result: { text: 'boom done' }, isEndpoint: true };
      },
      async reset() {},
      async release() {},
    };
    const pcm: {
      handler: undefined | ((samples: Float32Array, sampleRate: number) => void);
      errorHandler: undefined | ((message: string) => void);
      onData(handler: (samples: Float32Array, sampleRate: number) => void): () => void;
      onError(handler: (message: string) => void): () => void;
      start(): Promise<void>;
      stop(): Promise<void>;
    } = {
      handler: undefined,
      errorHandler: undefined,
      onData(handler) {
        this.handler = handler;
        return () => {};
      },
      onError(handler) {
        this.errorHandler = handler;
        return () => {};
      },
      async start() {},
      async stop() {},
    };
    const runtime = {
      documentDirectoryPath: '/docs',
      createStreamingSTT: async () => ({
        createStream: async () => stream,
        destroy: async () => {},
      }),
      createPcmLiveStream: () => pcm,
    } as unknown as SherpaAsrRuntime;
    const engine = new SherpaAsrEngine({ now: () => 10, runtime });

    await engine.start((event) => events.push(event));
    pcm.handler?.(new Float32Array([0]), 16000);
    pcm.handler?.(new Float32Array([0]), 16000);
    await engine.stop();

    expect(events).toContainEqual({ type: 'vadStart', timestamp: 10 });
    expect(events).toContainEqual({ type: 'partial', text: 'boom', timestamp: 10 });
    expect(events).toContainEqual({ type: 'final', text: 'boom done', timestamp: 10 });
    expect(events).toContainEqual({ type: 'vadEnd', timestamp: 10 });
  });
});
