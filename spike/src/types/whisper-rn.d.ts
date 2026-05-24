declare module 'whisper.rn' {
  export type TranscribeOptions = {
    language?: string;
    translate?: boolean;
    maxThreads?: number;
    nProcessors?: number;
    maxContext?: number;
    maxLen?: number;
    tokenTimestamps?: boolean;
    tdrzEnable?: boolean;
    wordThold?: number;
    offset?: number;
    duration?: number;
    temperature?: number;
    temperatureInc?: number;
    beamSize?: number;
    bestOf?: number;
    prompt?: string;
  };

  export type TranscribeResult = {
    result: string;
    language: string;
    segments: Array<{ text: string; t0: number; t1: number }>;
    isAborted: boolean;
  };

  export type ContextOptions = {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    useCoreMLIos?: boolean;
    useFlashAttn?: boolean;
  };

  export type VadOptions = {
    threshold?: number;
    minSpeechDurationMs?: number;
    minSilenceDurationMs?: number;
    maxSpeechDurationS?: number;
    speechPadMs?: number;
    samplesOverlap?: number;
  };

  export type VadContextOptions = {
    filePath: string | number;
    isBundleAsset?: boolean;
    useGpu?: boolean;
    nThreads?: number;
  };

  export type WhisperContext = {
    transcribeData(
      data: string | ArrayBuffer,
      options?: TranscribeOptions,
    ): {
      stop(): Promise<void>;
      promise: Promise<TranscribeResult>;
    };
    release(): Promise<void>;
  };

  export type WhisperVadContext = {
    detectSpeechData(
      audioData: string | ArrayBuffer,
      options?: VadOptions,
    ): Promise<Array<{ t0: number; t1: number }>>;
    release(): Promise<void>;
  };

  export function initWhisper(options: ContextOptions): Promise<WhisperContext>;
  export function initWhisperVad(options: VadContextOptions): Promise<WhisperVadContext>;
}

declare module 'whisper.rn/realtime-transcription/types' {
  import type { TranscribeOptions, TranscribeResult, VadOptions } from 'whisper.rn';
  import type { WavFileWriterFs } from 'whisper.rn/realtime-transcription';

  export interface AudioStreamData {
    data: Uint8Array;
    sampleRate: number;
    channels: number;
    timestamp: number;
  }

  export interface AudioStreamConfig {
    sampleRate?: number;
    channels?: number;
    bitsPerSample?: number;
    bufferSize?: number;
    audioSource?: number;
  }

  export interface AudioStreamInterface {
    initialize(config: AudioStreamConfig): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isRecording(): boolean;
    onData(callback: (data: AudioStreamData) => void): void;
    onError(callback: (error: string) => void): void;
    onStatusChange(callback: (isRecording: boolean) => void): void;
    onEnd?(callback: () => void): void;
    release(): Promise<void>;
  }

  export interface RealtimeVadEvent {
    type: 'speech_start' | 'speech_end' | 'speech_continue' | 'silence';
    timestamp: number;
    lastSpeechDetectedTime: number;
    confidence: number;
    duration: number;
    sliceIndex: number;
  }

  export interface RealtimeTranscribeEvent {
    type: 'start' | 'transcribe' | 'end' | 'error';
    sliceIndex: number;
    data?: TranscribeResult;
    isCapturing: boolean;
    processTime: number;
    recordingTime: number;
  }

  export interface RealtimeOptions {
    audioSliceSec?: number;
    audioMinSec?: number;
    maxSlicesInMemory?: number;
    transcribeOptions?: TranscribeOptions;
    initialPrompt?: string;
    promptPreviousSlices?: boolean;
    audioOutputPath?: string;
    audioStreamConfig?: AudioStreamConfig;
    logger?: (message: string) => void;
    realtimeProcessingPauseMs?: number;
    initRealtimeAfterMs?: number;
  }

