# Audio Playback-Start Latency Results (P6)

Status: complete (Android / Galaxy S10). iPhone 12 portion **pending [P8](./phase-2-prompts/P8-ios-unblock.md)**.
Last updated May 29, 2026.

Settles the **"one-shot audio is effectively instant after preload, target <~50 ms on the S10"**
bet ([00-vision.md](./00-vision.md) §Bets; flagged in [05-phase-2-plan.md](./05-phase-2-plan.md)
§Candor as "the most under-tested assumption"). Phase 1 only proved play calls *resolve*
([03-spike-results.md](./03-spike-results.md) §Audio Latency); this measures the **first audible
sample**.

## Verdict

**Native player required for v1 one-shots.** Neither JS library comes near the ~50 ms "instant"
target on the S10 — both land at **~180–260 ms** command → first-audible-sample. A native
`SoundPool`/AAudio (Android) and `AVAudioPlayer` pool / `AVAudioEngine` (iOS) is the path for the
"magical" instant effect.

Between the two JS libraries:

- **`expo-audio` is the reliable one but slower:** fired **88/88** clicks across both runs (0 drops),
  ~20 ms slower than react-native-sound.
- **`react-native-sound` is faster but unreliable:** it **silently dropped 35/88 one-shot replays
  (~37–41%)** while the mic was recording — and the mic *is* recording in production (ASR runs
  concurrently). Dropping a third of sound-effect fires is a v1 dealbreaker on its own, independent
  of latency.

So neither JS library is a v1 answer: even the reliable one (expo-audio) is 4–5× over the instant
target. This selects the native-player playback path for P7+.

## The "first check": is there a software first-sample signal?

**No — neither library exposes a JS-accessible playback-start / first-audible-sample timestamp.**
This is why acoustic capture was necessary.

- **`expo-audio` 56.0.9** — `play()` is synchronous `void`. The only status channel is the **polled**
  `playbackStatusUpdate` event (`playing`, `currentTime`, `timeControlStatus`), which reports player
  *state*, not when a sample reaches the DAC. The underlying Android ExoPlayer/Media3 *does* have a
  true first-sample signal (`AnalyticsListener.onAudioPositionAdvancing(playoutStartSystemTimeMs)`),
  but expo-audio does not surface it.
- **`react-native-sound` 0.13.0** — Android backend is `MediaPlayer`. `play()` calls
  `MediaPlayer.start()` then immediately emits `onPlayChange(true)` (a command-side event, not
  audible). The `play(onEnd)` callback fires on **completion**, not start. `MediaPlayer` exposes no
  playout timestamp.

