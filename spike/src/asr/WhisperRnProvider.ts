import type { ContextOptions, TranscribeOptions, VadContextOptions, VadOptions } from 'whisper.rn';
import type {
  AudioStreamConfig,
  AudioStreamInterface,
  RealtimeOptions,
  RealtimeTranscribeEvent,
  RealtimeTranscriberCallbacks,
  RealtimeTranscriberDependencies,
  RealtimeVadContextLike,
  RealtimeVadEvent,
  WhisperContextLike,
  WhisperVadContextLike,
} from 'whisper.rn/realtime-transcription/types';
import type { WavFileWriterFs } from 'whisper.rn/realtime-transcription';
import type { ASREventHandler, ASRProvider } from './ASRProvider';

const DEFAULT_MODEL_FILE = 'ggml-tiny.en.bin';
const DEFAULT_VAD_MODEL_FILE = 'ggml-silero-v6.2.0.bin';
const DEFAULT_MODELS_DIR = 'models';

type VadPreset =
  | 'default'
  | 'sensitive'
  | 'very-sensitive'
  | 'conservative'
  | 'very-conservative'
  | 'continuous'
  | 'meeting'
  | 'noisy';

type RingBufferVadOptions = {
  vadOptions?: VadOptions;
  vadPreset?: VadPreset;
  preRecordingBufferMs?: number;
  sampleRate?: number;
  inferenceIntervalMs?: number;
  speechRateThreshold?: number;
  logger?: (message: string) => void;
};

type ReleasableWhisperContext = WhisperContextLike & {
  release(): Promise<void>;
};

type ReleasableWhisperVadContext = WhisperVadContextLike & {
  release(): Promise<void>;
};

type RealtimeTranscriberLike = {
  start(): Promise<void>;
  stop(): Promise<void>;
  release(): Promise<void>;
};

export type WhisperRnRuntime = {
  documentDirectoryPath?: string;
  exists?: (path: string) => Promise<boolean>;
  fs?: WavFileWriterFs;
  initWhisper(options: ContextOptions): Promise<ReleasableWhisperContext>;
  initWhisperVad(options: VadContextOptions): Promise<ReleasableWhisperVadContext>;
  createRealtimeVad(
    vadContext: ReleasableWhisperVadContext,
    options: RingBufferVadOptions,
  ): RealtimeVadContextLike;
  createAudioStream(): AudioStreamInterface;
  createTranscriber(
    dependencies: RealtimeTranscriberDependencies,
    options: RealtimeOptions,
    callbacks: RealtimeTranscriberCallbacks,
  ): RealtimeTranscriberLike;
};

export type WhisperRnProviderOptions = {
  modelPath?: string;
  vadModelPath?: string;
  runtime?: WhisperRnRuntime;
  now?: () => number;
  checkModelFiles?: boolean;
  language?: string;
  maxThreads?: number;
  vadThreads?: number;
  useGpu?: boolean;
  vadUseGpu?: boolean;
  useCoreMLIos?: boolean;
  useFlashAttn?: boolean;
  audioSliceSec?: number;
  audioMinSec?: number;
  maxSlicesInMemory?: number;
  realtimeProcessingPauseMs?: number;
  initRealtimeAfterMs?: number;
  promptPreviousSlices?: boolean;
  initialPrompt?: string;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  bufferSize?: number;
  audioSource?: number;
  vadPreset?: VadPreset;
  vadThreshold?: number;
  minSpeechDurationMs?: number;
  minSilenceDurationMs?: number;
  maxSpeechDurationS?: number;
  speechPadMs?: number;
  samplesOverlap?: number;
  preRecordingBufferMs?: number;
  vadInferenceIntervalMs?: number;
  speechRateThreshold?: number;
  logger?: (message: string) => void;
};

export class WhisperRnProvider implements ASRProvider {
  readonly name = 'whisper-rn' as const;

  private readonly now: () => number;
  private readonly options: WhisperRnProviderOptions;
  private runtime: WhisperRnRuntime | undefined;
  private onEvent: ASREventHandler | undefined;
  private transcriber: RealtimeTranscriberLike | undefined;
  private whisperContext: ReleasableWhisperContext | undefined;
  private whisperVadContext: ReleasableWhisperVadContext | undefined;
  private isStarted = false;
  private firstVadEventLogged = false;
  private firstPartialLogged = false;
  private firstFinalLogged = false;

