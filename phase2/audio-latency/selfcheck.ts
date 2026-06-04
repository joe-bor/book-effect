// Integration self-check for the P6 analyzer: builds a synthetic click recording,
// round-trips it through afconvert (wav -> m4a -> wav) exactly like the device path,
// then verifies detect -> fit -> pair -> stats recovers the injected latencies.
//
// Run: tsx selfcheck.ts   (exits non-zero on failure)

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectOnsets,
  fitClock,
  pairFiresToOnsets,
  summarizeByLibrary,
} from "./analysis.ts";
import { parseWav } from "./wav.ts";

function buildPcm16Wav(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const tag = (off: number, t: string) => {
    for (let i = 0; i < t.length; i += 1)
      view.setUint8(off + i, t.charCodeAt(i));
  };
  tag(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  tag(8, "WAVE");
  tag(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, "data");
  view.setUint32(40, dataBytes, true);
  for (let i = 0; i < samples.length; i += 1) {
    const c = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(c * 32767), true);
  }
  return new Uint8Array(buffer);
}

const sr = 44100;
const clickTimesMs = Array.from({ length: 10 }, (_, i) => 500 + i * 700);
const total = clickTimesMs[clickTimesMs.length - 1] + 1000;
const signal = new Float32Array(Math.round((total / 1000) * sr));
for (let i = 0; i < signal.length; i += 1)
  signal[i] = (Math.random() - 0.5) * 0.002;
for (const ms of clickTimesMs) {
  const start = Math.round((ms / 1000) * sr);
  const burst = Math.round(0.02 * sr);
  for (let i = 0; i < burst; i += 1) {
    signal[start + i] =
      Math.sin((2 * Math.PI * 2000 * i) / sr) * 0.8 * (1 - i / burst);
  }
}

const dir = mkdtempSync(join(tmpdir(), "p6-selfcheck-"));
const wavIn = join(dir, "in.wav");
const m4a = join(dir, "in.m4a");
const wavOut = join(dir, "out.wav");
writeFileSync(wavIn, buildPcm16Wav(signal, sr));
execFileSync("afconvert", ["-f", "m4af", "-d", "aac", wavIn, m4a]);
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", m4a, wavOut]);

const decoded = parseWav(readFileSync(wavOut));
const onsets = detectOnsets(decoded.samples, decoded.sampleRate);
console.log(
  `detected ${onsets.length} onsets (expected ${clickTimesMs.length})`,
);
assert.equal(
  onsets.length,
  clickTimesMs.length,
  "onset count mismatch after AAC round-trip",
);

// Build a self-consistent probe log: K is an arbitrary perf-clock offset, fires are
// placed so each injected latency is known, two libraries of 5 fires each.
const K = 5_000_000;
const injected = [80, 95, 110, 130, 250, 85, 100, 115, 140, 300];
const fires = onsets.map((onsetMs, i) => ({
  lib: i < 5 ? "lib-a" : "lib-b",
  index: i % 5,
  warmup: false,
  tCmdPerf: K + onsetMs - injected[i],
  tAfterPlayPerf: K + onsetMs - injected[i] + 1,
}));
const clockSamples = Array.from({ length: 30 }, (_, j) => {
  const durationMillis = j * 400;
  return {
    durationMillis,
    tPerf: K + durationMillis + (Math.random() - 0.5) * 4,
  };
});

const fit = fitClock(clockSamples);
assert.ok(Math.abs(fit.offsetMs - K) < 4, `clock offset off: ${fit.offsetMs}`);

const pairing = pairFiresToOnsets(fires, onsets, fit);
assert.equal(pairing.paired.length, fires.length, "not all fires paired");

const stats = summarizeByLibrary(pairing.paired);
for (const s of stats)
  console.log(
    `${s.lib}: p50=${s.p50.toFixed(1)} p95=${s.p95.toFixed(1)} max=${s.max.toFixed(1)}`,
  );

// p50 of lib-a injected = median(80,95,110,130,250)=110; lib-b=median(85,100,115,140,300)=115
const a = stats.find((s) => s.lib === "lib-a");
const b = stats.find((s) => s.lib === "lib-b");
assert.ok(a && Math.abs(a.p50 - 110) < 6, `lib-a p50 ${a?.p50}`);
assert.ok(b && Math.abs(b.p50 - 115) < 6, `lib-b p50 ${b?.p50}`);

// Persist a fixture log so the CLI can be smoke-tested separately (see README).
const logPath = join(dir, "log.json");
writeFileSync(
  logPath,
  JSON.stringify({
    reps: 5,
    warmups: 0,
    gapMs: 700,
    blockGapMs: 2000,
    fires,
    clockSamples,
  }),
);
console.log(`fixture log: ${logPath}`);
console.log(`fixture m4a: ${m4a}`);
console.log("SELFCHECK PASS");
