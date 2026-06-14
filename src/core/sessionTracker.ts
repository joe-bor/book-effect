import { approxSubstringAlign } from './align';
import { editBudget } from './editBudget';
import { normalizeWords } from './normalize';
import { fuzzyTokenEqual } from './tokens';
import type { AsrChunk, FireDecision, Trigger } from './types';

const MAX_MERGE = 3;

function phraseEditDistanceEndingAtEnd(
  target: readonly string[],
  recent: readonly string[],
): number {
  const m = target.length;
  const n = recent.length;
  if (m === 0) {
    return 0;
  }

  const width = n + 1;
  const dp = new Array<number>((m + 1) * width).fill(0);
  for (let i = 1; i <= m; i += 1) {
    dp[i * width] = i;
  }

  for (let i = 1; i <= m; i += 1) {
    const targetToken = target[i - 1] as string;
    for (let j = 1; j <= n; j += 1) {
      const recentToken = recent[j - 1] as string;
      const subCost = fuzzyTokenEqual(targetToken, recentToken) ? 0 : 1;

      let best = Math.min(
        (dp[(i - 1) * width + (j - 1)] as number) + subCost,
        (dp[(i - 1) * width + j] as number) + 1,
        (dp[i * width + (j - 1)] as number) + 1,
      );

      for (let k = 2; k <= MAX_MERGE && j >= k; k += 1) {
        const merged = recent.slice(j - k, j).join('');
        if (fuzzyTokenEqual(targetToken, merged)) {
          best = Math.min(best, dp[(i - 1) * width + (j - k)] as number);
        }
      }

      dp[i * width + j] = best;
    }
  }

  return dp[m * width + n] as number;
}

function commonPrefixLength(a: readonly string[], b: readonly string[]): number {
  const limit = Math.min(a.length, b.length);
  let index = 0;
  while (index < limit && a[index] === b[index]) {
    index += 1;
  }
  return index;
}

export type TriggerState = 'pending' | 'armed' | 'fired' | 'expired';

export type SessionOptions = {
  lookAhead?: number;
  lookBehind?: number;
  recentWindow?: number;
  advanceThreshold?: number;
  armLead?: number;
  maxLookbackSingleWord?: number;
  maxLookbackPhrase?: number;
  freezeAfter?: number;
  cooldownChunks?: number;
};

type ResolvedOptions = Required<SessionOptions>;

export const DEFAULT_SESSION_OPTIONS: ResolvedOptions = {
  lookAhead: 120,
  lookBehind: 10,
  recentWindow: 12,
  advanceThreshold: 0.6,
  armLead: 12,
  maxLookbackSingleWord: 10,
  maxLookbackPhrase: 18,
  freezeAfter: 3,
  cooldownChunks: 4,
};

type TrackedTrigger = {
  trigger: Trigger;
  phraseTokens: readonly string[];
  state: TriggerState;
  cooldownUntilChunk: number;
};

export class SessionTracker {
  private readonly book: readonly string[];
  private readonly opts: ResolvedOptions;
  private readonly tracked: TrackedTrigger[];

  private cursorIndex = 0;
  private committed: string[] = [];
  private partialTokens: string[] = [];
  private lowConfidenceStreak = 0;
  private chunkIndex = -1;
  private readonly history: number[] = [];
  private readonly firedDecisions: FireDecision[] = [];

  constructor(
    bookTokens: readonly string[],
    triggers: readonly Trigger[],
    options: SessionOptions = {},
  ) {
    this.book = bookTokens;
    this.opts = { ...DEFAULT_SESSION_OPTIONS, ...options };
    this.tracked = triggers.map((trigger) => ({
      trigger,
      phraseTokens: normalizeWords(trigger.phrase),
      state: 'pending',
      cooldownUntilChunk: -1,
    }));
  }

  get cursor(): number {
    return this.cursorIndex;
  }

  get cursorHistory(): readonly number[] {
    return this.history;
  }

  get fires(): readonly FireDecision[] {
    return this.firedDecisions;
  }

  get frozen(): boolean {
    return this.lowConfidenceStreak >= this.opts.freezeAfter;
  }

  stateOf(triggerId: string): TriggerState | undefined {
    return this.tracked.find((tracked) => tracked.trigger.id === triggerId)?.state;
  }

  process(chunk: AsrChunk): void {
    this.chunkIndex += 1;
    const tokens = normalizeWords(chunk.text);
    const observedTokenCount = this.countNewlyObservedTokens(tokens, chunk.kind);
    const recent = this.buildRecentWindow(tokens, chunk.kind);
    const newTokenCount = Math.min(observedTokenCount, recent.length);

    this.advanceCursor(recent);
    this.history.push(this.cursorIndex);

    this.armTriggerStates();
    if (!this.frozen) {
      this.fireMatches(recent, newTokenCount);
    }
    this.expireTriggerStates();
  }

