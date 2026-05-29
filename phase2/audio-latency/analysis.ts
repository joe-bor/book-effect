// Pure analysis for the P6 audio-latency probe: onset detection, recording->perf clock
// fit, fire/onset pairing, and summary statistics. No I/O here so it stays unit-testable.

export type ProbeFire = {
  lib: string;
  index: number;
  warmup: boolean;
  tCmdPerf: number;
  tAfterPlayPerf: number;
};

export type ClockSample = { tPerf: number; durationMillis: number };

export type ProbeLog = {
  reps: number;
  warmups: number;
  gapMs: number;
  blockGapMs: number;
  fires: ProbeFire[];
  clockSamples: ClockSample[];
};

export type OnsetOptions = {
  /** Analysis frame hop in ms. */
  hopMs?: number;
  /** Energy window in ms. */
  windowMs?: number;
  /** Fraction of (peak - floor) above floor to count as an onset. */
  thresholdFraction?: number;
  /** Minimum spacing between onsets in ms (refractory period). */
  refractoryMs?: number;
};

const DEFAULT_ONSET: Required<OnsetOptions> = {
  hopMs: 1,
  windowMs: 4,
  thresholdFraction: 0.2,
  refractoryMs: 250,
};

/**
 * Detects acoustic onsets and returns their times in milliseconds from sample 0.
 * Uses a short-time RMS envelope with an adaptive threshold and a refractory period
 * so each click counts once. Each onset is refined to the first sample that crosses
 * a low pre-threshold within the detecting frame.
 */
export function detectOnsets(
  samples: Float32Array,
  sampleRate: number,
  options: OnsetOptions = {},
): number[] {
  const opts = { ...DEFAULT_ONSET, ...options };
  const hop = Math.max(1, Math.round((opts.hopMs / 1000) * sampleRate));
  const win = Math.max(hop, Math.round((opts.windowMs / 1000) * sampleRate));

  const frameCount = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const energy = new Float32Array(frameCount);
  for (let f = 0; f < frameCount; f += 1) {
    const start = f * hop;
    let sumSq = 0;
    for (let i = 0; i < win; i += 1) {
      const s = samples[start + i];
      sumSq += s * s;
    }
    energy[f] = Math.sqrt(sumSq / win);
  }

  if (frameCount === 0) {
    return [];
  }

  const floor = percentile(Array.from(energy), 20);
  const peak = Math.max(...energy);
  const threshold = floor + opts.thresholdFraction * (peak - floor);
  const preThreshold = floor + 0.5 * (threshold - floor);
  const refractoryFrames =
    Math.round((opts.refractoryMs / 1000) * sampleRate) / hop;

  const onsets: number[] = [];
  let lastOnsetFrame = -Infinity;
  let armed = true;

  for (let f = 0; f < frameCount; f += 1) {
    if (energy[f] < preThreshold) {
      armed = true;
    }
    if (
      armed &&
      energy[f] >= threshold &&
      f - lastOnsetFrame >= refractoryFrames
    ) {
      const refined = refineOnset(samples, f * hop, hop, win, preThreshold);
      onsets.push((refined / sampleRate) * 1000);
      lastOnsetFrame = f;
      armed = false;
    }
  }

  return onsets;
}

function refineOnset(
  samples: Float32Array,
  frameStart: number,
  hop: number,
  win: number,
  preThreshold: number,
): number {
  // Walk back up to one window to find the first sample that breaks the noise floor.
  const lookback = Math.max(0, frameStart - win);
  let abs = 0;
  for (let i = lookback; i < frameStart + hop && i < samples.length; i += 1) {
    abs = Math.abs(samples[i]);
    if (abs >= preThreshold) {
      return i;
    }
  }
  return frameStart;
}

export type ClockFit = {
  /** perfTime(ms) = offsetMs + durationMillis. */
  offsetMs: number;
  slope: number;
  /** Residual standard deviation around the slope-1 model (ms). */
  residualStdMs: number;
  sampleCount: number;
};

/**
 * Fits the map from recording duration (ms) to the perf clock (ms). The recorder's
 * durationMillis and the perf clock run at the same real-time rate, so the model is
 * perf = offset + duration (slope 1). offset is taken as the median of (tPerf -
 * durationMillis) for robustness against JS scheduling jitter; slope is reported as a
 * least-squares cross-check.
 */
