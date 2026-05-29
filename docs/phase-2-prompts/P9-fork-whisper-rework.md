# P9 — FORK (E): Whisper realtime rework spike

Workstream: E (conditional) | Phase 2 | **Inserted by a gate, not pre-scheduled**

## When to run this (entry condition)
Insert this **only** when Gate 1 or Gate 2 shows recognition is the wall **and** it is
Sherpa-specific:
- Fuzzy matching ([P2](./P2-fuzzy-matcher.md)) tops out below the experience bar, and the residual
  misses matter; **and**
- The misses are recognition-level (Sherpa emitted a wrong/absent word), not surface text shapes;
  **and**
- On the same audio, Whisper would have recognized it correctly (Phase 1: Whisper scored 30/30).

If instead the sound was right but *any* word-level STT mangles it → run [P10](./P10-fork-phoneme.md),
not this.

## Goal (one line)
Determine whether `whisper.rn` (or an owned realtime pipeline) can be made fast enough on the S10
to be the recognizer, keeping the STT → text → fuzzy architecture intact.

## Before you start
- **Requires:** a gate decision that explicitly inserts this fork, citing the evidence above.
- **Read first:** `docs/05-phase-2-plan.md` (§Q4 — including the internal kill criterion),
  `docs/03-spike-results.md` (§"ASR Latency" — Whisper p95 4.4–8.8s; §"Recognition And Misses" —
  Whisper 30/30; §"Whisper realtime defects"), `spike/src/ui/SpikeScreen.tsx` (the
  `createAsrProvider` comment block documenting the spike's Whisper workarounds:
  `vadInferenceIntervalMs`, `preRecordingBufferMs`, `speechRateThreshold`, `audioSliceSec`),
  `spike/src/asr/WhisperRnProvider.ts`, `docs/research/report-a.md` (§Q1, §Q4 latency budget).

## Context
Whisper recognizes these carriers perfectly but its realtime pipeline fired seconds too late on the
S10 (p95 4.4–8.8s vs the 1.8s target). The Phase 1 settings were spike-scoped survival
workarounds, not a tuned realtime design. This fork asks whether smaller/owned slices, forced
slice advancement, different VAD gating, or replacing `whisper.rn` realtime helpers can bring p95
under target.

## Guardrails — including the kill criterion
- **Internal kill criterion:** if a reworked pipeline cannot reach **p95 < 1800 ms on the S10**,
  this fork **dies** — do not keep polishing it. Escalate to [P10](./P10-fork-phoneme.md) or a
  rescope decision.
- Offline, zero-cost, S10 gate. Treat the spike as throwaway measurement code.
- This is a measurement spike, not a v1 recognizer build.

## Scope — do this
1. Reproduce the Phase 1 Whisper latency on the S10 as a baseline.
2. Try realtime levers one at a time, measuring p50/p95 each: smaller/owned audio slices, forced
   slice advancement on speech-end, alternative VAD gating, removing/replacing slow helpers.
3. After each, re-check recognition didn't regress (replay through the P2/P3 engine).
4. Report the best achievable p95 on the S10 and whether it clears 1800 ms.

## Out of scope
- Productionizing Whisper. Matcher changes (A track owns those). Non-S10 tuning.

## Done when
- [ ] Best reworked Whisper p50/p95 on the S10 reported, with the levers that produced it.
- [ ] Explicit verdict against the 1800 ms kill criterion (clears → Whisper is viable; doesn't →
      fork dies, escalate).
- [ ] Recognition-no-regression confirmed via replay.

## Output
- Whisper-rework results in a dedicated `docs/` results section, cross-linked from
  `docs/06-phase-2-runbook.md`.

## What this leads to
- **Clears 1800 ms** → Whisper becomes a viable v1 recognizer candidate; fold into the gated
  architecture decision.
- **Fails** → escalate to [P10](./P10-fork-phoneme.md) or a rescope (looser latency / shorter
  sessions / fewer triggers per `docs/01-spike-plan.md` decision tree).
