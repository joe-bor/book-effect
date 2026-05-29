import type { ReplayReport } from './replay';

/** Render a replay report as Markdown (used for stdout and the committed BASELINE.md / FUZZY.md). */
export function formatReport(report: ReplayReport): string {
  const recovered = report.results.filter((r) => r.fired && !r.trial.meta.success).length;
  const regressed = report.results.filter((r) => !r.fired && r.trial.meta.success).length;

  const lines: string[] = [];

  lines.push(`# Replay — ${report.matcherName}`);
  lines.push('');
  lines.push(
    `Fired: ${report.totalFired}/${report.totalTrials}` +
      `  ·  false fires: ${report.totalFalseFires}` +
      `  ·  recovered vs Phase 1: ${recovered}` +
      `  ·  regressed vs Phase 1: ${regressed}`,
  );
  lines.push('');
  lines.push('| Provider | Trigger | Fired |');
  lines.push('| --- | --- | ---: |');
  for (const group of report.groups) {
    lines.push(`| ${group.provider} | ${group.slug} | ${group.fired}/${group.total} |`);
  }
  lines.push('');

  const misses = report.results.filter((r) => !r.fired);
  lines.push(`## Misses (${misses.length}) — recovery targets`);
  lines.push('');
  if (misses.length === 0) {
    lines.push('_None._');
  } else {
    for (const group of report.groups) {
      const groupMisses = misses.filter(
        (m) => m.trial.provider === group.provider && m.trial.slug === group.slug,
      );
      if (groupMisses.length === 0) {
        continue;
      }
      lines.push(`### ${group.provider} / ${group.slug} (${groupMisses.length})`);
      for (const miss of groupMisses) {
        const text = miss.trial.meta.latestFinal || miss.trial.meta.latestPartial || '(no text)';
        lines.push(`- trial ${miss.trial.trialNumber}: "${text}"`);
      }
      lines.push('');
    }
  }

  return lines.join('\n') + '\n';
}
