import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import type {
  EndpointConfig,
  OnlineSTTModelType,
  StreamingSttEngine,
  StreamingSttInitOptions,
  SttStream,
} from 'react-native-sherpa-onnx/stt';
import type { PcmLiveStreamHandle, PcmLiveStreamOptions } from 'react-native-sherpa-onnx/audio';
import type { ASREventHandler, ASRProvider } from './ASRProvider';

const DEFAULT_MODEL_PATH: ModelPathConfig = {
  type: 'auto',
  path: 'models/sherpa-onnx-streaming-zipformer-en',
};

type Unsubscribe = () => void;

export type SherpaOnnxRuntime = {
  createStreamingSTT(options: StreamingSttInitOptions): Promise<StreamingSttEngine>;
  createPcmLiveStream(options?: PcmLiveStreamOptions): PcmLiveStreamHandle;
};

export type SherpaOnnxProviderOptions = {
  modelPath?: ModelPathConfig;
  modelType?: OnlineSTTModelType | 'auto';
  runtime?: SherpaOnnxRuntime;
  now?: () => number;
  sampleRate?: number;
  channelCount?: number;
  bufferSizeFrames?: number;
  enableEndpoint?: boolean;
  endpointConfig?: EndpointConfig;
  decodingMethod?: 'greedy_search' | 'modified_beam_search';
  maxActivePaths?: number;
  hotwords?: string;
  numThreads?: number;
  provider?: string;
  ruleFsts?: string;
  ruleFars?: string;
  dither?: number;
  blankPenalty?: number;
  debug?: boolean;
  enableInputNormalization?: boolean;
};

export class SherpaOnnxProvider implements ASRProvider {
  readonly name = 'sherpa-onnx' as const;

  private readonly now: () => number;
  private readonly options: SherpaOnnxProviderOptions;
  private runtime: SherpaOnnxRuntime | undefined;
  private onEvent: ASREventHandler | undefined;
  private engine: StreamingSttEngine | undefined;
  private stream: SttStream | undefined;
  private pcmStream: PcmLiveStreamHandle | undefined;
  private unsubscribeData: Unsubscribe | undefined;
  private unsubscribeError: Unsubscribe | undefined;
  private processingQueue: Promise<void> = Promise.resolve();
  private isStarted = false;
  private speechActive = false;
  private lastPartialText = '';

