import { performance } from 'node:perf_hooks';

import { defaultCorpusRoot, loadCorpus } from '../corpus/loadCorpus';
import { constructionChristmasBookTokens } from '../engine/book';
import { readStream } from '../engine/readStream';
import { DEFAULT_SESSION_OPTIONS, SessionTracker } from '../engine/sessionTracker';
import { summarize, type Summary } from '../stats';
import { constructionChristmasTriggers } from '../triggers';
import type { AsrChunk } from '../matchers/types';

/**
 * P4 — Matcher JS cost at 5 Hz.
 *
 * Times the per-eval wall-clock cost of one full `SessionTracker.process(chunk)` — the whole
 * alignment path (windowed cursor advance + corridor arming/expiry + fuzzy fire matching), not just
 * `FuzzyMatcher.run`. `SessionTracker` is stateful and its cursor is monotonic, so each measured
 * pass starts a fresh tracker and replays the entire chunk stream; per-chunk deltas are pooled
 * across passes for stable p50/p95/max.
 *
 * Headline input is the synthetic full-read fixture (`readStream` over the whole book) so the
 * windowed alignment runs at the real continuous-read window sizes (lookAhead 120 ≈ a full window
 * throughout the book), rather than the isolated carriers which keep the cursor near 0 and
 * under-exercise the work. The recorded corpus is a secondary cross-check.
 */

const SAMPLE_TARGET = 50_000; // pooled per-eval samples for stable tail percentiles
const WARMUP_PASSES = 20; // discarded — let the JIT warm before measuring

const D = DEFAULT_SESSION_OPTIONS;
const FRAME_MS = 1000 / 5; // one 5 Hz frame = 200 ms (the hard ceiling)
const COMFORT_MS = 1; // the §Q3 comfort target: < ~1 ms/eval

/** Replay a chunk stream through a fresh tracker once, pushing each per-eval delta into `out`. */
function timePass(
  book: readonly string[],
  chunks: readonly AsrChunk[],
  out: number[],
  record: boolean,
): void {
  const tracker = new SessionTracker(book, constructionChristmasTriggers);
  for (const chunk of chunks) {
    const t0 = performance.now();
    tracker.process(chunk);
    const t1 = performance.now();
    if (record) out.push(t1 - t0);
  }
}

/** Pool per-eval timings across as many fresh passes as it takes to hit `SAMPLE_TARGET`. */
function benchStream(book: readonly string[], chunks: readonly AsrChunk[]): Summary {
  for (let i = 0; i < WARMUP_PASSES; i += 1) timePass(book, chunks, [], false);
  const samples: number[] = [];
  const passes = Math.max(1, Math.ceil(SAMPLE_TARGET / Math.max(1, chunks.length)));
  for (let i = 0; i < passes; i += 1) timePass(book, chunks, samples, true);
  return summarize(samples);
}

const ms = (n: number): string => n.toFixed(4);

function reportRow(label: string, s: Summary): string {
  return `| ${label} | ${s.count} | ${ms(s.p50)} | ${ms(s.p95)} | ${ms(s.max)} | ${ms(s.mean)} |`;
}

// --- Headline: synthetic full-read fixture -----------------------------------------------------
const book = [...constructionChristmasBookTokens];
const fullReadChunks = readStream(book, 6);
const fullRead = benchStream(book, fullReadChunks);

// --- Secondary cross-check: recorded corpus (isolated carriers, cursor stays near 0) -----------
const trials = loadCorpus(defaultCorpusRoot());
const corpusChunks = trials.flatMap((t) => t.chunks);
// Per-trial fresh trackers, but pooled timings, mirroring how the engine would see each carrier.
for (let i = 0; i < WARMUP_PASSES; i += 1) {
  for (const t of trials) timePass(book, t.chunks, [], false);
}
const corpusSamples: number[] = [];
const corpusPasses = Math.max(1, Math.ceil(SAMPLE_TARGET / Math.max(1, corpusChunks.length)));
for (let i = 0; i < corpusPasses; i += 1) {
  for (const t of trials) timePass(book, t.chunks, corpusSamples, true);
}
const corpus = summarize(corpusSamples);

// --- Output ------------------------------------------------------------------------------------
console.log(`Node ${process.version} · ${process.platform}/${process.arch}`);
console.log(
  `Window sizes (DEFAULT_SESSION_OPTIONS): lookAhead ${D.lookAhead}, recentWindow ${D.recentWindow}, lookBehind ${D.lookBehind}`,
);
console.log(
  `Book: ${book.length} tokens · full-read chunk stream: ${fullReadChunks.length} chunks`,
);
console.log('');
console.log('| Input | n (evals) | p50 ms | p95 ms | max ms | mean ms |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: |');
console.log(reportRow('Synthetic full read (headline)', fullRead));
console.log(reportRow('Recorded corpus (cross-check)', corpus));
console.log('');

// Primary gate is the 5 Hz frame budget (200 ms) with comfortable headroom — NOT the <1 ms
// comfort hypothesis. Report both, and the headroom at p95 and at the worst observed eval.
const frameUseP95 = (fullRead.p95 / FRAME_MS) * 100;
const headroomP95 = FRAME_MS / fullRead.p95;
const headroomMax = FRAME_MS / fullRead.max;
console.log(
  `Headline p95 = ${ms(fullRead.p95)} ms = ${frameUseP95.toFixed(2)}% of one 5 Hz frame (${FRAME_MS} ms) — ${headroomP95.toFixed(0)}x headroom.`,
);
console.log(
  `Worst observed eval = ${ms(fullRead.max)} ms (GC/scheduler outlier) — still ${headroomMax.toFixed(0)}x under the frame.`,
);
const meetsFrame = fullRead.p95 < FRAME_MS; // the gate
const meetsComfort = fullRead.p95 < COMFORT_MS; // the original hypothesis
console.log(
  `Gate (p95 < ${FRAME_MS} ms frame): ${meetsFrame ? 'PASS' : 'FAIL'} → ${meetsFrame ? 'KEEP IN JS for v1' : 'flag for native'}.`,
);
console.log(
  `Comfort hypothesis (p95 < ${COMFORT_MS} ms): ${meetsComfort ? 'met' : 'not met (but immaterial vs the frame budget)'}.`,
);
