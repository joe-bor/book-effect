import type { HumanRead } from './corpus/loadHumanReads';
import {
  DEFAULT_SESSION_OPTIONS,
  SessionTracker,
  type SessionOptions,
} from './engine/sessionTracker';
import type { Trigger } from './matchers/types';

// Replay the P2/P3 alignment engine (SessionTracker: fuzzy fire + forward-only cursor + corridors)
// over P5 real-human continuous reads, and score it the way the Gate-2 criteria are stated:
// recovery, false-stale, wrong-occurrence, and a phrase-end -> first-fire latency delta.

export type TriggerOutcome = {
  triggerId: string;
  phrase: string;
  wordIndex: number;
  fired: boolean;
  /** Cursor position when it fired (cursorHistory[chunkIndex]). */
  cursorAtFire?: number;
  /** Index into the read's chunk stream where the fire happened. */
  chunkIndex?: number;
  /** Whether cursorAtFire sat inside [wordIndex - armLead, wordIndex + maxLookback]. */
  inCorridor: boolean;
  /** ASR text on the firing chunk — for eyeballing real-human recognition shapes. */
  recognizedAtFire?: string;
  /** fireWallClock - cueWallClock in ms (signed). Undefined if either is missing. */
  latencyMs?: number;
};

export type ReadOutcome = {
  id: string;
  ok: boolean;
  issues: string[];
  triggers: TriggerOutcome[];
  /** Fires beyond the one legitimate occurrence per trigger in this read (wrong-occurrence). */
  extraFires: number;
  /** Concatenated final transcript, for error-shape inspection. */
  finalsTranscript: string;
};

export type LatencyStats = {
  n: number;
  p50?: number;
  p95?: number;
  min?: number;
  max?: number;
  mean?: number;
};

export type PerTrigger = {
  triggerId: string;
  phrase: string;
  fired: number;
  total: number;
  recoveryPct: number;
  latency: LatencyStats;
};

export type HumanReplayReport = {
  reads: ReadOutcome[];
  perTrigger: PerTrigger[];
  totalFired: number;
  totalOccurrences: number;
  recoveryPct: number;
  falseStaleCount: number;
  wrongOccurrenceCount: number;
  latencyOverall: LatencyStats;
};

const maxLookbackFor = (trigger: Trigger, opts: Required<SessionOptions>): number =>
  trigger.type === 'single-word' ? opts.maxLookbackSingleWord : opts.maxLookbackPhrase;

// Triggers in reading order (by position in the book). A front-to-back read hits them in this
// order, so the k-th phrase-end cue corresponds to the k-th trigger here.
const readingOrder = (triggers: readonly Trigger[]): Trigger[] =>
  [...triggers].sort((a, b) => a.wordIndex - b.wordIndex);

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo] as number;
  const w = rank - lo;
  return (sorted[lo] as number) * (1 - w) + (sorted[hi] as number) * w;
}

function latencyStats(values: number[]): LatencyStats {
  if (values.length === 0) return { n: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    n: sorted.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    min: sorted[0] as number,
    max: sorted[sorted.length - 1] as number,
    mean: sorted.reduce((sum, v) => sum + v, 0) / sorted.length,
  };
}

