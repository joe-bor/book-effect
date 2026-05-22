export type ASRProviderName = 'whisper-rn' | 'sherpa-onnx';

export type ASREvent =
  | { type: 'partial'; text: string; timestamp: number }
  | { type: 'final'; text: string; timestamp: number }
  | { type: 'vadStart'; timestamp: number; confidence?: number }
  | { type: 'vadEnd'; timestamp: number; confidence?: number }
  | { type: 'error'; timestamp: number; message: string };

export type ASREventHandler = (event: ASREvent) => void;

export type ASRProvider = {
  readonly name: ASRProviderName;
  start(onEvent: ASREventHandler): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
};
