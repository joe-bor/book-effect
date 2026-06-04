# P4 — Matcher JS cost at 5 Hz

Workstream: A | Phase 2 | Run order: after [P3](./P3-cursor-corridors.md) | Next: [P5](./P5-gate2-human-read.md)

## Goal (one line)
Measure the per-evaluation cost of the full matcher + cursor + corridor at the spike's 5 Hz cadence
and decide whether v1 can keep it in JS or needs a native module.

## Before you start
- **Requires:** [P3](./P3-cursor-corridors.md) `done` (full alignment engine). P2 is the minimum,
  but measure the P3 engine since that is what v1 would run.
- **Consumes:** the P3 engine `SessionTracker` (`phase2/matcher-lab/src/engine/sessionTracker.ts`)
  + the synthetic full-read fixtures (`readStream`, `book.ts`) + corpus in `phase2/matcher-lab/`.
- **Heads-up on the harness:** `SessionTracker` is **not** a `Matcher` — it exposes
  `process(chunk)` + getters, not `run(chunks, triggers)`. The existing `replay.ts` harness only
  drives `Matcher.run`, so it **does not apply here**; write a small standalone benchmark driver
  around `SessionTracker.process()`.
- **Read first:** `docs/05-phase-2-plan.md` (§Out of scope — "native matcher module"),
  `docs/00-vision.md` (the bet: JS matcher unless data proves it risks UI/latency),
  `docs/03-spike-results.md` (§"Matcher JS Cost" — currently unmeasured).

## Context
Vision bet #3: keep the matcher in JS for v1 unless logs prove it's a bottleneck. Phase 1 never
instrumented this. A token-DP over a ~120-token window at 5 Hz should be sub-millisecond, but that
is a hypothesis until measured.

## Guardrails
- Measurement only. Do **not** start a native rewrite — the decision is the deliverable.
- Offline benchmark is sufficient for the headline number; note that real-device JS-thread cost can
  differ and flag it for v1.

## Scope — do this
1. Instrument the per-eval wall-clock cost of one full `SessionTracker.process(chunk)` — the whole
   path (cursor alignment + corridor arming/expiry + fire matching), not just `FuzzyMatcher.run`.
2. Drive it with the **synthetic full-read fixtures** (`readStream` over the book) so the windowed
   alignment runs at the full window sizes a real continuous read uses, rather than the short
   isolated carriers (which keep the cursor near 0 and under-exercise the work). Report p50/p95/max
   per-eval cost and the `DEFAULT_SESSION_OPTIONS` window sizes used (lookAhead 120, recentWindow
   12, lookBehind 10). The corpus can be a secondary cross-check, not the headline input.
3. State a clear recommendation: keep in JS for v1, or flag for a native module — with the number
   that justifies it (e.g. p95 well under one 5 Hz frame = 200 ms, with comfortable headroom).

## Out of scope
- Native (Swift/Kotlin) implementation.
- On-device measurement (offline number is the gate; device caveat noted only).

## Done when
- [ ] p50/p95/max per-eval cost reported at 5 Hz with window sizes documented.
- [ ] Explicit JS-vs-native recommendation with the justifying number.

## Output
- Cost numbers + recommendation appended to `docs/08-alignment-replay-results.md`.

## What this leads to
- Always → [P5](./P5-gate2-human-read.md). No fork; this informs the (gated) v1 architecture doc.
