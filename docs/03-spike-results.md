# Phase 1 Spike Results

Last updated: May 27, 2026.

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

Task 13a local log save was smoke-tested on device. `Stop Session` auto-saved an app-private cache JSON file, and the log was pulled with `run-as` instead of the Android share sheet.

Whisper was tested with pushed app-private model files. It reached the UI `RUNNING` state, but it did not emit ASR/VAD events for a smoke phrase and `Stop Session` hung in `STOPPING`, requiring an app force-stop. Whisper counted trials were therefore not valid to run in this pass.

Manual audio request trials were run separately from ASR trials:

| Audio provider       | Manual play requests | Provider errors | What this proves                                             |
| -------------------- | -------------------: | --------------: | ------------------------------------------------------------ |
| `expo-audio`         |                30/30 |               0 | Play requests resolved/logged on Android                     |
| `react-native-sound` |                30/30 |               0 | Play requests resolved/logged on Android                     |

These manual audio trials do not prove true playback-start latency or first audible sample timing.

iOS is not forgotten. Task 12 remains blocked by duplicate RNFS native symbols from `react-native-fs` and `@dr.pogodin/react-native-fs`, as recorded in `spike/README.md`.

## Device And Build Details

- Device: Samsung Galaxy S10 `SM_G973U`.
- Branch and code baseline: `codex/phase-1-spike` at `c48bd36`, plus this results update.
- Runtime: installed Android Expo development build, served by Metro from `spike/`.
- Expo/RN stack from `spike/package.json`: Expo `~56.0.3`, React Native `0.85.3`, React `19.2.3`, `expo-audio ~56.0.9`.
- ASR provider counted: `sherpa-onnx`.
- ASR provider smoke-tested but not counted: `whisper-rn`.
- Audio provider during ASR sessions: `expo-audio`.
- Audio providers in manual request trials: `expo-audio` and `react-native-sound`.
- Sherpa model location on phone: app-private `files/models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/`.
- Whisper model locations on phone: app-private `files/models/ggml-tiny.en.bin` and `files/models/ggml-silero-v6.2.0.bin`.
- Input source: macOS `say`, voice `Samantha`, rate `130`, played through the Mac speaker into the phone microphone.
- ADB transport: USB serial `RF8M304FJLA`. The phone also appeared over wireless, so the runner pinned the USB serial.
- Metro asset loading over USB required `adb reverse tcp:8081 tcp:8081`; without this, `expo-audio` preload failed trying to reach `localhost:8081`.
- Sherpa counted logs were collected under `/private/tmp/book-effect-task13-trials/` and were not committed.
- Manual audio logs were pulled from app-private cache after local saves and were not committed.

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

Whisper latency was not measured. The provider reached `RUNNING` in the UI, but the smoke phrase produced no ASR/VAD events and stopping the session did not complete.

## ASR Stability

Sherpa-ONNX startup was stable after microphone permission/AppOps were fixed. Counted sessions repeatedly started, loaded `expo-audio`, streamed ASR, exported logs, and restarted without app crashes.

Recognition stability varied by phrase:

- `deadline`: 30/30 counted fires. Earlier calibration attempts showed that Sherpa sometimes transcribes `deadline` as `DEAD LINE`, which the current exact matcher does not accept.
- `massive gift`: 29/30 counted fires. The one miss was a plausible substitution: `IN HIS WAY A MASSIVE GUEST`.
- `pushes hard to clear the way`: 12/30 counted fires. Most misses lost the start of `pushes` or substituted `hard` with `heart`, so the exact phrase was not present even though the rest of the sentence was recognized.

This points to matcher design work for Phase 2 planning: single exact normalized phrase matching is too brittle for child read-aloud use, especially for multi-word phrase starts.

Whisper startup is not clean enough to compare yet. With `ggml-tiny.en.bin` and `ggml-silero-v6.2.0.bin` present in app-private storage, the provider entered `RUNNING`, but no partial/final ASR or VAD events were logged for a `deadline` smoke phrase. Pressing `Stop Session` left the UI in `STOPPING` for more than 30 seconds and required `am force-stop` before further testing. Logcat showed the native Whisper library load and React Native EventEmitter warnings from the audio stream dependency, but no clear provider-level error.

## Audio Latency

True audio latency was not honestly measured in this pass.

