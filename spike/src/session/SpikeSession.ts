import type { ASREvent, ASRProvider } from '../asr/ASRProvider';
import type { AudioProvider } from '../audio/AudioProvider';
import type { SpikeBook } from '../books/types';
import { EventLogger } from '../logging/EventLogger';
import { findPhraseInRecentText } from '../matcher/naiveMatcher';

type SpikeSessionOptions = {
  asr: ASRProvider;
  audio: AudioProvider;
  book: SpikeBook;
  now?: () => number;
};

export class SpikeSession {
  readonly logger = new EventLogger(500);
  private readonly fired = new Set<string>();
  private readonly now: () => number;

  constructor(private readonly options: SpikeSessionOptions) {
    this.now = options.now ?? (() => performance.now());
  }

  async start(): Promise<void> {
    this.logger.record({
      type: 'session.start',
      timestamp: this.now(),
      providers: { asr: this.options.asr.name, audio: this.options.audio.name },
    });
    await this.options.audio.preload(this.options.book.triggers);
    await this.options.asr.start((event) => {
      void this.handleAsrEvent(event);
    });
  }

  async stop(): Promise<void> {
    await this.options.asr.stop();
    this.logger.record({ type: 'session.stop', timestamp: this.now() });
  }

  private async handleAsrEvent(event: ASREvent): Promise<void> {
    const textPayload =
      'text' in event
        ? {
            payload: { text: event.text },
          }
        : {};

    this.logger.record({
      type: `asr.${event.type}`,
      timestamp: event.timestamp,
      providers: { asr: this.options.asr.name, audio: this.options.audio.name },
      ...textPayload,
    });

    if (event.type !== 'partial' && event.type !== 'final') {
      return;
    }

    for (const trigger of this.options.book.triggers) {
      if (this.fired.has(trigger.id)) {
        continue;
      }

      if (findPhraseInRecentText(event.text, trigger.phrase)) {
        this.fired.add(trigger.id);
        this.logger.record({
          type: 'trigger.fire',
          timestamp: this.now(),
          triggerId: trigger.id,
          providers: { asr: this.options.asr.name, audio: this.options.audio.name },
        });
        await this.options.audio.play(trigger.id);
      }
    }
  }
}
