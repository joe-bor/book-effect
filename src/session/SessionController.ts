import { SessionTracker } from '../core/sessionTracker';
import type { Trigger } from '../core/types';
import type { CompiledBook } from '../content/types';
import type {
  AsrEngine,
  AsrEvent,
  AudioPlayer,
  PermissionService,
  SessionError,
  SessionStatus,
} from './types';

type SessionControllerDeps = {
  asr: AsrEngine;
  audio: AudioPlayer;
  permissions: PermissionService;
  assets: Record<string, number>;
  createTracker: (tokens: readonly string[], triggers: readonly Trigger[]) => SessionTracker;
  now?: () => number;
};

type StatusListener = (status: SessionStatus) => void;

export class SessionController {
  private readonly deps: SessionControllerDeps;
  private readonly listeners = new Set<StatusListener>();
  private currentStatus: SessionStatus = 'idle';
  private currentError: SessionError | undefined;
  private tracker: SessionTracker | undefined;
  private fireCursor = 0;

  constructor(deps: SessionControllerDeps) {
    this.deps = deps;
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  get error(): SessionError | undefined {
    return this.currentError;
  }

  async start(book: CompiledBook): Promise<void> {
    this.currentError = undefined;

    try {
      const permission = await this.deps.permissions.requestMicrophone();
      if (permission === 'denied') {
        this.setError({
          reason: 'permission',
          message: 'Microphone permission is required to listen.',
        });
        return;
      }

      this.setStatus('preloading');
      this.tracker = this.deps.createTracker(book.tokens, book.triggers);
      this.fireCursor = 0;

      await this.deps.audio.init({ maxVoices: 4 });
      await this.deps.audio.preload(this.preloadVoices(book));
      await this.deps.asr.start((event) => {
        this.handleAsrEvent(event);
      });
      this.setStatus('listening');
    } catch (error) {
      this.tracker = undefined;
      this.fireCursor = 0;
      this.setError({ reason: 'unknown', message: messageFrom(error) });
    }
  }

  recover(): void {
    if (!this.tracker || this.currentStatus === 'idle' || this.currentStatus === 'error') {
      return;
    }

    this.tracker.forceReacquire();
    this.setStatus('recovering');
  }

  async stop(): Promise<void> {
    if (this.currentStatus === 'idle') {
      return;
    }

    this.setStatus('stopping');
    try {
      await this.deps.asr.stop();
    } finally {
      this.deps.audio.stopAll();
      await this.deps.audio.teardown();
      this.tracker = undefined;
      this.fireCursor = 0;
      this.setStatus('idle');
    }
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleAsrEvent(event: AsrEvent): void {
    switch (event.type) {
      case 'error':
        this.setError({ reason: 'asr', message: event.message });
        return;
      case 'interrupted':
        this.setError({ reason: 'interrupted', message: event.message });
        void this.stop();
        return;
      case 'vadStart':
      case 'vadEnd':
      case 'diag':
        return;
      case 'partial':
      case 'final':
        this.handleTranscriptEvent(event);
    }
  }

  private handleTranscriptEvent(event: Extract<AsrEvent, { type: 'partial' | 'final' }>): void {
    if (
      !this.tracker ||
      this.currentStatus === 'idle' ||
      this.currentStatus === 'stopping' ||
      this.currentStatus === 'error'
    ) {
      return;
    }

    this.tracker.process({ kind: event.type, text: event.text });
    this.playNewFires();
    this.setStatus(this.tracker.frozen ? 'recovering' : 'listening');
  }

  private playNewFires(): void {
    if (!this.tracker) {
      return;
    }

    const fires = this.tracker.fires.slice(this.fireCursor);
    this.fireCursor = this.tracker.fires.length;
    for (const fire of fires) {
      this.deps.audio.play(fire.triggerId);
    }
  }

  private preloadVoices(book: CompiledBook): { id: string; module: number }[] {
    return book.triggers.map((trigger) => {
      const audioModule = this.deps.assets[trigger.sound];
      if (audioModule === undefined) {
        throw new Error(`Missing audio asset for ${trigger.sound}`);
      }

      return { id: trigger.id, module: audioModule };
    });
  }

  private setError(error: SessionError): void {
    this.currentError = error;
    this.setStatus('error');
  }

  private setStatus(status: SessionStatus): void {
    if (this.currentStatus === status) {
      return;
    }

    this.currentStatus = status;
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Session controller failed.';
}
