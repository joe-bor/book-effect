# Book Effect - v1 Test Plan

Status: Final gated v1 planning doc. Created June 13, 2026. Third of the gated
v1 docs (PRD -> architecture -> **test plan**).

This doc defines how v1 is validated before implementation starts. It follows the
locked scope in [`11-v1-prd.md`](./11-v1-prd.md) and the implementation contract
in [`12-v1-architecture.md`](./12-v1-architecture.md). It is docs-only: no v1
product code, no Expo app scaffold, and no Phase 2 archive changes are part of
this plan.

## 1. Testing philosophy

Book Effect is a personal app, but it sits on risky ground: live ASR, native
audio, mobile lifecycle, and an eyes-free user experience. The test plan should
therefore be serious without pretending this is a regulated or multi-tenant
product.

The rigor model is **hybrid**:

- No repo-wide line-coverage threshold gates v1.
- Every architectural seam has explicit behavioral coverage and pass criteria.
- Coverage reports are review signals for `src/core` and `src/session`, not the
  thing being optimized.

The acceptance model is also hybrid:

- Deterministic checks block CI.
- On-device protocols validate what CI cannot know.
- Phase 2 numbers are regression/reference alarms, not formal sign-off gates.
- Final v1 acceptance is qualitative: a real family read-through of
  _Construction Site on Christmas Night_ on the Galaxy S10 `SM-G973U` feels
  right.

## 2. Scope and non-goals

This plan covers the v1 test strategy only. It does not authorize implementation
work.

In scope:

- Tests for the pure TypeScript core lifted from `phase2/matcher-lab/src/engine`.
- Tests for the content build and locked compiled book artifacts.
- Tests for `SessionController` using injected fakes and the real
  `SessionTracker`.
- Static checks that preserve the `src/core` boundary.
- Manual and on-device protocols for native audio, Sherpa contention, battery,
  thermal behavior, stability, and acceptance read-throughs.
- Offline regression use of the preserved Phase 2 corpus.

Out of scope:

- No v1 product implementation.
- No Expo app scaffold.
- No child speech validation. Adult speech only.
- No cloud ASR, sync, accounts, analytics, or paid service dependency.
- No diagnostics overlay in the product UI.
- No in-app authoring UI.
- No native matcher. The matcher stays in JS.
- No Phase 2 archive mutation except intentional generated reports when running
  the existing Phase 2 replay command.

## 3. Gate model

| Gate                                 | Blocks                                  | What belongs here                                                                                                                                                                     |
| ------------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **CI-blocking deterministic checks** | Every PR after v1 implementation exists | Unit/integration/static checks that run off-device: `src/core`, content build, `SessionController`, typecheck, format, lint/import boundaries, and any non-mutating regression guard. |
| **Manual/on-device validation**      | v1 acceptance readiness                 | Native audio smoke and acoustic latency, S10 production-engine timing, sustained battery/thermal/stability run, log-pull workflow.                                                    |
| **Acceptance read-through**          | v1 sign-off                             | Real family read of _Construction Site on Christmas Night_ on Galaxy S10 `SM-G973U`, with dev log and human notes.                                                                    |
| **Reference alarms**                 | Investigation, not automatic failure    | Phase 2 replay/bench numbers: about 95% in-corridor recovery, 0 false-stale, 0 wrong-occurrence, and phrase-end to first audible sample around <= 1.5s.                               |
| **Follow-on**                        | Not v1 gate                             | iPhone 12 physical latency and stability run once device access exists.                                                                                                               |

## 4. CI-blocking test layers

### 4.1 `src/core` engine

The v1 core is a pure TypeScript lift from `phase2/matcher-lab/src/engine` plus
one new method: `SessionTracker.forceReacquire()`. Its tests should run under
Vitest with no React Native, Expo, or native dependencies.

Required coverage:

