import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export type HumanReplaySummary = {
  recovered: number;
  total: number;
  falseStale: number;
  wrongOccurrence: number;
};

const REFERENCE_HUMAN_REPLAY: HumanReplaySummary = {
  recovered: 20,
  total: 21,
  falseStale: 0,
  wrongOccurrence: 0,
};

export function parseHumanReplaySummary(output: string): HumanReplaySummary {
  const recovery = lastMatch(output, /Total recovery:\s*(\d+)\s*\/\s*(\d+)/gi);
  const falseStale = lastMatch(output, /False-stale:\s*(\d+)/gi);
  const wrongOccurrence = lastMatch(output, /Wrong-occurrence:\s*(\d+)/gi);

  if (recovery === null || falseStale === null || wrongOccurrence === null) {
    throw new Error('Unable to parse human replay summary.');
  }

  return {
    recovered: Number(recovery[1]),
    total: Number(recovery[2]),
    falseStale: Number(falseStale[1]),
    wrongOccurrence: Number(wrongOccurrence[1]),
  };
}

export function formatReferenceWarnings(summary: HumanReplaySummary): string[] {
  const warnings: string[] = [];
  if (
    summary.recovered !== REFERENCE_HUMAN_REPLAY.recovered ||
    summary.total !== REFERENCE_HUMAN_REPLAY.total
  ) {
    warnings.push(
      `Recovery changed from reference ${REFERENCE_HUMAN_REPLAY.recovered}/${REFERENCE_HUMAN_REPLAY.total} to ${summary.recovered}/${summary.total}.`,
    );
  }
  if (summary.falseStale !== REFERENCE_HUMAN_REPLAY.falseStale) {
    warnings.push(
      `False-stale changed from reference ${REFERENCE_HUMAN_REPLAY.falseStale} to ${summary.falseStale}.`,
    );
  }
  if (summary.wrongOccurrence !== REFERENCE_HUMAN_REPLAY.wrongOccurrence) {
    warnings.push(
      `Wrong-occurrence changed from reference ${REFERENCE_HUMAN_REPLAY.wrongOccurrence} to ${summary.wrongOccurrence}.`,
    );
  }
  return warnings;
}

export function runHumanReplayReference(): number {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const result = spawnSync('npm', ['--prefix', 'phase2/matcher-lab', 'run', 'replay:human'], {
    cwd: projectRoot,
    encoding: 'utf8',
  });

  if (result.stdout.length > 0) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr.length > 0) {
    process.stderr.write(result.stderr);
  }
  if (result.error !== undefined) {
    process.stderr.write(`Failed to run Phase 2 human replay: ${result.error.message}\n`);
    return 1;
  }
  if (result.status !== 0) {
    return result.status ?? 1;
  }

  try {
    const summary = parseHumanReplaySummary(result.stdout);
    process.stdout.write(
      `\nParsed human replay summary: ${summary.recovered}/${summary.total}; false-stale ${summary.falseStale}; wrong-occurrence ${summary.wrongOccurrence}.\n`,
    );
    for (const warning of formatReferenceWarnings(summary)) {
      process.stderr.write(`[phase2-reference] ${warning}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    return 1;
  }
}

function lastMatch(output: string, pattern: RegExp): RegExpExecArray | null {
  let last: RegExpExecArray | null = null;
  for (let match = pattern.exec(output); match !== null; match = pattern.exec(output)) {
    last = match;
  }
  return last;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runHumanReplayReference();
}