  constructor(options: WhisperRnProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  async start(onEvent: ASREventHandler): Promise<void> {
    if (this.isStarted) {
      throw new Error('WhisperRnProvider is already started');
    }

    this.onEvent = onEvent;
    this.firstVadEventLogged = false;
    this.firstPartialLogged = false;
    this.firstFinalLogged = false;

    try {
      this.emitDiag('start.begin');
      this.runtime = this.options.runtime ?? (await loadWhisperRnRuntime());
      this.emitDiag('runtime.loaded', {
        documentDirectoryPath: this.runtime.documentDirectoryPath,
      });
      const modelPath = this.resolveModelPath(this.options.modelPath, DEFAULT_MODEL_FILE);
      const vadModelPath = this.resolveModelPath(this.options.vadModelPath, DEFAULT_VAD_MODEL_FILE);
      this.emitDiag('modelPaths.resolved', { modelPath, vadModelPath });

      await this.ensureModelFile(modelPath, 'Whisper model');
      await this.ensureModelFile(vadModelPath, 'Whisper VAD model');
      this.emitDiag('modelFiles.checked');

      this.whisperContext = await this.runtime.initWhisper(this.buildWhisperOptions(modelPath));
      this.emitDiag('whisperContext.created');
      const rawWhisperVadContext = await this.runtime.initWhisperVad(
        this.buildVadContextOptions(vadModelPath),
      );
      this.whisperVadContext = this.instrumentVadContext(rawWhisperVadContext);
      this.emitDiag('whisperVadContext.created');

      const realtimeVad = this.runtime.createRealtimeVad(
        this.whisperVadContext,
        this.buildRealtimeVadOptions(),
      );
      this.emitDiag('realtimeVad.created');
      const rawAudioStream = this.runtime.createAudioStream();
      const audioStream = this.instrumentAudioStream(rawAudioStream);
      this.emitDiag('audioStream.created');

      this.transcriber = this.runtime.createTranscriber(
        this.buildTranscriberDependencies(realtimeVad, audioStream),
        this.buildRealtimeOptions(),
        this.buildCallbacks(),
      );
      this.emitDiag('transcriber.created');

      this.emitDiag('transcriber.start.begin');
      await this.transcriber.start();
      this.emitDiag('transcriber.start.done');
      this.isStarted = true;
      this.emitDiag('start.done');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitError(message);
      this.emitDiag('start.error', { message });
      await this.releaseResources();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted || this.transcriber === undefined) {
      this.emitDiag('stop.skip', { isStarted: this.isStarted });
      return;
    }

    this.emitDiag('stop.begin');
    this.emitDiag('transcriber.stop.begin');
    await this.transcriber.stop();
    this.emitDiag('transcriber.stop.done');
    this.isStarted = false;
    this.emitDiag('stop.done');
  }

  async dispose(): Promise<void> {
    this.emitDiag('dispose.begin');
    await this.stop();
    await this.releaseResources();
    this.onEvent = undefined;
    // onEvent is gone, so no diag possible past here.
  }

  private buildCallbacks(): RealtimeTranscriberCallbacks {
    return {
      onVad: (event) => {
        if (!this.firstVadEventLogged) {
          this.firstVadEventLogged = true;
          this.emitDiag('realtime.firstVad', {
            kind: event.type,
            confidence: event.confidence,
          });
        }
        this.handleVadEvent(event);
      },
      onTranscribe: (event) => {
        this.handleTranscribeEvent(event);
      },
      onSliceTranscriptionStabilized: (text) => {
        if (!this.firstFinalLogged) {
          this.firstFinalLogged = true;
          this.emitDiag('realtime.firstFinal', { length: text.length });
        }
        this.emitTextEvent('final', text);
      },
      onError: (error) => {
        this.emitDiag('realtime.error', { message: error });
        this.emitError(error);
      },
    };
  }

  private handleVadEvent(event: RealtimeVadEvent): void {
    if (event.type === 'speech_start') {
      this.onEvent?.({
        type: 'vadStart',
        timestamp: event.timestamp,
        confidence: event.confidence,
      });
      return;
    }

    if (event.type === 'speech_end') {
      this.onEvent?.({
        type: 'vadEnd',
        timestamp: event.timestamp,
        confidence: event.confidence,
      });
    }
  }

  private handleTranscribeEvent(event: RealtimeTranscribeEvent): void {
    if (event.type !== 'transcribe') {
      this.emitDiag('realtime.transcribeEvent', {
        kind: event.type,
        sliceIndex: event.sliceIndex,
        isCapturing: event.isCapturing,
        processTimeMs: event.processTime,
        recordingTimeMs: event.recordingTime,
      });
      return;
    }

    const raw = event.data?.result ?? '';
    this.emitDiag('realtime.transcribe', {
      sliceIndex: event.sliceIndex,
      rawLength: raw.length,
      trimmedLength: raw.trim().length,
      raw,
      processTimeMs: event.processTime,
      recordingTimeMs: event.recordingTime,
      isCapturing: event.isCapturing,
    });

    if (!this.firstPartialLogged && raw.trim().length > 0) {
      this.firstPartialLogged = true;
      this.emitDiag('realtime.firstPartial', { length: raw.length });
    }

    this.emitTextEvent('partial', raw);
  }

  private emitTextEvent(type: 'partial' | 'final', text: string | undefined): void {
    const trimmed = text?.trim();

    if (!trimmed) {
      return;
    }

    this.onEvent?.({ type, text: trimmed, timestamp: this.now() });
  }

  private emitError(message: string): void {
    this.onEvent?.({ type: 'error', timestamp: this.now(), message });
  }

  private emitDiag(stage: string, detail?: Record<string, unknown>): void {
    this.onEvent?.({
      type: 'diag',
      timestamp: this.now(),
      stage,
      ...(detail !== undefined ? { detail } : {}),
    });
  }

  private instrumentVadContext(context: ReleasableWhisperVadContext): ReleasableWhisperVadContext {
    let inferenceCount = 0;
    let segmentInferenceCount = 0;
    return {
      detectSpeechData: (data, options) => {
        const callIndex = ++inferenceCount;
        const startedAt = this.now();
        return context.detectSpeechData(data, options).then(
          (segments) => {
            const elapsed = this.now() - startedAt;
            if (segments.length > 0) {
              segmentInferenceCount += 1;
              if (segmentInferenceCount === 1 || segmentInferenceCount % 10 === 0) {
                this.emitDiag('silero.segments', {
                  callIndex,
                  elapsedMs: elapsed,
                  segmentCount: segments.length,
                  segmentsTotal: segmentInferenceCount,
                  firstT0: segments[0]?.t0,
                  lastT1: segments[segments.length - 1]?.t1,
                });
              }
            } else if (callIndex === 1 || callIndex % 20 === 0) {
              this.emitDiag('silero.empty', {
                callIndex,
                elapsedMs: elapsed,
                segmentsTotal: segmentInferenceCount,
              });
            }
            return segments;
          },
          (error) => {
            this.emitDiag('silero.error', {
              callIndex,
              elapsedMs: this.now() - startedAt,
              message: errorMessage(error),
            });
            throw error;
          },
        );
      },
      release: () => context.release(),
    };
  }

  private instrumentAudioStream(audioStream: AudioStreamInterface): AudioStreamInterface {
    let frameCount = 0;
    const wrapper: AudioStreamInterface = {
      initialize: async (config) => {
        this.emitDiag('audioStream.initialize.begin', {
          sampleRate: config.sampleRate,
          channels: config.channels,
          bitsPerSample: config.bitsPerSample,
          bufferSize: config.bufferSize,
          audioSource: config.audioSource,
        });
        try {
          await audioStream.initialize(config);
          this.emitDiag('audioStream.initialize.done');
        } catch (error) {
          this.emitDiag('audioStream.initialize.error', { message: errorMessage(error) });
          throw error;
        }
      },
      start: async () => {
        this.emitDiag('audioStream.start.begin');
        try {
          await audioStream.start();
          this.emitDiag('audioStream.start.done');
        } catch (error) {
          this.emitDiag('audioStream.start.error', { message: errorMessage(error) });
          throw error;
        }
      },
      stop: async () => {
        this.emitDiag('audioStream.stop.begin', { framesReceived: frameCount });
        try {
          await audioStream.stop();
          this.emitDiag('audioStream.stop.done');
        } catch (error) {
          this.emitDiag('audioStream.stop.error', { message: errorMessage(error) });
          throw error;
        }
      },
      isRecording: () => audioStream.isRecording(),
      onData: (callback) => {
        audioStream.onData((data) => {
          frameCount += 1;
          if (frameCount === 1) {
            this.emitDiag('audioStream.firstFrame', {
              sampleRate: data.sampleRate,
              channels: data.channels,
              byteLength: data.data.byteLength,
            });
          } else if (frameCount === 50 || frameCount === 500) {
            this.emitDiag('audioStream.framesReceived', { count: frameCount });
          }
          callback(data);
        });
      },
      onError: (callback) => {
        audioStream.onError((message) => {
          this.emitDiag('audioStream.error', { message });
          callback(message);
        });
      },
      onStatusChange: (callback) => {
        audioStream.onStatusChange((isRecording) => {
          this.emitDiag('audioStream.statusChange', { isRecording });
          callback(isRecording);
        });
      },
      release: async () => {
        this.emitDiag('audioStream.release.begin', { framesReceived: frameCount });
        try {
          await audioStream.release();
          this.emitDiag('audioStream.release.done');
        } catch (error) {
          this.emitDiag('audioStream.release.error', { message: errorMessage(error) });
          throw error;
        }
      },
    };

    if (audioStream.onEnd !== undefined) {
      const upstreamOnEnd = audioStream.onEnd.bind(audioStream);
      wrapper.onEnd = (callback) => {
        upstreamOnEnd(() => {
          this.emitDiag('audioStream.end');
          callback();
        });
      };
    }

    return wrapper;
  }

  private resolveModelPath(configuredPath: string | undefined, fileName: string): string {
    if (configuredPath !== undefined) {
      return configuredPath;
    }

    const documentDirectoryPath = this.runtime?.documentDirectoryPath;

    if (documentDirectoryPath === undefined) {
      throw new Error(`No model path configured for ${fileName}`);
    }

    return `${documentDirectoryPath}/${DEFAULT_MODELS_DIR}/${fileName}`;
  }

  private async ensureModelFile(path: string, label: string): Promise<void> {
    if (this.options.checkModelFiles === false || this.runtime?.exists === undefined) {
      return;
    }

    const exists = await this.runtime.exists(stripFileScheme(path));

    if (!exists) {
      throw new Error(`Missing ${label} file at ${path}`);
    }
  }

  private buildWhisperOptions(modelPath: string): ContextOptions {
    const options: ContextOptions = { filePath: modelPath };

    if (this.options.useGpu !== undefined) {
      options.useGpu = this.options.useGpu;
    }

    if (this.options.useCoreMLIos !== undefined) {
      options.useCoreMLIos = this.options.useCoreMLIos;
    }

    if (this.options.useFlashAttn !== undefined) {
      options.useFlashAttn = this.options.useFlashAttn;
    }

    return options;
  }

  private buildVadContextOptions(vadModelPath: string): VadContextOptions {
    const options: VadContextOptions = {
      filePath: vadModelPath,
      nThreads: this.options.vadThreads ?? 2,
    };

    if (this.options.vadUseGpu !== undefined) {
      options.useGpu = this.options.vadUseGpu;
    }

    return options;
  }

  private buildRealtimeOptions(): RealtimeOptions {
    const options: RealtimeOptions = {
      audioSliceSec: this.options.audioSliceSec ?? 2,
      audioMinSec: this.options.audioMinSec ?? 0.25,
      maxSlicesInMemory: this.options.maxSlicesInMemory ?? 3,
      promptPreviousSlices: this.options.promptPreviousSlices ?? true,
      realtimeProcessingPauseMs: this.options.realtimeProcessingPauseMs ?? 250,
      initRealtimeAfterMs: this.options.initRealtimeAfterMs ?? 250,
      audioStreamConfig: this.buildAudioStreamConfig(),
      transcribeOptions: this.buildTranscribeOptions(),
    };

    if (this.options.initialPrompt !== undefined) {
      options.initialPrompt = this.options.initialPrompt;
    }

    const userLogger = this.options.logger;
    options.logger = (message) => {
      this.emitDiag('realtime.log', { message });
      userLogger?.(message);
    };

    return options;
  }

  private buildTranscribeOptions(): TranscribeOptions {
    return {
      language: this.options.language ?? 'en',
      maxThreads: this.options.maxThreads ?? 2,
    };
  }

  private buildAudioStreamConfig(): AudioStreamConfig {
    return {
      sampleRate: this.options.sampleRate ?? 16000,
      channels: this.options.channels ?? 1,
      bitsPerSample: this.options.bitsPerSample ?? 16,
      bufferSize: this.options.bufferSize ?? 16 * 1024,
      audioSource: this.options.audioSource ?? 6,
    };
  }

  private buildRealtimeVadOptions(): RingBufferVadOptions {
    const options: RingBufferVadOptions = {
      vadPreset: this.options.vadPreset ?? 'default',
      vadOptions: {
        threshold: this.options.vadThreshold ?? 0.5,
        minSpeechDurationMs: this.options.minSpeechDurationMs ?? 250,
        minSilenceDurationMs: this.options.minSilenceDurationMs ?? 500,
        maxSpeechDurationS: this.options.maxSpeechDurationS ?? 15,
        speechPadMs: this.options.speechPadMs ?? 30,
        samplesOverlap: this.options.samplesOverlap ?? 0.1,
      },
      preRecordingBufferMs: this.options.preRecordingBufferMs ?? 1000,
      sampleRate: this.options.sampleRate ?? 16000,
      inferenceIntervalMs: this.options.vadInferenceIntervalMs ?? 500,
      speechRateThreshold: this.options.speechRateThreshold ?? 0.3,
    };

    const userLogger = this.options.logger;
    options.logger = (message) => {
      this.emitDiag('vad.log', { message });
      userLogger?.(message);
    };

    return options;
  }

  private buildTranscriberDependencies(
    realtimeVad: RealtimeVadContextLike,
    audioStream: AudioStreamInterface,
  ): RealtimeTranscriberDependencies {
    if (this.whisperContext === undefined) {
      throw new Error('Whisper context was not initialized');
    }

    const dependencies: RealtimeTranscriberDependencies = {
      whisperContext: this.whisperContext,
      vadContext: realtimeVad,
      audioStream,
    };

    if (this.runtime?.fs !== undefined) {
      dependencies.fs = this.runtime.fs;
    }

    return dependencies;
  }

  private async releaseResources(): Promise<void> {
    const transcriber = this.transcriber;
    const vadContext = this.whisperVadContext;
    const whisperContext = this.whisperContext;

    this.transcriber = undefined;
    this.whisperVadContext = undefined;
    this.whisperContext = undefined;
    this.isStarted = false;

    if (transcriber !== undefined) {
      this.emitDiag('transcriber.release.begin');
      try {
        await transcriber.release();
        this.emitDiag('transcriber.release.done');
      } catch (error) {
        this.emitDiag('transcriber.release.error', { message: errorMessage(error) });
      }
    }
    if (vadContext !== undefined) {
      this.emitDiag('whisperVadContext.release.begin');
      try {
        await vadContext.release();
        this.emitDiag('whisperVadContext.release.done');
      } catch (error) {
        this.emitDiag('whisperVadContext.release.error', { message: errorMessage(error) });
      }
    }
    if (whisperContext !== undefined) {
      this.emitDiag('whisperContext.release.begin');
      try {
        await whisperContext.release();
        this.emitDiag('whisperContext.release.done');
      } catch (error) {
        this.emitDiag('whisperContext.release.error', { message: errorMessage(error) });
      }
    }
    this.emitDiag('releaseResources.done');
  }
}

async function loadWhisperRnRuntime(): Promise<WhisperRnRuntime> {
  const whisper = await import('whisper.rn');
  const realtime = await import('whisper.rn/realtime-transcription');
  const adapter = await import('whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter');
  const fs = await import('react-native-fs');

  return {
    documentDirectoryPath: fs.DocumentDirectoryPath,
    exists: fs.exists,
    fs,
    initWhisper: whisper.initWhisper,
    initWhisperVad: whisper.initWhisperVad,
    createRealtimeVad: (vadContext, options) => new realtime.RingBufferVad(vadContext, options),
    createAudioStream: () => new adapter.AudioPcmStreamAdapter(),
    createTranscriber: (dependencies, options, callbacks) =>
      new realtime.RealtimeTranscriber(dependencies, options, callbacks),
  };
}

function stripFileScheme(path: string): string {
  return path.replace(/^file:\/\//, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
