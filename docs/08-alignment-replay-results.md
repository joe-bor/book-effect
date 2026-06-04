# Alignment Replay Results (P1–P5)

Status: in progress. Last updated May 29, 2026 (through P5 / Gate 2).

Offline results from `phase2/matcher-lab` replaying the committed Phase 1 corpus
(`phase2/corpus/raw`) through candidate matchers. Regenerate the numbers with:

```bash
cd phase2/matcher-lab && npm run replay        # P1/P2: writes BASELINE.md and FUZZY.md
cd phase2/matcher-lab && npm run bench         # P4: prints per-eval cost at 5 Hz
cd phase2/matcher-lab && npm run replay:human  # P5: P2/P3 engine over phase2/corpus/real-human
```

Results **P1–P4 below are on synthetic `say -v Samantha` TTS** (the Phase 1 corpus) — the fast
Gate-1 signal only. **§P5 is the first real adult human read** (Galaxy S10, Sherpa), the Gate-2
evidence. Child speech is still deferred to Gate 3.

## P1 — Harness fidelity (baseline substring matcher)

The baseline matcher ports the spike's exact-substring logic verbatim. Replaying it must
reproduce the live Phase 1 counts, proving the harness faithfully replays recorded ASR.

| Provider | deadline | massive-gift | pushes-hard | total |
| --- | ---: | ---: | ---: | ---: |
| sherpa-onnx | 27/30 | 23/30 | 21/30 | 71/90 |
| whisper-rn | 30/30 | 30/30 | 30/30 | 90/90 |

**Fidelity: 0 mismatches** vs recorded `success` across all 180 trials; 0 incomplete trials
(per-trial `eventCount` 8–81, well under the 500 ring-buffer cap). The harness is trustworthy.

## P2 — Fuzzy/token matcher

Algorithm: ordered approximate-substring alignment (Sellers DP) of each trigger phrase against
the normalized recent text, with three tolerances:

- **adjacent-token merge** (up to 3 tokens) — recovers split compounds (`dead line` → `deadline`).
- **length-scaled edit budget** — allowed token edits before a match:

  | Phrase tokens | Edit budget |
  | --- | ---: |
  | 1 (single word) | 0 |
  | 2–3 | 1 |
  | 4–6 | 2 |
  | 7+ | ⌊len/3⌋ |

- **fuzzy single-token equality** — identical or ≤1 character edit counts as the same word;
  larger differences are spent against the budget as substitutions.

### Results

| Provider | deadline | massive-gift | pushes-hard | total |
| --- | ---: | ---: | ---: | ---: |
| sherpa-onnx | 29/30 | 30/30 | 30/30 | 89/90 |
| whisper-rn | 30/30 | 30/30 | 30/30 | 90/90 |

**Total 179/180 (99.4%). 18 of 19 sherpa misses recovered. 0 false fires. 0 regressions.**

### What each technique fixed

| Miss shape | Example (sherpa) | Recovered by |
| --- | --- | --- |
| Split compound | `THE WORD IS DEAD LINE` | adjacent-token merge (edit 0) |
| One-token substitution | `IN HIS WAY A MASSIVE GUEST` | edit budget (1 sub on a 2-token phrase) |
| Split + correct tail | `IN HIS WAY A MASS IS GIFT` | edit budget (massive→mass sub; gift exact) |
| Dropped leading token | `'S HARD TO CLEAR THE WAY` | edit budget (1 drop on a 6-token phrase) |
| Dropped + substitution | `'S HEART TO CLEAR THE WAY` | edit budget (drop + heart/hard sub = 2 ≤ 2) |

### The one remaining miss (the floor)

`sherpa-onnx/deadline` trial 3 recognized only **`"INE"`** — the trigger word's leading syllables
were never emitted. No text-level matcher can fairly recover this; it is a recognition failure,
not a matching failure. We treat 89/90 as effectively ceiling for sherpa on this corpus and do
**not** loosen the single-word budget to force it (that would invite false fires).

