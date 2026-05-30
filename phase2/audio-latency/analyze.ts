// P6 audio-latency analyzer CLI.
//
// Usage:
//   tsx analyze.ts <probe-log.json> <recording.m4a> [--out summary.json] [--debug]
//
// Decodes the recording to PCM WAV via macOS `afconvert`, detects acoustic click
// onsets, fits the recording->perf clock from the recorder's durationMillis samples,
// pairs each fire to its onset, and reports command->first-audible-sample latency.
//
// Offline, zero-cost, throwaway. See docs/09-audio-latency-results.md for method + caveats.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  detectOnsets,
  detectOnsetsGuided,
  fitClock,
  percentile,
  round,
  summarizeByLibrary,
  type ProbeLog,
} from "./analysis.ts";
import { parseWav } from "./wav.ts";

function main(): void {
  const args = process.argv.slice(2);
  const positional = args.filter((a) => !a.startsWith("--"));
  const outFlag = args.find((a) => a.startsWith("--out="));
  const debug = args.includes("--debug");

  if (positional.length < 2) {
    console.error(
      "Usage: tsx analyze.ts <probe-log.json> <recording.m4a> [--out=summary.json]",
    );
    process.exit(1);
  }

  const [logPath, audioPath] = positional;
  const log = JSON.parse(readFileSync(logPath, "utf8")) as ProbeLog;

  const numFlag = (name: string): number | undefined => {
    const a = args.find((x) => x.startsWith(`--${name}=`));
    return a === undefined ? undefined : Number(a.slice(name.length + 3));
  };
  const guidedOptions = {
    minLatencyMs: numFlag("minLatencyMs"),
    maxLatencyMs: numFlag("maxLatencyMs"),
    peakFraction: numFlag("peakFraction"),
    validityRatio: numFlag("validityRatio"),
  };

  const wavPath = join(mkdtempSync(join(tmpdir(), "p6-")), "decoded.wav");
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", audioPath, wavPath]);
  const { samples, sampleRate } = parseWav(readFileSync(wavPath));

  const clock = fitClock(log.clockSamples);
  const definedGuided = Object.fromEntries(
    Object.entries(guidedOptions).filter(([, v]) => v !== undefined),
  );
  // Guided detection (uses the fire schedule + clock fit) is the primary path.
  const pairing = detectOnsetsGuided(
    samples,
    sampleRate,
    log.fires,
    clock,
    definedGuided,
  );
  // Blind detection is reported as an independent sanity cross-check only.
  const blindOnsets = detectOnsets(samples, sampleRate);
  const stats = summarizeByLibrary(pairing.paired);

  const measuredFires = log.fires.filter((f) => !f.warmup).length;
  const durationSec = round(samples.length / sampleRate, 1);

  const lines: string[] = [];
  lines.push("=== P6 Audio Latency — single-device acoustic self-capture ===");
  lines.push(`recording: ${durationSec}s @ ${sampleRate} Hz`);
  lines.push(
    `fires: ${log.fires.length} (measured ${measuredFires}, warmups ${log.fires.length - measuredFires}) | blind-onset cross-check: ${blindOnsets.length}`,
  );
  lines.push(
    `clock fit: offset=${round(clock.offsetMs, 2)}ms slope=${round(clock.slope, 5)} residualStd=${round(clock.residualStdMs, 2)}ms (n=${clock.sampleCount})`,
  );
  lines.push(
    `pairing: matched ${pairing.paired.length}, unmatched fires ${pairing.unmatchedFires.length}, extra onsets ${pairing.extraOnsets.length}`,
  );
  lines.push("");
  lines.push("command -> first-audible-sample latency (ms):");
  lines.push(
    "  library                p50     p95     max     min    mean   n",
  );
  for (const s of stats) {
    lines.push(
      `  ${s.lib.padEnd(20)} ${fmt(s.p50)} ${fmt(s.p95)} ${fmt(s.max)} ${fmt(s.min)} ${fmt(s.mean)}  ${s.count}`,
    );
  }

  if (stats.length === 2) {
    const diff = round(stats[0].p50 - stats[1].p50, 1);
    lines.push("");
    lines.push(
      `inter-library p50 difference (${stats[0].lib} - ${stats[1].lib}): ${diff}ms (bias-free; the clock offset cancels)`,
    );
  }

  // Bias-free jitter view: spread of each library above its own minimum.
  lines.push("");
  lines.push("jitter above per-library min (ms, clock-offset-independent):");
  for (const s of stats) {
    const spread = pairing.paired
      .filter((p) => !p.fire.warmup && p.fire.lib === s.lib)
      .map((p) => p.latencyMs - s.min);
    lines.push(
      `  ${s.lib.padEnd(20)} p50=${fmt(percentile(spread, 50))} p95=${fmt(percentile(spread, 95))} max=${fmt(Math.max(...spread))}`,
    );
  }

  if (pairing.unmatchedFires.length > 0) {
    lines.push("");
    lines.push(
      `WARNING: ${pairing.unmatchedFires.length} fires had no onset — check audio/threshold.`,
    );
  }

  const report = lines.join("\n");
  console.log(report);

  if (debug) {
    console.log("\n--- per-fire (debug) ---");
    for (const p of pairing.paired) {
      console.log(
        `${p.fire.lib} #${p.fire.index}${p.fire.warmup ? " (warmup)" : ""}: onset=${round(p.onsetMs, 1)}ms latency=${round(p.latencyMs, 1)}ms`,
      );
    }
  }

  const summary = {
    schema: "book-effect-audio-latency-summary/1",
    audioPath,
    logPath,
    sampleRate,
    durationSec,
    blindOnsetCrossCheck: blindOnsets.length,
    measuredFires,
    clock,
    pairing: {
      matched: pairing.paired.length,
      unmatchedFires: pairing.unmatchedFires.length,
      extraOnsets: pairing.extraOnsets.length,
    },
    stats,
    perFire: pairing.paired.map((p) => ({
      lib: p.fire.lib,
      index: p.fire.index,
      warmup: p.fire.warmup,
      onsetMs: round(p.onsetMs, 1),
      latencyMs: round(p.latencyMs, 1),
    })),
  };

  if (outFlag) {
    const outPath = outFlag.slice("--out=".length);
    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\nwrote ${outPath}`);
  }
}

function fmt(value: number): string {
  return round(value, 1).toFixed(1).padStart(7);
}

main();
