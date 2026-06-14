import { describe, expect, it } from 'vitest';

import { normalizeWords } from '../core/normalize';
import { SessionTracker } from '../core/sessionTracker';
import type { CompiledBook } from '../content/types';
import { SessionController } from './SessionController';
import type { AsrEngine, AsrEvent, AudioPlayer, PermissionService } from './types';

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

class FakeAsr implements AsrEngine {
  readonly name = 'fake-asr';
  handler: ((event: AsrEvent) => void) | undefined;
  starts = 0;
  stops = 0;

  constructor(private readonly order: string[] = []) {}

  async start(onEvent: (event: AsrEvent) => void): Promise<void> {
    this.order.push('asr.start');
    this.starts += 1;
    this.handler = onEvent;
  }

  async stop(): Promise<void> {
    this.order.push('asr.stop');
    this.stops += 1;
  }

  async dispose(): Promise<void> {}

  emit(event: AsrEvent): void {
    this.handler?.(event);
  }
}

class RecordingAudio implements AudioPlayer {
  inits: unknown[] = [];
  preloads: unknown[] = [];
  plays: string[] = [];
  stopped = 0;
  tornDown = 0;

  constructor(private readonly order: string[] = []) {}

  async init(opts?: { maxVoices?: number }): Promise<void> {
    this.order.push('audio.init');
    this.inits.push(opts);
  }

  async preload(voices: { id: string; module: number }[]): Promise<void> {
    this.order.push('audio.preload');
    this.preloads.push(voices);
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
});
