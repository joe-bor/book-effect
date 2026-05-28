# Phase 1 Spike Results

Last updated: May 28, 2026.

Phase: Phase 1 Spike, decision-quality Android ASR comparison. Phase 2 has not started. This document does not define the v1 product architecture, PRD, or test plan.

## Summary

The fair Android ASR comparison was completed on the Galaxy S10 `RF8M304FJLA` with the same carrier playback method for both providers: macOS `say -v Samantha -r 130 -o <file>.aiff` pre-rendered each phrase, then the harness played the AIFF through the Mac speaker with `afplay -v 1`.

Counted success required an app-private JSON log containing `trigger.fire` for the expected trigger. Logs were pulled with:

```bash
adb -s RF8M304FJLA exec-out run-as com.joebor.bookeffect.spike cat cache/<filename>
```

No counted log used the Android share sheet.

Decision: carry Sherpa-ONNX as the primary Android ASR candidate into Phase 2 planning. Carry Whisper only if Phase 2 explicitly budgets realtime pipeline rework; do not carry the current `whisper.rn` realtime configuration as-is. Do not drop or reframe Android offline ASR yet, because Sherpa is fast enough to justify the next design step, but the exact matcher and phrase robustness need work.

Counted same-method ASR results:

| Provider     | Trigger                        | Counted result | Main miss or caveat                                              |
| ------------ | ------------------------------ | -------------: | ---------------------------------------------------------------- |
| Sherpa-ONNX  | `deadline`                     |    27/30 fired | `DEAD LINE` split and one clipped `INE`                          |
| Sherpa-ONNX  | `massive gift`                 |    23/30 fired | Mostly `MASSIVE GUEST`; one `MASS IS GIFT`                       |
| Sherpa-ONNX  | `pushes hard to clear the way` |    21/30 fired | Dropped trigger start: `'S HARD TO CLEAR THE WAY` or `S HARD...` |
| `whisper.rn` | `deadline`                     |    30/30 fired | No counted misses                                                |
| `whisper.rn` | `massive gift`                 |    30/30 fired | No misses; one success included extra off-context text           |
| `whisper.rn` | `pushes hard to clear the way` |    30/30 fired | No counted misses, but latency was far outside the target feel   |

The tradeoff is stark: Whisper recognized all three carriers better, but it fired seconds too late. Sherpa fired quickly, often before the host playback process returned, but recognition plus exact matching was brittle.

## Device And Build Details

- Device: Samsung Galaxy S10 `SM-G973U`, ADB serial `RF8M304FJLA`.
- Branch and baseline: `codex/phase-1-spike` at `a23794b` (`feat(spike): unblock whisper realtime measurement`), plus this results update.
- Runtime: installed Android Expo development build, served by Metro from `spike/`.
- Expo/RN stack from `spike/package.json`: Expo `~56.0.3`, React Native `0.85.3`, React `19.2.3`, `expo-audio ~56.0.9`, `whisper.rn ^0.6.0`, `@fugood/react-native-audio-pcm-stream ^1.1.4`, `react-native-sherpa-onnx ^0.4.3`.
- ASR providers counted: `sherpa-onnx` and `whisper-rn`.
- Audio provider during ASR sessions: `expo-audio`.
- Sherpa model location on phone: app-private `files/models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/`.
- Whisper model locations on phone: app-private `files/models/ggml-tiny.en.bin` and `files/models/ggml-silero-v6.2.0.bin`.
- ADB transport: USB serial `RF8M304FJLA`.
- Counted trial artifacts were collected under `/private/tmp/book-effect-asr-comparison/` and were not committed.

Whisper provider configuration for the counted run was unchanged from the spike-scoped realtime unblock:

- `vadInferenceIntervalMs: 1000`
- `preRecordingBufferMs: 1500`
- `speechRateThreshold: 0.05`
- `audioSliceSec: 30`

Counted utterances:

| Trigger                        | Spoken carrier                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `deadline`                     | `the word is deadline`                                          |
| `massive gift`                 | `in his way a massive gift`                                     |
| `pushes hard to clear the way` | `working at full speed all day he pushes hard to clear the way` |

## Methodology Notes

