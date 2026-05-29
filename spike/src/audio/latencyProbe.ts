// MEASUREMENT-ONLY instrumentation for P6 (audio playback-start latency).
// This drives a single-device acoustic self-capture: the device records its own
// microphone while it fires a preloaded click through each audio provider. Pairing
// command timestamps (perf clock) against acoustic onsets (recording clock) yields a
// command -> first-audible-sample latency. See docs/09-audio-latency-results.md.
//
// Throwaway spike code. Do not productionize.

import type { BookTrigger } from '../books/types';
import type { AudioProvider } from './AudioProvider';

/** Monotonic clock in milliseconds (e.g. performance.now()). */
export type ProbeClock = () => number;

/** The subset of expo-audio's AudioRecorder this probe needs. */
export type ProbeRecorder = {
  prepareToRecordAsync(): Promise<void>;
  record(): void;
  stop(): Promise<void>;
  getStatus(): { isRecording: boolean; durationMillis: number; url?: string | null };
  readonly uri: string | null;
};

export type ProbeFire = {
  /** Library label, e.g. 'expo-audio'. */
  lib: string;
  /** 0-based index within this library's measured block (warmups excluded). */
  index: number;
  /** True for discarded warmup fires. */
  warmup: boolean;
  /** performance.now() captured immediately before provider.play(). */
  tCmdPerf: number;
  /** performance.now() captured immediately after provider.play() resolved. */
  tAfterPlayPerf: number;
};

/** (perf clock, recording duration) pair used to fit the recording->perf clock map. */
export type ClockSample = {
  tPerf: number;
  durationMillis: number;
};

export type LatencyProbeLog = {
  schema: 'book-effect-audio-latency-probe/1';
  startedAtWallClock: string;
  device: string;
  clickSound: string;
  reps: number;
  warmups: number;
  gapMs: number;
  blockGapMs: number;
  recordCallPerf: number;
  recordConfirmedPerf: number;
  recordingUri: string | null;
  fires: ProbeFire[];
  clockSamples: ClockSample[];
  stoppedPerf: number;
  notes: string[];
};

export type RunLatencyProbeDeps = {
  recorder: ProbeRecorder;
  /** Providers measured in order, each labelled. */
  providers: { lib: string; provider: AudioProvider }[];
  /** Single click trigger preloaded and fired. */
  clickTrigger: BookTrigger;
  reps: number;
  warmups: number;
  /** Silence between fires (must exceed click length + tail so onsets stay separable). */
  gapMs: number;
  /** Extra silence between library blocks, to make block boundaries obvious offline. */
  blockGapMs: number;
  now: ProbeClock;
  sleep: (ms: number) => Promise<void>;
  wallClock?: () => string;
  device?: string;
  onProgress?: (message: string) => void;
};

const RECORD_CONFIRM_TIMEOUT_MS = 3000;
const RECORD_CONFIRM_POLL_MS = 20;
const RECORD_SETTLE_MS = 500;

/**
 * Runs the acoustic self-capture probe and returns a structured log. The caller is
 * responsible for permissions, audio-mode setup, persisting the log, and copying the
 * recording (recorder.uri) somewhere pullable.
 */
export async function runLatencyProbe(deps: RunLatencyProbeDeps): Promise<LatencyProbeLog> {
  const {
    recorder,
    providers,
    clickTrigger,
    reps,
    warmups,
    gapMs,
    blockGapMs,
    now,
    sleep,
    wallClock = () => new Date().toISOString(),
    device = 'unknown',
    onProgress = () => {},
  } = deps;

  const fires: ProbeFire[] = [];
  const clockSamples: ClockSample[] = [];
  const notes: string[] = [];

  const sampleClock = () => {
    const status = recorder.getStatus();
    clockSamples.push({ tPerf: now(), durationMillis: status.durationMillis });
  };

  // Preload every provider so timing reflects the preloaded one-shot path.
  for (const { lib, provider } of providers) {
    onProgress(`Preloading ${lib}`);
    await provider.preload([clickTrigger]);
  }

  onProgress('Preparing recorder');
  await recorder.prepareToRecordAsync();

  const recordCallPerf = now();
  recorder.record();

  // Wait until the recorder reports it is actually capturing.
  const confirmDeadline = recordCallPerf + RECORD_CONFIRM_TIMEOUT_MS;
  while (!recorder.getStatus().isRecording) {
    if (now() > confirmDeadline) {
      notes.push('Recorder never reported isRecording within timeout');
      break;
    }
    await sleep(RECORD_CONFIRM_POLL_MS);
  }
  const recordConfirmedPerf = now();
  await sleep(RECORD_SETTLE_MS);
  sampleClock();

  for (const { lib, provider } of providers) {
    onProgress(`Warmup ${lib}`);
    for (let w = 0; w < warmups; w += 1) {
      await fireOnce(provider, clickTrigger.id, lib, -1 - w, true, now, fires);
      await sleep(gapMs);
      sampleClock();
    }

    onProgress(`Measuring ${lib} (${reps} fires)`);
    for (let i = 0; i < reps; i += 1) {
      await fireOnce(provider, clickTrigger.id, lib, i, false, now, fires);
      await sleep(gapMs);
      sampleClock();
    }

    // Long silence so the offline analyzer can see the block boundary.
    await sleep(blockGapMs);
    sampleClock();
  }

  onProgress('Stopping recorder');
  await recorder.stop();
  const stoppedPerf = now();

  return {
    schema: 'book-effect-audio-latency-probe/1',
    startedAtWallClock: wallClock(),
    device,
    clickSound: clickTrigger.sound,
    reps,
    warmups,
    gapMs,
    blockGapMs,
    recordCallPerf,
    recordConfirmedPerf,
    recordingUri: recorder.uri,
    fires,
    clockSamples,
    stoppedPerf,
    notes,
  };
}

async function fireOnce(
  provider: AudioProvider,
  triggerId: string,
  lib: string,
  index: number,
  warmup: boolean,
  now: ProbeClock,
  fires: ProbeFire[],
): Promise<void> {
  const tCmdPerf = now();
  await provider.play(triggerId);
  const tAfterPlayPerf = now();
  fires.push({ lib, index, warmup, tCmdPerf, tAfterPlayPerf });
}
