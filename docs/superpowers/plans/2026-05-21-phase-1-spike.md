# Phase 1 Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a throwaway Expo spike app that measures offline ASR and one-shot audio latency on the Galaxy S10 and iPhone 12.

**Architecture:** The spike lives in `spike/` and keeps risky integrations behind `ASRProvider` and `AudioProvider` interfaces. App-owned logic stays testable in Node: fixtures, event logging, trigger state, and the naive matcher. Native-heavy ASR/audio providers are measured, not polished.

**Tech Stack:** Expo prebuild/custom dev client, React Native, TypeScript strict, Vitest for logic tests, `whisper.rn`, Sherpa-ONNX integration path, `expo-audio`, `react-native-sound`, EAS/device builds.

---

## Scope

This plan covers Phase 1 only. It does not build v1, the final matcher, multi-book content, a production native module, or polished UI. It produces `spike/` and, after device trials, `docs/03-spike-results.md`.

Sherpa-ONNX integration is an explicit early risk. If there is no usable React Native path in the current ecosystem, stop and surface the finding instead of silently replacing it with a different ASR engine.

## File Structure

- `spike/`: throwaway Expo app.
- `spike/src/asr/ASRProvider.ts`: common ASR interface and event types.
- `spike/src/asr/WhisperRnProvider.ts`: `whisper.rn` adapter.
- `spike/src/asr/SherpaOnnxProvider.ts`: Sherpa-ONNX adapter or measured integration blocker.
- `spike/src/audio/AudioProvider.ts`: common audio interface and trigger sound types.
- `spike/src/audio/ExpoAudioProvider.ts`: `expo-audio` adapter.
- `spike/src/audio/ReactNativeSoundProvider.ts`: `react-native-sound` adapter.
- `spike/src/books/constructionChristmas.ts`: hardcoded excerpt and three trigger definitions.
- `spike/src/logging/EventLogger.ts`: in-memory event ring plus JSON export payload.
- `spike/src/matcher/naiveMatcher.ts`: low-quality matcher used only for latency spike.
- `spike/src/session/SpikeSession.ts`: provider orchestration, trigger arming, timing events.
- `spike/src/ui/SpikeScreen.tsx`: provider toggles, live text, cursor, trial controls, log tail.
- `spike/src/test/`: test helpers for logic-only modules.
- `docs/03-spike-results.md`: measured results after real-device trials.

## Task 1: Environment Baseline

**Files:**
- Read: `docs/01-spike-plan.md`
- Modify: none

- [ ] **Step 1: Confirm branch and clean state**

Run:

```bash
git branch --show-current
git status --short
```

Expected: branch is `codex/phase-1-spike`; status is clean or only contains the plan currently being executed.

- [ ] **Step 2: Confirm installed command-line tools**

Run:

```bash
node -v
npm -v
xcode-select -p
xcodebuild -version
java -version
watchman --version
pod --version
adb version
```

Expected now: Node/npm work. Full Xcode, Watchman, CocoaPods, Android Studio/platform tools, and `adb` may be missing on the first pass.

- [ ] **Step 3: Walk the user through missing GUI installs**

If full Xcode is missing, have the user install Xcode from the Mac App Store, open it once, accept licenses, install components, and sign in with the Apple ID.

If Android Studio or `adb` is missing, have the user install Android Studio, install SDK Platform Tools, and enable USB debugging on the Galaxy S10.

Stop here if either device build toolchain is blocked by a manual installation taking more than 30 minutes.

- [ ] **Step 4: Re-run the baseline checks**

Run the same commands from Step 2.

Expected before scaffolding: `xcodebuild -version`, `pod --version`, and `adb version` succeed if we are preparing both platforms. If iOS setup is deferred, document that Phase 1 starts Android-first.

## Task 2: Scaffold The Expo Spike

**Files:**
- Create: `spike/`
- Modify: `.gitignore` if the scaffold does not ignore native/build output

- [ ] **Step 1: Create the Expo TypeScript app**

Run:

```bash
npx create-expo-app@latest spike --template blank-typescript
```

Expected: a new Expo app is created under `spike/`.

- [ ] **Step 2: Install spike dependencies**

Run from `spike/`:

```bash
npx expo install expo-audio expo-file-system expo-sharing
npm install react-native-sound whisper.rn @fugood/react-native-audio-pcm-stream react-native-fs
npm install --save-dev vitest @types/node prettier eslint-config-prettier
```