### Decision: no phonetic backoff yet

The P2 prompt suggested Double Metaphone. We did **not** implement it: the substitution budget
already absorbs every phonetic miss in this corpus (`guest`/`gift`, `heart`/`hard`) without it, so
per YAGNI it stays out. This is itself evidence for the later phoneme fork (P10): on synthetic
adult TTS, text-level tolerance is sufficient and phonemes are not yet needed. Revisit only if
P5 (real adult) or Gate 3 (child) shows phonetic-class failures the budget cannot catch.

## What P2 does NOT yet prove (read on to P3 / Gate 1)

- **No cursor, corridor, or arming.** The "0 false fires" result is on an **isolated-carrier**
  corpus — each trial contains exactly one trigger phrase, so wrong-occurrence is impossible by
  construction. The real false-stale / goodnight-×12 risk is untested. **P3** adds the
  forward-only cursor + corridors and a synthetic repeated-phrase fixture to test it.
- **No real speech.** Synthetic TTS only; **P5** is the first human read.
- **No matcher cost number.** **P4** measures per-eval cost at 5 Hz.

## P3 — Forward-only cursor + trigger corridors + arming

P2's "0 false fires" was meaningless for the real risk: the recorded corpus is 180 **isolated
single-phrase carriers**, so firing the wrong trigger is impossible by construction. P3 adds the
**position layer** (`phase2/matcher-lab/src/engine/`) and tests it on **synthetic full-read
fixtures** that simulate a continuous read of the whole 202-token book.

Engine (`SessionTracker`): a **forward-only (monotonic) cursor** advanced by a windowed local
alignment of the recent ASR tokens against the book (reusing the P2 Sellers DP, extended to return
the matched end column — `approxSubstringAlign`); per-trigger states `pending → armed → fired |
expired` keyed by `wordIndex` (arm at `cursor ≥ wordIndex − 12`; expire at `cursor > wordIndex +
maxLookback`, phrase-length-aware: 10 single-word / 18 multi-word); a fire rule where only **armed**
triggers match `phraseEditDistance ≤ editBudget` against the recent window and, for repeated
phrases, the **nearest armed** trigger wins (fire-once + per-trigger cooldown); and a **minimal
hard-freeze** that, after 3 low-confidence updates, stops arming and suppresses firing until a
confident match re-acquires. Starting constants follow report-b §Position/Trigger and report-a
§Q2/Q3.

Fixtures are synthetic (token-by-token partials + a final per segment). They are the only way to
exercise cursor advancement, corridors, and wrong-occurrence — the recorded carriers cannot.
Real-human validation is **P5 / Gate 2**, not P3.

### Results (verified by running the engine over each fixture)

| Fixture | Triggers | In-corridor | False-stale | Wrong-occurrence | Cursor |
| --- | --- | --- | --- | --- | --- |
| Clean full read | 3/3 fire | ✅ all | **0** | **0** | monotonic → 202/202 |
| Realistic (sherpa misses injected at triggers) | 3/3 fire | ✅ all | **0** | **0** | monotonic → 202/202 |
| Repeated phrase (goodnight ×12 analog) | 3/3 occurrences | ✅ all | **0** | **0** | monotonic → end |
| Off-script / silence mid-read | n/a during garbage | n/a | **0** | **0** | **drift 0** (froze), then re-acquired |

- **Clean read:** deadline fired at cursor 68 (corridor [55,77]), pushes-hard at 91 ([75,105]),
  massive-gift at 122 ([109,139]) — each armed and not stale.
- **Realistic read (P2 recoveries preserved under the corridor):** the known sherpa miss shapes
  injected at the trigger positions still fire in-corridor — deadline on `"bulldozer's dead line"`
  (split compound via adjacent-token merge), pushes-hard with the leading `pushes` dropped, and
  massive-gift on the `gift`→`guest` substitution. The corridor does not suppress the legitimate
  fuzzy fires.