export function fitClock(samples: ClockSample[]): ClockFit {
  const usable = samples.filter(
    (s) => Number.isFinite(s.tPerf) && Number.isFinite(s.durationMillis),
  );
  if (usable.length === 0) {
    throw new Error("No clock samples to fit");
  }

  const offsets = usable.map((s) => s.tPerf - s.durationMillis);
  const offsetMs = percentile(offsets, 50);

  // Least-squares slope as a sanity check (should be ~1).
  const n = usable.length;
  const meanX = usable.reduce((a, s) => a + s.durationMillis, 0) / n;
  const meanY = usable.reduce((a, s) => a + s.tPerf, 0) / n;
  let num = 0;
  let den = 0;
  for (const s of usable) {
    num += (s.durationMillis - meanX) * (s.tPerf - meanY);
    den += (s.durationMillis - meanX) ** 2;
  }
  const slope = den === 0 ? 1 : num / den;

  const residuals = offsets.map((o) => o - offsetMs);
  const residualStdMs = Math.sqrt(
    residuals.reduce((a, r) => a + r * r, 0) / residuals.length,
  );

  return { offsetMs, slope, residualStdMs, sampleCount: usable.length };
}

export type PairedFire = {
  fire: ProbeFire;
  onsetMs: number;
  latencyMs: number;
};

export type PairingResult = {
  paired: PairedFire[];
  unmatchedFires: ProbeFire[];
  extraOnsets: number[];
};

/**
 * Pairs fires to onsets in time order. Each fire claims the earliest not-yet-used onset
 * whose perf time is at or after the command (minus a small negative tolerance) and
 * within a max window. Robust to a missed/extra onset because it is greedy in order.
 */
export function pairFiresToOnsets(
  fires: ProbeFire[],
  onsetsMs: number[],
  clock: ClockFit,
  maxLatencyMs = 600,
  negToleranceMs = 30,
): PairingResult {
  const sortedFires = [...fires].sort((a, b) => a.tCmdPerf - b.tCmdPerf);
  const onsetPerf = onsetsMs
    .map((onsetMs) => ({ onsetMs, perf: clock.offsetMs + onsetMs }))
    .sort((a, b) => a.perf - b.perf);

  const used = new Array(onsetPerf.length).fill(false);
  const paired: PairedFire[] = [];
  const unmatchedFires: ProbeFire[] = [];

  let cursor = 0;
  for (const fire of sortedFires) {
    // Advance past onsets that precede this command beyond tolerance.
    while (
      cursor < onsetPerf.length &&
      onsetPerf[cursor].perf < fire.tCmdPerf - negToleranceMs
    ) {
      cursor += 1;
    }

    let matched = -1;
    for (let j = cursor; j < onsetPerf.length; j += 1) {
      if (used[j]) {
        continue;
      }
      const latency = onsetPerf[j].perf - fire.tCmdPerf;
      if (latency > maxLatencyMs) {
        break;
      }
      matched = j;
      break;
    }

    if (matched < 0) {
      unmatchedFires.push(fire);
      continue;
    }

    used[matched] = true;
    paired.push({
      fire,
      onsetMs: onsetPerf[matched].onsetMs,
      latencyMs: onsetPerf[matched].perf - fire.tCmdPerf,
    });
  }

  const extraOnsets = onsetPerf
    .filter((_, j) => !used[j])
    .map((o) => o.onsetMs);
  return { paired, unmatchedFires, extraOnsets };
}

export type LatencyStats = {
  lib: string;
  count: number;
  p50: number;
  p95: number;
  max: number;
  min: number;
  mean: number;
};

export function summarizeByLibrary(paired: PairedFire[]): LatencyStats[] {
  const byLib = new Map<string, number[]>();
  for (const p of paired) {
    if (p.fire.warmup) {
      continue;
    }
    const list = byLib.get(p.fire.lib) ?? [];
    list.push(p.latencyMs);
    byLib.set(p.fire.lib, list);
  }

  return [...byLib.entries()].map(([lib, latencies]) => ({
    lib,
    count: latencies.length,
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    max: Math.max(...latencies),
    min: Math.min(...latencies),
    mean: latencies.reduce((a, b) => a + b, 0) / latencies.length,
  }));
}

/** Linear-interpolated percentile. p in [0, 100]. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) {
    return NaN;
  }
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) {
    return sorted[0];
  }
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

export function round(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