  export interface RealtimeTranscriberCallbacks {
    onTranscribe?: (event: RealtimeTranscribeEvent) => void;
    onVad?: (event: RealtimeVadEvent) => void;
    onError?: (error: string) => void;
    onStatusChange?: (isActive: boolean) => void;
    onSliceTranscriptionStabilized?: (text: string) => void;
  }

  export type WhisperContextLike = {
    transcribeData: (
      data: ArrayBuffer,
      options: TranscribeOptions,
    ) => {
      stop: () => Promise<void>;
      promise: Promise<TranscribeResult>;
    };
  };

  export type WhisperVadContextLike = {
    detectSpeechData: (
      data: ArrayBuffer,
      options: VadOptions,
    ) => Promise<Array<{ t0: number; t1: number }>>;
  };

  export interface RealtimeVadContextLike {
    processAudio(data: Uint8Array): void;
    onSpeechStart(callback: (confidence: number, data: Uint8Array) => void): void;
    onSpeechContinue(callback: (confidence: number, data: Uint8Array) => void): void;
    onSpeechEnd(callback: (confidence: number) => void): void;
    onError(callback: (error: string) => void): void;
    updateOptions(options: Partial<VadOptions>): void;
    flush(): Promise<void>;
    reset(): Promise<void>;
  }

  export interface RealtimeTranscriberDependencies {
    whisperContext: WhisperContextLike;
    vadContext?: RealtimeVadContextLike;
    audioStream: AudioStreamInterface;
    fs?: WavFileWriterFs;
  }
}

declare module 'whisper.rn/realtime-transcription' {
  import type { VadOptions } from 'whisper.rn';
  import type {
    AudioStreamInterface,
    RealtimeOptions,
    RealtimeTranscriberCallbacks,
    RealtimeTranscriberDependencies,
    RealtimeVadContextLike,
    WhisperVadContextLike,
  } from 'whisper.rn/realtime-transcription/types';

  export type WavFileWriterFs = {
    writeFile(filePath: string, data: string, encoding: string): Promise<void>;
    appendFile(filePath: string, data: string, encoding: string): Promise<void>;
    readFile(filePath: string, encoding: string): Promise<string>;
    exists(filePath: string): Promise<boolean>;
    unlink(filePath: string): Promise<void>;
  };

  export class RealtimeTranscriber {
    constructor(
      dependencies: RealtimeTranscriberDependencies,
      options?: RealtimeOptions,
      callbacks?: RealtimeTranscriberCallbacks,
    );
    start(): Promise<void>;
    stop(): Promise<void>;
    release(): Promise<void>;
  }

  export class RingBufferVad implements RealtimeVadContextLike {
    constructor(
      vadContext: WhisperVadContextLike,
      options?: {
        vadOptions?: VadOptions;
        vadPreset?: string;
        preRecordingBufferMs?: number;
        sampleRate?: number;
        inferenceIntervalMs?: number;
        speechRateThreshold?: number;
        logger?: (message: string) => void;
      },
    );
    processAudio(data: Uint8Array): void;
    onSpeechStart(callback: (confidence: number, data: Uint8Array) => void): void;
    onSpeechContinue(callback: (confidence: number, data: Uint8Array) => void): void;
    onSpeechEnd(callback: (confidence: number) => void): void;
    onError(callback: (error: string) => void): void;
    updateOptions(options: Partial<VadOptions>): void;
    flush(): Promise<void>;
    reset(): Promise<void>;
  }

  export type { AudioStreamInterface };
}

declare module 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter' {
  import type {
    AudioStreamConfig,
    AudioStreamData,
    AudioStreamInterface,
  } from 'whisper.rn/realtime-transcription/types';

  export class AudioPcmStreamAdapter implements AudioStreamInterface {
    initialize(config: AudioStreamConfig): Promise<void>;
    start(): Promise<void>;
    stop(): Promise<void>;
    isRecording(): boolean;
    onData(callback: (data: AudioStreamData) => void): void;
    onError(callback: (error: string) => void): void;
    onStatusChange(callback: (isRecording: boolean) => void): void;
    release(): Promise<void>;
  }
}
