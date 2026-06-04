import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AsrChunk } from '../matchers/types';

type RawEvent = {
  type: string;
  wallClock?: string;
  payload?: { text?: string };
};

type RawMeta = {
  provider: string;
  phraseSlug: string;
  triggerId: string;
  trialNumber: number;
  success: boolean;
  latestPartial: string;
  latestFinal: string;
  carrier: string;
  eventCount: number;
};

export type TrialMeta = {
  success: boolean;
  latestPartial: string;
  latestFinal: string;
  carrier: string;
  eventCount: number;
};

export type Completeness = { ok: boolean; issues: string[] };

export type Trial = {
  provider: string;
  slug: string;
  triggerId: string;
  trialNumber: number;
  chunks: AsrChunk[];
  meta: TrialMeta;
  completeness: Completeness;
};

const RING_BUFFER_CAP = 500; // EventLogger capacity in the spike; at/over this = possible truncation.
const TRIAL_FILE = /^trial-(\d+)\.json$/; // excludes trial-NN.metadata.json

function listDirs(path: string): string[] {
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function toChunks(events: RawEvent[]): AsrChunk[] {
  const chunks: AsrChunk[] = [];
  for (const event of events) {
    if (event.type !== 'asr.partial' && event.type !== 'asr.final') {
      continue;
    }
    if (typeof event.payload?.text !== 'string') {
      continue;
    }
    chunks.push({
      kind: event.type === 'asr.partial' ? 'partial' : 'final',
      text: event.payload.text,
      wallClock: event.wallClock ?? '',
    });
  }
  return chunks;
}

function assessCompleteness(events: RawEvent[], chunks: AsrChunk[]): Completeness {
  const issues: string[] = [];
  if (!events.some((event) => event.type === 'session.stop')) {
    issues.push('missing session.stop');
  }
  if (events.length >= RING_BUFFER_CAP) {
    issues.push(`at/over ${RING_BUFFER_CAP}-event ring-buffer cap (possible truncation)`);
  }
  if (chunks.length === 0) {
    issues.push('no asr.partial/asr.final chunks');
  }
  return { ok: issues.length === 0, issues };
}

/** Load every recorded trial under a corpus root (e.g. phase2/corpus/raw). */
export function loadCorpus(root: string): Trial[] {
  const trials: Trial[] = [];

  for (const provider of listDirs(root).filter((name) => name !== 'carriers')) {
    const providerDir = join(root, provider);
    for (const slug of listDirs(providerDir)) {
      const slugDir = join(providerDir, slug);
      const trialFiles = readdirSync(slugDir)
        .filter((name) => TRIAL_FILE.test(name))
        .sort();

      for (const file of trialFiles) {
        const events = readJson<RawEvent[]>(join(slugDir, file));
        const meta = readJson<RawMeta>(join(slugDir, file.replace(/\.json$/, '.metadata.json')));
        const chunks = toChunks(events);

        trials.push({
          provider: meta.provider,
          slug: meta.phraseSlug,
          triggerId: meta.triggerId,
          trialNumber: meta.trialNumber,
          chunks,
          meta: {
            success: meta.success,
            latestPartial: meta.latestPartial,
            latestFinal: meta.latestFinal,
            carrier: meta.carrier,
            eventCount: meta.eventCount,
          },
          completeness: assessCompleteness(events, chunks),
        });
      }
    }
  }

  return trials;
}

/** Default corpus location for the CLI: phase2/corpus/raw, resolved from this module. */
export function defaultCorpusRoot(): string {
  return fileURLToPath(new URL('../../../corpus/raw', import.meta.url));
}
