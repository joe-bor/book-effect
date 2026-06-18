import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import type { PcmLiveStreamOptions } from 'react-native-sherpa-onnx/audio';
import type { StreamingSttInitOptions } from 'react-native-sherpa-onnx/stt';

import type { AsrEngine, AsrEvent } from '../session/types';
import type { SherpaAsrEngineOptions, SherpaAsrRuntime } from './types';

const DEFAULT_MODEL_DIR = 'models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17';

type Unsubscribe = () => void;

export class SherpaAsrEngine implements AsrEngine {
  readonly name = 'sherpa-onnx';

  private readonly now: () => number;
  private readonly options: SherpaAsrEngineOptions;
  private runtime: SherpaAsrRuntime | undefined;
  private onEvent: ((event: AsrEvent) => void) | undefined;
  private engine: Awaited<ReturnType<SherpaAsrRuntime['createStreamingSTT']>> | undefined;
  private stream:
    | Awaited<
        ReturnType<Awaited<ReturnType<SherpaAsrRuntime['createStreamingSTT']>>['createStream']>
      >
    | undefined;
  private pcmStream: ReturnType<SherpaAsrRuntime['createPcmLiveStream']> | undefined;
  private unsubscribeData: Unsubscribe | undefined;
  private unsubscribeError: Unsubscribe | undefined;
  private processingQueue: Promise<void> = Promise.resolve();
  private isStarted = false;
  private speechActive = false;
  private lastPartialText = '';

  constructor(options: SherpaAsrEngineOptions = {}) {
    this.options = options;
    this.now = options.now ?? (() => performance.now());
  }

  async start(onEvent: (event: AsrEvent) => void): Promise<void> {
    if (this.isStarted) {
      throw new Error('SherpaAsrEngine is already started');
    }

    this.onEvent = onEvent;

    try {
      this.runtime = this.options.runtime ?? (await loadSherpaAsrRuntime());
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
      this.emitError(messageFrom(error));
      await this.stopPcmStream();
      await this.releaseResources();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isStarted && this.engine === undefined && this.pcmStream === undefined) {
      return;
    }

    this.removeSubscriptions();

    try {
      await this.stopPcmStream();
      await this.processingQueue;
    } finally {
      this.isStarted = false;
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
        this.emitError(messageFrom(error));
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
      modelPath: this.resolveModelPath(),
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

  private resolveModelPath(): ModelPathConfig {
    if (this.options.modelPath !== undefined) {
      return this.options.modelPath;
    }

    const documentDirectoryPath = this.runtime?.documentDirectoryPath;
    if (documentDirectoryPath !== undefined) {
      return {
        type: 'file',
        path: `${documentDirectoryPath}/${DEFAULT_MODEL_DIR}`,
      };
    }

    return {
      type: 'auto',
      path: DEFAULT_MODEL_DIR,
    };
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

async function loadSherpaAsrRuntime(): Promise<SherpaAsrRuntime> {
  const [{ createStreamingSTT }, { createPcmLiveStream }, fs] = await Promise.all([
    import('react-native-sherpa-onnx/stt'),
    import('react-native-sherpa-onnx/audio'),
    import('@dr.pogodin/react-native-fs'),
  ]);

  return {
    documentDirectoryPath: fs.DocumentDirectoryPath,
    createStreamingSTT,
    createPcmLiveStream,
  };
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
