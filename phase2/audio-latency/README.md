# P6 — Audio playback-start latency (offline analyzer)

Single-device acoustic self-capture analyzer for the P6 audio-latency probe. The Galaxy
S10 records its own microphone while the spike app fires a preloaded click through each
audio provider (`expo-audio`, `react-native-sound`). This tool pairs the in-app command
timestamps against the acoustic onsets to report **command → first-audible-sample** latency.

Throwaway, measurement-only. Offline, zero-cost. No npm install needed — runs on the `tsx`
already installed in `phase2/matcher-lab`.

## Pipeline

1. Spike "Run Latency Probe" button (`spike/src/audio/latencyProbe.ts`) records an `.m4a`
   and writes a `.json` log (fires + recorder `durationMillis` clock samples) to app cache.
2. Pull both from the device (see device recipe in the memory file / docs/09).
3. `analyze.ts` decodes the `.m4a` to PCM WAV via macOS `afconvert`, detects onsets, fits
   the recording→perf clock from the `durationMillis` samples, pairs fires↔onsets, and
   prints p50/p95/max per library plus the bias-free inter-library difference.

## Run

```sh
# from phase2/audio-latency
TSX=../matcher-lab/node_modules/.bin/tsx

# unit tests
$TSX --test ./analysis.test.ts

# integration self-check (real afconvert AAC round-trip)
$TSX ./selfcheck.ts

# analyze a real capture
$TSX ./analyze.ts <probe-log.json> <recording.m4a> --out=summary.json [--debug]
```

## Method & error bars

The recording clock and the JS perf clock advance at the same real-time rate, so the map is
`perf = offset + durationMillis` (slope ≈ 1); `offset` is fit from the recorder's
`durationMillis` samples (median, robust to JS jitter). Reported `residualStd` is the fit
noise.

Residual systematic uncertainty in the **absolute** number comes from: (a) recorder
start latency (`record()` → first captured sample) and (b) AAC encoder priming (constant
leading offset). Both are constant within a run, so the **inter-library difference and the
within-library jitter are bias-free**; only the absolute floor carries the systematic. For a
binary "is it under ~50 ms" question against latencies that turn out far larger, the
systematic does not change the verdict. See `docs/09-audio-latency-results.md`.