- **Repeated-phrase stress:** a constructed 52-token book places `"goodnight moon"` at wordIndex
  10 / 26 / 42, spaced wider than the corridor. Exactly **3 fires, one per occurrence**, each in
  its own corridor (cursor 11 / 27 / 43), in order — and a trailing **echo** of the phrase past
  all corridors fires **nothing**. This is the goodnight-×12 guard: only the occurrence whose
  corridor is active fires.
- **Off-script / silence:** a stretch of non-matching and empty chunks mid-read **does not advance
  the cursor (drift 0)** and fires nothing; the engine enters hard-freeze, then re-acquires on the
  next confident read and finishes all three triggers.
- **Monotonicity:** asserted non-decreasing across every fixture, plus a direct unit test that a
  low-confidence jump-back never rewinds the cursor.

P3 added 24 vitest tests (book fixture, `approxSubstringAlign` end column, `SessionTracker`
mechanics, `readStream` synthesis, and the four full-read fixtures). Full suite: **70 passing**;
`npm run typecheck` and `npm run format:check` clean.

### What P3 does NOT prove

- **No real speech.** All fixtures are synthetic; the error shapes are hand-injected from the P1
  sherpa misses. The first human read is **P5 / Gate 2**.
- **No matcher cost number.** Per-eval cost at 5 Hz is **P4** — explicitly out of scope here
  (correctness only).
- Single constant set, not swept; values are research starting points, not tuned against human
  data (that is Gate 2 work).

## P4 — Matcher JS cost at 5 Hz

The Gate-1 cost signal: can v1 keep the full alignment engine in JS, or does it need a native
module? We measure the per-eval wall-clock cost of one whole `SessionTracker.process(chunk)` — the
entire path (windowed cursor advance + corridor arming/expiry + fuzzy fire matching), **not** just
`FuzzyMatcher.run`. Driver: `phase2/matcher-lab/src/cli/benchmark.ts` (`npm run bench`).

**Method.** `SessionTracker` is stateful with a monotonic cursor, so each pass starts a fresh
tracker and replays the entire chunk stream; per-chunk `performance.now()` deltas are pooled across
~210 passes (50 k samples) after a 20-pass JIT warmup. The **headline input is the synthetic
full-read fixture** (`readStream` over the whole 202-token book → 236 chunks) so the windowed
alignment runs at the real continuous-read window sizes, rather than the isolated carriers (which
keep the cursor near 0 and under-exercise the work). Window sizes are `DEFAULT_SESSION_OPTIONS`:
**lookAhead 120, recentWindow 12, lookBehind 10**. The recorded corpus is a secondary cross-check.

### Results (Node v22.22.1, Apple-silicon `darwin/arm64`, offline)

| Input | n (evals) | p50 ms | p95 ms | max ms | mean ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Synthetic full read (headline)** | 50,032 | **2.35** | **3.26** | 22.26 | 2.16 |
| Recorded corpus (cross-check) | 50,040 | 1.00 | 2.76 | 3.42 | 1.32 |

The full read costs more than the isolated carriers because its cursor sits mid-book, so the
alignment window is the full ~120-token `lookAhead` slice throughout; the carriers keep the cursor
near 0 with a shorter window. The full-read number is therefore the honest continuous-read cost.
The `max` is a GC/scheduler outlier, not steady-state.

**Reproduced June 4, 2026** (independent re-run, same machine/Node): headline p50 2.50 ms / p95
3.55 ms; corpus p50 1.02 ms / p95 2.75 ms — steady-state matches the table within run-to-run noise
(only `max` varies, 81 ms this run, confirming it is a GC/scheduler outlier rather than the engine).
The KEEP-IN-JS recommendation is stable across runs.

### Recommendation: **KEEP THE MATCHER IN JS for v1.**

