# P3 — Forward-only cursor + trigger corridors + arming

Workstream: A | Phase 2 | Run order: after [P2](./P2-fuzzy-matcher.md) | Next: **◆ GATE 1**, then [P4](./P4-matcher-cost.md)

## Goal (one line)
Wrap the fuzzy matcher in a forward-only cursor with armed-trigger corridors so the system holds
position and produces **zero** false-stale and **zero** wrong-occurrence fires.

## Before you start
- **Requires:** [P2](./P2-fuzzy-matcher.md) `done` (≥95% recovery matcher).
- **Consumes:** the fuzzy `Matcher`, harness, and corpus from P1/P2.
- **Read first:** `docs/05-phase-2-plan.md` (§Q3), `docs/02-glossary.md` (cursor, corridor, armed,
  pending, fired, expired, hard-freeze), `docs/research/report-b.md` (§"Trigger firing
  precision", §"Robustness"), `docs/research/report-a.md` (§Q3 "goodnight ×12"),
  `spike/src/books/constructionChristmas.ts` (trigger `wordIndex` values, currently ignored),
  `spike/src/session/SpikeSession.ts` (today's global, cursor-less firing loop).

## Context
The spike fires against *all* triggers globally and ignores `wordIndex`, so the vision's hardest
promise — no stale effects firing a page late, and disambiguating repeated phrases — has never
been tested. This task adds the missing position layer: a monotonic cursor advanced by the
matcher, triggers that arm only when the cursor nears their `wordIndex`, and expiry when the
cursor moves too far past. The book excerpt does **not** contain a true repeated phrase, so you
must synthesize a stress fixture for the goodnight ×12 case.

## Guardrails
- Forward-only: the public cursor never moves backward automatically. Limited backward tolerance
  is for *scoring only*, per the research.
- Minimal hard-freeze is enough (stop advancing + stop arming on low confidence). Do **not** build
  the full confidence-graded state machine, ambient-bed logic, or manual-recovery UI — those are
  out of Phase 2 scope (`docs/05` §Out of scope).
- Still offline, in `phase2/matcher-lab/`. Framework-free.

## Scope — do this
1. Add a forward-only cursor advanced by the P2 matcher over a sliding book-token window.
2. Implement trigger states `pending → armed → fired | expired` keyed off `wordIndex`:
   arm when `cursor >= wordIndex - armLead`; expire when `cursor > wordIndex + maxLookback`
   (phrase-length-aware lookback per report-b starting values).
3. Match armed triggers only against a short recent-token window; nearest-armed-pending wins for
   repeats; add a short per-trigger cooldown as defense-in-depth.
4. Add minimal hard-freeze: when alignment confidence drops, stop advancing the public cursor and
   stop arming new triggers (no guessing).
5. Build a **synthetic repeated-phrase fixture** (e.g. the same trigger phrase at N positions) and
   verify only the in-corridor occurrence fires.
6. Replay the real corpus end-to-end as a full read and count false-stale + wrong-occurrence fires.

## Out of scope
- Confidence-graded UNCERTAIN/LISTENING/LOST states, ambient music, manual recovery UI.
- Native port / perf (P4).
- Real-device capture (P5).

## Done when
- [ ] Full simulated read over the corpus: **0 false-stale fires**, **0 wrong-occurrence fires**.
- [ ] Synthetic repeated-phrase fixture fires only the in-corridor occurrence.
- [ ] Recovery from P2 is preserved (corridor doesn't suppress legitimate fires).
- [ ] Cursor is provably monotonic (never auto-rewinds).

## Output
- Cursor/corridor/arming layer in `phase2/matcher-lab/`.
- Results appended to `docs/08-alignment-replay-results.md`.

## What this leads to
- → **◆ GATE 1** (`docs/06-phase-2-runbook.md`). Evaluate against `docs/05` §Q3.
  - **PASS** → [P4](./P4-matcher-cost.md), then [P5](./P5-gate2-human-read.md).
  - **PARTIAL/FAIL** → apply Q4/Q5 discriminator; insert [P9](./P9-fork-whisper-rework.md) or
    [P10](./P10-fork-phoneme.md).