Expected: packages install and `package-lock.json` updates.

- [ ] **Step 3: Verify Sherpa package availability before choosing the integration route**

Run from `spike/`:

```bash
npm view sherpa-onnx name version repository.url
npm view sherpa-onnx-react-native name version repository.url
```

Expected: `sherpa-onnx` exists. If a maintained React Native package is not available, create a short note in `spike/SherpaOnnxProvider.md` explaining the blocker and stop for a decision before building a custom bridge.

- [ ] **Step 4: Commit the scaffold**

Run from repo root:

```bash
git add spike package-lock.json package.json .gitignore
git commit -m "chore(spike): scaffold expo app"
```

Expected: commit succeeds. If root `package.json` does not exist, omit it from `git add`.

## Task 3: Configure App Metadata, Permissions, And Tooling

**Files:**
- Modify: `spike/app.json`
- Modify: `spike/tsconfig.json`
- Modify: `spike/package.json`
- Create: `spike/.prettierrc`
- Create: `spike/vitest.config.ts`

- [ ] **Step 1: Set app metadata and permissions**

Edit `spike/app.json` so the Expo config contains these values:

```json
{
  "expo": {
    "name": "Book Effect Spike",
    "slug": "book-effect-spike",
    "version": "0.1.0",
    "orientation": "portrait",
    "scheme": "bookeffectspike",
    "userInterfaceStyle": "automatic",
    "ios": {
      "bundleIdentifier": "com.joebor.bookeffect.spike",
      "infoPlist": {
        "NSMicrophoneUsageDescription": "Book Effect Spike listens locally to measure read-aloud speech recognition latency."
      }
    },
    "android": {
      "package": "com.joebor.bookeffect.spike",
      "permissions": ["RECORD_AUDIO"]
    },
    "plugins": [
      "expo-audio"
    ]
  }
}
```

- [ ] **Step 2: Make TypeScript strict**

Edit `spike/tsconfig.json`:

```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

- [ ] **Step 3: Add Prettier config**

Create `spike/.prettierrc`:

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "semi": true
}
```

- [ ] **Step 4: Add Vitest config**

Create `spike/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
});
```

- [ ] **Step 5: Add package scripts**

Modify `spike/package.json` scripts:

```json
{
  "scripts": {
    "start": "expo start --dev-client",
    "android": "expo run:android",
    "ios": "expo run:ios",
    "prebuild": "expo prebuild",
    "test": "vitest run",
    "test:watch": "vitest",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 6: Verify tooling**

Run from `spike/`:

```bash
npm run typecheck
npm run test
npm run format:check
```

Expected: typecheck may pass before source files exist; tests pass with no tests or Vitest exits cleanly after config is accepted. If Vitest exits with "No test files found", add `"passWithNoTests": true` to `vitest.config.ts`.

- [ ] **Step 7: Commit tooling**

Run from repo root:

```bash
git add spike/app.json spike/tsconfig.json spike/package.json spike/.prettierrc spike/vitest.config.ts
git commit -m "chore(spike): configure tooling and app metadata"
```

## Task 4: Add Core Types And Sample Book Fixture

**Files:**
- Create: `spike/src/books/types.ts`
- Create: `spike/src/books/constructionChristmas.ts`
- Create: `spike/src/audio/AudioProvider.ts`
- Create: `spike/src/asr/ASRProvider.ts`

- [ ] **Step 1: Create book and trigger types**

Create `spike/src/books/types.ts`:

```ts
export type TriggerType = 'single-word' | 'phrase' | 'sentence';

export type BookTrigger = {
  id: string;
  phrase: string;
  wordIndex: number;
  sound: string;
  type: TriggerType;
};

export type SpikeBook = {
  id: string;
  title: string;
  author: string;
  text: string;
  triggers: BookTrigger[];
};
```

- [ ] **Step 2: Add the initial spike fixture**

Create `spike/src/books/constructionChristmas.ts` with synthetic text for scaffolding. This keeps early tests and UI work independent of the physical book. The real excerpt is entered during the device-trial prep task before measurements count.

```ts
import type { SpikeBook } from './types';