The 5 Hz cadence gives a **200 ms per-frame budget**. Headline **p95 = 3.26 ms = 1.6 % of one
frame — ~61× headroom**; even the worst single eval observed (22.3 ms, a GC/scheduler outlier) is
~9× under the frame. This clears the Gate-1 cost bar decisively. Vision bet #3 holds: no native
matcher module for v1.

- **The <1 ms/eval comfort hypothesis (§Q3) was not met** (p50 2.35 ms), but it is immaterial — it
  was a finger-in-the-air guess; the real budget is the 200 ms frame, which we clear by ~60×.
- **Where the cost lives:** `approxSubstringAlign`'s adjacent-token merge loop does a
  `recent.slice().join('')` allocation **per DP cell** over the ~120-token window — a few thousand
  small allocations per `process()` call. If headroom ever tightened, hoisting that allocation is a
  trivial pure-JS win; we did **not** make it (guardrail: P4 is measurement only, and 60× headroom
  needs no optimization).
- **Device caveat (flag for v1 / P5):** this is an offline Apple-silicon number. The gating
  **Galaxy S10** JS thread is materially slower (single-thread perhaps ~5–10× off an M-series Mac).
  Even at a conservative 10× slowdown, p95 ≈ 33 ms stays comfortably under the 200 ms frame — but
  real on-device JS-thread cost (contending with Sherpa + UI) must be confirmed on the S10 at
  **P5 / Gate 2**; the offline number is the gate, not the final word.

## Gate 1 — PASS (on track); cost confirmation folded into P4

**Call (founder, May 29, 2026): PASS, on track.** On the synthetic recovery + position signals
Gate 1 clears the §Q3 bar, so we **keep Sherpa + fuzzy + cursor** and continue the main line
(P4 → P5); we do **not** open the P9/P10 forks. This is a *PASS-on-track*, not a final PASS: it
rests entirely on synthetic TTS, and the decisive real-human evidence is **P5 / Gate 2**. The
matcher-cost signal is now confirmed (**P4**: p95 3.26 ms, ~61× under the 200 ms frame — keep in
JS). If Gate 2 fails, revisit via the Q4/Q5 discriminator.

Against `docs/05-phase-2-plan.md` §Q3 (synthetic-corpus signals), on **synthetic TTS / synthetic
read-throughs only**:

| §Q3 signal | Bar | P2/P3 result |
| --- | --- | --- |
| Trigger recovery on replay corpus | ≥ 95% | **99.4%** (179/180; P2) |
| Wrong-occurrence fires (goodnight ×12) | 0 | **0** across the full read-through + repeated-phrase fixture (P3) |
| False-stale fires | 0 | **0** across clean / realistic / off-script reads (P3) |
| Matcher cost at 5 Hz | < ~1 ms/eval | **p95 3.26 ms — over the 1 ms guess but ~61× under the 200 ms frame; keep in JS (P4)** |
| Real adult read on S10 | (Gate 2) | **not run — P5** |

All four synthetic §Q3 signals are now green (cost cleared the frame budget with ~61× headroom in
P4); only the real-human signal **P5 / Gate 2** remains. Every number above is on synthetic
`say -v Samantha` TTS and synthetic read-throughs, so it is the fast Gate-1 signal only — which is
why the call above is *on track* rather than final.

## P5 — Real adult human read on the Galaxy S10 (Gate 2 evidence)

The first non-synthetic evidence. One adult read the verbatim book aloud on the gate device
(Galaxy S10 `SM-G973U`) with the **Sherpa** provider; the spike logged the live Sherpa stream. The
**7 continuous full reads** are committed under `phase2/corpus/real-human/` (see the corpus
MANIFEST §Real-human). We then replayed each read's ordered `asr.partial`/`asr.final` through the
**P2/P3 `SessionTracker`** (fuzzy fire + forward-only cursor + corridors, `DEFAULT_SESSION_OPTIONS`)
— `npm run replay:human`.

