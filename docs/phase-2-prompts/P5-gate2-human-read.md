# P5 — Gate 2: real adult human read on the Galaxy S10

Workstream: A | Phase 2 | Run order: after [P4](./P4-matcher-cost.md) | Next: **◆ GATE 2**, then [P6](./P6-audio-latency.md)

## Goal (one line)
Replace synthetic-TTS evidence with reality: capture a real adult reading the actual book on the
S10, then replay the P3 alignment engine against that fresh corpus.

## Before you start
- **Requires:** [P3](./P3-cursor-corridors.md) `done` and **Gate 1 PASS**. ([P4](./P4-matcher-cost.md)
  ideally `done` too.)
- **Consumes:** the alignment engine in `phase2/matcher-lab/`; the spike app (Sherpa provider) to
  capture new logs.
- **Read first:** `docs/05-phase-2-plan.md` (§Q3 Gate 2, §Candor flags — synthetic-TTS caveat),
  `docs/03-spike-results.md` (§"Methodology Notes" — adb log pull, `wallClock` clock), `spike/README.md`
  (Android device run + log pull), `spike/src/books/constructionChristmas.ts` (the book + triggers).

## Context
Every Phase 1 trial used macOS `say -v Samantha` — a clean synthetic adult voice. This is the
first test against a real human. The spike already captures Sherpa logs on the S10; reuse it to
record, pull via adb, and feed the offline harness. This is the gate that decides whether
Sherpa + fuzzy is the v1 path.

## Guardrails
- Reuse the throwaway spike for *capture only*. Do not productionize it.
- S10 is the gate. Offline, zero-cost.
- Read the actual book text and trigger phrases verbatim; do not coach the reading toward the
  matcher.

## Scope — do this
1. On the S10, run the spike with the Sherpa provider and read the full Construction Site excerpt
   aloud at a natural pace, several times (enough trials per trigger for a meaningful rate).
2. Pull the app-private JSON logs via adb (per `spike/README.md` / `03` methodology). Add them to
   `phase2/corpus/` as a clearly labeled **real-human** corpus (separate from the synthetic raw).
3. Replay the P2/P3 engine against the real-human corpus; report per-trigger + total recovery,
   false-stale count, wrong-occurrence count.
4. If feasible, capture a clean phrase-end → first-fire latency delta (addresses the `03` caveat
   that latency was never measured against the exact target definition).
5. Note any *new* error shapes not seen in synthetic data (these inform the E vs F discriminator).

## Out of scope
- Child speech (deferred to Gate 3 — that is the eventual P10 trigger, not this task).
- Audio-output latency (P6), battery/thermal (P7).
- Any v1 product code.

## Done when
- [ ] Real-human corpus captured on the S10 and committed under `phase2/corpus/`.
- [ ] P2/P3 engine recovery + false-stale + wrong-occurrence reported on real-human data.
- [ ] New error shapes (if any) characterized.
- [ ] Phrase-end→fire latency delta captured or its absence explained.

## Output
- `phase2/corpus/real-human/*.json` + manifest entry.
- Results appended to `docs/08-alignment-replay-results.md`.

## What this leads to
- → **◆ GATE 2** (`docs/06-phase-2-runbook.md`, criteria in `docs/05` §Q3).
  - **PASS** (in-corridor fires within ~1.5s, no stale fires) → **Sherpa + fuzzy is the v1 path.**
    Continue to [P6](./P6-audio-latency.md); unlock the gated product docs afterward.
  - **FAIL** → apply Q4/Q5 discriminator → insert [P9](./P9-fork-whisper-rework.md) (Sherpa-specific
    recognition wall) or [P10](./P10-fork-phoneme.md) (text-layer / child wall).
