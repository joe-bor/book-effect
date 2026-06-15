import { SessionTracker } from '../core/sessionTracker';
import type { Trigger } from '../core/types';
import type { CompiledBook } from '../content/types';
import type { DevLogger } from '../devlog/DevLogger';
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
  log?: DevLogger;
};

type StatusListener = (status: SessionStatus) => void;

export class SessionController {
  private readonly deps: SessionControllerDeps;
  private readonly listeners = new Set<StatusListener>();
  private currentStatus: SessionStatus = 'idle';
  private currentError: SessionError | undefined;
  private tracker: SessionTracker | undefined;
  private fireCursor = 0;
  private lifecycleToken = 0;
  private startPromise: Promise<void> | undefined;
  private audioInitialized = false;
  private asrStopNeeded = false;

  constructor(deps: SessionControllerDeps) {
    this.deps = deps;
  }

  get status(): SessionStatus {
    return this.currentStatus;
  }

  get error(): SessionError | undefined {
    return this.currentError;
  }

  start(book: CompiledBook): Promise<void> {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.audioInitialized || this.asrStopNeeded || !this.canStartFromStatus()) {
      return Promise.resolve();
    }

    const token = this.nextLifecycleToken();
    let startPromise: Promise<void>;
    startPromise = this.startSession(book, token).finally(() => {
      if (this.startPromise === startPromise) {
        this.startPromise = undefined;
      }
    });
    this.startPromise = startPromise;
    return startPromise;
  }

  private async startSession(book: CompiledBook, token: number): Promise<void> {
    this.currentError = undefined;
    let audioInitialized = false;
    let asrStopNeeded = false;

    try {
      this.deps.log?.record({ type: 'session.start', payload: { bookId: book.id } });
      const permission = await this.deps.permissions.requestMicrophone();
      if (!this.isCurrentLifecycle(token)) {
        return;
      }

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
      audioInitialized = true;
      this.audioInitialized = true;
      if (!this.isCurrentLifecycle(token)) {
        await this.cancelStartup(audioInitialized, asrStopNeeded);
        return;
      }

      await this.deps.audio.preload(this.preloadVoices(book));
      if (!this.isCurrentLifecycle(token)) {
        await this.cancelStartup(audioInitialized, asrStopNeeded);
        return;
      }

      asrStopNeeded = true;
      this.asrStopNeeded = true;
      await this.deps.asr.start((event) => {
        this.handleAsrEvent(event);
      });
      if (!this.isCurrentLifecycle(token)) {
        await this.cancelStartup(audioInitialized, asrStopNeeded);
        return;
      }

      this.setStatus('listening');
    } catch (error) {
      const sessionError = { reason: 'unknown' as const, message: messageFrom(error) };
      await this.cleanupResources({ stopAsr: asrStopNeeded, teardownAudio: audioInitialized });
      if (this.isCurrentLifecycle(token)) {
        this.setError(sessionError);
      } else {
        this.setStatus('idle');
      }
    }
  }

  recover(): void {
    if (!this.tracker || this.currentStatus === 'idle' || this.currentStatus === 'error') {
      return;
    }

    this.tracker.forceReacquire();
    this.setStatus('recovering');
  }

  async stop(reason: 'user' | 'interrupted' = 'user'): Promise<void> {
    const pendingStart = this.startPromise;
    if (pendingStart) {
      this.nextLifecycleToken();
      if (this.currentStatus === 'idle') {
        await pendingStart;
        return;
      }

      this.setStatus('stopping');
      await pendingStart;
      return;
    }

    if (this.currentStatus === 'idle') {
      return;
    }

    this.nextLifecycleToken();
    this.setStatus('stopping');
    this.deps.log?.record({ type: 'session.stop', payload: { reason } });
    await this.cleanupResources({
      stopAsr: this.asrStopNeeded,
      teardownAudio: this.audioInitialized,
    });
    this.setStatus('idle');
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private handleAsrEvent(event: AsrEvent): void {
    this.logAsrEvent(event);

    switch (event.type) {
      case 'error':
        this.setError({ reason: 'asr', message: event.message });
        return;
      case 'interrupted':
        this.setError({ reason: 'interrupted', message: event.message });
        void this.stop('interrupted').catch(() => {});
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

    const startedAt = this.deps.log === undefined ? 0 : performance.now();
    this.tracker.process({ kind: event.type, text: event.text });
    const durationMs = this.deps.log === undefined ? 0 : performance.now() - startedAt;
    this.deps.log?.record({
      type: 'engine.process',
      payload: {
        cursor: this.tracker.cursor,
        frozen: this.tracker.frozen,
        durationMs,
        fires: this.tracker.fires.length,
      },
    });
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
      this.deps.log?.record({ type: 'trigger.fire', triggerId: fire.triggerId });
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
    this.deps.log?.record({
      type: 'session.error',
      payload: { reason: error.reason, message: error.message },
    });
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

  private canStartFromStatus(): boolean {
    return this.currentStatus === 'idle' || this.currentStatus === 'error';
  }

  private nextLifecycleToken(): number {
    this.lifecycleToken += 1;
    return this.lifecycleToken;
  }

  private isCurrentLifecycle(token: number): boolean {
    return token === this.lifecycleToken;
  }

  private async cancelStartup(audioInitialized: boolean, asrStopNeeded: boolean): Promise<void> {
    await this.cleanupResources({ stopAsr: asrStopNeeded, teardownAudio: audioInitialized });
    this.setStatus('idle');
  }

  private async cleanupResources({
    stopAsr,
    teardownAudio,
  }: {
    stopAsr: boolean;
    teardownAudio: boolean;
  }): Promise<void> {
    if (stopAsr) {
      try {
        await this.deps.asr.stop();
      } catch {}
      this.asrStopNeeded = false;
    }

    if (teardownAudio) {
      try {
        this.deps.audio.stopAll();
      } catch {}

      try {
        await this.deps.audio.teardown();
      } catch {}
      this.audioInitialized = false;
    }

    this.tracker = undefined;
    this.fireCursor = 0;
  }

  private logAsrEvent(event: AsrEvent): void {
    switch (event.type) {
      case 'partial':
      case 'final':
        this.deps.log?.record({
          type: `asr.${event.type}`,
          payload: { text: event.text, timestamp: event.timestamp },
        });
        return;
      case 'error':
      case 'interrupted':
        this.deps.log?.record({
          type: `asr.${event.type}`,
          payload: { message: event.message, timestamp: event.timestamp },
        });
        return;
      case 'vadStart':
      case 'vadEnd':
        this.deps.log?.record({
          type: `asr.${event.type}`,
          payload: { timestamp: event.timestamp },
        });
        return;
      case 'diag':
        this.deps.log?.record({
          type: 'asr.diag',
          payload: { timestamp: event.timestamp, stage: event.stage, detail: event.detail },
        });
    }
  }
}

function messageFrom(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Session controller failed.';
}