function replayOneRead(
  read: HumanRead,
  bookTokens: readonly string[],
  triggers: readonly Trigger[],
  opts: Required<SessionOptions>,
): ReadOutcome {
  const tracker = new SessionTracker(bookTokens, triggers, opts);
  for (const chunk of read.chunks) tracker.process(chunk);

  const order = readingOrder(triggers);
  const triggerOutcomes: TriggerOutcome[] = order.map((trigger, orderIndex) => {
    const fires = tracker.fires.filter((f) => f.triggerId === trigger.id);
    const fire = fires[0];
    const base: TriggerOutcome = {
      triggerId: trigger.id,
      phrase: trigger.phrase,
      wordIndex: trigger.wordIndex,
      fired: fire !== undefined,
      inCorridor: false,
    };
    if (fire === undefined) return base;

    const fireChunk = read.chunks[fire.chunkIndex]!;
    const cursorAtFire = tracker.cursorHistory[fire.chunkIndex] as number;
    const lookback = maxLookbackFor(trigger, opts);
    const inCorridor =
      cursorAtFire >= trigger.wordIndex - opts.armLead &&
      cursorAtFire <= trigger.wordIndex + lookback;

    // Phrase-end cue is matched to the trigger by reading order (cue press k -> k-th phrase read).
    const cue = read.cues[orderIndex];
    let latencyMs: number | undefined;
    if (cue?.wallClock && fireChunk.wallClock) {
      const cueT = Date.parse(cue.wallClock);
      const fireT = Date.parse(fireChunk.wallClock);
      if (!Number.isNaN(cueT) && !Number.isNaN(fireT)) latencyMs = fireT - cueT;
    }

    return {
      ...base,
      cursorAtFire,
      chunkIndex: fire.chunkIndex,
      inCorridor,
      recognizedAtFire: fireChunk.text,
      ...(latencyMs !== undefined ? { latencyMs } : {}),
    };
  });

  const extraFires = order.reduce((sum, trigger) => {
    const count = tracker.fires.filter((f) => f.triggerId === trigger.id).length;
    return sum + Math.max(0, count - 1);
  }, 0);

  const finalsTranscript = read.chunks
    .filter((c) => c.kind === 'final')
    .map((c) => c.text)
    .join(' ');

  return {
    id: read.id,
    ok: read.completeness.ok,
    issues: read.completeness.issues,
    triggers: triggerOutcomes,
    extraFires,
    finalsTranscript,
  };
}

export function replayHumanReads(
  reads: readonly HumanRead[],
  bookTokens: readonly string[],
  triggers: readonly Trigger[],
  options: SessionOptions = {},
): HumanReplayReport {
  const opts: Required<SessionOptions> = { ...DEFAULT_SESSION_OPTIONS, ...options };
  const order = readingOrder(triggers);
  const readOutcomes = reads.map((read) => replayOneRead(read, bookTokens, triggers, opts));

  const perTrigger: PerTrigger[] = order.map((trigger) => {
    const outcomes = readOutcomes.map(
      (r) => r.triggers.find((t) => t.triggerId === trigger.id) as TriggerOutcome,
    );
    const fired = outcomes.filter((o) => o.fired).length;
    const latencies = outcomes
      .map((o) => o.latencyMs)
      .filter((v): v is number => typeof v === 'number');
    return {
      triggerId: trigger.id,
      phrase: trigger.phrase,
      fired,
      total: readOutcomes.length,
      recoveryPct: readOutcomes.length === 0 ? 0 : (fired / readOutcomes.length) * 100,
      latency: latencyStats(latencies),
    };
  });

  const totalFired = perTrigger.reduce((sum, t) => sum + t.fired, 0);
  const totalOccurrences = perTrigger.reduce((sum, t) => sum + t.total, 0);
  const falseStaleCount = readOutcomes.reduce(
    (sum, r) => sum + r.triggers.filter((t) => t.fired && !t.inCorridor).length,
    0,
  );
  const wrongOccurrenceCount = readOutcomes.reduce((sum, r) => sum + r.extraFires, 0);
  const allLatencies = readOutcomes.flatMap((r) =>
    r.triggers.map((t) => t.latencyMs).filter((v): v is number => typeof v === 'number'),
  );

  return {
    reads: readOutcomes,
    perTrigger,
    totalFired,
    totalOccurrences,
    recoveryPct: totalOccurrences === 0 ? 0 : (totalFired / totalOccurrences) * 100,
    falseStaleCount,
    wrongOccurrenceCount,
    latencyOverall: latencyStats(allLatencies),
  };
}
