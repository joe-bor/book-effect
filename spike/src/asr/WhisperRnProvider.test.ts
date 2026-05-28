import { describe, expect, it, vi } from 'vitest';
import type { ASREvent } from './ASRProvider';
import { WhisperRnProvider, type WhisperRnRuntime } from './WhisperRnProvider';

function createRuntime(): {
  runtime: WhisperRnRuntime;
  transcriber: {
    start: ReturnType<typeof vi.fn<() => Promise<void>>>;
    stop: ReturnType<typeof vi.fn<() => Promise<void>>>;
    release: ReturnType<typeof vi.fn<() => Promise<void>>>;
  };
  callbacks: Parameters<WhisperRnRuntime['createTranscriber']>[2] | undefined;
} {
  const transcriber = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    release: vi.fn(async () => {}),
  };

  let callbacks: Parameters<WhisperRnRuntime['createTranscriber']>[2] | undefined;

  const runtime: WhisperRnRuntime = {
    documentDirectoryPath: '/documents',
    exists: vi.fn(async () => true),
    initWhisper: vi.fn(async () => ({
      release: vi.fn(async () => {}),
      transcribeData: () => ({
        stop: vi.fn(async () => {}),
        promise: Promise.resolve({
          result: '',
          language: 'en',
          segments: [],
          isAborted: false,
        }),
      }),
    })),
    initWhisperVad: vi.fn(async () => ({
      release: vi.fn(async () => {}),
      detectSpeechData: vi.fn(async () => []),
    })),
    createRealtimeVad: vi.fn(() => ({
      processAudio: vi.fn(),
      onSpeechStart: vi.fn(),
      onSpeechContinue: vi.fn(),
      onSpeechEnd: vi.fn(),
      onError: vi.fn(),
      updateOptions: vi.fn(),
      flush: vi.fn(async () => {}),
      reset: vi.fn(async () => {}),
    })),
    createAudioStream: vi.fn(() => ({
      initialize: vi.fn(async () => {}),
      start: vi.fn(async () => {}),
      stop: vi.fn(async () => {}),
      isRecording: vi.fn(() => false),
      onData: vi.fn(),
      onError: vi.fn(),
      onStatusChange: vi.fn(),
      release: vi.fn(async () => {}),
    })),
    createTranscriber: vi.fn((_dependencies, _options, nextCallbacks) => {
      callbacks = nextCallbacks;
      return transcriber;
    }),
  };

  return {
    runtime,
    transcriber,
    get callbacks() {
      return callbacks;
    },
  };
}

type NonDiagAsrEvent = Exclude<ASREvent, { type: 'diag' }>;

function isNonDiag(event: { type: string }): event is NonDiagAsrEvent {
  return event.type !== 'diag';
}

describe('WhisperRnProvider', () => {
  it('starts realtime transcription and maps native callbacks to ASR events', async () => {
    const harness = createRuntime();
    const { runtime, transcriber } = harness;
    const events: { type: string }[] = [];
    const provider = new WhisperRnProvider({
      modelPath: '/models/ggml-tiny.en.bin',
      vadModelPath: '/models/ggml-silero-v6.2.0.bin',
      runtime,
      now: () => 42,
    });

    await provider.start((event) => events.push(event));

    expect(runtime.initWhisper).toHaveBeenCalledWith({
      filePath: '/models/ggml-tiny.en.bin',
    });
    expect(runtime.initWhisperVad).toHaveBeenCalledWith({
      filePath: '/models/ggml-silero-v6.2.0.bin',
      nThreads: 2,
    });
    expect(runtime.createTranscriber).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        audioSliceSec: 2,
        audioMinSec: 0.25,
        promptPreviousSlices: true,
        transcribeOptions: { language: 'en', maxThreads: 2 },
      }),
      expect.any(Object),
    );
    expect(transcriber.start).toHaveBeenCalledOnce();

    harness.callbacks?.onVad?.({
      type: 'speech_start',
      timestamp: 100,
      lastSpeechDetectedTime: 100,
      confidence: 0.7,
      duration: 10,
      sliceIndex: 0,
    });
    harness.callbacks?.onTranscribe?.({
      type: 'transcribe',
      sliceIndex: 0,
      data: {
        result: ' big truck ',
        language: 'en',
        segments: [],
        isAborted: false,
      },
      isCapturing: true,
      processTime: 20,
      recordingTime: 1000,
    });
    harness.callbacks?.onSliceTranscriptionStabilized?.('big truck');
    harness.callbacks?.onVad?.({
      type: 'speech_end',
      timestamp: 200,
      lastSpeechDetectedTime: 100,
      confidence: 0.3,
      duration: 12,
      sliceIndex: 0,
    });
    harness.callbacks?.onError?.('native failure');

    expect(events.filter(isNonDiag)).toEqual([
      { type: 'vadStart', timestamp: 100, confidence: 0.7 },
      { type: 'partial', text: 'big truck', timestamp: 42 },
      { type: 'final', text: 'big truck', timestamp: 42 },
      { type: 'vadEnd', timestamp: 200, confidence: 0.3 },
      { type: 'error', timestamp: 42, message: 'native failure' },
    ]);
  });

  it('emits an error when expected model files are missing', async () => {
    const { runtime } = createRuntime();
    vi.mocked(runtime.exists!).mockResolvedValue(false);
    const events: { type: string }[] = [];
    const provider = new WhisperRnProvider({
      modelPath: '/models/ggml-tiny.en.bin',
      vadModelPath: '/models/ggml-silero-v6.2.0.bin',
      runtime,
      now: () => 7,
    });

    await expect(provider.start((event) => events.push(event))).rejects.toThrow(
      'Missing Whisper model file',
    );

    expect(events.filter(isNonDiag)).toEqual([
      {
        type: 'error',
        timestamp: 7,
        message: 'Missing Whisper model file at /models/ggml-tiny.en.bin',
      },
    ]);
    expect(runtime.initWhisper).not.toHaveBeenCalled();
  });

  it('stops and releases native resources', async () => {
    const { runtime, transcriber } = createRuntime();
    const whisperContext = {
      release: vi.fn(async () => {}),
      transcribeData: vi.fn(),
    };
    const vadContext = {
      release: vi.fn(async () => {}),
      detectSpeechData: vi.fn(async () => []),
    };
    vi.mocked(runtime.initWhisper).mockResolvedValue(whisperContext);
    vi.mocked(runtime.initWhisperVad).mockResolvedValue(vadContext);
    const provider = new WhisperRnProvider({ runtime });

    await provider.start(() => {});
    await provider.dispose();

    expect(transcriber.stop).toHaveBeenCalledOnce();
    expect(transcriber.release).toHaveBeenCalledOnce();
    expect(vadContext.release).toHaveBeenCalledOnce();
    expect(whisperContext.release).toHaveBeenCalledOnce();
  });
});
