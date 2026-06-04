import { describe, expect, it } from 'vitest';

import type { BookTrigger } from '../books/types';
import type { AudioProvider } from './AudioProvider';
import { runLatencyProbe, type ProbeRecorder } from './latencyProbe';

const clickTrigger: BookTrigger = {
  id: 'latency-click',
  phrase: 'click',
  wordIndex: 0,
  sound: 'latency-click.wav',
  type: 'single-word',
};

function makeProvider(name: string, calls: string[]): AudioProvider {
  return {
    name: name as AudioProvider['name'],
    async preload() {
      calls.push(`${name}:preload`);
    },
    async play(id: string) {
      calls.push(`${name}:play:${id}`);
    },
    async stop() {},
    async dispose() {},
  };
}

function makeRecorder(calls: string[]): ProbeRecorder {
  let duration = 0;
  let recording = false;
  return {
    async prepareToRecordAsync() {
      calls.push('prepare');
    },
    record() {
      calls.push('record');
      recording = true;
    },
    async stop() {
      calls.push('stop');
      recording = false;
    },
    getStatus() {
      // Advance the recording clock on every poll so durationMillis grows.
      duration += 5;
      return { isRecording: recording, durationMillis: duration, url: 'file:///rec.m4a' };
    },
    get uri() {
      return 'file:///rec.m4a';
    },
  };
}

function fakeClock(): () => number {
  let t = 1000;
  return () => {
    t += 1;
    return t;
  };
}

describe('runLatencyProbe', () => {
  it('preloads all providers, records once, fires warmups + reps per library, then stops', async () => {
    const calls: string[] = [];
    const recorder = makeRecorder(calls);
    const providers = [
      { lib: 'expo-audio', provider: makeProvider('expo-audio', calls) },
      { lib: 'react-native-sound', provider: makeProvider('react-native-sound', calls) },
    ];

    const log = await runLatencyProbe({
      recorder,
      providers,
      clickTrigger,
      reps: 3,
      warmups: 1,
      gapMs: 0,
      blockGapMs: 0,
      now: fakeClock(),
      sleep: async () => {},
    });

    // Both providers preloaded before recording starts.
    expect(calls.indexOf('expo-audio:preload')).toBeLessThan(calls.indexOf('record'));
    expect(calls.indexOf('react-native-sound:preload')).toBeLessThan(calls.indexOf('record'));

    // Recorder lifecycle: prepare -> record -> stop, exactly once each, in order.
    expect(calls.filter((c) => c === 'record')).toHaveLength(1);
    expect(calls.filter((c) => c === 'prepare')).toHaveLength(1);
    expect(calls.filter((c) => c === 'stop')).toHaveLength(1);
    expect(calls.indexOf('prepare')).toBeLessThan(calls.indexOf('record'));
    expect(calls.indexOf('record')).toBeLessThan(calls.indexOf('stop'));

    // (warmups + reps) fires per library.
    const expoFires = log.fires.filter((f) => f.lib === 'expo-audio');
    const rnsFires = log.fires.filter((f) => f.lib === 'react-native-sound');
    expect(expoFires).toHaveLength(4);
    expect(rnsFires).toHaveLength(4);

    // Exactly `reps` measured (non-warmup) fires per library, indexed 0..reps-1.
    const expoMeasured = expoFires.filter((f) => !f.warmup);
    expect(expoMeasured.map((f) => f.index)).toEqual([0, 1, 2]);
    expect(expoFires.filter((f) => f.warmup)).toHaveLength(1);

    // Command timestamps are monotonic and precede their post-play timestamp.
    for (const fire of log.fires) {
      expect(fire.tAfterPlayPerf).toBeGreaterThan(fire.tCmdPerf);
    }

    // Clock samples captured for the recording->perf fit.
    expect(log.clockSamples.length).toBeGreaterThan(0);
    expect(log.recordingUri).toBe('file:///rec.m4a');
  });
});
