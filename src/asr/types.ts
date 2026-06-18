import type { ModelPathConfig } from 'react-native-sherpa-onnx';
import type { PcmLiveStreamHandle, PcmLiveStreamOptions } from 'react-native-sherpa-onnx/audio';
import type {
  EndpointConfig,
  OnlineSTTModelType,
  StreamingSttEngine,
  StreamingSttInitOptions,
} from 'react-native-sherpa-onnx/stt';

export type SherpaAsrRuntime = {
  documentDirectoryPath?: string;
  createStreamingSTT(options: StreamingSttInitOptions): Promise<StreamingSttEngine>;
  createPcmLiveStream(options?: PcmLiveStreamOptions): PcmLiveStreamHandle;
};

export type SherpaAsrEngineOptions = {
  modelPath?: ModelPathConfig;
  modelType?: OnlineSTTModelType | 'auto';
  runtime?: SherpaAsrRuntime;
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