- Lift the Phase 2 `SessionTracker` unit coverage:
  - cursor advances through clean reads;
  - cursor never rewinds;
  - trigger arming and firing happen only inside the active corridor;
  - triggers fire at most once;
  - unmatched triggers expire and refuse late stale fires;
  - repeated phrases fire only the active occurrence;
  - hard-freeze suppresses firing until a confident forward re-acquire.
- Lift the full-read fixture coverage:
  - clean full read fires all expected triggers in-corridor;
  - injected Sherpa miss shapes still fire in-corridor;
  - off-script/silence freezes without cursor drift or spurious fires;
  - repeated-phrase stress has 0 wrong-occurrence fires;
  - cursor history is monotonic through each fixture.
- Add `forceReacquire()` coverage (detailed in section 7).

Pass criteria:

- All lifted tests pass against the v1 core.
- New tests prove the `forceReacquire()` contract without weakening the
  monotonic cursor invariant.
- No test relies on React Native, Expo, timers, audio devices, or network access.

### 4.2 Content build

The content pipeline compiles hand-authored books into committed, locked
`*.book.json` files plus a generated static asset registry. Runtime should load
compiled content; authoring errors should fail at build/test time.

Required coverage:

- Exact phrase resolution against normalized book tokens.
- `occurrence` disambiguation for repeated phrases.
- Missing phrase -> build error.
- Ambiguous phrase without `occurrence` -> build error.
- Missing sound asset -> build error.
- Trigger `type` is derived from phrase token count, not hand-authored.
- Bare single-word trigger -> lint warning, not error.
- `sourceHash` detects stale compiled artifacts.
- Generated static asset registry contains only static `require()` entries for
  referenced assets.
- Golden compiled artifact for the acceptance book
  _Construction Site on Christmas Night_.

Pass criteria:

- The content build fails loudly for invalid authored content.
- The compiled acceptance-book artifact is reviewable and stable.
- The asset registry is generated, not hand-wired.
- Single-word trigger warnings are visible enough to affect authoring decisions.

### 4.3 `SessionController`

`SessionController` is the integration seam between ASR, audio, content, the real
`SessionTracker`, dev logging, and UI-facing status. It should be tested with a
scripted fake `AsrEngine`, a recording fake `AudioPlayer`, and the real
`SessionTracker`.

Required coverage:

- `start()` requests/validates permission before preloading/listening.
- Sounds preload before `asr.start()`.
- ASR partial/final events are adapted into core `AsrChunk`s.
- New `tracker.fires` deltas call `audio.play(triggerId)` in order.
- `stop()` stops ASR, stops audio, tears down resources, and returns to `idle`.
- Status transitions cover `idle`, `preloading`, `listening`, `recovering`,
  `stopping`, and `error`.
- Engine freeze maps to `recovering`; lifecycle failures map to `error`.
- `recover()` calls `tracker.forceReacquire()` and is safe only during an active
  session.
- Permission denial produces `error{permission}` and no partial startup.
- ASR/model failure produces `error{asr}` and keeps the route back to the
  library available.
- Audio interruption produces `error{interrupted}` and a graceful stop.
- Missing/unloaded asset does not crash the session; `play()` is a no-op or
  logged skip according to the audio facade contract.

Pass criteria:

- The controller can be tested off-device with no real mic or speaker.
- The real core engine is used in controller tests; only platform edges are
  faked.
- Fire order and status transitions are asserted, not only snapshotted.

### 4.4 `src/core` boundary

`src/core` must remain React Native and Expo import-free.

Required coverage:

- ESLint, dependency-cruiser, or an equivalent static rule bans imports from:
  - `react-native`;
  - `expo` and `expo-*`;
  - `app/`, `src/asr`, `src/audio`, `src/session`, `src/content`, `modules/`,
    and other platform leaves.
- TypeScript path aliases cannot bypass the rule.

Pass criteria:

- CI fails if `src/core` imports platform/app code.
- `src/core` tests can run in plain Node/Vitest.

### 4.5 Dev-only logging

The product UI has no diagnostics overlay. Validation uses dev-only logs.

Required coverage:

