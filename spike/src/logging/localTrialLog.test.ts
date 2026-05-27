import { describe, expect, it } from 'vitest';
import type { SpikeEvent } from './EventLogger';
import { buildTrialLogFilename, saveTrialLogSnapshot } from './localTrialLog';

const events: SpikeEvent[] = [
  {
    type: 'session.start',
    timestamp: 12,
    wallClock: '2026-05-27T12:00:00.000Z',
    providers: { asr: 'sherpa-onnx', audio: 'expo-audio' },
  },
];

describe('buildTrialLogFilename', () => {
  it('creates a predictable JSON filename from a timestamp', () => {
    expect(buildTrialLogFilename(1779901234567)).toBe('book-effect-spike-log-1779901234567.json');
  });
});

describe('saveTrialLogSnapshot', () => {
  it('writes the event snapshot to the provided cache file', async () => {
    const writes: string[] = [];
    const creates: Array<{ intermediates?: boolean; overwrite?: boolean }> = [];

    const result = await saveTrialLogSnapshot({
      events,
      now: () => 1779901234567,
      createFile(filename) {
        return {
          uri: `file:///data/user/0/com.joebor.bookeffect.spike/cache/${filename}`,
          create(options) {
            creates.push(options);
          },
          write(content) {
            writes.push(content);
          },
        };
      },
    });

    expect(result).toEqual({
      eventCount: 1,
      filename: 'book-effect-spike-log-1779901234567.json',
      pullPath: 'cache/book-effect-spike-log-1779901234567.json',
      uri: 'file:///data/user/0/com.joebor.bookeffect.spike/cache/book-effect-spike-log-1779901234567.json',
    });
    expect(creates).toEqual([{ intermediates: true, overwrite: true }]);
    expect(JSON.parse(writes[0] ?? '')).toEqual(events);
  });
});