- The harness waited for the app to report `RUNNING`, then waited an additional 1.5 seconds before playback so the microphone/VAD path could settle.
- A first attempted run without this settle delay clipped early Sherpa starts and was discarded.
- A transient `uiautomator` `null root node` interrupted one harness attempt before the app could stop/save; that interrupted attempt was force-stopped and excluded from counted data.
- Counted trials were restarted or resumed only from complete app-private JSON logs.
- Cross-event timing uses `wallClock`. The provider-managed `timestamp` field still mixes clock sources and is not used for cross-event deltas.
- `hostEndToTriggerMs` is Mac wall-clock time from `afplay` process exit to app `trigger.fire`. It is useful for same-method comparison, but it is still approximate because host and phone clocks are separate and AIFF playback can include trailing audio/silence.
- `vadStartToTriggerMs` is app-side wall-clock time from first `asr.vadStart` to `trigger.fire`.
- Stop duration is host-side time from the harness initiating `Stop Session` to the UI returning to `IDLE`. The app's internal `session.stop` event is recorded after ASR stop completes, so it is not a stop-wait measurement.

## ASR Latency

Successful trials only:

| Provider     | Trigger                        | Successes | Host end p50 | Host end p95 | VAD start p50 | VAD start p95 | Stop p50 | Stop p95 |
| ------------ | ------------------------------ | --------: | -----------: | -----------: | ------------: | ------------: | -------: | -------: |
| Sherpa-ONNX  | `deadline`                     |        27 |      -640 ms |      -135 ms |        973 ms |       1032 ms |  5424 ms |  5544 ms |
| Sherpa-ONNX  | `massive gift`                 |        23 |      -585 ms |       -90 ms |       1302 ms |       1378 ms |  5338 ms |  5500 ms |
| Sherpa-ONNX  | `pushes hard to clear the way` |        21 |      -699 ms |      -248 ms |       2241 ms |       2599 ms |  5292 ms |  5414 ms |
| `whisper.rn` | `deadline`                     |        30 |      1988 ms |      4368 ms |       3318 ms |       5150 ms |  6598 ms |  8822 ms |
| `whisper.rn` | `massive gift`                 |        30 |      2442 ms |      5471 ms |       3879 ms |       7115 ms |  7095 ms |  9105 ms |
| `whisper.rn` | `pushes hard to clear the way` |        30 |      6068 ms |      8807 ms |       9634 ms |      12263 ms |  8888 ms |  9820 ms |

Sherpa's negative host-end values mean the app often fired before `afplay` returned. Treat them as "near-immediate under this carrier method", not as literal negative product latency.

Whisper's latency is the blocker. Even when it recognized perfectly, `deadline` p95 was 4.4 seconds after host playback end, `massive gift` p95 was 5.5 seconds, and the long phrase p95 was 8.8 seconds. This does not meet the Galaxy S10 spike target of p50 under 1000 ms and p95 under 1800 ms.

## Recognition And Misses

### Sherpa-ONNX

Sherpa completed all counted sessions without provider errors in the app-private JSON logs.

Miss details:

| Trigger                        | Misses | Last partial/final patterns                                                                |
| ------------------------------ | -----: | ------------------------------------------------------------------------------------------ |
| `deadline`                     |      3 | `INE`; `THE WORD IS DEAD LINE`; `THE WORD IS DEAD LINE WHERE THERE ARE`                    |
| `massive gift`                 |      7 | Six `IN HIS WAY A MASSIVE GUEST`; one `IN HIS WAY A MASS IS GIFT`                          |
| `pushes hard to clear the way` |      9 | Mostly `'S HARD TO CLEAR THE WAY` or `S HARD TO CLEAR THE WAY`; one `'S HEART TO CLEAR...` |

The long phrase improved from the earlier 12/30 pass to 21/30 under the shared AIFF playback method, but the miss pattern did not change: Sherpa often drops or mutates the beginning of the trigger phrase. The current exact matcher then misses even when the remainder is recognized.

### Whisper (`whisper.rn`)

Whisper completed all counted sessions without provider errors in the app-private JSON logs.

Whisper had no counted misses in this same-method run. One successful `massive gift` trial produced an off-context partial before the carrier:

```text
"Don't miss their helper. What did you do today?" In his way, a massive gift.
```

That still counted because the expected trigger fired, but it is a reminder that Whisper can emit plausible extra text around a short carrier.

The previous `whisper.rn` realtime defects still matter:

1. Default `vadInferenceIntervalMs: 500` can make Stop Session wait while the VAD queue drains on the S10. The spike uses `1000`.
2. Default `speechRateThreshold: 0.3` can prevent `speech_start` after the ring buffer grows. The spike uses `0.05`.
3. Small `audioSliceSec` values can trigger `SliceManager.addAudioData` recursion overflow. The spike uses `30`.

These are spike-scoped workarounds, not Phase 2 architecture.

## Stability, Crashes, And Provider Errors