- Logging is `__DEV__`-gated or otherwise excluded from release behavior.
- Logs record:
  - ASR events and timestamps;
  - cursor index;
  - frozen/recovering state;
  - trigger fires;
  - per-`process()` timing via `performance.now()` or equivalent;
  - lifecycle errors and stop reason.
- Long runs are not truncated by the old 500-event ring-buffer limit; either the
  cap is raised enough for 15-20 minutes or logs flush periodically.

Pass criteria:

- Product session UI remains limited to user-facing controls/status.
- CI or static review can verify logging does not introduce a diagnostics overlay
  or a release-only dependency.

## 5. Native audio module validation

The native audio module is the one thin native module in v1. Its contract is:

```ts
init({ maxVoices });
preload(voices);
play(id);
stopAll();
teardown();
```

Android uses `SoundPool`; iOS uses a preloaded `AVAudioPlayer` pool. JS unit
tests can validate the TypeScript facade and error handling, but they cannot
prove first-audible-sample latency.

Required validation:

- Contract smoke:
  - `init({ maxVoices })` succeeds and enforces a small polyphony cap.
  - `preload` loads all acceptance-book voices.
  - repeated `play(id)` calls are fire-and-forget.
  - overlapping effects play up to `maxVoices`.
  - `stopAll()` stops active effects without unloading.
  - `teardown()` releases native resources and leaves a later init possible.
- Missing/unloaded voice:
  - `play(id)` does not crash;
  - the dev log records the skipped play.
- Acoustic latency:
  - use a P6-style command-to-first-audible-sample probe on physical hardware;
  - treat JS-side timestamps as command timing, not audio-output proof;
  - capture enough repetitions to distinguish latency from one-off jitter.

Pass criteria:

- The S10 native path feels instant enough in the acceptance read-through.
- Acoustic measurements do not regress toward the rejected JS-library range
  (~180-260 ms command -> first audible sample).
- iPhone 12 acoustic measurement is follow-on, not a v1 gate.

## 6. Offline regression guard

The Phase 2 corpus is immutable input. Do not edit `phase2/corpus` for v1. The
Phase 2 matcher lab remains the reference harness for the engine behavior that
v1 productionizes.

Reference commands:

```bash
cd phase2/matcher-lab
npm run replay
npm run replay:human
npm run bench
```

Use these as reference checks:

- `npm run replay` - synthetic carrier replay, P1/P2 reference signal.
- `npm run replay:human` - real adult full-read replay over the S10 Sherpa logs.
- `npm run bench` - offline per-`process()` cost reference.

Important caveat: `npm run replay` writes generated reports (`BASELINE.md` and
`FUZZY.md` in matcher-lab). The eventual v1 implementation should either run it
intentionally as a report-generating step or add a non-mutating guard before
placing replay in CI.

After the v1 engine and compiled acceptance book exist, the regression guard
should compare the ported v1 behavior against the Phase 2 reference:

- in-corridor recovery remains near the Phase 2 real-human signal
  (20/21 = 95.2%);
- false-stale fires remain 0;
- wrong-occurrence fires remain 0;
- repeated-phrase behavior preserves the nearest armed occurrence rule;
- per-`process()` offline cost remains in the same order of magnitude as P4
  (p95 about 3.5 ms on the Mac reference run).

Pass criteria:

- A regression alarm triggers investigation, not automatic v1 rejection.
- A behavior drift caused by the port must be explained before acceptance.
- Phase 2 artifacts stay preserved and reviewable.

## 7. `forceReacquire()` validation

`forceReacquire()` is the only new engine method in the v1 core. It supports the
hidden tap recovery path. The contract is forward-only: it clears freeze and
widens forward search, but never rewinds the monotonic cursor.

Synthetic fixture coverage:

- Frozen state:
  - drive the tracker into hard-freeze with low-confidence chunks;
  - call `forceReacquire()`;
  - assert `frozen` clears or the next process cycle can exit recovering state
    according to the final API shape.
