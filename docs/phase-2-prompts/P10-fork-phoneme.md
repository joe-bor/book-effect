# P10 — FORK (F): Phoneme matching exploration

Workstream: F (conditional) | Phase 2 | **Inserted by a gate, not pre-scheduled**

## When to run this (entry condition)
Insert this **only** when text-level matching fundamentally fails on real speech, independent of
the STT engine:
- Fuzzy + phonetic backoff ([P2](./P2-fuzzy-matcher.md)) collapses on a **real human / child** read
  (the reader said it correctly-enough, but the text layer still misses a large fraction); **and**
- The failure is **not** Sherpa-vs-Whisper engine quality (both word-level STTs would mangle it);
  **and**
- The misses cluster on phoneme-fixable cases: mispronunciations, near-homophones metaphone can't
  catch, child phonology.

If instead Whisper would have recognized it correctly → run [P9](./P9-fork-whisper-rework.md). If
no real-human data exists yet → run [P5](./P5-gate2-human-read.md) first; do not fork on synthetic
data.

## Goal (one line)
Test whether phoneme-distance matching (the Novel Effect approach) recovers triggers that word-level
STT + fuzzy text matching cannot, on real/child speech.

## Before you start
- **Requires:** a gate decision inserting this fork, citing the evidence above — ideally backed by
  a real-human ([P5](./P5-gate2-human-read.md)) or child corpus.
- **Read first:** `docs/05-phase-2-plan.md` (§Q5, §discriminator), `docs/research/report-a.md`
  (§Q5 + Key Findings — Novel Effect patents US 11,526,671 / US 12,315,533 compute phoneme edit
  distance and deliberately avoid speech-to-text; Vosk exposes phoneme-level Kaldi output; cmudict
  for grapheme-to-phoneme on book text), `docs/research/synthesis.md` (phoneme as the v2
  robustness moat), `docs/02-glossary.md` (Phonetic Backoff).

## Context
Novel Effect bypasses STT entirely and matches phonemes directly, which is their documented answer
to exactly the child-speech / accent robustness problem. This fork explores whether a
phoneme-distance layer (e.g. phoneme output from a Vosk-class recognizer, compared against
cmudict-derived book phonemes) beats text matching where text matching has provably failed.

## Guardrails
- Offline, zero-cost — **must** stay free/OSS. KeenASR (Novel Effect's engine) and other paid SDKs
  are out of bounds without explicit approval (`docs/00-vision.md` constraints).
- This is an evidence spike comparing phoneme-distance vs fuzzy-text recovery on the **same** failing
  corpus — not a v1 phoneme-engine build.
- Note the patent caveat in `report-a.md` §Caveats; this is research, not a shipping decision.

## Scope — do this
1. Assemble the failing corpus from the gate that triggered this fork (the real/child reads where
   fuzzy text matching missed).
2. Stand up a free phoneme path: a recognizer that emits phonemes + cmudict grapheme-to-phoneme on
   the book/trigger text.
3. Compute phoneme edit distance for the failing triggers; compare recovery vs the P2/P3 fuzzy-text
   engine on the identical corpus.
4. Report whether phonemes recover the failures text matching couldn't, and at what latency/cost on
   the S10 (so we know if it's even viable on the gate device).

## Out of scope
- Building the v1 phoneme engine. Paid SDKs. Replacing the A track wholesale before the evidence
  justifies it.

## Done when
- [ ] Phoneme-distance recovery measured on the same corpus where fuzzy text failed.
- [ ] Side-by-side recovery (phoneme vs fuzzy) reported, with the specific cases phonemes fixed.
- [ ] S10 latency/cost feasibility of the phoneme path noted.

## Output
- Phoneme-vs-fuzzy comparison in a dedicated `docs/` results section, cross-linked from
  `docs/06-phase-2-runbook.md`.

## What this leads to
- **Phonemes clearly win on real/child speech** → phoneme matching becomes the v1 (or fast-follow)
  direction; fold into the gated architecture decision.
- **No meaningful gain** → stay on Sherpa + fuzzy; document that text matching was sufficient and
  phoneme is deferred to a true v2.