- Counted app-private JSON logs contained 0 provider errors for Sherpa and 0 provider errors for Whisper.
- No unexpected app crash or unexpected force-stop was observed during counted trials.
- The harness intentionally force-stopped the app after excluded setup/interrupted attempts and before resumed counted blocks.
- Whisper stop remained usable with the spike settings. Host Stop-to-IDLE p95 was 8.8 seconds for `deadline`, 9.1 seconds for `massive gift`, and 9.8 seconds for the long phrase.
- Sherpa Stop-to-IDLE p95 stayed around 5.4-5.5 seconds.

## Battery And Thermal Notes

This was not a controlled battery drain test because the phone was USB powered.

- Before the counted comparison window: 100 percent battery, USB powered, battery temperature 26.6 C.
- After the counted comparison window: 85 percent battery, USB powered, battery temperature 28.0 C.
- Final `dumpsys thermalservice`: thermal status `0`; AP 40.0 C; PA 32.6 C; battery 27.9 C.
- No thermal warning or visible device instability was observed.

The counted comparison window ran from the first Sherpa counted trial at about 18:32 UTC to the last Whisper counted trial at about 20:04 UTC on May 28, 2026. The 15-point battery drop while USB powered is a risk signal for sustained CPU-heavy ASR, especially Whisper, but not a standalone drain measurement.

## Audio Latency

True audio playback-start latency was not remeasured in this comparison.

Earlier Phase 1 manual request-level trials still stand:

| Audio provider       | Manual play requests | Provider errors | What this proves                         |
| -------------------- | -------------------: | --------------: | ---------------------------------------- |
| `expo-audio`         |                30/30 |               0 | Play requests resolved/logged on Android |
| `react-native-sound` |                30/30 |               0 | Play requests resolved/logged on Android |

These manual audio trials do not prove true playback-start latency or first audible sample timing. A future measurement still needs native playback-start or first-sample instrumentation.

## Matcher JS Cost

Matcher JS cost was not separately instrumented in this comparison.

The current matcher is a small normalized recent-text phrase scan in `spike/src/matcher/naiveMatcher.ts`. The repeated ASR sessions did not expose UI instability from matcher cost, but that is not a measured cost claim. Phase 2 should not carry the exact matcher unchanged; it needs tolerance for split compounds (`DEAD LINE`), near substitutions (`GUEST` vs `GIFT`), and dropped leading syllables in longer phrases.

## Recommendation

Carry Sherpa-ONNX as the primary Android offline ASR candidate for Phase 2 planning.

Rationale:

- Sherpa is much faster on the Galaxy S10. Its VAD-start p95 was 1.0-2.6 seconds across the three carriers, while Whisper's was 5.2-12.3 seconds.
- Sherpa is recognition-brittle with the current exact matcher, but the errors are plausible matcher/model robustness problems: split `DEAD LINE`, `GIFT` vs `GUEST`, and dropped leading trigger syllables.
- Whisper's 30/30 recognition is attractive, but its current realtime pipeline is too slow for a live read-aloud effect. Carrying Whisper only makes sense if Phase 2 explicitly includes realtime rework, such as smaller/owned slices, forced slice advancement, different VAD gating, or replacing `whisper.rn` realtime helpers.

Do not drop or reframe Android offline ASR yet. The data says Android offline ASR is still viable enough to plan the next phase around Sherpa plus matcher robustness. It does not say that either provider is ready to ship unchanged.

For audio playback, keep both `expo-audio` and `react-native-sound` unresolved on latency until playback-start or first-sample timing is instrumented.

## Surprises And Gotchas

- The playback method matters. The previous Sherpa pass used direct `say`; this fair comparison used pre-rendered AIFF plus `afplay -v 1` for both providers. Sherpa counts changed under the shared method.
- Sherpa can fire very quickly while still being brittle on exact text.
- Whisper can be perfectly accurate on these carriers while still being too late to feel responsive.
- The `wallClock` field on each event in the cache JSON is the reliable cross-event timestamp. Per-event `timestamp` mixes `performance.now()` and native/provider timestamps.
- Android share/export UI was not used for counted logs.
- Raw logs, model binaries, `.idea/`, and `.claude/` remain uncommitted.

## Phase 2 Impact

Do not begin Phase 2 from this document alone.

When Phase 2 planning is approved, plan around:

- Sherpa-ONNX as the default Android ASR path.
- Matcher robustness as a first-class requirement, not a cleanup item.
- Whisper only as an explicit realtime rework track, not as a drop-in ASR provider.
- True audio playback-start measurement.
- Matcher cost measurement.
- The unresolved iOS duplicate RNFS native symbol blocker recorded in `spike/README.md`.
