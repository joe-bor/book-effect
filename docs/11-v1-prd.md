# Book Effect — v1 Product Requirements (PRD)

Status: Draft for review. Created June 4, 2026. First of the gated v1 docs
(**PRD** → architecture → test plan).

This PRD defines *what* v1 is and the bar for calling it done. It grounds in
[`00-vision.md`](./00-vision.md) and the Phase 2 evidence
([`06`](./06-phase-2-runbook.md), [`08`](./08-alignment-replay-results.md),
[`09`](./09-audio-latency-results.md), [`10`](./10-sustained-session-results.md)).
The *how* — module boundaries, the native player contract, data shapes — is the
architecture doc (next). v1 code waits until the PRD **and** architecture are agreed.

## 1. Overview

Book Effect is a personal, fully-offline mobile app that listens to an adult read a
**known** children's book aloud and fires contextual sound effects at the right phrase.
Reading is **eyes-free**: the phone sits nearby, the reader looks at the physical book.

v1 is a **fresh build** that productionizes the recognition + matching engine validated
in Phase 2. The Phase 1/Phase 2 spike (`spike/`, `phase2/`) is throwaway reference; v1
does not build on it, but reuses the same Sherpa engine and ports the validated matcher
algorithm from `phase2/matcher-lab/src/engine/`.

## 2. Goals

1. **Family magic.** Make reading time with books we already own a little magical —
   effects land at the intended moments, nothing fires a page late.
2. **Learn mobile dev properly.** Expo, native build tooling, on-device testing, audio,
   ASR, TypeScript, and clean architecture. This goal justifies investing in clear module
   boundaries and a real test story even though the app is personal.

## 3. v1 scope (decided)

| Dimension | Decision | Consequence |
| --- | --- | --- |
| **Platform** | Android-only **acceptance gate** (Galaxy S10 `SM-G973U`). Architecture stays cross-platform; the native audio player ships an iOS impl. | iPhone 12 (~1 s) run is a **follow-on, not a v1 gate**. No Android-only APIs that would block an iOS flip later. |
| **Content** | Declarative **multi-book data format** — hand-authored files (book text + trigger list + sound assets). Ships with the one acceptance book; format supports a few more. | No in-app authoring UI. A small build/validation step prepares content. |
| **UI** | Two screens: **library** (pick a book) → **eyes-free session** (start/stop, listening-status indicator, hidden tap-to-recover). | **No diagnostics overlay in the product UI.** On-device validation uses a dev-only logging path. |
| **Recovery** | Hidden tap = **force re-acquire** (re-sync nudge), reusing the engine's freeze/re-acquire path. | No manual per-trigger control, no position-anchor machinery. |
| **Audio** | One-shot preloaded effects, **overlap allowed** (small polyphony cap). | No ambient/background bed, no ducking, no mixing graph. Keeps the one native module thin. |

Two locked architecture constraints carried from Phase 2 (detailed in the architecture doc):
the **matcher stays in JS** (P4: ~56× under the 5 Hz frame), and v1 ships **exactly one thin
native module** — the low-latency one-shot audio player (P6: JS audio libs were 4–5× too slow).

## 4. Usage context

- **One adult reader** at a time, reading aloud at a natural cadence in a quiet-ish room.
- The phone is nearby with the screen on; the reader's hands and eyes are on the book.
- Sessions are a single book, ~5–20 minutes, fully offline, zero per-session cost.
- **Adult speech only.** Child speech is explicitly deferred (Phase 2 Gate 3 / P10 territory).

## 5. Functional requirements

### 5.1 Library
- List the available books (those present in the content data).
- Selecting a book opens its session screen.

### 5.2 Session lifecycle
- **Start:** request microphone permission on first run; preload the selected book's sound
  assets into the native player; initialize and start the Sherpa recognizer; begin listening.
- **During:** the screen stays awake (the hidden tap must remain reachable); a clear but
  unobtrusive status indicator shows *listening* vs *frozen/recovering*.
- **Stop:** halt the recognizer, release/teardown audio, return to an idle state. Stop is
  always available (visible control).

### 5.3 Recognition + matching (productionize the validated engine)
- Stream microphone audio through **Sherpa-ONNX** (streaming zipformer en-20M).
- Feed recognized partials/finals into the **`SessionTracker`** engine ported from
  `phase2/matcher-lab/src/engine/`: fuzzy/token matcher → forward-only (monotonic) cursor →
  per-trigger corridors + arming → fire-once + cooldown → hard-freeze on sustained low
  confidence.
- The matcher runs **in JS**. No native matcher module.
- A trigger fires only when **armed** and matched **in-corridor**; for repeated phrases, the
  nearest armed occurrence wins.

### 5.4 Audio playback (the one native module)
- On an in-corridor fire, play that trigger's preloaded one-shot effect through the native
  low-latency player.
- **Overlap allowed:** multiple effects may sound at once up to a small voice cap, so two
  close-together triggers both play cleanly.
- Effects are **preloaded** at session start (the path that hits the ~50 ms target).
- No background/ambient audio, no ducking in v1.

### 5.5 Recovery
- On sustained low-confidence updates, the engine **hard-freezes**: it stops arming and
  suppresses firing rather than guessing. No stale effect fires.
- The engine **auto-re-acquires** on the next confident match.
- A **hidden tap region** on the session screen forces immediate re-acquire (clears
  low-confidence state and re-scans recent audio against the book to relocate the cursor),
  without waiting for the auto-threshold.

