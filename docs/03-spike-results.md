# Phase 1 Spike Results

Last updated: May 28, 2026.

Phase: Phase 1 Spike, Task 13 - Run Trials And Write Results (Whisper realtime debug pass).

Scope: Android-first measured spike results. Phase 2 has not started. This document does not define the v1 product architecture, PRD, or test plan.

## Summary

Both Sherpa-ONNX and `whisper.rn` now produce countable Android trials on the Galaxy S10 after a debugging pass that found three independent defects in the `whisper.rn` realtime pipeline and tuned the provider around them.

Whisper transcribes the carrier almost verbatim on this device-and-mic setup, so its phrase-match success rate is higher than Sherpa for the long carrier. Latency from `asr.vadStart` to `trigger.fire` is multiple seconds though — slow enough that read-aloud responsiveness will likely fail unless Whisper is moved to a faster slicing/inference configuration in Phase 2.

Counted Sherpa-ONNX Android trials on the Galaxy S10 (unchanged from previous pass):

| Trigger                        | Counted result | Main miss pattern                                                                       |
| ------------------------------ | -------------: | --------------------------------------------------------------------------------------- |
| `deadline`                     |    30/30 fired | None in counted run                                                                     |
| `massive gift`                 |    29/30 fired | `MASSIVE GUEST`                                                                         |
| `pushes hard to clear the way` |    12/30 fired | `S HARD TO CLEAR THE WAY`, `PUSHES HEART TO CLEAR THE WAY`, or `HEART TO CLEAR THE WAY` |

Counted Whisper (`whisper.rn` + `ggml-tiny.en.bin` + `ggml-silero-v6.2.0.bin`) Android trials on the Galaxy S10:

| Trigger                        | Counted result | Main miss pattern                                                       |
| ------------------------------ | -------------: | ----------------------------------------------------------------------- |
| `deadline`                     |    29/30 fired | `The word is a word.`                                                   |
| `massive gift`                 |    28/30 fired | `In his way of God.`, plus one trial with no partial captured           |
| `pushes hard to clear the way` |    29/30 fired | `Working at full speed all day he pushes hard` (truncated before `to`)  |

Task 13a local log save was smoke-tested on device. `Stop Session` auto-saved an app-private cache JSON file, and the log was pulled with `run-as` instead of the Android share sheet.

Whisper counted trials only became possible after the realtime pipeline was unblocked. See `ASR Stability` and `Surprises And Gotchas` for the three defects that were found and the spike-scoped workarounds applied in `spike/src/asr/WhisperRnProvider.ts` and `spike/src/ui/SpikeScreen.tsx`.

Manual audio request trials were run separately from ASR trials:

| Audio provider       | Manual play requests | Provider errors | What this proves                                             |
| -------------------- | -------------------: | --------------: | ------------------------------------------------------------ |
| `expo-audio`         |                30/30 |               0 | Play requests resolved/logged on Android                     |
| `react-native-sound` |                30/30 |               0 | Play requests resolved/logged on Android                     |

These manual audio trials do not prove true playback-start latency or first audible sample timing.

iOS is not forgotten. Task 12 remains blocked by duplicate RNFS native symbols from `react-native-fs` and `@dr.pogodin/react-native-fs`, as recorded in `spike/README.md`.

## Device And Build Details

- Device: Samsung Galaxy S10 `SM_G973U`.
- Branch and code baseline: `codex/phase-1-spike` at `934f26e`, plus the Whisper realtime fixes/instrumentation in this pass (not yet committed at the time of writing).
- Runtime: installed Android Expo development build, served by Metro from `spike/`.
- Expo/RN stack from `spike/package.json`: Expo `~56.0.3`, React Native `0.85.3` (new architecture / bridgeless on by default), React `19.2.3`, `expo-audio ~56.0.9`, `whisper.rn ^0.6.0`, `@fugood/react-native-audio-pcm-stream ^1.1.4`.
- ASR providers counted: `sherpa-onnx` and `whisper-rn`.
- Audio provider during ASR sessions: `expo-audio`.
- Audio providers in manual request trials: `expo-audio` and `react-native-sound`.
- Sherpa model location on phone: app-private `files/models/sherpa-onnx-streaming-zipformer-en-20M-2023-02-17/`.
- Whisper model locations on phone: app-private `files/models/ggml-tiny.en.bin` and `files/models/ggml-silero-v6.2.0.bin`.
- Sherpa input source for the counted run: macOS `say`, voice `Samantha`, rate `130`, played through the Mac speaker into the phone microphone.
- Whisper input source for the counted run: macOS `say -o` pre-renders each carrier to a small AIFF, then a Python harness plays it with `afplay -v 1` so the playback volume is independent of the Mac's UI volume slider.
- ADB transport: USB serial `RF8M304FJLA`. The phone also appeared over wireless, so the runner pinned the USB serial.
- Metro asset loading over USB required `adb reverse tcp:8081 tcp:8081`; without this, `expo-audio` preload failed trying to reach `localhost:8081`.
- Counted logs were collected under `/private/tmp/book-effect-task13-trials/` (Sherpa) and `/private/tmp/book-effect-whisper-trials/` (Whisper) and were not committed.
- Manual audio logs were pulled from app-private cache after local saves and were not committed.

