# P2 — Forgiving fuzzy / token matcher

Workstream: A | Phase 2 | Run order: after [P1](./P1-replay-harness.md) | Next: [P3](./P3-cursor-corridors.md)

## Goal (one line)
Replace exact substring matching with a forgiving token-level matcher that absorbs Sherpa's three
known error shapes, and push corpus recovery from ~79% to ≥95%.

## Before you start
- **Requires:** [P1](./P1-replay-harness.md) `done` (harness + reproduced baseline).
- **Consumes:** the `Matcher` interface and corpus from P1.
- **Read first:** `docs/05-phase-2-plan.md` (§Q3, §Q4), `docs/03-spike-results.md`
  (§"Recognition And Misses" — the exact miss patterns), `docs/research/report-a.md` (§Q2
  Smith-Waterman + Double Metaphone), `docs/research/report-b.md` (§"Position tracking" two-stage
  matcher), `docs/research/synthesis.md` (the agreed forward-only fuzzy approach).

## Context
Phase 1's misses are all surface-level and named in `03`:
- `DEAD LINE` vs `deadline` — **split compound** (whitespace inserted).
- `MASSIVE GUEST` vs `massive gift` — **one-token substitution** (phonetically near).
- `'S HARD TO CLEAR THE WAY` vs `pushes hard to clear the way` — **dropped leading token(s)**.
A forgiving matcher should recover all three without inventing false fires.

## Guardrails
- Implement the matcher behind the P1 `Matcher` interface; no harness changes needed.
- Keep it pure TS, dependency-light, framework-free — this module may carry into v1.
- This is a matcher, **not** a position engine. No cursor/corridor yet (that is P3). Match against
  a recent-text window only, as the spike did.
- Offline-only, zero-cost.

## Scope — do this
1. Add tolerance for each named miss class:
   - **Split compounds:** compare on a whitespace-collapsed form too (so `dead line` matches
     `deadline`), or allow merging adjacent tokens during alignment.
   - **Substitutions:** ordered token alignment (monotonic DP / Smith-Waterman) scored as
     fraction of expected tokens matched; allow ≤1 substitution for short phrases. Add phonetic
     backoff (e.g. Double Metaphone) so near-homophones count as matches.
   - **Dropped leading/trailing tokens:** subsequence-style scoring where a high fraction of
     expected tokens present *in order* is enough to fire (threshold ~0.7, tune on corpus).
2. Make the fire threshold phrase-length-aware (single-word stricter than multi-word), per the
   research reports.
3. Iterate against the corpus, recording which technique fixes which miss and the false-fire
   count at each threshold setting.
4. Lock in a threshold set and report final per-trigger + total recovery.

## Out of scope
- Cursor, corridors, arming, wrong-occurrence disambiguation (P3).
- Cost/perf measurement (P4).
- Phoneme-level matching on raw audio (that is the P10 fork, not text-level phonetic backoff).

## Done when
- [ ] Total recovery ≥ 95% across the corpus (baseline was ~79%).
- [ ] Each Phase 1 miss class (split / substitution / drop) is demonstrably recovered, with the
      responsible technique named.
- [ ] False-fire count on the corpus is reported (should stay ~0 against the recorded text).
- [ ] Chosen thresholds documented with the recovery they produce.

## Output
- The fuzzy `Matcher` implementation in `phase2/matcher-lab/`.
- Recovery + threshold notes appended toward `docs/08-alignment-replay-results.md` (create if
  absent).

## What this leads to
- **≥95%, ~0 false fires →** [P3](./P3-cursor-corridors.md).
- **Stalls well below 95% →** this is **Gate 1 PARTIAL/FAIL**. Go to the Gate 1 decision block in
  `docs/06-phase-2-runbook.md` and apply the Q4/Q5 discriminator: Sherpa-specific recognition wall
  → insert [P9](./P9-fork-whisper-rework.md); text-layer/child-speech wall → insert
  [P10](./P10-fork-phoneme.md).
