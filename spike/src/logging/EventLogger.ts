import type { ASRProviderName } from '../asr/ASRProvider';
import type { AudioProviderName } from '../audio/AudioProvider';

export type SpikeEvent = {
  type: string;
  timestamp: number;
  wallClock?: string;
  providers?: {
    asr?: ASRProviderName;
    audio?: AudioProviderName;
  };
  triggerId?: string;
  payload?: Record<string, unknown>;
};

export class EventLogger {
  private readonly events: SpikeEvent[] = [];

  constructor(private readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('EventLogger capacity must be a positive integer');
    }
  }

  record(event: SpikeEvent): void {
    this.events.push({ ...event, wallClock: event.wallClock ?? new Date().toISOString() });

    while (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  snapshot(): SpikeEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  toJson(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
