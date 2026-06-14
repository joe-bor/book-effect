import { approxSubstringAlign, phraseEditDistance } from './align';
import { editBudget } from './editBudget';
import { normalizeWords } from './normalize';
import type { AsrChunk, FireDecision, Trigger } from './types';

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
    const recent = this.buildRecentWindow(tokens, chunk.kind);

    this.advanceCursor(recent);
    this.history.push(this.cursorIndex);

    this.updateTriggerStates();
    if (!this.frozen) {
      this.fireMatches(recent);
    }
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

  private updateTriggerStates(): void {
    for (const tracked of this.tracked) {
      if (tracked.state === 'fired' || tracked.state === 'expired') continue;

      if (this.cursorIndex > tracked.trigger.wordIndex + this.maxLookback(tracked.trigger)) {
        tracked.state = 'expired';
        continue;
      }

      if (
        tracked.state === 'pending' &&
        !this.frozen &&
        this.cursorIndex >= tracked.trigger.wordIndex - this.opts.armLead
      ) {
        tracked.state = 'armed';
      }
    }
  }

  private fireMatches(recent: readonly string[]): void {
    const eligible = this.tracked.filter(
      (tracked) =>
        tracked.state === 'armed' &&
        this.chunkIndex >= tracked.cooldownUntilChunk &&
        tracked.phraseTokens.length > 0 &&
        phraseEditDistance(tracked.phraseTokens, recent) <= editBudget(tracked.phraseTokens.length),
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
}
