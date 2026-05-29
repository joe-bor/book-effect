# Phase 2 Runbook

Status: Active sequencing guide. Created May 28, 2026.

This is the operational companion to [`05-phase-2-plan.md`](./05-phase-2-plan.md). It tells you
**which prompt to run, in what order, how to tell if its output is done, and whether the result
leads straight to the next prompt or should trigger a fork / inserted task.**

We run everything **sequentially — no parallel work.** Each prompt is a self-contained, scoped
file in [`phase-2-prompts/`](./phase-2-prompts/) that an agent can execute from a fresh context.

## How to use this runbook

1. Run prompts top to bottom in the **Run order** below.
2. After each prompt, check its **Done when** box. If unmet → it "needs more work"; re-run /
   extend the same prompt, do not advance.
3. At each **◆ DECISION GATE**, stop and evaluate against the criteria. The gate tells you
   whether to continue, fork (insert P9/P10), or stop and write product docs.
4. Update the **Status** column as you go (`todo` → `in-progress` → `done` / `needs-more-work`).

## Run order at a glance

| # | Prompt | Workstream | Depends on (must be `done`/PASS) | Status |
|---|--------|------------|----------------------------------|--------|
| 1 | [P0 — Preserve corpus](./phase-2-prompts/P0-preserve-corpus.md) | A0 | — | **done** (`phase2/corpus/`, 365 files; counts validated vs `docs/03`) |
| 2 | [P1 — Replay harness + baseline](./phase-2-prompts/P1-replay-harness.md) | A | P0 | **done** (`phase2/matcher-lab/`; baseline 27/23/21 + 30/30/30, 0 mismatches, 23 tests) |
| 3 | [P2 — Fuzzy / token matcher](./phase-2-prompts/P2-fuzzy-matcher.md) | A | P1 | **done** (179/180 = 99.4%; 18/19 sherpa misses recovered, 0 false fires; see `docs/08`) |
| 4 | [P3 — Cursor + corridors + arming](./phase-2-prompts/P3-cursor-corridors.md) | A | P2 | todo |
| — | **◆ GATE 1 (synthetic replay)** | — | P2, P3 | — |
| 5 | [P4 — Matcher JS cost @ 5Hz](./phase-2-prompts/P4-matcher-cost.md) | A | P2 (ideally P3) | todo |
| 6 | [P5 — Gate 2: real adult read on S10](./phase-2-prompts/P5-gate2-human-read.md) | A | P3 (Gate 1 PASS) | todo |
| — | **◆ GATE 2 (real human read)** | — | P5 | — |
| 7 | [P6 — Audio latency probe](./phase-2-prompts/P6-audio-latency.md) | B | — (device) | todo |
| 8 | [P7 — Sustained continuous read](./phase-2-prompts/P7-sustained-session.md) | C | — (Sherpa path) | todo |
| 9 | [P8 — iOS native unblock](./phase-2-prompts/P8-ios-unblock.md) | D | — | todo |
| ⑂ | [P9 — Whisper rework (FORK)](./phase-2-prompts/P9-fork-whisper-rework.md) | E | inserted by Gate 1/2 | conditional |
| ⑂ | [P10 — Phoneme matching (FORK)](./phase-2-prompts/P10-fork-phoneme.md) | F | inserted by Gate 1/2/3 | conditional |

`P6`, `P7`, `P8` are independent of A and of each other; this order is the recommended
single-threaded sequence (gate-defining work first). If device access is your constraint, you may
reorder P6/P7/P8 among themselves — they do not feed each other.

## Sequence + decision flow

```
 P0 ──► P1 ──► P2 ──► P3 ──► ◆ GATE 1 ──► P4 ──► P5 ──► ◆ GATE 2 ──► P6 ──► P7 ──► P8
preserve replay fuzzy  cursor  synthetic  cost  human   real-human  audio  sustain iOS
 data   +base  matcher corridors PASS?           read    PASS?       latency session unblock
                                   │                       │
                          PARTIAL/FAIL                 FAIL │
                                   ▼                        ▼
                         INSERT P9 (E) or P10 (F)   diagnose: Sherpa-specific → P9
                         per Q4/Q5 discriminator     | text-layer/child       → P10
```

## Per-prompt: done-criteria + what it leads to

### P0 — Preserve corpus (A0)
- **Done when:** the raw `/private/tmp/book-effect-asr-comparison/` logs are copied into a
  committed fixtures dir, with a short manifest mapping each file to provider/trigger/trial.
- **Leads to:** P1, always. No fork. **Urgent** — `/private/tmp` may be cleared on reboot.

