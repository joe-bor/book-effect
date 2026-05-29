# P3 — Forward-only cursor + trigger corridors + arming

Workstream: A (Book Effect Phase 2) | Run order: after P2 | Next: **◆ GATE 1**, then P4

> **Self-contained handoff.** This prompt is written so a fresh agent can execute P3 cold. Read
> it fully, then skim the files it points to. Do **not** start P4, P5, or any device work.

## Mission (one paragraph)

Book Effect listens to a parent reading a physical children's book aloud and fires sound effects
when trigger phrases are read. P1 built an offline replay harness (`phase2/matcher-lab`) and P2
built a forgiving phrase matcher that recovers 18/19 known recognizer misses with 0 false fires.
**But P2's "0 false fires" is meaningless for the real risk**, because the recorded corpus is 180
*isolated single-phrase carriers* — each trial contains exactly one trigger phrase, so firing the
wrong trigger is impossible by construction. Your job (P3) is to build the **position layer** that
makes firing trustworthy during a real, continuous read: a forward-only cursor, trigger corridors,
arming/expiry, and a minimal hard-freeze — then prove, on **synthetic full-read fixtures you
create**, that it produces **zero false-stale fires and zero wrong-occurrence fires** (the
"goodnight ×12" problem) while preserving P2's recoveries.

## Start here

- Repo: `book-effect`. Workspace for ALL P3 work: **`phase2/matcher-lab/`** (Node 22.22.1, TS
  strict, vitest, prettier printWidth 100). Do not touch `spike/` (throwaway) or add Expo/RN.
- Commands (run from `phase2/matcher-lab/`): `npm test`, `npm run typecheck`, `npm run format`,
  `npm run replay`.
- Read for context (in this order): this prompt → `docs/08-alignment-replay-results.md` (P1/P2
  results + the isolated-carrier caveat) → `docs/05-phase-2-plan.md` §Decision gates (Q3 defines
  Gate 1) → `docs/02-glossary.md` (cursor, corridor, armed/pending/fired/expired, hard-freeze,
  reacquisition) → research depth: `docs/research/report-a.md` §Q2 (monotonic Smith-Waterman
  ratchet) and `docs/research/report-b.md` §"Position tracking" + §"Trigger firing precision".
- Work test-first (TDD). The repo convention is vitest, one behavior per test, watch it fail
  before implementing. `tsconfig` is strict with `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes`.

## What already exists (reuse it; do not rebuild)

In `phase2/matcher-lab/src/`:

- `matchers/types.ts` — `AsrChunk { kind: 'partial'|'final'; text; wallClock }`,
  `Trigger { id; phrase; wordIndex; type }`, `FireDecision { triggerId; chunkIndex }`,
  `Matcher { name; run(chunks, triggers): FireDecision[] }`.
- `normalize.ts` — `normalizeWords(text): string[]` (lowercase; strips to `[a-z0-9']`; splits on
  whitespace). **Hyphens/parens become token boundaries** (`full-speed` → `full`,`speed`).
- `matchers/tokens.ts` — `charEditDistance`, `fuzzyTokenEqual`.
- `matchers/align.ts` — `phraseEditDistance(target, recent): number` (approx-substring DP with
  adjacent-token merge). **Reuse this for phrase spotting.**
- `matchers/fuzzy.ts` — `editBudget(tokenCount): number` and `FuzzyMatcher` (the P2 windowless
  matcher; `phraseEditDistance(tokens, recent) <= editBudget(tokens.length)` = a hit).
- `corpus/loadCorpus.ts` — `loadCorpus(root): Trial[]`, `defaultCorpusRoot()`. A `Trial` has
  `provider, slug, triggerId, trialNumber, chunks: AsrChunk[], meta {success, latestPartial,
  latestFinal, carrier}, completeness`.
- `replay.ts` / `report.ts` — replay a matcher over trials, score, render.
- `triggers.ts` — `constructionChristmasTriggers`: the 3 triggers
  (`deadline` wordIndex 67 single-word; `massive gift` 121 phrase; `pushes hard to clear the way`
  87 phrase).

## The book model (verified facts you will need)

The book text lives in `spike/src/books/constructionChristmas.ts` (`constructionChristmasBook.text`
is the joined sentences). Tokenizing it with `normalizeWords` yields **exactly 202 tokens**, and
each trigger's `wordIndex` is the index of the **first token of its phrase** in that tokenization
(verified: token 67 = `deadline`, 87 = `pushes`, 121 = `massive`). Copy the book text into
`matcher-lab` (a `book.ts` fixture; cite the source file) — do not import across the spike
boundary — and tokenize it the same way so indices line up.

## Why you must build fixtures (the core constraint)

