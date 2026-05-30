// Throwaway diagnostic: per-fire window peak vs noise floor. tsx diag.ts <log> <m4a>
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitClock, percentile, type ProbeLog } from "./analysis.ts";
import { parseWav } from "./wav.ts";

const [logPath, audioPath] = process.argv.slice(2);
const log = JSON.parse(readFileSync(logPath, "utf8")) as ProbeLog;
const wav = join(mkdtempSync(join(tmpdir(), "diag-")), "d.wav");
execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16", audioPath, wav]);
const { samples, sampleRate } = parseWav(readFileSync(wav));
const clock = fitClock(log.clockSamples);

const hop = Math.max(1, Math.round((0.5 / 1000) * sampleRate));
const win = Math.max(hop, Math.round((3 / 1000) * sampleRate));
const fc = Math.floor((samples.length - win) / hop) + 1;
const energy = new Float32Array(fc);
for (let f = 0; f < fc; f += 1) {
  let s = 0;
  for (let i = 0; i < win; i += 1) s += samples[f * hop + i] ** 2;
  energy[f] = Math.sqrt(s / win);
}
const floor = percentile(Array.from(energy), 20);
const fpm = sampleRate / 1000 / hop;
console.log(
  `floor=${floor.toExponential(2)} 6xfloor=${(floor * 6).toExponential(2)}`,
);

for (const fire of [...log.fires].sort((a, b) => a.tCmdPerf - b.tCmdPerf)) {
  const base = fire.tCmdPerf - clock.offsetMs;
  const sF = Math.max(0, Math.floor((base + 20) * fpm));
  const eF = Math.min(energy.length - 1, Math.ceil((base + 450) * fpm));
  let peak = 0;
  let peakF = sF;
  for (let f = sF; f <= eF; f += 1)
    if (energy[f] > peak) {
      peak = energy[f];
      peakF = f;
    }
  const peakLatency = peakF / fpm - base;
  console.log(
    `${fire.lib.padEnd(20)} ${fire.warmup ? "warm" : "#" + fire.index}`.padEnd(
      28,
    ) +
      ` peak=${peak.toExponential(2)} (${(peak / floor).toFixed(1)}x floor) peak@${peakLatency.toFixed(0)}ms`,
  );
}
