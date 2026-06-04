# P0 — Preserve & version the replay corpus

Workstream: A0 | Phase 2 | Run order: **first** | Next: [P1](./P1-replay-harness.md)

## Goal (one line)
Get the raw Phase 1 counted ASR logs out of `/private/tmp/` and into a committed, documented
fixtures directory before they are lost.

## Before you start
- **Requires:** nothing.
- **Consumes:** `/private/tmp/book-effect-asr-comparison/` (raw counted trial artifacts from
  Phase 1; per `docs/03-spike-results.md` these were collected but never committed).
- **Read first:** `docs/05-phase-2-plan.md` (workstream A0), `docs/03-spike-results.md`
  (§"Device And Build Details", §"Recognition And Misses" — the expected per-trigger counts).

## Context
These logs are app-private JSON event logs pulled from the Galaxy S10 with
`adb ... run-as com.joebor.bookeffect.spike cat cache/<file>`. Each file is an append-only array
of events including `asr.partial`, `asr.final`, `trigger.fire`, and timestamps (`wallClock` is the
reliable cross-event clock; per-event `timestamp` mixes sources). They are the only real Sherpa
error data we have, and `/private/tmp` can be cleared on reboot. This task is data preservation
only — no analysis.

## Guardrails
- Offline-only, zero-cost, S10 is the gate (unchanged).
- This is throwaway-adjacent measurement data, but the fixtures will feed reusable matcher work,
  so store them cleanly and immutably.
- Do not edit/clean the raw logs. Preserve verbatim; do any normalization downstream in P1.

## Scope — do this
1. Inventory `/private/tmp/book-effect-asr-comparison/`: list every file, size, and which
   provider/trigger/trial it represents.
2. Copy them verbatim into a committed location, e.g. `phase2/corpus/raw/` (create the dir).
3. Write a `phase2/corpus/MANIFEST.md` mapping each file → `{ provider, trigger, expected
   phrase, expected wordIndex, Phase 1 counted result }`, cross-checked against the tables in
   `docs/03-spike-results.md`.
4. Note any gaps: trials referenced in `03` but missing on disk, or files present but not counted.
5. Commit on a `chore/phase2-preserve-corpus` branch.

## Out of scope
- Parsing, replaying, or scoring the logs (that is P1).
- Committing model binaries, `.idea/`, `.claude/`, or anything under `/private/tmp` besides the
  counted logs.

## Done when
- [ ] All counted logs copied verbatim into `phase2/corpus/raw/` and committed.
- [ ] `MANIFEST.md` maps every file to provider/trigger/expected/Phase-1-result.
- [ ] Missing-or-extra files explicitly noted.

## Output
- `phase2/corpus/raw/*.json` (verbatim), `phase2/corpus/MANIFEST.md`.

## What this leads to
- Always → **[P1](./P1-replay-harness.md)**. No fork. Update the status row in
  `docs/06-phase-2-runbook.md`.
