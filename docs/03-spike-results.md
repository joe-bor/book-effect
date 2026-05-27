# Phase 1 Spike Results

Last updated: May 26, 2026.

Phase: Phase 1 Spike, Task 13 - Run Trials And Write Results.

Scope: Android-first measured spike results. Phase 2 has not started. This document does not define the v1 product architecture, PRD, or test plan.

## Summary

Sherpa-ONNX is viable enough to carry into the next decision point on Android, but exact phrase matching is brittle when the recognizer drops or substitutes the first word of a longer phrase.

Counted Sherpa-ONNX Android trials on the Galaxy S10:

| Trigger                        | Counted result | Main miss pattern                                                                       |
| ------------------------------ | -------------: | --------------------------------------------------------------------------------------- |
| `deadline`                     |    30/30 fired | None in counted run                                                                     |
| `massive gift`                 |    29/30 fired | `MASSIVE GUEST`                                                                         |
| `pushes hard to clear the way` |    12/30 fired | `S HARD TO CLEAR THE WAY`, `PUSHES HEART TO CLEAR THE WAY`, or `HEART TO CLEAR THE WAY` |

Whisper was not counted in this pass. After the Sherpa run, further ADB/device escalations were blocked by the local approval/usage gate, so Whisper startup and manual audio trials remain unmeasured rather than inferred.

iOS is not forgotten. Task 12 remains blocked by duplicate RNFS native symbols from `react-native-fs` and `@dr.pogodin/react-native-fs`, as recorded in `spike/README.md`.

## Device And Build Details

- Device: Samsung Galaxy S10 `SM_G973U`.
- Branch and commit: `codex/phase-1-spike` at `a0ca3ff`.
- Runtime: installed Android Expo development build, served by Metro from `spike/`.
- Expo/RN stack from `spike/package.json`: Expo `~56.0.3`, React Native `0.85.3`, React `19.2.3`, `expo-audio ~56.0.9`.
- ASR provider counted: `sherpa-onnx`.
- Audio provider during ASR sessions: `expo-audio`.
- Sherpa model location on phone: app-private `files/models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/`.
- Input source: macOS `say`, voice `Samantha`, rate `130`, played through the Mac speaker into the phone microphone.
- ADB transport: USB serial `RF8M304FJLA`. The phone also appeared over wireless, so the runner pinned the USB serial.
- Metro asset loading over USB required `adb reverse tcp:8081 tcp:8081`; without this, `expo-audio` preload failed trying to reach `localhost:8081`.
- Counted logs: `/private/tmp/book-effect-task13-trials/sherpa-summary.json` and per-trial JSON files.

Counted utterances:

| Trigger                        | Spoken carrier                                                  |
| ------------------------------ | --------------------------------------------------------------- |
| `deadline`                     | `the word is deadline`                                          |
| `massive gift`                 | `in his way a massive gift`                                     |
| `pushes hard to clear the way` | `working at full speed all day he pushes hard to clear the way` |

The long-phrase carrier intentionally used story-like context. A shorter calibrated carrier, `now it pushes hard to clear the way`, fired in a one-off smoke check, but it was not used for the 30 counted long-phrase trials.

## ASR Latency

The runner records two latency views:

- `hostEndToTriggerMs`: Mac wall-clock time from `say` process exit to app `trigger.fire`. This is only a rough proxy for phrase-end latency because `say` can include trailing silence and the Mac and phone clocks are separate.
- `vadStartToTriggerMs`: app-side time from Sherpa `asr.vadStart` to `trigger.fire`. This includes the spoken carrier duration before the trigger phrase, so it is useful for relative behavior but is not pure post-phrase latency.

Successful trials only:

| Trigger                        | Successes | Host end p50 | Host end p95 | VAD start p50 | VAD start p95 |
| ------------------------------ | --------: | -----------: | -----------: | ------------: | ------------: |
| `deadline`                     |        30 |       295 ms |       351 ms |        899 ms |       1338 ms |
| `massive gift`                 |        29 |       300 ms |       333 ms |       1585 ms |       1601 ms |
| `pushes hard to clear the way` |        12 |       -92 ms |        16 ms |       1884 ms |       2355 ms |