This is the decisive test the synthetic corpus could not give: real coarticulation, a real human
cadence, real Sherpa errors on a real voice, and a continuous read where the cursor and corridors
must hold against ASR noise across the whole 202-token book.

### Results (7 reads × 3 triggers = 21 occurrences; verified by `npm run replay:human`)

| Trigger | Phrase | Recovery | Phrase-end→fire latency (signed ms) |
| --- | --- | ---: | --- |
| trigger-1 | `deadline` | **6/7 (86%)** | n=6 · p50 62 · p95 2699 · min −1435 · max 3414 |
| trigger-3 | `pushes hard to clear the way` | **7/7 (100%)** | n=7 · p50 −114 · p95 381 · min −375 · max 416 |
| trigger-2 | `massive gift` | **7/7 (100%)** | n=7 · p50 −53 · p95 111 · min −265 · max 120 |

**Total recovery: 20/21 (95.2%). False-stale: 0. Wrong-occurrence: 0.** Every one of the 20 fires
landed **in-corridor** (cursor within `[wordIndex − armLead, wordIndex + maxLookback]`); the cursor
advanced monotonically to the end of the book on all 7 reads.

For comparison, the spike's **live naive exact-substring matcher** fired **19/21** on the same audio
(one read fired only 1/3). The P2/P3 fuzzy+cursor engine recovered **20/21**, catching one of the
two live misses; both miss the same single recognition corruption (below).

### The one miss (the floor, again recognition-layer)

`deadline` in read `…787310` was recognized as **`"STEAD LINE"`** — the recognizer corrupted the
*onset* (`d → st`) **and** split the word. Adjacent-token merge yields `steadline`, which is >1 edit
from `deadline`, and the single-word edit budget is **0** (loosening it invites false fires — see
P2). This is a **recognition failure, not a matching failure**: no fair text-level matcher should
force it. It is the human-voice analog of the synthetic `"INE"` floor (P2), and it is why
`deadline`, a bare single word, is the most fragile trigger.

### Latency — how to read the signed delta (addresses the `docs/03` caveat)

Latency here is `fire-chunk wallClock − phrase-end-cue wallClock`, both on the device clock — i.e.
**how long after the reader finished saying the phrase did the recognized text first cross the
trigger.** This is the first time latency is measured against the actual target definition.

- **Negative is common and good:** the matcher fires off a *partial* the instant the trigger token
  is recognized, often before the reader's manual cue tap lands (human reaction time). The phrase
  triggers are tight — `pushes hard…` p95 381 ms, `massive gift` p95 111 ms — effectively firing at
  phrase-end. (`massive gift` typically fires on a window ending `"…A MASSIVE"`, before `gift` is
  even emitted, via the 1-token edit budget.)
- **`deadline` is noisy** (p95 2699 ms, one 3414 ms outlier): in those reads Sherpa emitted the word
  several seconds late. That is **recognizer emission lag, not matcher cost** (P4 put the matcher at
  p95 3.3 ms). It still fired in-corridor, but the user-perceived latency on a slow single-word
  emission is the real risk to watch on-device.

Excluding the single-word recognizer-lag outliers, every fire is well within the ~1.5 s gate
target; the phrase triggers clear it with room to spare.

### New error shapes not seen in synthetic data (these feed the E-vs-F call)

The synthetic sherpa misses were clean and few (split compound, one 1-token substitution, one
dropped token). Real human + Sherpa added shapes the TTS corpus never produced:

1. **Onset-corruption + split** — `deadline → "stead line"`. Not a clean split (`dead line`, which
   we recover) but the leading phoneme itself wrong, pushing it past the 0-edit single-word budget.
   This is the only miss and the clearest *new* shape.
