import type { SpikeEvent } from './EventLogger';

export type LocalTrialLogFile = {
  readonly uri: string;
  create(options: { intermediates: true; overwrite: true }): void | Promise<void>;
  write(content: string): void | Promise<void>;
};

export type SaveTrialLogSnapshotOptions = {
  events: SpikeEvent[];
  now?: () => number;
  createFile(filename: string): LocalTrialLogFile;
};

export type SavedTrialLog = {
  filename: string;
  pullPath: string;
  uri: string;
  eventCount: number;
};

export function buildTrialLogFilename(timestamp: number): string {
  return `book-effect-spike-log-${Math.trunc(timestamp)}.json`;
}

export async function saveTrialLogSnapshot({
  events,
  now = Date.now,
  createFile,
}: SaveTrialLogSnapshotOptions): Promise<SavedTrialLog> {
  const filename = buildTrialLogFilename(now());
  const file = createFile(filename);

  await file.create({ intermediates: true, overwrite: true });
  await file.write(JSON.stringify(events, null, 2));

  return {
    filename,
    pullPath: `cache/${filename}`,
    uri: file.uri,
    eventCount: events.length,
  };
}