The negative host-end values on the long phrase mean the trigger sometimes fired before the macOS `say` process returned. Treat host-end numbers as approximate, not as final product latency measurements.

## ASR Stability

Sherpa-ONNX startup was stable after microphone permission/AppOps were fixed. Counted sessions repeatedly started, loaded `expo-audio`, streamed ASR, exported logs, and restarted without app crashes.

Recognition stability varied by phrase:

- `deadline`: 30/30 counted fires. Earlier calibration attempts showed that Sherpa sometimes transcribes `deadline` as `DEAD LINE`, which the current exact matcher does not accept.
- `massive gift`: 29/30 counted fires. The one miss was a plausible substitution: `IN HIS WAY A MASSIVE GUEST`.
- `pushes hard to clear the way`: 12/30 counted fires. Most misses lost the start of `pushes` or substituted `hard` with `heart`, so the exact phrase was not present even though the rest of the sentence was recognized.

This points to matcher design work for Phase 2 planning: single exact normalized phrase matching is too brittle for child read-aloud use, especially for multi-word phrase starts.

## Audio Latency

Audio latency was not honestly measured in this pass.

The app logs `trigger.fire` and manual `audio.manual.play` request events, but it does not log actual first-sample playback or native playback-start callbacks. The counted ASR sessions did not report `expo-audio` playback errors when triggers fired, but that is not a latency measurement.

Manual audio trials for `expo-audio` and `react-native-sound` remain to be run separately once device automation is available again.

## Matcher JS Cost

Matcher JS cost was not separately instrumented in Task 13.

The current matcher is a small normalized recent-text phrase scan in `spike/src/matcher/naiveMatcher.ts`, and the app remained responsive during repeated sessions. That is not enough to claim measured cost. A future measurement should add timing around matcher evaluation and log candidate text length, phrase count, and elapsed JS time.

## Battery And Thermal Notes

Battery before the counted work was observed as AC powered. One early `dumpsys battery` sample showed 22 percent, charging, and 28.9 C battery temperature. A later UI dump during setup showed 44 percent charging.

No post-run `dumpsys battery` sample was captured because ADB escalations were blocked after the Sherpa counted run. No thermal warning, app crash, or visible device instability was observed during the counted sessions.

## Recommendation

Use Sherpa-ONNX as the leading Android ASR candidate for the next spike decision, with two caveats:

- Keep measuring on real device audio, not only desktop TTS, because recognition quality is sensitive to distance, voice, and carrier phrasing.
- Do not carry the exact matcher forward unchanged. Phrase matching needs tolerance for split compounds (`DEAD LINE`), near substitutions (`GUEST` vs `GIFT` may or may not be acceptable depending on trigger), and dropped leading syllables in longer phrases.

Do not make a final provider recommendation until Whisper has been started and measured on the same Galaxy S10 with the pushed model files.

## Surprises And Gotchas

- Android `RECORD_AUDIO` permission was the root cause of the initial Sherpa `AudioRecord failed to initialize` failure. AppOps needed to be `foreground`/`allow`.
- With both USB and wireless ADB transports attached for the same phone, unpinned `adb` commands failed with "more than one device/emulator".
- Using the USB transport required `adb reverse tcp:8081 tcp:8081`; otherwise `expo-audio` asset preload attempted `localhost:8081` on the phone and failed.
- Android share/export UI can remain foreground after log export. The trial runner had to dismiss it before the next session.
- Short isolated TTS phrases are poor proxies for read-aloud. They caused clipped starts such as `INE`, `DEADLI`, or `S HARD TO CLEAR THE WAY`.
- The current trigger log proves the trigger was requested and no provider error was logged; it does not prove audible first sample timing.

## Phase 2 Impact

Do not begin Phase 2 from these results alone.

Before Phase 2 planning documents or v1 app code, finish the missing Phase 1 evidence:

- Run Whisper startup and counted trials if the pushed Whisper/VAD model files initialize cleanly.
- Run manual audio trials separately from ASR trials.
- Add or plan instrumentation for true playback-start latency and matcher cost.
- Keep the iOS duplicate RNFS native symbol blocker visible as an unresolved platform risk.