Whisper provider configuration used for the counted run (spike-tuned defaults in `spike/src/ui/SpikeScreen.tsx`; see `Surprises And Gotchas` for why each value was forced):

- `vadInferenceIntervalMs: 1000`
- `preRecordingBufferMs: 1500`
- `speechRateThreshold: 0.05`
- `audioSliceSec: 30`
- All other realtime options default (notably `audioMinSec: 0.25`, `maxSlicesInMemory: 3`).

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
- `vadStartToTriggerMs`: app-side time from `asr.vadStart` to `trigger.fire`. This includes the spoken carrier duration before the trigger phrase, so it is useful for relative behavior but is not pure post-phrase latency.

Successful Sherpa-ONNX trials only:

| Trigger                        | Successes | Host end p50 | Host end p95 | VAD start p50 | VAD start p95 |
| ------------------------------ | --------: | -----------: | -----------: | ------------: | ------------: |
| `deadline`                     |        30 |       295 ms |       351 ms |        899 ms |       1338 ms |
| `massive gift`                 |        29 |       300 ms |       333 ms |       1585 ms |       1601 ms |
| `pushes hard to clear the way` |        12 |       -92 ms |        16 ms |       1884 ms |       2355 ms |

The negative host-end values on the long phrase mean the trigger sometimes fired before the macOS `say` process returned. Treat host-end numbers as approximate, not as final product latency measurements.

Whisper VAD-start latency (successful trials only). Host-end timing was not captured in this pass because the Whisper trial harness drives playback through `afplay` and does not log the Mac-side process-exit timestamp into the JSON log.

| Trigger                        | Successes | VAD start p50 | VAD start p95 | VAD start p99 |
| ------------------------------ | --------: | ------------: | ------------: | ------------: |
| `deadline`                     |        29 |       3307 ms |       4386 ms |       4442 ms |
| `massive gift`                 |        28 |       4790 ms |       7600 ms |       8036 ms |
| `pushes hard to clear the way` |        29 |       7328 ms |      10786 ms |      11693 ms |

Whisper VAD-start latency is dominated by the chain `silero speech_start → slice grows over ~1-3 seconds of audio → Whisper transcribeData on the slice → matcher hits the carrier text`. Each per-slice `whisper.rn` inference on the Galaxy S10 measured at p50 ≈ 1.5 s, p95 ≈ 2.8-4.2 s across the three carriers (per the `realtime.transcribe` diag events). Two to three slice transcribes are needed before the carrier text contains the trigger phrase, so the per-trial latency is roughly cumulative.

The Whisper latency numbers above are not directly comparable to the Sherpa numbers in v1 terms. They include the time `whisper.rn` spent waiting for the slice to finalize, which is set by the spike-tuned `audioSliceSec` of 30 s and the VAD-driven natural slice end. A faster Whisper configuration (smaller slice, force `nextSlice` after a VAD timeout, or move slicing into the matcher) is a Phase 2 question, not a Phase 1 fix.

## ASR Stability

### Sherpa-ONNX

Sherpa-ONNX startup was stable after microphone permission/AppOps were fixed. Counted sessions repeatedly started, loaded `expo-audio`, streamed ASR, exported logs, and restarted without app crashes.

Recognition stability varied by phrase:

- `deadline`: 30/30 counted fires. Earlier calibration attempts showed that Sherpa sometimes transcribes `deadline` as `DEAD LINE`, which the current exact matcher does not accept.
- `massive gift`: 29/30 counted fires. The one miss was a plausible substitution: `IN HIS WAY A MASSIVE GUEST`.
- `pushes hard to clear the way`: 12/30 counted fires. Most misses lost the start of `pushes` or substituted `hard` with `heart`, so the exact phrase was not present even though the rest of the sentence was recognized.

This points to matcher design work for Phase 2 planning: single exact normalized phrase matching is too brittle for child read-aloud use, especially for multi-word phrase starts.

### Whisper (`whisper.rn`)

Three independent defects in the `whisper.rn` realtime pipeline blocked Whisper trials in the previous Task 13 pass. They were tracked down with provider-side instrumentation, not by patching `node_modules`. All three are reproducible on the Galaxy S10:

1. **`Stop Session` hangs while the VAD queue drains.** The provider defaults to `vadInferenceIntervalMs: 500`, which is faster than `silero` inference on the S10 (measured 50-300 ms per call, rising linearly with the size of the ring buffer). The work queue in `whisper.rn/src/realtime-transcription/RingBufferVad.ts` keeps adding entries that finish slower than they arrive. On stop, `RingBufferVad.flush()` awaits every queued task, so the UI sat in `STOPPING` for 119 s in one repro run before the queue drained. Workaround: pass `vadInferenceIntervalMs: 1000` from `SpikeScreen`. `RingBufferVad` then also requires `preRecordingBufferMs > inferenceIntervalMs`, so the spike sets `preRecordingBufferMs: 1500`.
2. **`speech_start` never fired even after silero returned non-empty segments.** `RingBufferVad.handleVadStateChange` measures speech rate against the entire ring-buffer length (`vadInput.byteLength / 2 / sampleRate`). The ring buffer grows over the whole session because it is only cleared in `RingBufferVad.reset()`, which is called from `RealtimeTranscriber.stop()`. As a result, even when silero saw 1.0-1.3 s of speech inside a 10 s buffer, the computed `speechRate` (~0.10) stayed below the provider default `speechRateThreshold: 0.3`. Workaround: pass `speechRateThreshold: 0.05`.
3. **`SliceManager.addAudioData` recurses to a JS stack overflow whenever the data added is larger than one slice.** `whisper.rn/src/realtime-transcription/SliceManager.ts` recurses on overflow but always allocates a fresh slice of size `audioSliceSec * sampleRate * 2`, then re-tests the full `audioData.length` against it. The provider previously set `audioSliceSec: 2`, so any speech_start payload bigger than ~64 KB (≈ 2 s of audio at 16 kHz mono 16-bit) overflowed the stack. Logcat showed `Uncaught (in promise, id: 3): RangeError: Maximum call stack size exceeded`. The slice index advanced to `6527` (the recursion depth before stack overflow) and Whisper transcribed only fragments such as `line.`, `[MUSIC PLAYING]`, or an empty string. Workaround: pass `audioSliceSec: 30` (matches the `whisper.rn` default).

After these three workarounds, Whisper startup and stop are reliable. Counted runs of 30 trials per carrier completed without app crashes, without device force-stops, and with each `Stop Session` returning to `IDLE` in 3-5 s end-to-end.

Recognition stability for the counted Whisper run:

- `deadline`: 29/30 fired. The single miss transcribed `The word is a word.`. No `DEAD LINE` style splits were observed in the counted run.
- `massive gift`: 28/30 fired. One miss had no captured partial; one transcribed `In his way of God.`.
- `pushes hard to clear the way`: 29/30 fired. The single miss transcribed `Working at full speed all day he pushes hard` and ended before reaching `to clear the way`, so the exact phrase was never present in the rolling partial.

Whisper produced fewer hard "wrong-word" substitutions than Sherpa on this carrier set, especially on the long phrase. The current matcher does still tokenize on whitespace, so a punctuation difference like `gift.` versus `gift` does not break the match.

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

Sherpa-ONNX remains the leading Android ASR candidate for the next decision, primarily on latency. Whisper now produces countable trials with higher phrase-match accuracy on this carrier set, but VAD-start to trigger.fire latency is multiple seconds even on a 4-word carrier, which is unlikely to feel "magical" in a live read-aloud session without significant Phase 2 work.

Caveats that still apply:

- Keep measuring on real device audio, not only desktop TTS, because recognition quality is sensitive to distance, voice, and carrier phrasing.
- Do not carry the exact matcher forward unchanged. Phrase matching needs tolerance for split compounds (`DEAD LINE`), near substitutions (`GUEST` vs `GIFT` may or may not be acceptable depending on trigger), and dropped leading syllables in longer phrases.
- The Whisper recommendation is conditional on whether Phase 2 wants to attack the `whisper.rn`/`silero` slicing path. If yes, Whisper may close the latency gap; if no, the current configuration is too slow to ship.

For audio playback, both `expo-audio` and `react-native-sound` passed request-level Android manual trials. Do not choose between them on latency until playback-start or first-sample timing is instrumented.

## Surprises And Gotchas

- Android `RECORD_AUDIO` permission was the root cause of the initial Sherpa `AudioRecord failed to initialize` failure. AppOps needed to be `foreground`/`allow`.
- With both USB and wireless ADB transports attached for the same phone, unpinned `adb` commands failed with "more than one device/emulator".
- Using the USB transport required `adb reverse tcp:8081 tcp:8081`; otherwise `expo-audio` asset preload attempted `localhost:8081` on the phone and failed.
- Android share/export UI can remain foreground after log export. The trial runner had to dismiss it before the next session.
- Task 13a local cache save avoided the Android share sheet for counted/manual logs. The saved JSON captures events up to `log.localSave.requested`; the UI/in-memory log then records `log.localSave.completed` after the file write succeeds.
- The React Native EventEmitter warnings from `@fugood/react-native-audio-pcm-stream` on Android (`addListener`/`removeListeners` missing) are non-fatal under RN 0.85's bridgeless mode. Native PCM frames reached JS in this pass at the expected ~2 frames/s rate even with both warnings logged.
- The `whisper.rn` realtime pipeline as shipped is not Galaxy-S10-ready out of the box. The three concrete defects (`Stop` hang from a backlogged VAD queue, `speechRate` evaluated against the whole ring buffer, `SliceManager.addAudioData` recursing on overflow) are documented in `ASR Stability → Whisper` above. Each was reproduced and worked around without touching `node_modules`.
- `whisper.rn`'s `RingBufferVad` allocates `bufferSize = preRecordingBufferMs * sampleRate * 2` bytes for its ring buffer without dividing by 1000, so a configured value of `1500` allocates ~48 MB instead of ~48 KB. The buffer still works because `dataLength` is bounded by what is actually written, but the constraint check `preRecordingBufferMs > inferenceIntervalMs` mixes the two units, which forces the configured value above the ms-based inference interval.
- Short isolated TTS phrases are poor proxies for read-aloud. They caused clipped starts such as `INE`, `DEADLI`, or `S HARD TO CLEAR THE WAY` for Sherpa. Whisper was more robust to clipped starts in this pass but produced one outright hallucination per long carrier (`[MUSIC PLAYING]` during smoke runs, `In his way of God.` in the counted run).
- Mac-side TTS volume mattered. The first Whisper trial set produced empty Whisper output until the harness moved from `say` directly to `say -o … .aiff` plus `afplay -v 1`. The latter ensures the carrier plays at the system master volume without depending on the keyboard volume slider.
- The current trigger log proves the trigger was requested and no provider error was logged; it does not prove audible first sample timing.
- The `wallClock` field on each event in the cache JSON is the reliable cross-event timestamp. Per-event `timestamp` mixes `performance.now()` (provider-managed) and `Date.now()` (passed through from native VAD events), so subtracting them gives nonsense values.

## Phase 2 Impact

Do not begin Phase 2 from these results alone.

Before Phase 2 planning documents or v1 app code, finish the missing Phase 1 evidence:

- Decide whether Whisper is in or out of the Android shortlist. The current numbers say it works but is slow. A Phase 2 decision should explicitly say "ship Sherpa", "ship Whisper after slicing rework", or "drop Whisper" — not leave it ambiguous.
- Add `hostEndToTriggerMs` capture to the Whisper harness so its latency is directly comparable to Sherpa.
- Add or plan instrumentation for true playback-start latency and matcher cost.
- Keep the iOS duplicate RNFS native symbol blocker visible as an unresolved platform risk.
- The three `whisper.rn` defects documented in `ASR Stability → Whisper` are pinned to the Phase 1 workarounds in `SpikeScreen`. If Whisper is carried to v1, decide whether to fix them upstream, fork, or replace `whisper.rn`'s realtime helpers with a project-owned pipeline.
