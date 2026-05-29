# Alignment Replay Results (P1–P5)

Status: in progress. Last updated May 29, 2026 (through P3).

Offline results from `phase2/matcher-lab` replaying the committed Phase 1 corpus
(`phase2/corpus/raw`) through candidate matchers. Regenerate the numbers with:

```bash
cd phase2/matcher-lab && npm run replay   # writes BASELINE.md and FUZZY.md
```

All results below are on **synthetic `say -v Samantha` TTS** (the Phase 1 corpus). No human or
child speech yet — that is P5 (Gate 2) / Gate 3. Treat these as the fast Gate-1 signal only.

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

## Gate 1 — PASS (on track); cost confirmation folded into P4

**Call (founder, May 29, 2026): PASS, on track.** On the synthetic recovery + position signals
Gate 1 clears the §Q3 bar, so we **keep Sherpa + fuzzy + cursor** and continue the main line
(P4 → P5); we do **not** open the P9/P10 forks. This is a *PASS-on-track*, not a final PASS: it
rests entirely on synthetic TTS, the matcher-cost signal is confirmed in **P4**, and the decisive
real-human evidence is **P5 / Gate 2**. If P4 shows cost is not sub-frame, or Gate 2 fails, revisit
via the Q4/Q5 discriminator.

Against `docs/05-phase-2-plan.md` §Q3 (synthetic-corpus signals), on **synthetic TTS / synthetic
read-throughs only**:

| §Q3 signal | Bar | P2/P3 result |
| --- | --- | --- |
| Trigger recovery on replay corpus | ≥ 95% | **99.4%** (179/180; P2) |
| Wrong-occurrence fires (goodnight ×12) | 0 | **0** across the full read-through + repeated-phrase fixture (P3) |
| False-stale fires | 0 | **0** across clean / realistic / off-script reads (P3) |
| Matcher cost at 5 Hz | < ~1 ms/eval | **not measured — P4** |
| Real adult read on S10 | (Gate 2) | **not run — P5** |

Three of the four synthetic §Q3 signals are green; the cost signal is **P4** and the real-human
signal is **P5 / Gate 2**. Every number above is on synthetic `say -v Samantha` TTS and synthetic
read-throughs, so it is the fast Gate-1 signal only — which is why the call above is *on track*
rather than final.
