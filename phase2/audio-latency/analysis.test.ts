import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectOnsets,
  detectOnsetsGuided,
  fitClock,
  pairFiresToOnsets,
  percentile,
  summarizeByLibrary,
  type ProbeFire,
} from "./analysis.ts";
import { parseWav } from "./wav.ts";

function buildPcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeTag = (offset: number, tag: string) => {
    for (let i = 0; i < tag.length; i += 1) {
      view.setUint8(offset + i, tag.charCodeAt(i));
    }
  };
  writeTag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeTag(8, "WAVE");
  writeTag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeTag(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(clamped * 32767), true);
  }
  return new Uint8Array(buffer);
}

/** Silence with sharp impulse bursts at the given ms positions. */
function buildClickSignal(
  sampleRate: number,
  totalMs: number,
  clickMsList: number[],
): Float32Array {
  const samples = new Float32Array(Math.round((totalMs / 1000) * sampleRate));
  // low-level noise floor
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = (Math.random() - 0.5) * 0.002;
  }
  for (const ms of clickMsList) {
    const start = Math.round((ms / 1000) * sampleRate);
    const burst = Math.round(0.02 * sampleRate); // 20 ms burst
    for (let i = 0; i < burst && start + i < samples.length; i += 1) {
      const env = 1 - i / burst;
      samples[start + i] =
        Math.sin((2 * Math.PI * 2000 * i) / sampleRate) * 0.8 * env;
    }
  }
  return samples;
}

test("parseWav reads sample rate and PCM16 samples downmixed to mono", () => {
  const sr = 44100;
  const input = Float32Array.from([0, 0.5, -0.5, 1, -1]);
  const wav = buildPcm16Wav(input, sr);
  const parsed = parseWav(wav);
  assert.equal(parsed.sampleRate, sr);
  assert.equal(parsed.channels, 1);
  assert.equal(parsed.samples.length, input.length);
  for (let i = 0; i < input.length; i += 1) {
    assert.ok(Math.abs(parsed.samples[i] - input[i]) < 0.001, `sample ${i}`);
  }
});

test("detectOnsets finds each click near its true position", () => {
  const sr = 44100;
  const clicks = [200, 900, 1600, 2300];
  const signal = buildClickSignal(sr, 2800, clicks);
  const onsets = detectOnsets(signal, sr);
  assert.equal(onsets.length, clicks.length);
  for (let i = 0; i < clicks.length; i += 1) {
    assert.ok(
      Math.abs(onsets[i] - clicks[i]) < 5,
      `onset ${i}: got ${onsets[i].toFixed(1)} expected ~${clicks[i]}`,
    );
  }
});

test("detectOnsetsGuided finds clicks in each fire window and flags a silent one", () => {
  const sr = 44100;
  // Clicks present at 300 and 1000 ms; the window after the third fire is silent.
  const signal = buildClickSignal(sr, 2200, [300, 1000]);
  const clock = { offsetMs: 0, slope: 1, residualStdMs: 0, sampleCount: 10 };
  const fires: ProbeFire[] = [
    { lib: "a", index: 0, warmup: false, tCmdPerf: 150, tAfterPlayPerf: 151 }, // click@300 => 150ms
    { lib: "a", index: 1, warmup: false, tCmdPerf: 840, tAfterPlayPerf: 841 }, // click@1000 => 160ms
    { lib: "a", index: 2, warmup: false, tCmdPerf: 1550, tAfterPlayPerf: 1551 }, // no click
  ];
  const result = detectOnsetsGuided(signal, sr, fires, clock);
  assert.equal(result.paired.length, 2);
  assert.equal(result.unmatchedFires.length, 1);
  assert.equal(result.unmatchedFires[0].index, 2);
  assert.ok(
    Math.abs(result.paired[0].latencyMs - 150) < 6,
    `lat0 ${result.paired[0].latencyMs}`,
  );
  assert.ok(
    Math.abs(result.paired[1].latencyMs - 160) < 6,
    `lat1 ${result.paired[1].latencyMs}`,
  );
});

test("fitClock recovers the recording->perf offset with slope ~1", () => {
  const offset = 1_000_000;
  const samples = Array.from({ length: 40 }, (_, i) => {
    const durationMillis = i * 700;
    const jitter = (Math.random() - 0.5) * 4;
    return { durationMillis, tPerf: offset + durationMillis + jitter };
  });
  const fit = fitClock(samples);
  assert.ok(Math.abs(fit.offsetMs - offset) < 3, `offset ${fit.offsetMs}`);
  assert.ok(Math.abs(fit.slope - 1) < 0.01, `slope ${fit.slope}`);
  assert.ok(fit.residualStdMs < 5);
});

test("pairFiresToOnsets pairs in order and computes positive latencies", () => {
  const clock = { offsetMs: 1000, slope: 1, residualStdMs: 0, sampleCount: 10 };
  // command at perf t; onset at perf t + latency => onsetMs = (t + latency) - offset
  const fires: ProbeFire[] = [
    { lib: "a", index: 0, warmup: false, tCmdPerf: 2000, tAfterPlayPerf: 2001 },
    { lib: "a", index: 1, warmup: false, tCmdPerf: 2700, tAfterPlayPerf: 2701 },
    { lib: "b", index: 0, warmup: false, tCmdPerf: 3400, tAfterPlayPerf: 3401 },
  ];
  const latencies = [120, 130, 110];
  const onsetsMs = fires.map(
    (f, i) => f.tCmdPerf + latencies[i] - clock.offsetMs,
  );
  const result = pairFiresToOnsets(fires, onsetsMs, clock);
  assert.equal(result.paired.length, 3);
  assert.equal(result.unmatchedFires.length, 0);
  for (let i = 0; i < 3; i += 1) {
    assert.ok(Math.abs(result.paired[i].latencyMs - latencies[i]) < 0.001);
  }
});

test("pairFiresToOnsets tolerates one missing onset", () => {
  const clock = { offsetMs: 0, slope: 1, residualStdMs: 0, sampleCount: 10 };
  const fires: ProbeFire[] = [
    { lib: "a", index: 0, warmup: false, tCmdPerf: 1000, tAfterPlayPerf: 1001 },
    { lib: "a", index: 1, warmup: false, tCmdPerf: 1700, tAfterPlayPerf: 1701 },
    { lib: "a", index: 2, warmup: false, tCmdPerf: 2400, tAfterPlayPerf: 2401 },
  ];
  // second click did not register acoustically
  const onsetsMs = [1120, 2520];
  const result = pairFiresToOnsets(fires, onsetsMs, clock);
  assert.equal(result.paired.length, 2);
  assert.equal(result.unmatchedFires.length, 1);
  assert.equal(result.unmatchedFires[0].index, 1);
});

test("summarizeByLibrary excludes warmups and computes percentiles", () => {
  const paired = [
    { fire: mkFire("expo", 0, true), onsetMs: 0, latencyMs: 999 }, // warmup, ignored
    ...[100, 110, 120, 130, 200].map((l, i) => ({
      fire: mkFire("expo", i, false),
      onsetMs: 0,
      latencyMs: l,
    })),
  ];
  const stats = summarizeByLibrary(paired);
  assert.equal(stats.length, 1);
  assert.equal(stats[0].count, 5);
  assert.equal(stats[0].max, 200);
  assert.equal(stats[0].min, 100);
  assert.equal(stats[0].p50, 120);
});

test("percentile interpolates", () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  assert.equal(percentile([10], 95), 10);
  assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
});

function mkFire(lib: string, index: number, warmup: boolean): ProbeFire {
  return { lib, index, warmup, tCmdPerf: 0, tAfterPlayPerf: 0 };
}
