# Phase 2 Replay Corpus — Manifest

Preserved by P0 ([`docs/phase-2-prompts/P0-preserve-corpus.md`](../../docs/phase-2-prompts/P0-preserve-corpus.md)).
Created May 29, 2026.

This is the verbatim, immutable copy of the Phase 1 counted ASR comparison artifacts. It is the
input for the P1 offline replay harness. **Do not edit these files** — any normalization happens
downstream in `phase2/matcher-lab/` (P1).

## Provenance

- Source: `/private/tmp/book-effect-asr-comparison/` (was uncommitted; see `docs/03-spike-results.md`
  §"Device And Build Details").
- Device: Samsung Galaxy S10 `SM-G973U`, ADB serial `RF8M304FJLA`.
- Capture window: May 28, 2026, ~18:32–20:04 UTC.
- Carrier playback method: macOS `say -v Samantha -r 130 -o <file>.aiff` pre-rendered each phrase,
  then `afplay -v 1` through the Mac speaker (same method for both providers).
- Audio provider during capture: `expo-audio`. ASR providers: `sherpa-onnx`, `whisper-rn`.
- Copied verbatim: 365 files in, 365 files out (`cp -R`).

> ⚠️ **All speech is synthetic TTS (`say -v Samantha`), not a real human and not a child.** This
> corpus is the fast Gate-1 signal only. Real-human evidence is captured separately in P5
> (Gate 2); child speech is deferred (Gate 3). See `docs/05-phase-2-plan.md` §Candor flags.

## Directory layout

```
phase2/corpus/raw/
├── aggregate-summary.json        cross-provider rollup (both providers, 180 trials)
├── run-summary.json              LAST run only (whisper-rn, 90 trials) — see note below
├── carriers/                     stimulus audio (the exact phrases played)
│   ├── deadline.aiff
│   ├── massive-gift.aiff
│   └── pushes-hard.aiff
├── sherpa-onnx/<trigger>/trial-NN.json            app event log (replay input)
├── sherpa-onnx/<trigger>/trial-NN.metadata.json   harness-side ground truth
└── whisper-rn/<trigger>/  ... same shape ...
```

Each provider has 3 triggers × 30 trials × 2 files (log + metadata) = 180 files.

## File formats

**`trial-NN.json`** — append-only array of app events. The P1 replay input. Event types include
`session.start`, `asr.vadStart`, `asr.partial` (`payload.text`), `trigger.fire` (`triggerId`),
`asr.final`, `asr.vadEnd`, `session.stop`. **Use `wallClock` (ISO) for cross-event timing**;
per-event `timestamp` mixes clock sources (per `docs/03`). To evaluate a *new* matcher, replay the
ordered `asr.partial`/`asr.final` `payload.text` and ignore the recorded `trigger.fire`.

**`trial-NN.metadata.json`** — harness ground truth per trial: `provider`, `phraseSlug`,
`triggerId`, `carrier` (spoken sentence), `trialNumber`, `success` (bool), `latestPartial`,
`latestFinal`, `hostEndToTriggerMs`, `vadStartToTriggerMs`, `stopDurationMs`, `providerErrors`,
`eventCount`, and the original on-device `cacheFilename`.

## Trials and counted results (validated against `docs/03`)

`wordIndex` is from `spike/src/books/constructionChristmas.ts`. The counted result column was
recomputed here from `success: true` in the metadata and **matches the published `docs/03` table
exactly**.

| Provider | Trigger | id | Expected phrase | wordIndex | Carrier (spoken) | Counted | Provider errors |
|----------|---------|----|-----------------|----------:|------------------|--------:|----------------:|
| sherpa-onnx | deadline | trigger-1 | `deadline` | 67 | "the word is deadline" | **27/30** | 0 |
| sherpa-onnx | massive-gift | trigger-2 | `massive gift` | 121 | "in his way a massive gift" | **23/30** | 0 |
| sherpa-onnx | pushes-hard | trigger-3 | `pushes hard to clear the way` | 87 | "working at full speed all day he pushes hard to clear the way" | **21/30** | 0 |
| whisper-rn | deadline | trigger-1 | `deadline` | 67 | "the word is deadline" | **30/30** | 0 |
| whisper-rn | massive-gift | trigger-2 | `massive gift` | 121 | "in his way a massive gift" | **30/30** | 0 |
| whisper-rn | pushes-hard | trigger-3 | `pushes hard to clear the way` | 87 | "working at full speed all day he pushes hard to clear the way" | **30/30** | 0 |

Sherpa total: 71/90 (≈79%) — the P1 fuzzy-matcher baseline to beat (target ≥95%, `docs/05` §Q3).

## Summary files

- `aggregate-summary.json` — **authoritative cross-provider rollup**: `{ root, total: 180,
  groups: { sherpa-onnx, whisper-rn } }`, each group keyed by trigger.
- `run-summary.json` — covers **only the last (whisper-rn) run**: `generatedAt` 20:04 UTC,
  `trials` (90 = whisper × 3 triggers × 30), with per-trial latency arrays under `totals`. It is
  **not** a cross-provider summary; this is a scope difference, not a missing-data gap. For
  cross-provider numbers use `aggregate-summary.json` or recompute from the trial metadata.

## Completeness

- **No truncation.** Per-trial `eventCount`: sherpa 8–16, whisper 52–81 — all far below the
  EventLogger 500-event ring-buffer cap. Every trial ends with a stop / `log.localSave.requested`
  event, indicating complete logs. (P1 should still assert this programmatically.)
- 0 provider errors across all 180 trials (both providers).

## Known gaps / what is NOT here

- **No real-human or child speech** — synthetic TTS only (P5 / Gate 2 / Gate 3 close this).
- **No iOS data** — iOS build is blocked (duplicate RNFS symbol; `spike/README.md`, P8).
- **No true audio first-sample latency** — `hostEndToTriggerMs` is a Mac-clock proxy with caveats
  (separate clocks, AIFF trailing silence); P6 measures real playback-start latency.
- **No matcher JS-cost data** — P4 measures it.
- Carriers are committed as stimulus documentation; the replay harness (P1) operates on the
  recorded text and does not need the AIFFs.
