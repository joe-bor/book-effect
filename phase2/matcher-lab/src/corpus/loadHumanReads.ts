import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AsrChunk } from '../matchers/types';

// A P5 real-human read is one continuous spike session log: a flat, append-only array of
// SpikeEvents (NOT the Phase 1 provider/slug/trial-NN tree). One full read of the whole book in a
// single session, with the reader pressing "Mark Phrase End Cue" right after each trigger phrase.
type RawEvent = {
  type: string;
  wallClock?: string;
  payload?: { text?: string; latestPartial?: string; latestFinal?: string };
};

/** A "Mark Phrase End Cue" press: ground-truth timing for when the reader finished a phrase. */
export type PhraseEndCue = {
  wallClock: string;
  latestPartial: string;
  latestFinal: string;
};

export type Completeness = { ok: boolean; issues: string[] };

export type HumanRead = {
  /** Source filename without extension (e.g. book-effect-spike-log-1780000000000). */
  id: string;
  /** Ordered asr.partial / asr.final emissions — the replay input for SessionTracker. */
  chunks: AsrChunk[];
  /** Phrase-end cues in press order (pairs with triggers in reading order). */
  cues: PhraseEndCue[];
  completeness: Completeness;
};

const RING_BUFFER_CAP = 500; // EventLogger capacity in the spike; at/over this = possible truncation.
const LOG_FILE = /^book-effect-spike-log-\d+\.json$/;

function toChunks(events: RawEvent[]): AsrChunk[] {
  const chunks: AsrChunk[] = [];
  for (const event of events) {
    if (event.type !== 'asr.partial' && event.type !== 'asr.final') continue;
    if (typeof event.payload?.text !== 'string') continue;
    chunks.push({
      kind: event.type === 'asr.partial' ? 'partial' : 'final',
      text: event.payload.text,
      wallClock: event.wallClock ?? '',
    });
  }
  return chunks;
}

function toCues(events: RawEvent[]): PhraseEndCue[] {
  return events
    .filter((event) => event.type === 'manual.phraseEndCue')
    .map((event) => ({
      wallClock: event.wallClock ?? '',
      latestPartial: event.payload?.latestPartial ?? '',
      latestFinal: event.payload?.latestFinal ?? '',
    }));
}

function assessCompleteness(events: RawEvent[], chunks: AsrChunk[]): Completeness {
  const issues: string[] = [];
  if (!events.some((event) => event.type === 'session.start')) issues.push('missing session.start');
  if (!events.some((event) => event.type === 'session.stop')) issues.push('missing session.stop');
  if (events.length >= RING_BUFFER_CAP) {
    issues.push(`at/over ${RING_BUFFER_CAP}-event ring-buffer cap (possible truncation)`);
  }
  if (chunks.length === 0) issues.push('no asr.partial/asr.final chunks');
  return { ok: issues.length === 0, issues };
}

/** Load every real-human read log under a directory (e.g. phase2/corpus/real-human). */
export function loadHumanReads(dir: string): HumanRead[] {
  return readdirSync(dir)
    .filter((name) => LOG_FILE.test(name))
    .sort()
    .map((file) => {
      const events = JSON.parse(readFileSync(join(dir, file), 'utf8')) as RawEvent[];
      const chunks = toChunks(events);
      return {
        id: file.replace(/\.json$/, ''),
        chunks,
        cues: toCues(events),
        completeness: assessCompleteness(events, chunks),
      };
    });
}

/** Default real-human corpus location for the CLI: phase2/corpus/real-human. */
export function defaultHumanCorpusRoot(): string {
  return fileURLToPath(new URL('../../../corpus/real-human', import.meta.url));
}
