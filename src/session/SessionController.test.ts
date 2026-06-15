import { describe, expect, it } from 'vitest';

import { normalizeWords } from '../core/normalize';
import { SessionTracker } from '../core/sessionTracker';
import type { CompiledBook } from '../content/types';
import { SessionController } from './SessionController';
import type { AsrEngine, AsrEvent, AudioPlayer, PermissionService } from './types';

type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
  reject(reason?: unknown): void;
};

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

const book: CompiledBook = {
  id: 'test',
  title: 'Test',
  tokens: normalizeWords('alpha bravo boom charlie massive gift'),
  sourceHash: 'hash',
  warnings: [],
  triggers: [
    {
      id: 'boom',
      phrase: 'boom',
      wordIndex: 2,
      type: 'single-word',
      sound: 'sounds/boom.wav',
    },
    {
      id: 'gift',
      phrase: 'massive gift',
      wordIndex: 4,
      type: 'phrase',
      sound: 'sounds/gift.wav',
    },
  ],
};

type FakeAsrOptions = {
  startRejects?: Error;
  stopRejects?: Error;
};

class FakeAsr implements AsrEngine {
  readonly name = 'fake-asr';
  handler: ((event: AsrEvent) => void) | undefined;
  starts = 0;
  stops = 0;

  constructor(
    private readonly order: string[] = [],
    private readonly options: FakeAsrOptions = {},
  ) {}

  async start(onEvent: (event: AsrEvent) => void): Promise<void> {
    this.order.push('asr.start');
    this.starts += 1;
    this.handler = onEvent;
    if (this.options.startRejects) {
      throw this.options.startRejects;
    }
  }

  async stop(): Promise<void> {
    this.order.push('asr.stop');
    this.stops += 1;
    if (this.options.stopRejects) {
      throw this.options.stopRejects;
    }
  }

  async dispose(): Promise<void> {}

  emit(event: AsrEvent): void {
    this.handler?.(event);
  }
}

type RecordingAudioOptions = {
  preloadRejects?: Error;
  preloadWait?: Promise<void>;
  teardownRejects?: Error;
  onPreload?: () => void;
};

class RecordingAudio implements AudioPlayer {
  inits: unknown[] = [];
  preloads: unknown[] = [];
  plays: string[] = [];
  stopped = 0;
  tornDown = 0;

  constructor(
    private readonly order: string[] = [],
    private readonly options: RecordingAudioOptions = {},
  ) {}

  async init(opts?: { maxVoices?: number }): Promise<void> {
    this.order.push('audio.init');
    this.inits.push(opts);
  }

  async preload(voices: { id: string; module: number }[]): Promise<void> {
    this.order.push('audio.preload');
    this.preloads.push(voices);
    this.options.onPreload?.();
    await this.options.preloadWait;
    if (this.options.preloadRejects) {
      throw this.options.preloadRejects;
    }
  }

  play(id: string): void {
    this.order.push(`audio.play:${id}`);
    this.plays.push(id);
  }

  stopAll(): void {
    this.order.push('audio.stopAll');
    this.stopped += 1;
  }

  async teardown(): Promise<void> {
    this.order.push('audio.teardown');
    this.tornDown += 1;
    if (this.options.teardownRejects) {
      throw this.options.teardownRejects;
    }
  }
}

const granted: PermissionService = { requestMicrophone: async () => 'granted' };

