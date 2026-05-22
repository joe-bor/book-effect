# Spike Plan

## The One Question

Can Book Effect listen offline on the Galaxy S10 and fire preloaded sound effects quickly and stably enough to make a physical read-aloud session feel magical?

The answer must be data-driven. The research disagrees on the best ASR engine and audio library, so the spike compares both instead of choosing by opinion.

## Devices

- **Primary gate:** Samsung Galaxy S10, model SM-G973U, Snapdragon 855, 8 GB RAM.
- **Secondary:** iPhone 12.

The Galaxy S10 decides whether the cross-platform v1 plan is viable. The iPhone 12 should pass more comfortably, but it does not rescue an Android failure unless we explicitly choose iOS-only v1 afterward.

## What We Are Measuring

| Measurement | Galaxy S10 Target | iPhone 12 Target | Notes |
| --- | --- | --- | --- |
| End-to-end latency p50 | < 1000 ms | < 700 ms | End of phrase to first audible sample. |
| End-to-end latency p95 | < 1800 ms | < 1200 ms | Looser Android target because the S10 is older. |
| Recognizer stability | 15 min continuous read | 15 min continuous read | Realistic pauses, restarts, interruptions. |
| First-play audio latency | about 50 ms or better | about 50 ms or better | Compare preloaded one-shot effects. |
| Matcher JS cost | safe at 5 Hz | safe at 5 Hz | Naive matcher only; this is not a matcher-quality test. |
| Battery drain | recorded start/end | recorded start/end | Inform v1 expectations. |
| Thermal behavior | no severe throttling | no severe throttling | S10 sustained CPU inference is the risk. |

Every timing event uses `performance.now()` inside the app where possible. Manual trial notes record battery percentage and obvious thermal state at the start and end.

## What We Are Building

A throwaway Expo app in `spike/`, separate from the eventual v1 app:

- TypeScript strict mode.
- ESLint and Prettier.
- EAS prebuild with a custom development client.
- Hardcoded roughly 200-word excerpt from `Construction Site on Christmas Night`.
- Three triggers:
  - one short single-word trigger,
  - one two-word phrase,
  - one mid-sentence phrase inside prose.
- `ASRProvider` interface:
  - `start()`
  - `stop()`
  - emits `partial(text, ts)` and `final(text, ts)`
- `WhisperRnProvider` implementation.
- `SherpaOnnxProvider` implementation.
- UI toggle for ASR provider.
- `AudioProvider` interface:
  - `preload(triggers)`
  - `play(id)`
  - `stop(id)`
- `ExpoAudioProvider` implementation.
- `ReactNativeSoundProvider` implementation.
- UI toggle for audio provider.
- Naive matcher using sliding-window substring or simple edit distance.
- Session screen showing live ASR text, cursor estimate, trigger state, and latency log tail.
- JSON event log stored on device and exportable through share sheet or `adb pull`.

The spike is allowed to be ugly. It exists to measure risk, not to become v1.

## Instrumentation

Log every meaningful event:

- app/session start
- mic open
- VAD speech start, if available
- VAD speech end, if available
- manual phrase-end cue
- ASR partial
- ASR final
- matcher hit
- trigger armed
- trigger fired
- playback command issued
- playback start callback, if the library exposes one
- provider error
- session stop

The event log should be an append-only JSON array or JSONL file with:

- monotonic timestamp,
- wall-clock timestamp,
- provider names,
- event type,
- phrase/trigger id when relevant,
- raw ASR text when relevant,
- measured deltas when available.

## Methodology

Run trials on real devices, not simulators.

- Use at least 30 trials per phrase per ASR provider per device.
- Test the same three phrases for each ASR provider.
- Mark phrase end with a sharp tongue-click cue after the phrase. This gives the log a consistent acoustic marker even before we have better instrumentation.
- Test in a normal family-room noise level first. If results are close to failing, repeat a smaller set in a quiet room.
- Before latency trials, preload all audio effects and run one warmup play.
- Run one 15-minute continuous read per ASR provider on the Galaxy S10.
- Record battery percentage and thermal feel before and after each 15-minute stability run.
- Keep audio library trials separate from ASR trials when isolating first-play latency.

## Decision Tree

- **S10 passes with at least one ASR provider:** choose the faster/stabler ASR provider for v1. If both pass, prefer the one with better 15-minute stability and simpler integration.
- **S10 passes with both audio providers:** choose the lower-latency provider. If latency is comparable, prefer the simpler Expo-compatible path.
- **S10 fails ASR but iPhone 12 passes:** stop and choose between iOS-only v1 or an Android fallback using platform speech recognition with known restart fragility.
- **Both devices fail ASR:** stop and reframe. Options include shorter sessions, looser latency, fewer triggers, phrase-spotting only, or a different project scope.
- **Audio latency fails for both libraries:** stop before v1 and consider a small native `AVAudioPlayer`/`SoundPool` wrapper.
- **Matcher cost is visible at 5 Hz:** v1 plans for a native matcher module. Otherwise keep JS for v1 until logs prove it is a bottleneck.

## Out Of Scope

- Real matcher quality.
- Multiple books.
- Trigger authoring UI.
- Polished screens.
- App Store or TestFlight distribution.
- Accounts, onboarding, analytics, or cloud services.
- Native matcher module.
- Production-grade manual recovery UI.

## Phase 0 Setup Checklist

We will walk through these before or during Phase 1. Do not install paid services or SDKs.

- Install full Xcode from the Mac App Store.
- Open Xcode once, accept licenses, install extra components, and sign in with the Apple ID for free personal-device sideloading.
- Select full Xcode as the active developer directory instead of Command Line Tools.
- Install Android Studio.
- Install Android SDK Platform Tools so `adb` is available.
- Enable Developer Options and USB debugging on the Galaxy S10.
- Install Watchman.
- Install CocoaPods.
- Create a free Expo account.
- Install or use EAS CLI.
- Use the repo-pinned Node version from `.nvmrc`: `v22.22.1`.
- Confirm `node -v` prints `v22.22.1` and `npm -v` prints a compatible npm 10 version before running Expo commands.
- If a non-interactive agent shell resolves `/usr/local/bin/node` inside `spike/`, prefix commands with `env PATH="$HOME/.nvm/versions/node/v22.22.1/bin:$PATH"` to use the pinned Node version.

## Expected Deliverable

After the spike, write `docs/03-spike-results.md` with:

- device and build details,
- raw latency tables,
- stability notes,
- audio latency results,
- battery and thermal observations,
- recommendation for ASR provider,
- recommendation for audio provider,
- recommendation for JS vs native matcher in v1,
- surprises or gotchas,
- any Phase 2 plan changes.

Stop after the results and wait for approval before Phase 2.
