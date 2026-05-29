# Alignment Replay Results (P1–P5)

Status: in progress. Last updated May 29, 2026 (through P2).

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

## What P2 does NOT yet prove (reads on to P3 / Gate 1)

- **No cursor, corridor, or arming.** The "0 false fires" result is on an **isolated-carrier**
  corpus — each trial contains exactly one trigger phrase, so wrong-occurrence is impossible by
  construction. The real false-stale / goodnight-×12 risk is untested. **P3** adds the
  forward-only cursor + corridors and a synthetic repeated-phrase fixture to test it.
- **No real speech.** Synthetic TTS only; **P5** is the first human read.
- **No matcher cost number.** **P4** measures per-eval cost at 5 Hz.

**Gate 1 status: not yet evaluable.** Recovery (99.4%) clears the ≥95% bar from
`docs/05-phase-2-plan.md` §Q3, but Gate 1 also requires **0 false-stale and 0 wrong-occurrence
fires on a full read-through**, which only exists after P3. Gate 1 is decided after P3.
