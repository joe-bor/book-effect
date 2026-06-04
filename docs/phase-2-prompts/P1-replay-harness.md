# P1 — Offline replay harness + baseline reproduction

Workstream: A | Phase 2 | Run order: after [P0](./P0-preserve-corpus.md) | Next: [P2](./P2-fuzzy-matcher.md)

## Goal (one line)
Build a laptop-only harness that replays recorded ASR text through a pluggable matcher and
re-derives trigger fires — and prove it by reproducing the Phase 1 substring-matcher baseline.

## Before you start
- **Requires:** [P0](./P0-preserve-corpus.md) `done` (committed corpus + manifest).
- **Consumes:** `phase2/corpus/raw/*.json`, `phase2/corpus/MANIFEST.md`.
- **Read first:** `docs/05-phase-2-plan.md` (workstream A, Gate 1), `docs/03-spike-results.md`
  (§"Recognition And Misses" — exact expected counts), `spike/src/matcher/naiveMatcher.ts` (the
  current `recent.includes(target)` matcher), `spike/src/session/SpikeSession.ts` (how fires were
  derived live), `spike/src/logging/EventLogger.ts` (event shape + 500-capacity ring buffer).

## Context
Phase 1 derived counted results *live* on-device. To evaluate a *new* matcher we must replay the
recorded `asr.partial`/`asr.final` text events through it offline and re-derive fires, ignoring
the recorded `trigger.fire`. The validation that the harness is faithful: re-running the current
substring matcher must reproduce the Phase 1 counts.

## Guardrails
- **Do not** put this in `spike/` and do not import Expo/React Native. This is a Node + TypeScript
  workspace (e.g. `phase2/matcher-lab/`) so it runs in CI/CLI with no device.
- Keep the matcher behind a small interface so P2 can swap implementations without touching the
  harness. The matcher module is the one piece that may later carry into v1 — keep it clean and
  dependency-light.
- Offline-only, zero-cost.

## Scope — do this
1. Stand up `phase2/matcher-lab/` (TS, strict, its own `package.json`, a `npm test`/`npm run
   replay` script). Reuse `spike`'s `.nvmrc` Node version.
2. Define a `Matcher` interface: feed it the ordered partial/final text stream for a trial plus
   the trigger set; it emits the fire decisions (trigger id + index in the stream where it fired).
3. Port the current substring matcher (`normalizeWords` + `recent.includes(target)`) behind that
   interface as `BaselineMatcher`.
4. Write a corpus loader that reads `phase2/corpus/raw/*.json`, groups events per trial, extracts
   the ordered `asr.partial`/`asr.final` text and the expected trigger from the manifest. Handle
   the EventLogger 500-capacity caveat (flag any truncated trials).
5. Build a scorer that reports per-trigger and total fire counts, plus a miss list with the last
   partial/final text for each miss.
6. Run it and confirm `BaselineMatcher` reproduces Phase 1: deadline 27/30, massive gift 23/30,
   pushes-hard 21/30 (small margin acceptable if you document why).

## Out of scope
- Any fuzzy logic, cursor, or corridor (those are P2/P3).
- Latency analysis (Sherpa already won latency; timestamps may be surfaced but not analyzed here).
- On-device anything.

## Done when
- [ ] `phase2/matcher-lab/` runs offline with `npm run replay`.
- [ ] `BaselineMatcher` reproduces the Phase 1 per-trigger counts (±documented small margin).
- [ ] Scorer outputs per-trigger + total recovery and a miss list with last-text per miss.
- [ ] Truncated/partial trials are flagged, not silently dropped.

## Output
- `phase2/matcher-lab/` (harness, `Matcher` interface, `BaselineMatcher`, loader, scorer).
- A short `phase2/matcher-lab/BASELINE.md` recording the reproduced counts.

## What this leads to
- Always → **[P2](./P2-fuzzy-matcher.md)**. If baseline can't be reproduced, the harness is wrong
  — fix here before P2. No fork.
