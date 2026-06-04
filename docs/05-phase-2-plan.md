# Phase 2 Plan

Status: Agreed breakdown (planning only). Created May 28, 2026.

This document is the agreed Phase 2 workstream map and decision framework. It is **not** a
PRD, architecture doc, or test plan — those remain gated until Gate 2 passes (see
[Decision gates](#decision-gates)). The operational "what to run, in what order, and how do I
know it's done" guide lives in [`06-phase-2-runbook.md`](./06-phase-2-runbook.md). The scoped,
agent-ready work prompts live in [`phase-2-prompts/`](./phase-2-prompts/).

## Guardrails (carried from Phase 1)

- Do not migrate the spike into v1 product code. `spike/` is throwaway measurement code.
- Offline-only recognition and playback. Zero per-session cost. No paid SDKs.
- Galaxy S10 (`SM-G973U`, serial `RF8M304FJLA`) is the gating device. iPhone 12 is secondary.
- PRD / architecture / test plan are written only after Sherpa + fuzzy matching is confirmed
  on a real human read (Gate 2).

## Founder-friendly framing

Phase 1 taught us three things and left two things untested.

What we know:

- **The ears are fast.** Sherpa-ONNX fires essentially the moment a phrase ends on the S10.
  Speed is no longer the dominant Android risk.
- **The ears mishear in predictable, surface-level ways.** Every Sherpa miss was a *text-shape*
  problem, not a "didn't hear it" problem: `DEAD LINE` (split compound), `MASSIVE GUEST`
  (one wrong word), `'S HARD TO CLEAR THE WAY` (dropped the leading word).
- **Our current matcher is a literal substring test.** `spike/src/matcher/naiveMatcher.ts` is
  `recent.includes(target)`. It cannot survive any of those three error shapes. That is *why*
  Sherpa scored ~79% instead of ~100%.

What we have **not** tested:

1. **A real voice.** Every counted trial used macOS `say -v Samantha` synthetic speech. We have
   zero evidence on a real adult, and less than zero on a child. Recognition numbers are
   optimistic by an unknown margin.
2. **Position tracking.** `spike/src/session/SpikeSession.ts` loops over *all* triggers globally
   and ignores `wordIndex`. There is no cursor, no corridor, no arming. The vision's hardest
   promise — "no stale effects firing a page late," plus disambiguating repeated phrases
   (goodnight ×12) — has had no evidence applied to it at all.

So the real Phase 2 question is not "is Sherpa good?" It is: **can a forgiving alignment layer
turn fast-but-sloppy Sherpa output into reliable, correctly-positioned trigger fires — first on
the recordings we already have, then on a real human, eventually on a child?**

## The risk map

```
  mic ──► VAD ──► Sherpa STT ──► ASR text ──►  ??? ALIGNMENT ??? ──► trigger ──► audio out
  │        │          │             │              │                    │            │
  └─ C ────┴── C ─────┴─ Whisper E? ┘         ┌────┴─────┐              │            └─ B
     (sustained                              MATCHER   CURSOR +         │          (is <50ms
      session:                              robustness  CORRIDORS       │           "instant"
      battery,                              (A: split,  (A: forward-    │           real?)
      thermal,                               sub, drop)  only, arming,  │
      stability)                                         goodnight×12)  │
                                                                        │
          PHASE 1 PROVED ◄──── fast ──────►  │◄═══ THE GAP: ALL OF A ═══►│  ◄─ unproven (B)
          (Sherpa fires near phrase-end)     │   (never built or tested) │
```

Phase 1 measured the left half. The entire middle — the thing that decides whether the product
works — is unbuilt and untested. That is the headline.

## Workstreams

Four core tracks each kill one risk; two conditional forks open only when evidence forces them.
A0–D are independent of each other and can run in any order. We are running everything
**sequentially** (see runbook) — dependencies below are about correctness, not scheduling.

| ID | Workstream | The one risk it kills | Offline? | Needs S10? | Depends on | Output | Prompt |
|----|------------|----------------------|:--------:|:----------:|------------|--------|--------|
| **A0** | Preserve the corpus — copy raw counted logs from `/private/tmp/book-effect-asr-comparison/` into committed fixtures | "We lose the only real ASR-error data we have for free" | ✅ | ❌ | — | Versioned replay fixtures | [P0](./phase-2-prompts/P0-preserve-corpus.md) |
| **A** | Alignment engine — fuzzy/token matcher + forward-only cursor + corridors, scored on the replay corpus | "Can a forgiving matcher absorb Sherpa's errors *and* hold position without stale/wrong fires?" — **#1 product risk** | ✅ (replay) | ❌ → ✅ at Gate 2 | A0 | Reusable matcher module + recovery / false-fire / cost numbers | [P1](./phase-2-prompts/P1-replay-harness.md) [P2](./phase-2-prompts/P2-fuzzy-matcher.md) [P3](./phase-2-prompts/P3-cursor-corridors.md) [P4](./phase-2-prompts/P4-matcher-cost.md) [P5](./phase-2-prompts/P5-gate2-human-read.md) |
| **B** | Audio latency probe — native first-sample timing for `expo-audio` vs `react-native-sound` | "Is the sub-50ms 'instant' bet real?" | ❌ | ✅ (+iPhone) | — | True playback-start latency per library | [P6](./phase-2-prompts/P6-audio-latency.md) |
| **C** | Sustained-session viability — one *unplugged* 15–20 min continuous Sherpa read | "Does the S10 throttle, drain, or drop the recognizer over a real session?" | ❌ | ✅ | Sherpa path | Battery curve, thermal log, stability events | [P7](./phase-2-prompts/P7-sustained-session.md) |
| **D** | iOS native unblock — duplicate RNFS symbol (`react-native-fs` vs `@dr.pogodin/react-native-fs`) | "iOS is dead-on-arrival for the secondary device" | ❌ | ❌ (Mac/iPhone) | — | iOS build runs, or documented deferral | [P8](./phase-2-prompts/P8-ios-unblock.md) |
| **E** ⑂ | Whisper realtime rework (**conditional**) | "Recognition is the wall, and it's Sherpa-specific" | partly | ✅ | A result | p95 latency of reworked Whisper on S10 | [P9](./phase-2-prompts/P9-fork-whisper-rework.md) |
| **F** ⑂ | Phoneme matching (**conditional**) | "Text-level matching fundamentally fails on real/child speech" | partly | ✅ | A + human/child data | phoneme-distance fire rate vs fuzzy | [P10](./phase-2-prompts/P10-fork-phoneme.md) |

**First, and why: Workstream A (P0 → P5).** It is the gate for everything else — you cannot
answer the keep/fork questions below without it; it is the cheapest work you have (laptop,
existing data, seconds-long iteration loop, no device rebuild); it deletes the two most
expensive forks if it passes; and it is the first-ever test of your hardest product promise.

## Decision gates

Pre-register these thresholds **before** running A, so Gate evaluation reads evidence instead of
rationalizing after the fact.

```
                          ┌─────────────────────────────────────────┐
                          │  GATE 1 — Replay (synthetic corpus, A0)   │
                          │  Run fuzzy matcher + cursor + corridor    │
                          │  over the recorded Sherpa transcripts     │
                          └─────────────────────────────────────────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                              ▼                             ▼
   PASS: ≥95% trigger recovery,    PARTIAL: recovers split/sub      FAIL: misses are NOT
   0 wrong-occurrence fires,       but a class of misses survives   surface-recoverable —
   0 false-stale on full read,     (still real misses)              Sherpa dropped the word
   <1ms/eval at 5Hz                          │                       entirely / heard wrong
              │                              │                             │
              ▼                              ▼                             ▼
   ┌─────────────────────────┐    diagnose WHERE it fails  ──────► is it Sherpa-specific?
   │ GATE 2 — Real adult read │              │                  (would Whisper have heard it?)
   │ Founder reads the actual │     ┌────────┴─────────┐         ┌────────┴─────────┐
   │ book on the S10, live    │     ▼                  ▼         ▼ YES              ▼ NO
   └─────────────────────────┘   tune              the sound    OPEN E (P9):      OPEN F (P10):
              │                   thresholds        was right    Whisper rework    phoneme
       ┌──────┴──────┐           on corpus          but text-    (kill if can't    (text layer
       ▼ PASS        ▼ FAIL                         layer mangled p95<1800ms on     can't help)
   KEEP Sherpa+    → diagnose, may                  it (esp.     S10)
   fuzzy. Write    open E or F via                  child speech)
   architecture    same logic as ────────────────────► leads toward F
   + PRD.          right branch
              │
              ▼
   GATE 3 — Child read (deferred): if fuzzy collapses on a kid → this is the phoneme trigger.
```

### Q3 — Evidence that lets us KEEP Sherpa + fuzzy matching

| Signal | Bar |
|--------|-----|
| Trigger recovery on replay corpus | ≥ 95% (exact-matcher baseline was 71/90 ≈ 79%; all misses were surface-recoverable) |
| Wrong-occurrence fires (goodnight ×12 class) | **0** across a full simulated read-through |
| False-stale fires (the vision's hard guardrail) | **0** |
| Matcher cost at 5 Hz | < ~1 ms/eval (confirm, do not assume) |
| Then: real adult read on S10 (Gate 2) | Triggers fire inside the corridor, within ~1.5s, no stale fires |

### Q4 — Evidence that FORCES a Whisper realtime rework track (E / P9)

| Signal | Bar |
|--------|-----|
| Fuzzy matcher tops out **below** the experience bar on the corpus | And the residual misses matter (key effects missed / stale fires) |
| Residual misses are **recognition-level**, not text-shape | Sherpa emitted a wrong/absent word, not a recoverable variant |
| Failure is **Sherpa-specific** | On the same audio, Whisper got it right (scored 30/30) — better STT, not better matching, is the fix |
| Internal kill criterion for E | Reworked slice/VAD pipeline must hit **p95 < 1800ms on the S10**, else E dies → go to F or rescope |

E keeps the STT → text → fuzzy architecture and bets a better recognizer fixes it. Only justified
if the wall is recognition quality *and* Whisper's latency is plausibly beatable.

### Q5 — Evidence that justifies JUMPING to phoneme matching early (F / P10)

| Signal | Bar |
|--------|-----|
| Fuzzy + phonetic backoff **collapses on real human / child speech** | Reader said it correctly-enough, text layer still misses a large fraction |
| Failure is **not** STT-engine-specific | Both Sherpa and Whisper would mangle it |
| Failure clusters on phoneme-fixable cases | Mispronunciations, near-homophones metaphone can't catch, child phonology |

This is Novel Effect's documented reason for bypassing STT (see `research/report-a.md`). **But we
have no human or child data yet** — the carriers were synthetic TTS. Phoneme is justified by
Gate 2/Gate 3 evidence, not by anything we have today.

**Discriminator between E and F — where does Sherpa + fuzzy fail?**
- Wrong text, but Whisper got it right, and Whisper can be made fast → **E**.
- Right sound, but *any* word-level STT mangles it (esp. kids) → **F**.
- Hasn't failed yet because all data is synthetic → **fork nothing; get human data (P5).**

## Out of scope for Phase 2

| Out of scope | Why |
|--------------|-----|
| PRD, architecture doc, test plan | Gated on passing Gate 2 — they describe a thing not yet proven to exist |
| Migrating the spike into v1 product code | Spike is throwaway; only the matcher *algorithm* may cross over |
| A native matcher module | Vision bet: JS until data proves otherwise. Measure cost (P4) first |
| Trigger-authoring UI, multiple books, content pipeline | One hand-authored book answers every Phase 2 question |
| iOS as a Phase 2 *gate* | S10 is the gate. D is unblock-or-defer, not a success criterion |
| Ambient-bed music, crossfades, tuned confidence state machine | v1 polish. Phase 2 needs only minimal hard-freeze to test the guardrail |
| Predictive early-fire / latency micro-optimizations | Sherpa already won latency; optimizing it is wasted motion |
| Paid SDKs (Picovoice, KeenASR), cloud, accounts, analytics, store/TestFlight | Violates offline-only / zero-cost / non-goals |
| Reading assessment / scoring | Permanent non-goal |

## Docs to create next, in order

| Order | Doc | When | Why |
|------:|-----|------|-----|
| 1 | `05-phase-2-plan.md` (this doc) + `06-phase-2-runbook.md` | Now (breakdown agreed) | The guardrail-permitted planning artifacts |
| 2 | `07-decision-gates.md` (optional split of the gate tables) | Before running A, if more detail needed | Pre-register thresholds honestly |
| 3 | `08-alignment-replay-results.md` | After P2/P3 run | Evidence record that triggers keep/E/F |
| 4 | PRD → architecture → test plan | Only after Gate 2 passes | Don't document an unproven product |

Keep `02-glossary.md` living — add `arming`, `corridor`, `replay corpus`, `phonetic backoff` as
P2/P3 make them concrete.

## Candor flags

- **Sherpa's latency was never measured against the exact target definition** ("phrase-end to
  first audible sample"). Host-end latency is a proxy with caveats (separate clocks, AIFF
  trailing silence). Likely fine; P5/P6 should capture a clean phrase-end→fire delta on a real
  read if we want the vision number defended.
- **The 50ms audio bet is the most under-tested assumption** (P6). Reports A and B disagree;
  Phase 1 only proved play calls *resolve*. "Magical" lives or dies here.
- **Do not let A balloon into a v1 engine.** Its job is a decision, not a product. A reusable
  matcher *module* is a fine byproduct; a state-machine framework is scope creep.
