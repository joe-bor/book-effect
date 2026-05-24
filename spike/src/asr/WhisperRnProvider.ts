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

  constructor(options: WhisperRnProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  async start(onEvent: ASREventHandler): Promise<void> {
    if (this.isStarted) {
      throw new Error('WhisperRnProvider is already started');
    }

    this.onEvent = onEvent;

    try {
      this.runtime = this.options.runtime ?? (await loadWhisperRnRuntime());
      const modelPath = this.resolveModelPath(this.options.modelPath, DEFAULT_MODEL_FILE);
      const vadModelPath = this.resolveModelPath(this.options.vadModelPath, DEFAULT_VAD_MODEL_FILE);

      await this.ensureModelFile(modelPath, 'Whisper model');
      await this.ensureModelFile(vadModelPath, 'Whisper VAD model');

      this.whisperContext = await this.runtime.initWhisper(this.buildWhisperOptions(modelPath));
      this.whisperVadContext = await this.runtime.initWhisperVad(
        this.buildVadContextOptions(vadModelPath),
      );

      const realtimeVad = this.runtime.createRealtimeVad(
        this.whisperVadContext,
        this.buildRealtimeVadOptions(),
      );
      const audioStream = this.runtime.createAudioStream();

      this.transcriber = this.runtime.createTranscriber(
        this.buildTranscriberDependencies(realtimeVad, audioStream),
        this.buildRealtimeOptions(),
        this.buildCallbacks(),
      );

      await this.transcriber.start();
      this.isStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitError(message);
      await this.releaseResources();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted || this.transcriber === undefined) {
      return;
    }

    await this.transcriber.stop();
    this.isStarted = false;
  }

  async dispose(): Promise<void> {
    await this.stop();
    await this.releaseResources();
    this.onEvent = undefined;
  }

  private buildCallbacks(): RealtimeTranscriberCallbacks {
    return {
      onVad: (event) => {
        this.handleVadEvent(event);
      },
      onTranscribe: (event) => {
        this.handleTranscribeEvent(event);
      },
      onSliceTranscriptionStabilized: (text) => {
        this.emitTextEvent('final', text);
      },
      onError: (error) => {
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
      return;
    }

    this.emitTextEvent('partial', event.data?.result);
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

    if (this.options.logger !== undefined) {
      options.logger = this.options.logger;
    }

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

    if (this.options.logger !== undefined) {
      options.logger = this.options.logger;
    }

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

    await transcriber?.release();
    await vadContext?.release();
    await whisperContext?.release();
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