describe('SessionController', () => {
  it('preloads sounds before ASR starts and plays fired trigger ids in order', async () => {
    const order: string[] = [];
    const asr = new FakeAsr(order);
    const audio = new RecordingAudio(order);
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) =>
        new SessionTracker(tokens, triggers, { armLead: 2, advanceThreshold: 0.5 }),
    });

    await controller.start(book);
    asr.emit({ type: 'partial', text: 'alpha bravo boom', timestamp: 10 });
    asr.emit({ type: 'final', text: 'charlie massive gift', timestamp: 20 });

    expect(audio.preloads).toEqual([
      [
        { id: 'boom', module: 1 },
        { id: 'gift', module: 2 },
      ],
    ]);
    expect(order).toEqual([
      'audio.init',
      'audio.preload',
      'asr.start',
      'audio.play:boom',
      'audio.play:gift',
    ]);
    expect(asr.starts).toBe(1);
    expect(audio.plays).toEqual(['boom', 'gift']);
    expect(controller.status).toBe('listening');
  });

  it('maps engine freeze to recovering and hidden tap to forceReacquire', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    let recovered = 0;
    const tracker = new SessionTracker(book.tokens, book.triggers, { freezeAfter: 2 });
    const original = tracker.forceReacquire.bind(tracker);
    tracker.forceReacquire = () => {
      recovered += 1;
      original();
    };
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: () => tracker,
    });

    await controller.start(book);
    asr.emit({ type: 'partial', text: 'noise', timestamp: 10 });
    asr.emit({ type: 'final', text: 'more noise', timestamp: 11 });
    expect(controller.status).toBe('recovering');

    controller.recover();
    expect(recovered).toBe(1);
  });

  it('handles permission denial without preload or ASR start', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    const controller = new SessionController({
      asr,
      audio,
      permissions: { requestMicrophone: async () => 'denied' },
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);

    expect(controller.status).toBe('error');
    expect(controller.error).toEqual({
      reason: 'permission',
      message: 'Microphone permission is required to listen.',
    });
    expect(audio.preloads).toEqual([]);
    expect(asr.starts).toBe(0);
  });

  it('cleans initialized audio and preserves the preload error when preload fails', async () => {
    const order: string[] = [];
    const asr = new FakeAsr(order);
    const audio = new RecordingAudio(order, {
      preloadRejects: new Error('preload failed'),
      teardownRejects: new Error('teardown failed'),
    });
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);

    expect(order).toEqual(['audio.init', 'audio.preload', 'audio.stopAll', 'audio.teardown']);
    expect(controller.status).toBe('error');
    expect(controller.error).toEqual({ reason: 'unknown', message: 'preload failed' });
    expect(asr.starts).toBe(0);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
  });

  it('stops partially-started ASR and tears down audio when ASR start fails', async () => {
    const order: string[] = [];
    const asr = new FakeAsr(order, { startRejects: new Error('ASR start failed') });
    const audio = new RecordingAudio(order);
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);

    expect(order).toEqual([
      'audio.init',
      'audio.preload',
      'asr.start',
      'asr.stop',
      'audio.stopAll',
      'audio.teardown',
    ]);
    expect(controller.status).toBe('error');
    expect(controller.error).toEqual({ reason: 'unknown', message: 'ASR start failed' });
    expect(asr.starts).toBe(1);
    expect(asr.stops).toBe(1);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
  });

  it('maps ASR errors to controller error state', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    asr.emit({ type: 'error', message: 'ASR failed', timestamp: 30 });

    expect(controller.status).toBe('error');
    expect(controller.error).toEqual({ reason: 'asr', message: 'ASR failed' });
  });

  it('ignores duplicate starts while a session is active', async () => {
    const order: string[] = [];
    const asr = new FakeAsr(order);
    const audio = new RecordingAudio(order);
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    await controller.start(book);

    expect(order).toEqual(['audio.init', 'audio.preload', 'asr.start']);
    expect(audio.inits).toEqual([{ maxVoices: 4 }]);
    expect(audio.preloads).toHaveLength(1);
    expect(asr.starts).toBe(1);
    expect(controller.status).toBe('listening');
  });

  it('cancels an in-progress start when stopped during preload', async () => {
    const order: string[] = [];
    const preloadStarted = deferred<void>();
    const releasePreload = deferred<void>();
    const asr = new FakeAsr(order);
    const audio = new RecordingAudio(order, {
      preloadWait: releasePreload.promise,
      onPreload: () => preloadStarted.resolve(),
    });
    const statuses: string[] = [];
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });
    controller.subscribe((status) => {
      statuses.push(status);
    });

    const startPromise = controller.start(book);
    await preloadStarted.promise;
    const stopPromise = controller.stop();
    releasePreload.resolve();
    await Promise.all([startPromise, stopPromise]);

    expect(statuses).toEqual(['preloading', 'stopping', 'idle']);
    expect(order).toEqual(['audio.init', 'audio.preload', 'audio.stopAll', 'audio.teardown']);
    expect(asr.starts).toBe(0);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
    expect(controller.status).toBe('idle');
  });

  it('waits for an in-progress start cancellation while permission is pending', async () => {
    const permission = deferred<'granted' | 'denied'>();
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    const controller = new SessionController({
      asr,
      audio,
      permissions: { requestMicrophone: async () => permission.promise },
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    const startPromise = controller.start(book);
    const stopPromise = controller.stop();
    let stopSettled = false;
    void stopPromise.then(() => {
      stopSettled = true;
    });
    await Promise.resolve();

    expect(stopSettled).toBe(false);

    permission.resolve('granted');
    await Promise.all([startPromise, stopPromise]);

    expect(controller.status).toBe('idle');
    expect(audio.inits).toEqual([]);
    expect(asr.starts).toBe(0);
    expect(stopSettled).toBe(true);
  });

  it('notifies status subscribers until they unsubscribe', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    const statuses: string[] = [];
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    const unsubscribe = controller.subscribe((status) => {
      statuses.push(status);
    });

    await controller.start(book);
    unsubscribe();
    await controller.stop();

    expect(statuses).toEqual(['preloading', 'listening']);
  });

  it('maps interruption to an error and stops asynchronously', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio();
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    asr.emit({ type: 'interrupted', message: 'Audio session interrupted', timestamp: 40 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.error).toEqual({
      reason: 'interrupted',
      message: 'Audio session interrupted',
    });
    expect(asr.stops).toBe(1);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
    expect(controller.status).toBe('idle');
  });

  it('keeps interrupted error and returns idle when interruption cleanup rejects', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio([], {
      teardownRejects: new Error('teardown failed'),
    });
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    asr.emit({ type: 'interrupted', message: 'Audio session interrupted', timestamp: 40 });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(controller.error).toEqual({
      reason: 'interrupted',
      message: 'Audio session interrupted',
    });
    expect(asr.stops).toBe(1);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
    expect(controller.status).toBe('idle');
  });

  it('stops ASR, stops audio, tears down, and returns idle', async () => {
    const order: string[] = [];
    const asr = new FakeAsr(order);
    const audio = new RecordingAudio(order);
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    order.length = 0;
    controller.subscribe((status) => {
      order.push(`status:${status}`);
    });
    await controller.stop();

    expect(order).toEqual([
      'status:stopping',
      'asr.stop',
      'audio.stopAll',
      'audio.teardown',
      'status:idle',
    ]);
    expect(asr.stops).toBe(1);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
    expect(controller.status).toBe('idle');
  });

  it('returns idle when audio teardown rejects during stop', async () => {
    const asr = new FakeAsr();
    const audio = new RecordingAudio([], {
      teardownRejects: new Error('teardown failed'),
    });
    const controller = new SessionController({
      asr,
      audio,
      permissions: granted,
      assets: { 'sounds/boom.wav': 1, 'sounds/gift.wav': 2 },
      createTracker: (tokens, triggers) => new SessionTracker(tokens, triggers),
    });

    await controller.start(book);
    await controller.stop();

    expect(asr.stops).toBe(1);
    expect(audio.stopped).toBe(1);
    expect(audio.tornDown).toBe(1);
    expect(controller.status).toBe('idle');
  });
});