2. **Pervasive context-word substitution around the trigger** — `Bulldozer's →` "those are's" /
   "while doze are's" / "all those who's" / "pull dozers"; `full tilt →` "fultilt"/"full silt";
   `awesome → "osum"/"autumn"`. Synthetic TTS never garbled neighbors like this. It did **not** cost
   recovery (the trigger *tokens* survived) but it is constant low-grade noise the forward cursor
   had to absorb — and did, without drifting or arming the wrong position.
3. **Repeated-context near-misses survived.** `clear` and `way` recur (`pushes hard to clear the
   way` vs the later `in his way`, `this way and that`, `clears the site`), yet `pushes-hard` fired
   **exactly once, in its corridor** — the first real (non-fixture) wrong-occurrence stress, passed.
4. **Recognizer emission lag** — the multi-second `deadline` delay (#deadline latency above), a
   timing shape absent from the prompt synthetic stream where emission was prompt.

**E-vs-F read:** the only failure is recognition-layer (Sherpa misheard the phonemes), which points
at the Q4/Q5 **recognition wall (P9, Sherpa-specific)** rather than the text/matcher layer (P10) —
consistent with P2's decision not to loosen the single-word budget or add phonetic backoff. The
text-layer tolerance again proved sufficient for everything except a true mis-recognition.

## Gate 2 — PASS (founder call, May 29, 2026)

**Call (founder, May 29, 2026): PASS.** On the first real adult read, **Sherpa + fuzzy + cursor
holds** — kept as the v1 path; the A track is closed and the main line continues to
[P6](./phase-2-prompts/P6-audio-latency.md), with no P9/P10 fork. Recorded in
`docs/06-phase-2-runbook.md` §Gate 2.

Against `docs/05-phase-2-plan.md` §Q3, now on **real adult human speech (Sherpa, S10)**:

| §Q3 / Gate-2 signal | Bar | P5 result (real human) |
| --- | --- | --- |
| Trigger recovery, real adult read | ≥ 95% | **95.2%** (20/21) |
| In-corridor fires within ~1.5 s | yes | **yes** for phrase triggers (p95 ≤ 0.4 s); `deadline` clears it except recognizer-lag outliers |
| False-stale fires | 0 | **0** across all 7 continuous reads |
| Wrong-occurrence fires | 0 | **0** (incl. the repeated `clear`/`way` context) |

All four real-human signals clear the bar, so the founder stamped **PASS** (above): keep Sherpa +
fuzzy + cursor as the v1 path and continue the main line to
[P6](./phase-2-prompts/P6-audio-latency.md) (audio-output latency), **not** open the P9/P10 forks.

Honest caveats carried forward despite the PASS:

- **n = 7 reads, one adult reader** (21 occurrences). A gate signal, not a population study. The
  95.2% sits right on the 95% line — one more `deadline`-style miss would drop it under.
- **`deadline` (single word) is the weak point**: 86% recovery and the multi-second emission-lag
  outliers. If v1 leans on bare single-word triggers, expect this to be the failure mode; the fix is
  recognition-layer (P9), not the matcher.
- **Device JS-thread cost still unconfirmed.** P5 replayed the recorded streams **offline**; the
  P4 device caveat (real on-S10 matcher cost contending with Sherpa + UI) is not yet closed.
- **Child speech (Gate 3) untouched.** This is adult-only.

## P6 — Audio playback-start latency (Workstream B)

Done. Full results in a sibling doc: **[09-audio-latency-results.md](./09-audio-latency-results.md)**.
Headline: neither `expo-audio` nor `react-native-sound` exposes a software first-sample signal, so
latency was measured by acoustic self-capture on the S10. Both land at **~180–260 ms** command →
first-audible-sample (~±40 ms per-run systematic) — 4–5× over the ~50 ms "instant" target. **Native
player required for v1 one-shots.** `react-native-sound` additionally **dropped ~37–41% of one-shot
replays** while the mic was recording (the production condition). iPhone portion pending
[P8](./phase-2-prompts/P8-ios-unblock.md). Leads to [P7](./phase-2-prompts/P7-sustained-session.md).
