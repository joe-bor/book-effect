import type { Trial } from './corpus/loadCorpus';
import type { Matcher, Trigger } from './matchers/types';

export type TrialResult = {
  trial: Trial;
  firedTriggerIds: string[];
  falseFiredTriggerIds: string[]; // fired triggers other than the trial's expected one
  fired: boolean; // did the trial's EXPECTED trigger fire?
  mismatch: boolean; // replayed `fired` disagrees with recorded meta.success
};

export type GroupScore = {
  provider: string;
  slug: string;
  fired: number;
  total: number;
  mismatches: number;
};

export type ReplayReport = {
  matcherName: string;
  results: TrialResult[];
  groups: GroupScore[];
  totalFired: number;
  totalTrials: number;
  totalMismatches: number;
  totalFalseFires: number;
};

/**
 * Replay a matcher over every trial. For each trial we arm the full trigger set (as the live
 * spike did) and ask whether the trial's expected trigger fired, then compare to the recorded
 * success so we can prove the harness reproduces Phase 1 and track unexpected (false) fires.
 */
export function replay(trials: Trial[], triggers: Trigger[], matcher: Matcher): ReplayReport {
  const results: TrialResult[] = trials.map((trial) => {
    const firedTriggerIds = matcher.run(trial.chunks, triggers).map((f) => f.triggerId);
    const fired = firedTriggerIds.includes(trial.triggerId);
    const falseFiredTriggerIds = firedTriggerIds.filter((id) => id !== trial.triggerId);
    return {
      trial,
      firedTriggerIds,
      falseFiredTriggerIds,
      fired,
      mismatch: fired !== trial.meta.success,
    };
  });

  const groupMap = new Map<string, GroupScore>();
  for (const result of results) {
    const key = `${result.trial.provider}/${result.trial.slug}`;
    let group = groupMap.get(key);
    if (!group) {
      group = {
        provider: result.trial.provider,
        slug: result.trial.slug,
        fired: 0,
        total: 0,
        mismatches: 0,
      };
      groupMap.set(key, group);
    }
    group.total += 1;
    if (result.fired) group.fired += 1;
    if (result.mismatch) group.mismatches += 1;
  }

  return {
    matcherName: matcher.name,
    results,
    groups: [...groupMap.values()],
    totalFired: results.filter((r) => r.fired).length,
    totalTrials: results.length,
    totalMismatches: results.filter((r) => r.mismatch).length,
    totalFalseFires: results.reduce((sum, r) => sum + r.falseFiredTriggerIds.length, 0),
  };
}