- Forward widened search:
  - freeze at position N;
  - simulate the reader having advanced beyond the normal look-ahead;
  - call `forceReacquire()`;
  - assert a confident forward chunk can advance the cursor and resume arming.
- Monotonic invariant:
  - after `forceReacquire()`, feed earlier book text;
  - assert cursor never decreases.
- No stale fire:
  - expire or pass a trigger before freezing;
  - call `forceReacquire()`;
  - assert the old phrase cannot fire late.
- No wrong repeated occurrence:
  - build a repeated-phrase fixture with at least two future occurrences;
  - force recovery between them;
  - assert only the active/future occurrence can fire.

On-device feel check:

- During an S10 read, intentionally pause/off-script until the app enters
  recovering/frozen behavior.
- Tap the hidden recovery area.
- Continue reading forward.
- Confirm the app resumes on the forward position without a page-late stale fire.

Pass criteria:

- `forceReacquire()` never rewinds the cursor.
- It cannot resurrect expired triggers.
- It improves recovery feel without weakening the Phase 2 wrong-occurrence and
  stale-fire guards.

## 8. PRD Section 8 on-device validation

These are required observations during v1, but only the S10 items are v1-gating.
All measurements use dev-only logs or external tooling, not a product diagnostics
overlay.

### 8.1 S10 production-engine cost

Goal: confirm the production v1 engine cost on Galaxy S10 `SM-G973U` while Sherpa
and UI are active.

Protocol:

- Enable dev logging of every `SessionTracker.process()` call duration.
- Run a real session with Sherpa active and the production controller path.
- Capture p50, p95, max, and sample count.
- Note whether UI interaction or logging visibly affects responsiveness.

Pass criteria:

- p95 remains comfortably below the 5 Hz / 200 ms frame budget.
- Any max outlier is explained as scheduler/GC or investigated if repeated.
- If cost threatens the frame, investigate before acceptance.

### 8.2 15-20 minute battery, thermal, and stability run

Goal: close the P7 caveat with a full-length S10 confirmation run.

Protocol:

- Use Galaxy S10 `SM-G973U`.
- Start battery and thermal readings before the run.
- Run a continuous 15-20 minute Sherpa session.
- Capture recognizer errors/stalls/drops, VAD activity, lifecycle errors, and
  clean stop.
- Capture battery and thermal readings after the run.

Pass criteria:

- No recognizer stall/drop or lifecycle crash.
- Thermal behavior stays in the same safe range as P7.
- Battery drain is acceptable for a normal family reading session.
- Dev log covers the full run; it is not truncated by the old 500-event cap.

### 8.3 Native audio acoustic latency

Goal: verify the native one-shot player does not regress toward the rejected JS
audio paths.

Protocol:

- Preload a short click/effect through the native module.
- Log command timestamps immediately before `play()`.
- Record acoustic output with the S10 or an equivalent physical capture path.
- Analyze command -> first audible sample.

Pass criteria:

- Native output is materially faster and more reliable than the P6 JS-library
  baseline.
- No dropped replays under concurrent mic capture.

### 8.4 iPhone 12 follow-on

The iPhone 12 physical latency run is a follow-on item gated on device access.
It is not a v1 sign-off gate. When available, run the same native-audio contract
and acoustic protocol against the Swift `AVAudioPlayer` pool.

### 8.5 Device workflow gotchas

Carry these forward into any manual protocol:

- Use USB. Do not spend v1 time on wireless adb; the Mac cannot reliably reach
  LAN peers.
- Metro dev builds need:

  ```bash
  adb reverse tcp:8081 tcp:8081
  ```

- For dev-build audio preload, start the session while plugged in, then unplug
  for the sustained run. Re-add `adb reverse` after replugging.
- Pull logs with `run-as`, and guard stdin:

  ```bash
  adb shell run-as <package> cat cache/<file> </dev/null > <local-file>
  ```

- For binary captures, use `adb exec-out run-as ... cat ... </dev/null`.
- Raise the dev logger capacity or flush periodically before long runs.

## 9. Acceptance read-through protocol

