export type DevLogEvent = {
  type: string;
  timestamp?: number;
  wallClock?: string;
  triggerId?: string;
  payload?: Record<string, unknown>;
};

export class DevLogger {
  private readonly events: DevLogEvent[] = [];
  private readonly enabled: boolean;
  private readonly capacity: number;
  private readonly now: () => number;

  constructor(options: { enabled: boolean; capacity: number; now?: () => number }) {
    this.enabled = options.enabled;
    this.capacity = options.capacity;
    this.now = options.now ?? (() => performance.now());
  }

  record(event: DevLogEvent): void {
    if (!this.enabled) {
      return;
    }

    this.events.push({
      ...event,
      timestamp: event.timestamp ?? this.now(),
      wallClock: event.wallClock ?? new Date().toISOString(),
    });

    while (this.events.length > this.capacity) {
      this.events.shift();
    }
  }

  snapshot(): DevLogEvent[] {
    return this.events.map((event) => {
      if (event.payload === undefined) {
        return { ...event };
      }

      return { ...event, payload: { ...event.payload } };
    });
  }

  toJson(): string {
    return JSON.stringify(this.events, null, 2);
  }
}
