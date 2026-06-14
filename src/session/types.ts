export type AsrEvent =
  | { type: 'partial' | 'final'; text: string; timestamp: number }
  | { type: 'vadStart' | 'vadEnd'; timestamp: number }
  | { type: 'error'; timestamp: number; message: string }
  | { type: 'interrupted'; timestamp: number; message: string }
  | { type: 'diag'; timestamp: number; stage: string; detail?: Record<string, unknown> };

export interface AsrEngine {
  readonly name: string;
  start(onEvent: (event: AsrEvent) => void): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
}

export interface AudioPlayer {
  init(opts?: { maxVoices?: number }): Promise<void>;
  preload(voices: { id: string; module: number }[]): Promise<void>;
  play(id: string): void;
  stopAll(): void;
  teardown(): Promise<void>;
}

export type PermissionService = {
  requestMicrophone(): Promise<'granted' | 'denied'>;
};

export type SessionStatus =
  | 'idle'
  | 'preloading'
  | 'listening'
  | 'recovering'
  | 'stopping'
  | 'error';

export type SessionError = {
  reason: 'permission' | 'asr' | 'interrupted' | 'unknown';
  message: string;
};
