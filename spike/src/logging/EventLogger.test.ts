import { describe, expect, it } from 'vitest';
import { EventLogger } from './EventLogger';

describe('EventLogger', () => {
  it('keeps the newest events when capacity is exceeded', () => {
    const logger = new EventLogger(2);

    logger.record({ type: 'first', timestamp: 1 });
    logger.record({ type: 'second', timestamp: 2 });
    logger.record({ type: 'third', timestamp: 3 });

    expect(logger.snapshot().map((event) => event.type)).toEqual(['second', 'third']);
  });

  it('exports JSON with provider metadata', () => {
    const logger = new EventLogger(10);

    logger.record({
      type: 'asr.partial',
      timestamp: 12,
      providers: { asr: 'whisper-rn', audio: 'expo-audio' },
      payload: { text: 'boom' },
    });

    const parsed = JSON.parse(logger.toJson()) as Array<{ wallClock?: string }>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: 'asr.partial',
      timestamp: 12,
      providers: { asr: 'whisper-rn', audio: 'expo-audio' },
      payload: { text: 'boom' },
    });
    expect(typeof parsed[0]?.wallClock).toBe('string');
  });
});
