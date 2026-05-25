import { describe, expect, it, vi } from 'vitest';
import { SherpaOnnxProvider, type SherpaOnnxRuntime } from './SherpaOnnxProvider';

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function createRuntime(): {
  runtime: SherpaOnnxRuntime;
  pcm: {
    start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
    emitData: (samples: Float32Array, sampleRate: number) => void;
    emitError: (message: string) => void;
  };
  stream: {
    release: ReturnType<typeof vi.fn<() => Promise<void>>>;
    reset: ReturnType<typeof vi.fn<() => Promise<void>>>;
    processAudioChunk: ReturnType<
      typeof vi.fn<
        (
          samples: number[] | Float32Array,
          sampleRate: number,
        ) => Promise<{
          result: { text: string; tokens: string[]; timestamps: number[] };
          isEndpoint: boolean;
        }>
      >
    >;
  };
  engine: {
    destroy: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
} {
  let onData: ((samples: Float32Array, sampleRate: number) => void) | undefined;
  let onError: ((message: string) => void) | undefined;

  const stream = {
    streamId: 'stream_1',
    acceptWaveform: vi.fn(async () => {}),
    inputFinished: vi.fn(async () => {}),
    decode: vi.fn(async () => {}),
    isReady: vi.fn(async () => false),
    getResult: vi.fn(async () => ({ text: '', tokens: [], timestamps: [] })),
    isEndpoint: vi.fn(async () => false),
    release: vi.fn(async () => {}),
    reset: vi.fn(async () => {}),
    processAudioChunk: vi.fn(async () => ({
      result: { text: '', tokens: [], timestamps: [] },
      isEndpoint: false,
    })),
  };
  const engine = {
    instanceId: 'engine_1',
    createStream: vi.fn(async () => stream),
    destroy: vi.fn(async () => {}),
  };
  const pcm = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    onData: vi.fn((callback: (samples: Float32Array, sampleRate: number) => void) => {
      onData = callback;
      return vi.fn();
    }),
    onError: vi.fn((callback: (message: string) => void) => {
      onError = callback;
      return vi.fn();
    }),
    emitData(samples: Float32Array, sampleRate: number) {
      onData?.(samples, sampleRate);
    },
    emitError(message: string) {
      onError?.(message);
    },
  };

  return {
    runtime: {
      createStreamingSTT: vi.fn(async () => engine),
      createPcmLiveStream: vi.fn(() => pcm),
    },
    pcm,
    stream,
    engine,
  };
}

describe('SherpaOnnxProvider', () => {
  it('defaults to the app document directory Sherpa model path', async () => {
    const { runtime } = createRuntime();
    runtime.documentDirectoryPath = '/data/user/0/com.joebor.bookeffect.spike/files';
    const provider = new SherpaOnnxProvider({ runtime });

    await provider.start(() => {});

    expect(runtime.createStreamingSTT).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: {
          type: 'file',
          path: '/data/user/0/com.joebor.bookeffect.spike/files/models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17',
        },
      }),
    );

    await provider.dispose();
  });

  it('starts streaming recognition and maps PCM chunks to ASR events', async () => {
    const { runtime, pcm, stream } = createRuntime();
    const events: unknown[] = [];
    const provider = new SherpaOnnxProvider({
      modelPath: { type: 'file', path: '/models/zipformer' },
      modelType: 'transducer',
      runtime,
      now: () => 123,
    });

    stream.processAudioChunk
      .mockResolvedValueOnce({
        result: { text: ' big ', tokens: ['big'], timestamps: [0] },
        isEndpoint: false,
      })
      .mockResolvedValueOnce({
        result: { text: ' big truck ', tokens: ['big', 'truck'], timestamps: [0, 0.4] },
        isEndpoint: true,
      });

    await provider.start((event) => events.push(event));

    expect(runtime.createStreamingSTT).toHaveBeenCalledWith(
      expect.objectContaining({
        modelPath: { type: 'file', path: '/models/zipformer' },
        modelType: 'transducer',
        enableEndpoint: true,
        decodingMethod: 'greedy_search',
      }),
    );
    expect(runtime.createPcmLiveStream).toHaveBeenCalledWith({
      sampleRate: 16000,
      channelCount: 1,
      bufferSizeFrames: 0,
    });
    expect(pcm.start).toHaveBeenCalledOnce();

    pcm.emitData(new Float32Array([0.1, 0.2]), 16000);
    pcm.emitData(new Float32Array([0.3, 0.4]), 16000);
    await flushPromises();

    expect(events).toEqual([
      { type: 'vadStart', timestamp: 123 },
      { type: 'partial', text: 'big', timestamp: 123 },
      { type: 'partial', text: 'big truck', timestamp: 123 },
      { type: 'final', text: 'big truck', timestamp: 123 },
      { type: 'vadEnd', timestamp: 123 },
    ]);
    expect(stream.reset).toHaveBeenCalledOnce();
  });

  it('emits provider errors and releases resources on dispose', async () => {
    const { runtime, pcm, stream, engine } = createRuntime();
    const events: unknown[] = [];
    const provider = new SherpaOnnxProvider({
      modelPath: { type: 'file', path: '/models/zipformer' },
      runtime,
      now: () => 7,
    });

    await provider.start((event) => events.push(event));
    pcm.emitError('microphone unavailable');
    await provider.dispose();

    expect(events).toEqual([{ type: 'error', timestamp: 7, message: 'microphone unavailable' }]);
    expect(pcm.stop).toHaveBeenCalledOnce();
    expect(stream.release).toHaveBeenCalledOnce();
    expect(engine.destroy).toHaveBeenCalledOnce();
  });
});
