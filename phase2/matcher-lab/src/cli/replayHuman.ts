import { defaultHumanCorpusRoot, loadHumanReads } from '../corpus/loadHumanReads';
import { constructionChristmasBookTokens } from '../engine/book';
import { replayHumanReads, type LatencyStats } from '../humanReplay';
import { constructionChristmasTriggers } from '../triggers';

// P5 / Gate 2: replay the P2/P3 engine over the real-human corpus and print recovery, false-stale,
// wrong-occurrence, and the phrase-end -> first-fire latency delta. Usage: npm run replay:human [dir]

const root = process.argv[2] ?? defaultHumanCorpusRoot();
const reads = loadHumanReads(root);

if (reads.length === 0) {
  console.error(`No real-human read logs found under ${root}`);
  process.exit(1);
}

const report = replayHumanReads(
  reads,
  constructionChristmasBookTokens,
  constructionChristmasTriggers,
);

const ms = (v: number | undefined): string =>
  v === undefined || Number.isNaN(v) ? '—' : v.toFixed(0);
const lat = (s: LatencyStats): string =>
  s.n === 0
    ? 'n=0'
    : `n=${s.n} p50=${ms(s.p50)} p95=${ms(s.p95)} min=${ms(s.min)} max=${ms(s.max)}`;

console.log(`# P5 real-human replay — ${reads.length} read(s) from ${root}\n`);

console.log('## Per-trigger recovery + phrase-end→fire latency (ms)\n');
console.log('| Trigger | Phrase | Recovery | Latency (ms) |');
console.log('| --- | --- | ---: | --- |');
for (const t of report.perTrigger) {
  console.log(
    `| ${t.triggerId} | ${t.phrase} | ${t.fired}/${t.total} (${t.recoveryPct.toFixed(0)}%) | ${lat(t.latency)} |`,
  );
}
console.log(
  `\n**Total recovery: ${report.totalFired}/${report.totalOccurrences} ` +
    `(${report.recoveryPct.toFixed(1)}%). False-stale: ${report.falseStaleCount}. ` +
    `Wrong-occurrence: ${report.wrongOccurrenceCount}.**`,
);
console.log(`Overall latency: ${lat(report.latencyOverall)}\n`);

console.log('## Per-read detail (recognition shapes)\n');
for (const r of report.reads) {
  const flag = r.ok ? '' : `  ⚠️ ${r.issues.join('; ')}`;
  console.log(`### ${r.id}${flag}`);
  for (const t of r.triggers) {
    if (t.fired) {
      console.log(
        `- ${t.triggerId} **fired** @chunk ${t.chunkIndex}, cursor ${t.cursorAtFire} ` +
          `(corridor: ${t.inCorridor ? 'in' : 'OUT'}, latency ${ms(t.latencyMs)}ms) ` +
          `heard: "${t.recognizedAtFire}"`,
      );
    } else {
      console.log(`- ${t.triggerId} **MISS** (${t.phrase})`);
    }
  }
  if (r.extraFires > 0) console.log(`- ⚠️ ${r.extraFires} extra fire(s) (wrong-occurrence)`);
  console.log(`  transcript: ${r.finalsTranscript}\n`);
}