The recorded corpus (`phase2/corpus/raw`) is **isolated carriers**, not a sequential read, so it
**cannot** exercise cursor advancement, corridors, or wrong-occurrence. You must construct
**synthetic** ASR fixtures that simulate a continuous read of the whole book. Real-human
validation is a later task (P5) — not yours. Build at minimum:

1. **Clean full read-through**: the 202 book tokens streamed as partial/final chunks in order →
   assert all 3 triggers fire, each inside its corridor, cursor advances monotonically to the end.
2. **Realistic full read-through**: the same, but inject the known sherpa miss shapes at the
   trigger positions (`DEAD LINE`, `MASSIVE GUEST`, dropped leading `pushes`) → assert all 3 still
   fire in-corridor (P2 recoveries preserved under the corridor).
3. **Repeated-phrase stress (goodnight ×12 analog)**: a constructed book where one trigger phrase
   appears at several `wordIndex` positions → assert **only the occurrence whose corridor is
   active fires**, exactly once, and earlier/later occurrences do not.
4. **Off-script / silence**: a stretch of non-matching or empty chunks mid-read → assert the
   cursor does not drift forward and no trigger fires (hard-freeze holds).

## What to build (requirements, not a rigid design)

Add a stateful position engine in `matcher-lab` (e.g. `AlignmentEngine` / `SessionTracker`) that
consumes an ordered `AsrChunk[]` against the book + triggers and emits `FireDecision[]`. You have
latitude on the exact algorithm and constants; you must satisfy the Done criteria. Requirements:

- **Forward-only cursor**: a monotonic token index into the book. It advances when recent ASR
  tokens align confidently to a forward window of book tokens (reuse the alignment ideas in
  `align.ts`; a monotonic local alignment over a window of ~120 tokens ahead, ~10 behind, is the
  intended approach per the research). It **never auto-rewinds**; backward tolerance is for
  scoring only.
- **Trigger states** `pending → armed → fired | expired`, keyed by `wordIndex`: arm when
  `cursor >= wordIndex - armLead`; expire when `cursor > wordIndex + maxLookback`. Make lookback
  phrase-length-aware (single word shorter than multi-word; see report-b starting values).
- **Fire rule**: only **armed** triggers are eligible; match them against a short recent-token
  window using `phraseEditDistance` + `editBudget`. For repeated phrases, the **nearest armed
  pending** trigger wins. Each trigger fires at most once; add a short per-trigger cooldown.
- **Minimal hard-freeze**: when alignment confidence stays low for a few updates, stop advancing
  the public cursor and stop arming new triggers (no guessing, no drift). Re-acquire when a
  confident match returns. This is the *only* low-confidence behavior in scope.

## Done criteria (all required; verify by running, not asserting)

- [ ] Clean + realistic full-read fixtures: **all 3 triggers fire in-corridor; 0 false-stale**.
- [ ] Repeated-phrase fixture: **only the in-corridor occurrence fires** (0 wrong-occurrence).
- [ ] Off-script/silence fixture: cursor does not drift; no spurious fire.
- [ ] P2 recoveries preserved (the corridor does not suppress the legitimate fuzzy fires).
- [ ] Cursor is provably monotonic (a test that asserts it never decreases).
- [ ] All new logic is TDD'd (vitest); `npm test`, `npm run typecheck`, `npm run format:check`
      all clean.

## Out of scope (do NOT do these)

- **Matcher JS cost / performance** — that is **P4**, a separate task. Do not benchmark or
  optimize here; correctness only.
- Real human or child speech (P5 / Gate 3). Phoneme matching (P10). Double Metaphone (deferred;
  the edit budget is sufficient on synthetic data — see `docs/08`).
- Ambient-bed music, crossfades, manual-recovery UI, and the full confidence-graded
  UNCERTAIN/LISTENING/LOST state machine — minimal hard-freeze only.
- Any device, Expo, or React Native work. Any change to `spike/`.

## Guardrails

- Offline-only, zero per-session cost, Galaxy S10 is the gating device (informs targets, not your
  code). `matcher-lab` is the workspace; keep modules pure TS, framework-free — the matcher +
  engine are the one thing that may later cross into v1.

## When you finish

- Append a P3 section to `docs/08-alignment-replay-results.md` (what the fixtures showed:
  false-stale = 0, wrong-occurrence = 0, recoveries preserved) and flip P3 to done in
  `docs/06-phase-2-runbook.md`.
- P3 completion triggers the **◆ Gate 1** decision in `docs/06-phase-2-runbook.md` (criteria in
  `docs/05-phase-2-plan.md` §Q3). Do not make the Gate 1 call yourself unless asked — surface the
  numbers and stop.
