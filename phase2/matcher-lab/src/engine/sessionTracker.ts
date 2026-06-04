import { approxSubstringAlign, phraseEditDistance } from '../matchers/align';
import { editBudget } from '../matchers/fuzzy';
import { normalizeWords } from '../normalize';
import type { AsrChunk, FireDecision, Trigger } from '../matchers/types';

export type TriggerState = 'pending' | 'armed' | 'fired' | 'expired';

export type SessionOptions = {
  /** Forward book tokens to consider when advancing the cursor (per research: ~120). */
  lookAhead?: number;
  /** Backward tokens kept in the alignment window for scoring only; the cursor never rewinds. */
  lookBehind?: number;
  /** Rolling cap on recent ASR tokens matched against the book (the ring buffer). */
  recentWindow?: number;
  /** Normalized alignment similarity (1 - dist/len) required to advance the cursor. */
  advanceThreshold?: number;
  /** Arm a trigger once `cursor >= wordIndex - armLead`. */
  armLead?: number;
  /** Expire a single-word trigger once `cursor > wordIndex + this`. */
  maxLookbackSingleWord?: number;
  /** Expire a multi-word/sentence trigger once `cursor > wordIndex + this`. */
  maxLookbackPhrase?: number;
  /** Consecutive low-confidence updates before the public cursor freezes. */
  freezeAfter?: number;
  /** Chunks a fired trigger stays in cooldown (defense in depth on top of the permanent fired state). */
  cooldownChunks?: number;
};

type ResolvedOptions = Required<SessionOptions>;

/** Starting constants from docs/research/report-b §Position/Trigger and report-a §Q2/Q3. */
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

/**
 * Stateful position engine for a continuous read. It consumes ordered ASR chunks against the book
 * token stream and emits a FireDecision per trigger, maintaining:
 *  - a forward-only (monotonic) cursor advanced by a windowed local alignment of recent ASR to the
 *    book (reusing {@link approxSubstringAlign}); it never auto-rewinds — `lookBehind` is for
 *    scoring only;
 *  - a per-trigger state machine `pending -> armed -> fired | expired` keyed by `wordIndex`;
 *  - a minimal hard-freeze that, after a low-confidence streak, stops arming and suppresses firing
 *    until a confident match re-acquires position.
 */
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
      state: 'pending' as TriggerState,
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
    return this.tracked.find((t) => t.trigger.id === triggerId)?.state;
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

  // Rolling recent-token window. Finals commit their tokens to the buffer; a partial is a volatile
  // suffix appended to the committed tail without being committed (the next partial supersedes it).
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
      const candidate = windowStart + end + 1; // one past the last matched book token
      this.cursorIndex = Math.max(this.cursorIndex, candidate); // monotonic ratchet
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
    for (const t of this.tracked) {
      if (t.state === 'fired' || t.state === 'expired') continue;
      // Expiry tracks the (monotonic) cursor and applies even while frozen — the cursor is not
      // advancing under a freeze, so this never expires a trigger we are still waiting on.
      if (this.cursorIndex > t.trigger.wordIndex + this.maxLookback(t.trigger)) {
        t.state = 'expired';
        continue;
      }
      // A freeze stops arming new triggers (no guessing while we are unsure of position).
      if (
        t.state === 'pending' &&
        !this.frozen &&
        this.cursorIndex >= t.trigger.wordIndex - this.opts.armLead
      ) {
        t.state = 'armed';
      }
    }
  }

  private fireMatches(recent: readonly string[]): void {
    const eligible = this.tracked.filter(
      (t) =>
        t.state === 'armed' &&
        this.chunkIndex >= t.cooldownUntilChunk &&
        t.phraseTokens.length > 0 &&
        phraseEditDistance(t.phraseTokens, recent) <= editBudget(t.phraseTokens.length),
    );

    // For repeated phrases the nearest armed trigger to the cursor wins; distinct phrases may each
    // fire on the same chunk. Group by phrase, keep the nearest occurrence, then fire deterministically.
    const winners = new Map<string, TrackedTrigger>();
    for (const t of eligible) {
      const phrase = t.trigger.phrase;
      const current = winners.get(phrase);
      if (!current || this.distanceToCursor(t) < this.distanceToCursor(current)) {
        winners.set(phrase, t);
      }
    }

    for (const t of [...winners.values()].sort(
      (a, b) => a.trigger.wordIndex - b.trigger.wordIndex,
    )) {
      t.state = 'fired';
      t.cooldownUntilChunk = this.chunkIndex + this.opts.cooldownChunks;
      this.firedDecisions.push({ triggerId: t.trigger.id, chunkIndex: this.chunkIndex });
    }
  }

  private distanceToCursor(t: TrackedTrigger): number {
    return Math.abs(t.trigger.wordIndex - this.cursorIndex);
  }
}