export const constructionChristmasBook: SpikeBook = {
  id: 'construction-christmas',
  title: 'Construction Site on Christmas Night',
  author: 'Sherri Duskey Rinker and AG Ford',
  text: [
    'The big truck rolled through the snow and stopped beside the quiet crane.',
    'A bell rang once, the lights came on, and the crew called boom across the yard.',
    'Under the winter sky, every engine waited for the next construction surprise.',
  ].join(' '),
  triggers: [
    { id: 'trigger-1', phrase: 'boom', wordIndex: 20, sound: 'boom.wav', type: 'single-word' },
    { id: 'trigger-2', phrase: 'big truck', wordIndex: 1, sound: 'truck.wav', type: 'phrase' },
    { id: 'trigger-3', phrase: 'winter sky', wordIndex: 29, sound: 'sparkle.wav', type: 'phrase' },
  ],
};
```

Before measured trials, ask the user to type the real approximately 200-word excerpt from the physical book and update the trigger word indices from the normalized token list. This is the only permitted manual content step because the source is a physical book in the user's home.

- [ ] **Step 3: Add audio provider interface**

Create `spike/src/audio/AudioProvider.ts`:

```ts
import type { BookTrigger } from '../books/types';

export type AudioProviderName = 'expo-audio' | 'react-native-sound';

export type AudioProvider = {
  readonly name: AudioProviderName;
  preload(triggers: BookTrigger[]): Promise<void>;
  play(id: string): Promise<void>;
  stop(id: string): Promise<void>;
  dispose(): Promise<void>;
};
```

- [ ] **Step 4: Add ASR provider interface**

Create `spike/src/asr/ASRProvider.ts`:

```ts
export type ASRProviderName = 'whisper-rn' | 'sherpa-onnx';

export type ASREvent =
  | { type: 'partial'; text: string; timestamp: number }
  | { type: 'final'; text: string; timestamp: number }
  | { type: 'vadStart'; timestamp: number; confidence?: number }
  | { type: 'vadEnd'; timestamp: number; confidence?: number }
  | { type: 'error'; timestamp: number; message: string };

export type ASREventHandler = (event: ASREvent) => void;

export type ASRProvider = {
  readonly name: ASRProviderName;
  start(onEvent: ASREventHandler): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
};
```

- [ ] **Step 5: Run checks and commit**

Run from `spike/`:

```bash
npm run typecheck
npm run format:check
```

Run from repo root:

```bash
git add spike/src/books spike/src/audio/AudioProvider.ts spike/src/asr/ASRProvider.ts
git commit -m "feat(spike): add provider contracts and book fixture"
```

## Task 5: Add Event Logging

**Files:**
- Create: `spike/src/logging/EventLogger.ts`
- Create: `spike/src/logging/EventLogger.test.ts`

- [ ] **Step 1: Write tests**

Create `spike/src/logging/EventLogger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EventLogger } from './EventLogger';