  constructor(options: SherpaOnnxProviderOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  async start(onEvent: ASREventHandler): Promise<void> {
    if (this.isStarted) {
      throw new Error('SherpaOnnxProvider is already started');
    }

    this.onEvent = onEvent;

    try {
      this.runtime = this.options.runtime ?? (await loadSherpaOnnxRuntime());
      this.engine = await this.runtime.createStreamingSTT(this.buildStreamingOptions());
      this.stream = await this.engine.createStream(this.options.hotwords);
      this.pcmStream = this.runtime.createPcmLiveStream(this.buildPcmOptions());
      this.unsubscribeData = this.pcmStream.onData((samples, sampleRate) => {
        this.enqueueSamples(samples, sampleRate);
      });
      this.unsubscribeError = this.pcmStream.onError((message) => {
        this.emitError(message);
      });

      await this.pcmStream.start();
      this.isStarted = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitError(message);
      await this.stopPcmStream();
      await this.releaseResources();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted && this.engine === undefined && this.pcmStream === undefined) {
      return;
    }

    this.isStarted = false;
    this.removeSubscriptions();

    try {
      await this.stopPcmStream();
      await this.processingQueue;
    } finally {
      await this.releaseResources();
      this.speechActive = false;
      this.lastPartialText = '';
    }
  }

  async dispose(): Promise<void> {
    await this.stop();
    this.onEvent = undefined;
  }

  private enqueueSamples(samples: Float32Array, sampleRate: number): void {
    this.processingQueue = this.processingQueue
      .then(() => this.processSamples(samples, sampleRate))
      .catch((error) => {
        this.emitError(error instanceof Error ? error.message : String(error));
      });
  }

  private async processSamples(samples: Float32Array, sampleRate: number): Promise<void> {
    if (!this.isStarted || this.stream === undefined) {
      return;
    }

    const { result, isEndpoint } = await this.stream.processAudioChunk(samples, sampleRate);
    const text = result.text.trim();

    if (text.length > 0) {
      if (!this.speechActive) {
        this.speechActive = true;
        this.onEvent?.({ type: 'vadStart', timestamp: this.now() });
      }

      if (text !== this.lastPartialText) {
        this.lastPartialText = text;
        this.onEvent?.({ type: 'partial', text, timestamp: this.now() });
      }
    }

    if (!isEndpoint) {
      return;
    }

    if (text.length > 0) {
      this.onEvent?.({ type: 'final', text, timestamp: this.now() });
    }

    if (this.speechActive) {
      this.onEvent?.({ type: 'vadEnd', timestamp: this.now() });
    }

    this.speechActive = false;
    this.lastPartialText = '';
    await this.stream.reset();
  }

  private buildStreamingOptions(): StreamingSttInitOptions {
    const options: StreamingSttInitOptions = {
      modelPath: this.options.modelPath ?? DEFAULT_MODEL_PATH,
      modelType: this.options.modelType ?? 'auto',
      enableEndpoint: this.options.enableEndpoint ?? true,
      decodingMethod: this.options.decodingMethod ?? 'greedy_search',
      maxActivePaths: this.options.maxActivePaths ?? 4,
    };

    if (this.options.endpointConfig !== undefined) {
      options.endpointConfig = this.options.endpointConfig;
    }
    if (this.options.numThreads !== undefined) {
      options.numThreads = this.options.numThreads;
    }
    if (this.options.provider !== undefined) {
      options.provider = this.options.provider;
    }
    if (this.options.ruleFsts !== undefined) {
      options.ruleFsts = this.options.ruleFsts;
    }
    if (this.options.ruleFars !== undefined) {
      options.ruleFars = this.options.ruleFars;
    }
    if (this.options.dither !== undefined) {
      options.dither = this.options.dither;
    }
    if (this.options.blankPenalty !== undefined) {
      options.blankPenalty = this.options.blankPenalty;
    }
    if (this.options.debug !== undefined) {
      options.debug = this.options.debug;
    }
    if (this.options.enableInputNormalization !== undefined) {
      options.enableInputNormalization = this.options.enableInputNormalization;
    }

    return options;
  }

  private buildPcmOptions(): Required<PcmLiveStreamOptions> {
    return {
      sampleRate: this.options.sampleRate ?? 16000,
      channelCount: this.options.channelCount ?? 1,
      bufferSizeFrames: this.options.bufferSizeFrames ?? 0,
    };
  }

  private async stopPcmStream(): Promise<void> {
    if (this.pcmStream === undefined) {
      return;
    }

    await this.pcmStream.stop();
    this.pcmStream = undefined;
  }

  private async releaseResources(): Promise<void> {
    this.removeSubscriptions();

    const stream = this.stream;
    this.stream = undefined;
    if (stream !== undefined) {
      await stream.release();
    }

    const engine = this.engine;
    this.engine = undefined;
    if (engine !== undefined) {
      await engine.destroy();
    }

    this.runtime = undefined;
  }

  private removeSubscriptions(): void {
    this.unsubscribeData?.();
    this.unsubscribeError?.();
    this.unsubscribeData = undefined;
    this.unsubscribeError = undefined;
  }

  private emitError(message: string): void {
    this.onEvent?.({ type: 'error', timestamp: this.now(), message });
  }
}

async function loadSherpaOnnxRuntime(): Promise<SherpaOnnxRuntime> {
  const [{ createStreamingSTT }, { createPcmLiveStream }] = await Promise.all([
    import('react-native-sherpa-onnx/stt'),
    import('react-native-sherpa-onnx/audio'),
  ]);

  return { createStreamingSTT, createPcmLiveStream };
}