  private countNewlyObservedTokens(tokens: string[], kind: AsrChunk['kind']): number {
    const sharedPrefix = commonPrefixLength(this.partialTokens, tokens);
    const observedTokenCount = tokens.length - sharedPrefix;
    this.partialTokens = kind === 'partial' ? tokens : [];
    return observedTokenCount;
  }

  private buildRecentWindow(tokens: string[], kind: AsrChunk['kind']): readonly string[] {
    if (kind === 'final') {
      this.committed.push(...tokens);
      if (this.committed.length > this.opts.recentWindow) {
        this.committed = this.committed.slice(-this.opts.recentWindow);
      }
      return this.committed.slice(-this.opts.recentWindow);
    }
    return [...this.committed, ...tokens].slice(-this.opts.recentWindow);
  }

  private advanceCursor(recent: readonly string[]): void {
    if (recent.length === 0) {
      this.lowConfidenceStreak += 1;
      return;
    }

    const windowStart = Math.max(0, this.cursorIndex - this.opts.lookBehind);
    const windowEnd = Math.min(this.book.length, this.cursorIndex + this.opts.lookAhead);
    const window = this.book.slice(windowStart, windowEnd);
    const { distance, end } = approxSubstringAlign(recent, window);
    const similarity = 1 - distance / recent.length;

    if (similarity >= this.opts.advanceThreshold && end >= 0) {
      const candidate = windowStart + end + 1;
      this.cursorIndex = Math.max(this.cursorIndex, candidate);
      this.lowConfidenceStreak = 0;
    } else {
      this.lowConfidenceStreak += 1;
    }
  }

  private maxLookback(trigger: Trigger): number {
    return trigger.type === 'single-word'
      ? this.opts.maxLookbackSingleWord
      : this.opts.maxLookbackPhrase;
  }

  private armTriggerStates(): void {
    for (const tracked of this.tracked) {
      if (tracked.state === 'fired' || tracked.state === 'expired') continue;

      if (
        tracked.state === 'pending' &&
        !this.frozen &&
        this.cursorIndex >= tracked.trigger.wordIndex - this.opts.armLead
      ) {
        tracked.state = 'armed';
      }
    }
  }

  private expireTriggerStates(): void {
    for (const tracked of this.tracked) {
      if (tracked.state === 'fired' || tracked.state === 'expired') continue;

      if (this.cursorIndex > tracked.trigger.wordIndex + this.maxLookback(tracked.trigger)) {
        tracked.state = 'expired';
      }
    }
  }

  private fireMatches(recent: readonly string[], newTokenCount: number): void {
    const eligible = this.tracked.filter(
      (tracked) =>
        tracked.state === 'armed' &&
        this.chunkIndex >= tracked.cooldownUntilChunk &&
        tracked.phraseTokens.length > 0 &&
        this.matchesEndingInNewTokens(tracked.phraseTokens, recent, newTokenCount),
    );

    const winners = new Map<string, TrackedTrigger>();
    for (const tracked of eligible) {
      const phrase = tracked.trigger.phrase;
      const current = winners.get(phrase);
      if (!current || this.distanceToCursor(tracked) < this.distanceToCursor(current)) {
        winners.set(phrase, tracked);
      }
    }

    for (const tracked of [...winners.values()].sort(
      (a, b) => a.trigger.wordIndex - b.trigger.wordIndex,
    )) {
      tracked.state = 'fired';
      tracked.cooldownUntilChunk = this.chunkIndex + this.opts.cooldownChunks;
      this.firedDecisions.push({ triggerId: tracked.trigger.id, chunkIndex: this.chunkIndex });
    }
  }

  private distanceToCursor(tracked: TrackedTrigger): number {
    return Math.abs(tracked.trigger.wordIndex - this.cursorIndex);
  }

  private matchesEndingInNewTokens(
    phraseTokens: readonly string[],
    recent: readonly string[],
    newTokenCount: number,
  ): boolean {
    if (newTokenCount === 0) {
      return false;
    }

    const suffixStart = Math.max(0, recent.length - newTokenCount);
    const budget = editBudget(phraseTokens.length);
    for (let end = suffixStart; end < recent.length; end += 1) {
      if (phraseEditDistanceEndingAtEnd(phraseTokens, recent.slice(0, end + 1)) <= budget) {
        return true;
      }
    }
    return false;
  }
}