describe('EventLogger', () => {
  it('keeps the newest events when capacity is exceeded', () => {
    const logger = new EventLogger(2);

    logger.record({ type: 'first', timestamp: 1 });
    logger.record({ type: 'second', timestamp: 2 });
    logger.record({ type: 'third', timestamp: 3 });

    expect(logger.snapshot().map((event) => event.type)).toEqual(['second', 'third']);
  });

  it('exports JSON with provider metadata', () => {
    const logger = new EventLogger(10);

    logger.record({
      type: 'asr.partial',
      timestamp: 12,
      providers: { asr: 'whisper-rn', audio: 'expo-audio' },
      payload: { text: 'boom' },
    });

    const parsed = JSON.parse(logger.toJson()) as Array<{ wallClock?: string }>;

    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: 'asr.partial',
      timestamp: 12,
      providers: { asr: 'whisper-rn', audio: 'expo-audio' },
      payload: { text: 'boom' },
    });
    expect(typeof parsed[0]?.wallClock).toBe('string');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run from `spike/`:

```bash
npm run test -- src/logging/EventLogger.test.ts
```

Expected: fail because `EventLogger` does not exist.

- [ ] **Step 3: Implement logger**

Create `spike/src/logging/EventLogger.ts`:

```ts
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
```

- [ ] **Step 4: Verify and commit**

Run from `spike/`:

```bash
npm run test -- src/logging/EventLogger.test.ts
npm run typecheck
```

Run from repo root:

```bash
git add spike/src/logging
git commit -m "feat(spike): add event logger"
```

## Task 6: Add Naive Matcher

**Files:**
- Create: `spike/src/matcher/naiveMatcher.ts`
- Create: `spike/src/matcher/naiveMatcher.test.ts`

- [ ] **Step 1: Write tests**

Create `spike/src/matcher/naiveMatcher.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findPhraseInRecentText, normalizeWords } from './naiveMatcher';

describe('normalizeWords', () => {
  it('lowercases text and strips punctuation', () => {
    expect(normalizeWords('Goodnight, Moon!')).toEqual(['goodnight', 'moon']);
  });
});

describe('findPhraseInRecentText', () => {
  it('finds a normalized phrase inside recent ASR text', () => {
    expect(findPhraseInRecentText('then the truck went BOOM loudly', 'truck went boom')).toBe(true);
  });

  it('does not match missing phrases', () => {
    expect(findPhraseInRecentText('quiet snow fell', 'truck went boom')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run from `spike/`:

```bash
npm run test -- src/matcher/naiveMatcher.test.ts
```

Expected: fail because `naiveMatcher` does not exist.

- [ ] **Step 3: Implement matcher**

Create `spike/src/matcher/naiveMatcher.ts`:

```ts
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

export function findPhraseInRecentText(recentText: string, phrase: string): boolean {
  const recent = normalizeWords(recentText).join(' ');
  const target = normalizeWords(phrase).join(' ');

  if (target.length === 0) {
    return false;
  }

  return recent.includes(target);
}
```

- [ ] **Step 4: Verify and commit**

Run from `spike/`:

```bash
npm run test -- src/matcher/naiveMatcher.test.ts
npm run typecheck
```

Run from repo root:

```bash
git add spike/src/matcher
git commit -m "feat(spike): add naive matcher"
```

## Task 7: Add Spike Session Orchestration

**Files:**
- Create: `spike/src/session/SpikeSession.ts`
- Create: `spike/src/session/SpikeSession.test.ts`

- [ ] **Step 1: Write tests**

Create `spike/src/session/SpikeSession.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ASRProvider } from '../asr/ASRProvider';
import type { AudioProvider } from '../audio/AudioProvider';
import type { SpikeBook } from '../books/types';
import { SpikeSession } from './SpikeSession';

const book: SpikeBook = {
  id: 'test',
  title: 'Test',
  author: 'Tester',
  text: 'the truck went boom in the snow',
  triggers: [{ id: 'boom', phrase: 'went boom', wordIndex: 2, sound: 'boom.wav', type: 'phrase' }],
};

describe('SpikeSession', () => {
  it('fires a trigger once when recent ASR text contains the phrase', async () => {
    const played: string[] = [];
    let onEvent: Parameters<ASRProvider['start']>[0] | undefined;

    const asr: ASRProvider = {
      name: 'whisper-rn',
      async start(handler) {
        onEvent = handler;
      },
      async stop() {},
      async dispose() {},
    };

    const audio: AudioProvider = {
      name: 'expo-audio',
      async preload() {},
      async play(id) {
        played.push(id);
      },
      async stop() {},
      async dispose() {},
    };

    const session = new SpikeSession({ asr, audio, book, now: () => 100 });
    await session.start();

    onEvent?.({ type: 'partial', text: 'the truck went boom', timestamp: 100 });
    onEvent?.({ type: 'partial', text: 'the truck went boom', timestamp: 120 });

    expect(played).toEqual(['boom']);
    await session.stop();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run from `spike/`:

```bash
npm run test -- src/session/SpikeSession.test.ts
```

Expected: fail because `SpikeSession` does not exist.

- [ ] **Step 3: Implement session orchestration**

Create `spike/src/session/SpikeSession.ts`:

```ts
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
```

- [ ] **Step 4: Verify and commit**

Run from `spike/`:

```bash
npm run test -- src/session/SpikeSession.test.ts
npm run typecheck
```

Run from repo root:

```bash
git add spike/src/session
git commit -m "feat(spike): add session orchestration"
```

## Task 8: Add Audio Provider Implementations

**Files:**
- Create: `spike/src/audio/ExpoAudioProvider.ts`
- Create: `spike/src/audio/ReactNativeSoundProvider.ts`
- Add: `spike/assets/audio/boom.wav`
- Add: `spike/assets/audio/sparkle.wav`
- Add: `spike/assets/audio/truck.wav`

- [ ] **Step 1: Add short placeholder assets**

Use CC-licensed effects with attribution notes in `spike/assets/audio/README.md`, plus one generated short beep/click WAV for latency trials. Keep files small and named exactly:

```text
boom.wav
sparkle.wav
truck.wav
latency-click.wav
```

- [ ] **Step 2: Implement `ExpoAudioProvider`**

Create `spike/src/audio/ExpoAudioProvider.ts` using `expo-audio` players. Use one player per trigger id, and record play-command timestamps in the session logger rather than inside the provider.

- [ ] **Step 3: Implement `ReactNativeSoundProvider`**

Create `spike/src/audio/ReactNativeSoundProvider.ts` using one loaded `Sound` instance per trigger id. Confirm `isLoaded()` before a provider reports preload complete.

- [ ] **Step 4: Add a manual audio debug screen path**

Wire the UI so each trigger can be played manually after preload. This isolates audio latency from ASR latency.

- [ ] **Step 5: Verify on at least one device**

Run one local device build and manually confirm:

```bash
cd spike
npm run android
```

Expected on Galaxy S10: app installs, opens, and manual trigger playback works for both audio providers or records the provider-specific failure.

- [ ] **Step 6: Commit audio providers**

Run from repo root:

```bash
git add spike/src/audio spike/assets/audio
git commit -m "feat(spike): add audio provider comparison"
```

## Task 9: Add Whisper Provider

**Files:**
- Create: `spike/src/asr/WhisperRnProvider.ts`
- Modify: native prebuild files as required by `whisper.rn`
- Add: model assets or documented model download instructions under `spike/models/README.md`

- [ ] **Step 1: Add model acquisition note**

Create `spike/models/README.md` explaining where the `tiny.en` and VAD model files come from, their expected filenames, and that model files are local-only assets for the spike.

- [ ] **Step 2: Implement `WhisperRnProvider`**

Use `RealtimeTranscriber` from `whisper.rn/realtime-transcription`, `AudioPcmStreamAdapter`, and VAD-end-triggered slicing. Emit provider events through the common `ASREvent` shape.

- [ ] **Step 3: Verify microphone permission**

Run on Android:

```bash
cd spike
npm run android
```

Expected: Android asks for microphone permission; after approval, the UI shows partial or final text from `whisper.rn`, or logs a provider error with a native stack.

- [ ] **Step 4: Commit Whisper provider**

Run from repo root:

```bash
git add spike/src/asr/WhisperRnProvider.ts spike/models/README.md spike/android spike/ios spike/app.json
git commit -m "feat(spike): add whisper rn provider"
```

## Task 10: Add Sherpa-ONNX Provider Or Surface Integration Blocker

**Files:**
- Create: `spike/src/asr/SherpaOnnxProvider.ts`
- Create if blocked: `spike/SherpaOnnxProvider.md`
- Modify: native prebuild files only if a viable React Native integration exists

- [ ] **Step 1: Confirm viable mobile integration path**

Run:

```bash
cd spike
npm view sherpa-onnx name version
npm view sherpa-onnx-react-native name version
```

If only the Node package is available, do not use it in React Native and do not fake the comparison.

- [ ] **Step 2: Implement or document the blocker**

If a viable React Native package exists, create `SherpaOnnxProvider.ts` behind the same `ASRProvider` interface and wire it into the UI toggle.

If no viable package exists within the 30-minute blocker window, create `spike/SherpaOnnxProvider.md`:

```md
# Sherpa-ONNX Provider Status

The Phase 1 requirement is to compare Sherpa-ONNX against whisper.rn on the Galaxy S10.

Current finding:
- `sherpa-onnx` is available for Node.
- A maintained React Native package was not confirmed during the integration check.

Decision needed:
- Build a small native bridge for the spike.
- Replace this comparison with a different offline ASR candidate.
- Defer Sherpa-ONNX and mark Phase 1 incomplete.
```

- [ ] **Step 3: Commit the result**

Run from repo root:

```bash
git add spike/src/asr/SherpaOnnxProvider.ts spike/SherpaOnnxProvider.md spike/android spike/ios
git commit -m "feat(spike): add sherpa onnx provider status"
```

If one of the listed files does not exist because the other path was taken, omit it from `git add`.

## Task 11: Add Spike UI

**Files:**
- Modify: `spike/App.tsx`
- Create: `spike/src/ui/SpikeScreen.tsx`

- [ ] **Step 1: Build the screen**

Create `SpikeScreen` with:

- ASR provider segmented toggle.
- Audio provider segmented toggle.
- `Start Session`, `Stop Session`, `Mark Phrase End Cue`, and `Export Log` buttons.
- Manual audio test buttons for each trigger.
- Live partial/final ASR text.
- Trigger status list.
- Log tail.

- [ ] **Step 2: Wire `App.tsx`**

Replace the template `App.tsx` with:

```tsx
import { StatusBar } from 'expo-status-bar';
import { SafeAreaView } from 'react-native';
import { SpikeScreen } from './src/ui/SpikeScreen';

export default function App() {
  return (
    <SafeAreaView style={{ flex: 1 }}>
      <StatusBar style="auto" />
      <SpikeScreen />
    </SafeAreaView>
  );
}
```

- [ ] **Step 3: Verify UI compiles**

Run:

```bash
cd spike
npm run typecheck
npm run format:check
```

- [ ] **Step 4: Commit UI**

Run from repo root:

```bash
git add spike/App.tsx spike/src/ui
git commit -m "feat(spike): add measurement UI"
```

## Task 12: Build And Run On Devices

**Files:**
- Modify: `spike/README.md`
- Modify: `spike/eas.json` if EAS build is used

- [ ] **Step 1: Add run instructions**

Document:

```bash
cd spike
npm install
npx expo prebuild
npm run android
npm run ios
```

Also document Android USB debugging and `adb devices`.

- [ ] **Step 2: Create development builds**

For local Android:

```bash
cd spike
npm run android
```

For iOS after full Xcode setup:

```bash
cd spike
npm run ios
```

If local iOS signing is blocked, record the blocker and continue Android-first.

- [ ] **Step 3: Commit README/build config**

Run from repo root:

```bash
git add spike/README.md spike/eas.json
git commit -m "docs(spike): add device run instructions"
```

If `spike/eas.json` is not used, omit it from `git add`.

## Task 13: Run Trials And Write Results

**Files:**
- Modify: `spike/src/books/constructionChristmas.ts`
- Create: `docs/03-spike-results.md`
- Add: exported JSON logs under `spike/results/` only if small enough for git; otherwise keep local and summarize.

- [ ] **Step 1: Enter the physical-book excerpt**

Ask the user to type or dictate the approximately 200-word excerpt from `Construction Site on Christmas Night` that will be read during the spike.

Update `spike/src/books/constructionChristmas.ts` with:

- the exact excerpt text,
- one short single-word trigger,
- one two-word trigger,
- one mid-sentence phrase trigger,
- `wordIndex` values computed from the normalized token list.

Run from `spike/`:

```bash
npm run typecheck
```

Expected: fixture still typechecks.

- [ ] **Step 2: Run latency trials**

For each device and ASR provider:

- 30 trials for the single-word phrase.
- 30 trials for the two-word phrase.
- 30 trials for the mid-sentence phrase.

For each audio provider:

- at least 30 manual first-play/preloaded-play trials on the Galaxy S10.
- repeat on iPhone 12 if iOS build is working.

- [ ] **Step 3: Run stability trials**

On the Galaxy S10:

- one 15-minute continuous read with `whisper.rn`,
- one 15-minute continuous read with Sherpa-ONNX if available.

Record battery start/end and thermal notes.

- [ ] **Step 4: Write results**

Create `docs/03-spike-results.md`:

```md
# Spike Results

## Summary

## Device And Build Details

## ASR Latency

## ASR Stability

## Audio Latency

## Matcher JS Cost

## Battery And Thermal Notes

## Recommendation

## Surprises And Gotchas

## Phase 2 Impact
```

Fill every section with measured data. Do not recommend an ASR or audio provider without the Galaxy S10 numbers.

- [ ] **Step 5: Commit results**

Run from repo root:

```bash
git add docs/03-spike-results.md spike/results
git commit -m "docs(spike): add measured results"
```

If raw results are too large for git, omit `spike/results` and state where the local files live.

## Final Gate

After Task 13, stop and ask for approval before Phase 2. Do not create `docs/10-prd.md`, `docs/11-architecture.md`, `docs/12-test-plan.md`, or v1 app code until the spike results are approved.
