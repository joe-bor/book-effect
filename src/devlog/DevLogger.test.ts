import { describe, expect, it } from 'vitest';

import { DevLogger } from './DevLogger';

describe('DevLogger', () => {
  it('records ASR, engine, fire, and lifecycle events with a large long-run capacity', () => {
    const logger = new DevLogger({ enabled: true, capacity: 10_000, now: () => 123 });

    logger.record({ type: 'asr.partial', payload: { text: 'boom' } });
    logger.record({
      type: 'engine.process',
      payload: { cursor: 4, frozen: false, durationMs: 1.5 },
    });
    logger.record({ type: 'trigger.fire', triggerId: 'boom' });
    logger.record({ type: 'session.stop', payload: { reason: 'user' } });

    expect(logger.snapshot()).toMatchObject([
      { type: 'asr.partial', timestamp: 123 },
      { type: 'engine.process', payload: { cursor: 4, frozen: false, durationMs: 1.5 } },
      { type: 'trigger.fire', triggerId: 'boom' },
      { type: 'session.stop', payload: { reason: 'user' } },
    ]);
  });

  it('is a no-op when disabled', () => {
    const logger = new DevLogger({ enabled: false, capacity: 10_000 });

    logger.record({ type: 'asr.partial' });

    expect(logger.snapshot()).toEqual([]);
  });

  it('keeps only the newest entries within capacity and snapshots defensively', () => {
    const logger = new DevLogger({ enabled: true, capacity: 2, now: () => 10 });

    logger.record({ type: 'first', payload: { nested: 'a' } });
    logger.record({ type: 'second', payload: { nested: 'b' } });
    logger.record({ type: 'third', payload: { nested: 'c' } });

    const snapshot = logger.snapshot();
    expect(snapshot.map((event) => event.type)).toEqual(['second', 'third']);
    snapshot[0]!.payload!.nested = 'mutated';
    expect(logger.snapshot()[0]!.payload).toEqual({ nested: 'b' });
  });
});