A true software signal would require native instrumentation + a dev-client rebuild (and react-native-sound's
MediaPlayer has no equivalent to ExoPlayer's hook anyway). Acoustic capture was chosen instead.

## Method — single-device acoustic self-capture

The S10 records its own microphone (`expo-audio` recorder, 44.1 kHz mono AAC) while the spike app
fires a preloaded `latency-click.wav` (80 ms impulse) through each provider. The offline analyzer
pairs the in-app command timestamps against the acoustic onsets.

- **Probe:** `spike/src/audio/latencyProbe.ts` + "Run Latency Probe" button in `SpikeScreen`.
  Preloads a single click trigger per provider, one warmup play, then ≥30 timed fires per library
  with 700 ms gaps. Logs each `tCmdPerf` (perf clock, captured immediately before `play()`) plus
  recorder `durationMillis` samples for the clock fit. Writes an `.m4a` + `.json` to app cache.
- **Analyzer:** `phase2/audio-latency/` (offline, zero-cost, runs on matcher-lab's `tsx`). Decodes
  the `.m4a` via `afconvert`, **guided** onset detection (search the window after each logged
  command for that click's own energy peak — amplitude-robust per click, immune to room noise and
  reverb tails), fits the recording→perf clock, computes per-library p50/p95/max. Reproduce:

  ```bash
  cd phase2/audio-latency
  TSX=../matcher-lab/node_modules/.bin/tsx
  $TSX --test ./analysis.test.ts     # unit tests
  $TSX ./selfcheck.ts                # afconvert AAC round-trip integration check
  $TSX ./analyze.ts <log.json> <recording.m4a> --out=summary.json
  ```

Clock fit was excellent both runs: slope 1.0000, residual std **0.3 ms** — the recording timeline
and perf clock track tightly.

## Results — Galaxy S10 (SM-G973U), command → first-audible-sample (ms)

Two independent runs. Quiet room, media volume ~73%, mic ~10 cm from the speaker.

**Run 1 — 32 fires/library + 1 warmup, 52.3 s recording**

| Library | n (of 32) | dropped | p50 | p95 | max | min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `expo-audio` | 32 | 0 | 197.4 | 216.3 | 218.4 | 177.3 |
| `react-native-sound` | 20 | 12 (37.5%) | 178.9 | 189.1 | 190.2 | 167.6 |

**Run 2 — 56 fires/library + 1 warmup, 87.2 s recording**

| Library | n (of 56) | dropped | p50 | p95 | max | min |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `expo-audio` | 56 | 0 | 236.9 | 249.8 | 258.3 | 220.3 |
| `react-native-sound` | 33 | 23 (41.1%) | 215.4 | 226.3 | 227.8 | 201.8 |

Both runs clear the **≥30 valid reps/library** bar (run 2 secures it for react-native-sound despite
its drops). `expo-audio` is consistently **~19–22 ms slower** than react-native-sound's *emitted*
clicks (the bias-free inter-library difference held across runs). Within-library jitter is small:
`expo-audio` p95-above-min ~30–39 ms, `react-native-sound` ~22–25 ms.

## Error bars — what is and isn't trustworthy

- **Robust (bias-free):** the **inter-library difference** (expo ~20 ms slower) and **within-library
  jitter** (spread above each library's own min). These cancel any common-mode clock offset, so they
  are reliable to a few ms.
- **Absolute number carries a per-run systematic of ~±40 ms.** The same two libraries shifted **+~40
  ms together** from run 1 → run 2 (a common-mode offset, exactly as theory predicts). The source is
  the recorder's start path: `record()` → first captured sample (measured ~195 ms in run 1) plus AAC
  encoder priming (~48 ms), which the `durationMillis` clock fit maps but not to perfect run-to-run
  consistency. So read the absolute as **~200 ± 40 ms**, not a precise figure.
- **This does not change the verdict.** Even subtracting the entire ~±40 ms systematic and the AAC
  priming, the floor stays **~140–180 ms — still 3–4× over the ~50 ms target.** The bet fails by a
  margin far larger than the measurement uncertainty. (For the same reason, a more precise rig —
  loopback dongle or second-device capture — was not needed to reach the decision.)
- **react-native-sound's drop is the dominant reliability signal**, and it is *not* a measurement
  artifact: emitted clicks register at ~250–300× the noise floor while dropped fires show only 3–10×
  (i.e. silence). The validity gate cleanly separates them. The drop reproduced at ~37% and ~41%
  across two runs.

## Caveats carried forward

- **Android-only.** iPhone 12 measurement is **pending [P8](./phase-2-prompts/P8-ios-unblock.md)**
  (iOS dev-client is blocked). expo-audio uses AVPlayer and react-native-sound uses AVAudioPlayer on
  iOS — different stacks, so the Android verdict does not transfer; re-measure on iOS after P8.
- **Single device, self-capture.** Output and input share one clock, which is what makes the method
  cheap; the trade is the absolute systematic above. Verdict-grade, not spec-grade.
- **react-native-sound's drop was measured as-used** (the spike provider's `setCurrentTime(0)` +
  `play()` one-shot replay) **with concurrent recording**. That is the production shape (ASR mic open
  while effects fire), so it is the relevant condition — but the root cause (seek/start race vs.
  AudioRecord contention) was not isolated; the native-player path makes it moot for v1.

## What this leads to

Always → **[P7](./phase-2-prompts/P7-sustained-session.md)**. The result selects the v1 playback
path: a small native one-shot player, not either JS library. iPhone numbers join here after P8.