### P1 — Replay harness + baseline (A)
- **Done when:** an offline harness replays recorded `asr.partial`/`asr.final` text through a
  pluggable matcher and re-derives trigger fires; running the *current substring matcher*
  reproduces the Phase 1 baseline (deadline 27/30, massive gift 23/30, pushes 21/30, ±small
  margin). If it can't reproduce baseline, the harness is wrong — fix before P2.
- **Leads to:** P2, always.

### P2 — Fuzzy / token matcher (A)
- **Done when:** the new matcher recovers ≥ 95% of triggers across the corpus, and you can name
  which technique fixed each Phase 1 miss class (split compound / substitution / dropped token).
- **Leads to:** P3. If recovery stalls well below 95% → this is the **Gate 1 PARTIAL/FAIL** path;
  go to the Gate 1 decision block before doing anything else.

### P3 — Cursor + corridors + arming (A)
- **Done when:** with cursor + corridor + arming wired, a full simulated read produces **0
  false-stale fires** and **0 wrong-occurrence fires**, including on a synthetic repeated-phrase
  fixture (goodnight ×12 stress case).
- **Leads to:** ◆ GATE 1.

### ◆ GATE 1 — synthetic replay decision
Evaluate against [05 §Q3](./05-phase-2-plan.md#q3--evidence-that-lets-us-keep-sherpa--fuzzy-matching).
- **PASS** (≥95% recovery, 0 false-stale, 0 wrong-occurrence): continue → P4, then P5.
- **PARTIAL/FAIL:** diagnose *where* it fails using the [Q4/Q5 discriminator](./05-phase-2-plan.md#q5--evidence-that-justifies-jumping-to-phoneme-matching-early-f--p10).
  - Sherpa emitted wrong/absent word, Whisper would've nailed it → **INSERT P9** here.
  - Sound was right but text layer mangled it (and it's not engine-specific) → **INSERT P10**.
  - Otherwise: stay in P2, tune thresholds, re-evaluate.

### P4 — Matcher JS cost @ 5Hz (A)
- **Done when:** measured per-eval cost over the corpus at 5 Hz, with a JS-vs-native call. Expect
  < ~1 ms/eval; if it's surprisingly high, that's a finding, not a blocker.
- **Leads to:** P5. No fork (informs v1 architecture later).

### P5 — Gate 2: real adult read on S10 (A)
- **Done when:** the founder reads the actual book on the S10 via the spike (Sherpa), logs are
  pulled, and the P2/P3 matcher is replayed against this fresh **real-human** corpus with recovery
  and false-fire numbers recorded. A clean phrase-end→fire latency delta is captured if feasible.
- **Leads to:** ◆ GATE 2.

### ◆ GATE 2 — real human read decision
- **PASS** (triggers fire in-corridor within ~1.5s, no stale fires): **Sherpa + fuzzy is the v1
  path.** Stop the A track. Continue to P6/P7/P8, then unlock the gated product docs (PRD →
  architecture → test plan).
- **FAIL:** diagnose with the same Q4/Q5 discriminator → **INSERT P9 or P10**. (Child read /
  Gate 3 is deferred; if a later child read collapses, that is the P10 trigger.)

### P6 — Audio latency probe (B)
- **Done when:** true command→first-sample latency is measured for `expo-audio` and
  `react-native-sound` on the S10 (≥30 reps each). iPhone measurement is a follow-on gated on P8.
- **Leads to:** P7. No fork; result decides the v1 playback library and whether a tiny native
  player is needed.

### P7 — Sustained continuous read (C)
- **Done when:** one **unplugged** 15–20 min continuous Sherpa read on the S10 with start/end
  battery %, thermal readings, and a recognizer-stability log (errors, stalls, drops).
- **Leads to:** P8. If severe throttling/drain/recognizer loss appears → insert a mitigation task
  (eco mode / shorter sessions) and note it for v1 scope.

### P8 — iOS native unblock (D)
- **Done when:** the duplicate RNFS symbol is resolved and the spike builds/launches on the
  iPhone 12, **or** a written decision to defer iOS for Phase 2 with the rationale.
- **Leads to:** end of core sequence. Unblocks the iPhone half of P6.

### ⑂ P9 / P10 — conditional forks
Never scheduled up front. Inserted only by a Gate 1 or Gate 2 decision, per the discriminator.
Each has its own internal kill criterion (P9: p95 < 1800ms on S10, or it dies).

## Status legend

- `todo` — not started.
- `in-progress` — running.
- `needs-more-work` — ran, but **Done when** unmet; do not advance.
- `done` — **Done when** met; safe to advance.
- `conditional` — fork; only runs if a gate inserts it.