### 5.6 Robustness / error handling
- **Mic permission denied:** show a clear, recoverable message; do not crash; allow retry.
- **Audio interruption** (incoming call, alarm, notification sound): pause/stop the session
  gracefully; on return, the reader can restart or re-acquire.
- **Recognizer or model load failure:** surface a clear error on the session screen; the app
  stays usable (can return to the library).
- **Missing/corrupt sound asset:** caught at the content-validation step (build time)
  wherever possible; at runtime, a missing asset must not crash the session.

### 5.7 Device behavior
- Keep the screen awake for the duration of an active session only.
- Play through the default output route (no Bluetooth/route management in v1).

## 6. Content model

Each book is a small hand-authored data unit:

- **Book text**, tokenized into a stable `wordIndex` space (the cursor/corridor coordinate).
- **Triggers:** an ordered list of `{ phrase, wordIndex, soundAsset }` — the phrase to
  recognize, its anchor position in the book, and the effect to play.
- **Sound assets:** short audio files, preloadable.

Authoring is file-editing. A **content build/validation step** prepares and checks content:
it computes/locks each trigger's `wordIndex` against the book text, verifies every
`soundAsset` exists, and emits **lint warnings** for risky triggers (see §9).

v1 ships with the acceptance book *Construction Site on Christmas Night* authored with
**10–30 triggers**; the format supports adding a few more books by hand.

## 7. Success criteria (acceptance)

**v1 acceptance is qualitative:** v1 is "done" when a real **family read-through of
*Construction Site on Christmas Night* on the Galaxy S10 feels right** — effects land at the
intended moments, nothing fires a page late, and when the app loses its place it freezes
(no stale fire) and recovers via the hidden tap. No formal metric must be hit to sign off.

The Phase 2 numbers below are **expected behavior and regression/diagnostic references** for
the test plan — not the sign-off gate. They describe what "feels right" should look like
under measurement, and flag regressions if a future change degrades the engine:

| Reference signal | Phase 2 result (the bar to not regress below) |
| --- | --- |
| In-corridor trigger recovery on a real adult read | ~95% (Gate 2: 20/21 = 95.2%) |
| False-stale fires | 0 |
| Wrong-occurrence fires | 0 |
| Phrase-end → first audible sample (S10) | ≤ ~1.5 s; phrase triggers clear it comfortably |

iOS: the app **builds and runs on the iPhone 12** with native sound playing — a follow-on
acceptance item, **not a v1 gate** (gated on device access).

## 8. Open validation items (fold into the test plan)

These are not gate-blocking but must be observed during v1. Per the UI decision, they are
measured via a **dev-only logging path** (logs / external tooling), **not** an in-product
overlay:

1. **On-device production-engine cost on the S10.** P4's ~3.5 ms p95 was an offline Mac
   number; confirm the *production* engine's per-eval cost on the S10 while contending with
   Sherpa + UI.
2. **15–20 min battery confirmation run.** Current data is a ~9 min read (~25 %/hr,
   preliminary); confirm acceptable drain over a full-length session.
3. **iPhone 12 physical latency run.** The ~1 s iOS target, gated on device access (P6/P8
   follow-on).

## 9. Non-goals (v1)

- No in-app trigger authoring; no diagnostics overlay in the product UI.
- No ambient/background audio, ducking, or mixing graph.
- **No child-speech tuning** (adult reader only; Gate 3 deferred).
- No reading assessment, scoring, fluency grading, or progress tracking.
- No cloud ASR, sync, accounts, analytics, or usage tracking.
- No App Store release, onboarding flows, marketing, IAP, or content marketplace.
- No multi-user, shared libraries, or scalable content management.
- Not solving every children's book — a few hand-authored books only.

## 10. Known risks / watch-items

- **Single-word triggers are fragile.** Real-read recovery was 86% for `deadline` (onset
  corruption `d → st`, "stead line") vs 100% for the phrase triggers. **v1 mitigation:** the
  content build step emits a **lint warning** on bare single-word triggers; the authoring
  guideline is to prefer multi-word phrases or pair a single word with surrounding context.
  No engine change — this failure is recognition-layer (P9 territory), out of v1 scope.
- **n = 1 reader validated.** Gate 2 was one adult reader, 7 reads. v1's real-use read-throughs
  widen this but it remains a small sample.
- **Device JS-thread cost unconfirmed on-device** (see §8.1) — folded into the test plan, not
  expected to be a problem (even 10× the offline number stays under the frame).
- **Child speech untested** — deferred by design; a later child read is the P10 trigger, not
  a v1 concern.

## 11. Constraints (carried from the vision)

- Offline-only recognition and playback; zero per-session cost.
- Galaxy S10 `SM-G973U` is the gating device; iPhone 12 is secondary.
- Expo prebuild / custom dev client (Expo Go won't run the native ASR/audio libs).
- No paid SDKs or services without explicit approval.

## 12. References

- Vision: [`00-vision.md`](./00-vision.md)
- Phase 2 plan / runbook: [`05`](./05-phase-2-plan.md), [`06`](./06-phase-2-runbook.md)
- Evidence: matcher [`08`](./08-alignment-replay-results.md), audio
  [`09`](./09-audio-latency-results.md), sustained read [`10`](./10-sustained-session-results.md)
- Validated engine to productionize: `phase2/matcher-lab/src/engine/`
- Glossary: [`02-glossary.md`](./02-glossary.md)