The app logs `trigger.fire` and manual `audio.manual.play` request events, but it does not log actual first-sample playback or native playback-start callbacks. The counted ASR sessions did not report `expo-audio` playback errors when triggers fired, but that is not a latency measurement.

Manual request-level trials were run without ASR sessions. Each trial tapped the `deadline` manual trigger button and then saved the local JSON log from app-private cache.

| Audio provider       | Manual request events | Provider error events | Notes                                                  |
| -------------------- | --------------------: | --------------------: | ------------------------------------------------------ |
| `expo-audio`         |                    30 |                     0 | All play requests resolved and logged                  |
| `react-native-sound` |                    30 |                     0 | All play requests resolved and logged                  |

This supports basic Android request-path viability for both audio providers. It does not justify a latency ranking. A future measurement still needs native playback-start or first-sample instrumentation.

## Matcher JS Cost

Matcher JS cost was not separately instrumented in Task 13.

The current matcher is a small normalized recent-text phrase scan in `spike/src/matcher/naiveMatcher.ts`, and the app remained responsive during repeated sessions. That is not enough to claim measured cost. This pass did not add matcher timing because the priority was completing the local-save smoke, Whisper startup check, and audio provider request counts. A future measurement should add timing around matcher evaluation and log candidate text length, phrase count, and elapsed JS time.

## Battery And Thermal Notes

Battery before the counted work was observed as AC powered. One early `dumpsys battery` sample showed 22 percent, charging, and 28.9 C battery temperature. A later UI dump during setup showed 44 percent charging.

Later Android battery samples during the manual audio pass showed 91 percent, charging, and about 29.7-29.9 C battery temperature. No thermal warning, app crash, or visible device instability was observed during the counted Sherpa or manual audio trials. The Whisper stop hang is recorded as a provider/runtime blocker rather than a whole-app thermal or device stability issue.

## Recommendation

Use Sherpa-ONNX as the leading Android ASR candidate for the next spike decision, with these caveats:

- Keep measuring on real device audio, not only desktop TTS, because recognition quality is sensitive to distance, voice, and carrier phrasing.
- Do not carry the exact matcher forward unchanged. Phrase matching needs tolerance for split compounds (`DEAD LINE`), near substitutions (`GUEST` vs `GIFT` may or may not be acceptable depending on trigger), and dropped leading syllables in longer phrases.

Do not make a final provider recommendation until Whisper realtime startup/stop behavior is understood or a deliberate decision is made to drop it from the Android shortlist. The current evidence is not a fair ASR accuracy comparison because Whisper never produced countable realtime events.

For audio playback, both `expo-audio` and `react-native-sound` passed request-level Android manual trials. Do not choose between them on latency until playback-start or first-sample timing is instrumented.

## Surprises And Gotchas

- Android `RECORD_AUDIO` permission was the root cause of the initial Sherpa `AudioRecord failed to initialize` failure. AppOps needed to be `foreground`/`allow`.
- With both USB and wireless ADB transports attached for the same phone, unpinned `adb` commands failed with "more than one device/emulator".
- Using the USB transport required `adb reverse tcp:8081 tcp:8081`; otherwise `expo-audio` asset preload attempted `localhost:8081` on the phone and failed.
- Android share/export UI can remain foreground after log export. The trial runner had to dismiss it before the next session.
- Task 13a local cache save avoided the Android share sheet for counted/manual logs. The saved JSON captures events up to `log.localSave.requested`; the UI/in-memory log then records `log.localSave.completed` after the file write succeeds.
- Whisper model files were present and the native library loaded, but no realtime ASR/VAD events appeared for a smoke phrase, and `Stop Session` hung in `STOPPING`.
- Whisper startup produced React Native EventEmitter warnings from the audio stream dependency about missing `addListener` and `removeListeners` methods.
- Short isolated TTS phrases are poor proxies for read-aloud. They caused clipped starts such as `INE`, `DEADLI`, or `S HARD TO CLEAR THE WAY`.
- The current trigger log proves the trigger was requested and no provider error was logged; it does not prove audible first sample timing.

## Phase 2 Impact

Do not begin Phase 2 from these results alone.

Before Phase 2 planning documents or v1 app code, finish the missing Phase 1 evidence:

- Resolve or explicitly close the Whisper realtime startup/stop blocker before treating Whisper as measured.
- Add or plan instrumentation for true playback-start latency and matcher cost.
- Keep the iOS duplicate RNFS native symbol blocker visible as an unresolved platform risk.