The v1 sign-off gate is a structured family read-through, not a lab experiment.

Device:

- Galaxy S10 `SM-G973U`.

Book:

- _Construction Site on Christmas Night_.

Build:

- v1 app with production engine path.
- Sherpa-ONNX streaming zipformer en-20M.
- Native one-shot audio player.
- Compiled locked acceptance-book artifact.
- Dev logging enabled.

### 9.1 Pre-flight

Before the read:

- Confirm the acceptance book appears in the library.
- Confirm all acceptance-book sounds preload successfully.
- Confirm mic permission is granted or the permission path works.
- Confirm the session can start and stop cleanly.
- Confirm dev logs are written to cache and can be pulled.
- If using a dev build, confirm `adb reverse tcp:8081 tcp:8081` before launch.
- Keep the setup practical: phone nearby, screen on, normal room, physical book.

### 9.2 Read-through

During the read:

- Reader reads naturally and looks at the physical book, not the phone.
- Phone sits nearby with the screen awake.
- Use hidden tap recovery only when the app clearly loses its place or freezes.
- Do not pause the read to inspect diagnostics; there is no product overlay.

Operational definition of "feels right":

- Effects land at intended phrases.
- Effects do not arrive page-late.
- Repeated/nearby phrases do not fire the wrong occurrence.
- When the app loses place, it freezes/recovers instead of guessing.
- Hidden tap recovery returns the app to the forward reading position.
- The session stops cleanly.

### 9.3 Artifacts

Capture:

- Dev log for the session.
- Human notes with:
  - missed effects;
  - late effects;
  - wrong effects;
  - freeze/recovery moments;
  - hidden tap use;
  - audio drop/overlap issues;
  - lifecycle errors or interruptions;
  - overall feel.

### 9.4 Decision

Pass:

- The read feels right by the operational definition above.
- No stale/page-late fire undermines trust.
- Hidden tap recovery works when needed.
- Logs do not reveal a severe engine, ASR, or audio stability issue.

Follow up before sign-off:

- Any page-late stale fire.
- Any wrong repeated occurrence.
- Native audio drops or fails to preload.
- Production engine cost threatens the frame budget.
- Session cannot stop/restart cleanly.

Reference alarms only:

- Phase 2 recovery percentage falls below the old 95% reference.
- A single-word trigger such as `deadline` misses due to recognizer onset
  corruption.
- Phrase-end-to-fire timing has a measured outlier that does not affect the
  family read-through.

The reference alarms should trigger investigation and notes. They do not replace
the qualitative S10 acceptance decision.

## 10. Evidence checklist before v1 sign-off

Before calling v1 done, the project should have:

- CI passing for deterministic tests and static checks.
- `src/core` Phase 2 lift tests passing.
- `forceReacquire()` tests passing.
- Content build tests passing, including the golden acceptance-book artifact.
- `SessionController` fake-ASR/fake-audio tests passing with the real tracker.
- `src/core` import-boundary rule passing.
- Native audio contract smoke completed on S10.
- S10 production `process()` timing summarized from dev logs.
- S10 15-20 minute battery/thermal/stability run summarized.
- Offline Phase 2 regression reference checked or intentionally deferred with a
  reason.
- Acceptance read-through dev log and human notes captured.

## 11. References

- PRD: [`11-v1-prd.md`](./11-v1-prd.md)
- Architecture: [`12-v1-architecture.md`](./12-v1-architecture.md)
- Phase 2 runbook: [`06-phase-2-runbook.md`](./06-phase-2-runbook.md)
- Alignment replay results: [`08-alignment-replay-results.md`](./08-alignment-replay-results.md)
- Audio latency results: [`09-audio-latency-results.md`](./09-audio-latency-results.md)
- Sustained session results: [`10-sustained-session-results.md`](./10-sustained-session-results.md)
- Preserved corpus manifest: [`../phase2/corpus/MANIFEST.md`](../phase2/corpus/MANIFEST.md)
- Reference engine: `phase2/matcher-lab/src/engine/`
