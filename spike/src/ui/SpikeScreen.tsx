import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { SherpaOnnxProvider } from '../asr/SherpaOnnxProvider';
import { WhisperRnProvider } from '../asr/WhisperRnProvider';
import type { ASRProvider, ASRProviderName } from '../asr/ASRProvider';
import { ExpoAudioProvider } from '../audio/ExpoAudioProvider';
import { ReactNativeSoundProvider } from '../audio/ReactNativeSoundProvider';
import type { AudioProvider, AudioProviderName } from '../audio/AudioProvider';
import { constructionChristmasBook } from '../books/constructionChristmas';
import type { BookTrigger } from '../books/types';
import type { SpikeEvent } from '../logging/EventLogger';
import { SpikeSession } from '../session/SpikeSession';

type SessionPhase = 'idle' | 'starting' | 'running' | 'stopping';

type ActiveProviders = {
  asr: ASRProvider;
  audio: AudioProvider;
};

type ManualAudioProvider = {
  name: AudioProviderName;
  provider: AudioProvider;
  preloaded: boolean;
};

const asrProviders: ASRProviderName[] = ['whisper-rn', 'sherpa-onnx'];
const audioProviders: AudioProviderName[] = ['expo-audio', 'react-native-sound'];
const loggerCapacity = 500;

export function SpikeScreen() {
  const [selectedAsrProvider, setSelectedAsrProvider] = useState<ASRProviderName>('whisper-rn');
  const [selectedAudioProvider, setSelectedAudioProvider] =
    useState<AudioProviderName>('expo-audio');
  const [sessionPhase, setSessionPhase] = useState<SessionPhase>('idle');
  const [events, setEvents] = useState<SpikeEvent[]>([]);
  const [message, setMessage] = useState('Ready');

  const sessionRef = useRef<SpikeSession | null>(null);
  const activeProvidersRef = useRef<ActiveProviders | null>(null);
  const manualAudioProviderRef = useRef<ManualAudioProvider | null>(null);

  const refreshEvents = useCallback(() => {
    const session = sessionRef.current;

    if (session !== null) {
      setEvents(session.logger.snapshot());
    }
  }, []);

  useEffect(() => {
    if (sessionPhase !== 'running') {
      return;
    }

    const interval = setInterval(refreshEvents, 500);
    return () => {
      clearInterval(interval);
    };
  }, [refreshEvents, sessionPhase]);

  useEffect(() => {
    return () => {
      const activeProviders = activeProvidersRef.current;
      activeProvidersRef.current = null;
      void activeProviders?.asr.dispose();
      void activeProviders?.audio.dispose();

      const manualAudioProvider = manualAudioProviderRef.current;
      manualAudioProviderRef.current = null;
      void manualAudioProvider?.provider.dispose();
    };
  }, []);

  const latestPartialText = useMemo(() => findLatestPayloadText(events, 'asr.partial'), [events]);
  const latestFinalText = useMemo(() => findLatestPayloadText(events, 'asr.final'), [events]);
  const logTail = useMemo(() => events.slice(-12).reverse(), [events]);
  const firedTriggerIds = useMemo(
    () =>
      new Set(
        events
          .filter((event) => event.type === 'trigger.fire')
          .map((event) => event.triggerId)
          .filter((triggerId): triggerId is string => triggerId !== undefined),
      ),
    [events],
  );
  const lastCue = useMemo(
    () => [...events].reverse().find((event) => event.type === 'manual.phraseEndCue'),
    [events],
  );

  const isBusy = sessionPhase === 'starting' || sessionPhase === 'stopping';
  const isRunning = sessionPhase === 'running';

  const recordEvent = useCallback(
    (type: string, payload?: Record<string, unknown>, triggerId?: string) => {
      const event = buildUiEvent(
        type,
        selectedAsrProvider,
        selectedAudioProvider,
        payload,
        triggerId,
      );
      const session = sessionRef.current;

      if (session !== null) {
        session.logger.record(event);
        setEvents(session.logger.snapshot());
        return;
      }

      setEvents((currentEvents) => [...currentEvents, event].slice(-loggerCapacity));
    },
    [selectedAsrProvider, selectedAudioProvider],
  );

  const startSession = useCallback(async () => {
    if (activeProvidersRef.current !== null || sessionPhase !== 'idle') {
      return;
    }

    setSessionPhase('starting');
    setMessage('Starting session...');
    setEvents([]);

    const manualAudioProvider = manualAudioProviderRef.current;
    manualAudioProviderRef.current = null;
    await manualAudioProvider?.provider.dispose();

    const asr = createAsrProvider(selectedAsrProvider);
    const audio = createAudioProvider(selectedAudioProvider);
    const session = new SpikeSession({ asr, audio, book: constructionChristmasBook });

    sessionRef.current = session;
    activeProvidersRef.current = { asr, audio };

    try {
      await session.start();
      setSessionPhase('running');
      setMessage('Session running');
      setEvents(session.logger.snapshot());
    } catch (error) {
      const errorMessage = formatError(error);
      session.logger.record(
        buildUiEvent('provider.error', selectedAsrProvider, selectedAudioProvider, {
          phase: 'start',
          message: errorMessage,
        }),
      );
      setEvents(session.logger.snapshot());
      setMessage(errorMessage);
      setSessionPhase('idle');
      activeProvidersRef.current = null;
      await Promise.allSettled([asr.dispose(), audio.dispose()]);
    }
  }, [selectedAsrProvider, selectedAudioProvider, sessionPhase]);

  const stopSession = useCallback(async () => {
    if (sessionPhase !== 'running') {
      return;
    }

    setSessionPhase('stopping');
    setMessage('Stopping session...');

    const session = sessionRef.current;
    const activeProviders = activeProvidersRef.current;
    activeProvidersRef.current = null;

    try {
      await session?.stop();
      await Promise.allSettled([
        activeProviders?.asr.dispose() ?? Promise.resolve(),
        activeProviders?.audio.dispose() ?? Promise.resolve(),
      ]);
      setMessage('Session stopped');
    } catch (error) {
      const errorMessage = formatError(error);
      recordEvent('provider.error', { phase: 'stop', message: errorMessage });
      setMessage(errorMessage);
    } finally {
      setSessionPhase('idle');
      refreshEvents();
    }
  }, [recordEvent, refreshEvents, sessionPhase]);

  const markPhraseEndCue = useCallback(() => {
    recordEvent('manual.phraseEndCue', {
      latestPartial: latestPartialText ?? '',
      latestFinal: latestFinalText ?? '',
    });
    setMessage('Phrase end cue marked');
  }, [latestFinalText, latestPartialText, recordEvent]);

  const playTrigger = useCallback(
    async (trigger: BookTrigger) => {
      setMessage(`Playing ${trigger.id}...`);

      try {
        const provider = await getAudioProviderForManualPlay(
          selectedAudioProvider,
          activeProvidersRef,
          manualAudioProviderRef,
        );

        if (activeProvidersRef.current === null) {
          const manualAudioProvider = manualAudioProviderRef.current;

          if (manualAudioProvider !== null && !manualAudioProvider.preloaded) {
            await manualAudioProvider.provider.preload(constructionChristmasBook.triggers);
            manualAudioProvider.preloaded = true;
          }
        }

        recordEvent('audio.manual.play', { sound: trigger.sound }, trigger.id);
        await provider.play(trigger.id);
        setMessage(`Played ${trigger.id}`);
      } catch (error) {
        const errorMessage = formatError(error);
        recordEvent('provider.error', {
          phase: 'manualAudio',
          triggerId: trigger.id,
          message: errorMessage,
        });
        setMessage(errorMessage);
      }
    },
    [recordEvent, selectedAudioProvider],
  );

  const exportLog = useCallback(async () => {
    const exportEvent = buildUiEvent(
      'log.export.requested',
      selectedAsrProvider,
      selectedAudioProvider,
      {
        eventCount: events.length,
      },
    );
    const session = sessionRef.current;
    let exportEvents: SpikeEvent[];

    if (session !== null) {
      session.logger.record(exportEvent);
      exportEvents = session.logger.snapshot();
      setEvents(exportEvents);
    } else {
      exportEvents = [...events, exportEvent].slice(-loggerCapacity);
      setEvents(exportEvents);
    }

    try {
      const canShare = await Sharing.isAvailableAsync();

      if (!canShare) {
        throw new Error('Sharing is not available on this platform');
      }

      const file = new File(Paths.cache, `book-effect-spike-log-${Date.now()}.json`);
      file.create({ intermediates: true, overwrite: true });
      file.write(JSON.stringify(exportEvents, null, 2));

      await Sharing.shareAsync(file.uri, {
        UTI: 'public.json',
        dialogTitle: 'Export Book Effect spike log',
        mimeType: 'application/json',
      });
      setMessage('Log export opened');
    } catch (error) {
      const errorMessage = formatError(error);
      recordEvent('provider.error', { phase: 'exportLog', message: errorMessage });
      setMessage(errorMessage);
    }
  }, [events, recordEvent, selectedAsrProvider, selectedAudioProvider]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>Phase 1 Spike</Text>
          <Text style={styles.title}>Measurement UI</Text>
        </View>
        <View style={[styles.statusBadge, isRunning ? styles.statusRunning : styles.statusIdle]}>
          <Text style={styles.statusBadgeText}>{sessionPhase}</Text>
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Providers</Text>
        <SegmentedToggle<ASRProviderName>
          label="ASR"
          disabled={isRunning || isBusy}
          options={asrProviders}
          value={selectedAsrProvider}
          onChange={setSelectedAsrProvider}
        />
        <SegmentedToggle<AudioProviderName>
          label="Audio"
          disabled={isRunning || isBusy}
          options={audioProviders}
          value={selectedAudioProvider}
          onChange={setSelectedAudioProvider}
        />
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Session</Text>
        <View style={styles.buttonGrid}>
          <ActionButton
            label="Start Session"
            disabled={isRunning || isBusy}
            onPress={startSession}
          />
          <ActionButton
            label="Stop Session"
            disabled={!isRunning || isBusy}
            onPress={stopSession}
          />
          <ActionButton label="Mark Phrase End Cue" disabled={isBusy} onPress={markPhraseEndCue} />
          <ActionButton
            label="Export Log"
            disabled={isBusy || events.length === 0}
            onPress={exportLog}
          />
        </View>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.meta}>
          Events: {events.length}
          {lastCue !== undefined ? `  Last cue: ${formatTimestamp(lastCue.timestamp)}` : ''}
        </Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Manual Audio</Text>
        <View style={styles.triggerButtons}>
          {constructionChristmasBook.triggers.map((trigger) => (
            <ActionButton
              key={trigger.id}
              label={`${trigger.id}: ${trigger.phrase}`}
              disabled={isBusy}
              onPress={() => {
                void playTrigger(trigger);
              }}
              style={styles.triggerButton}
            />
          ))}
        </View>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>ASR Text</Text>
        <Text style={styles.textLabel}>Partial</Text>
        <Text style={styles.liveText}>{latestPartialText ?? 'No partial text yet'}</Text>
        <Text style={styles.textLabel}>Final</Text>
        <Text style={styles.liveText}>{latestFinalText ?? 'No final text yet'}</Text>
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Triggers</Text>
        {constructionChristmasBook.triggers.map((trigger) => {
          const fired = firedTriggerIds.has(trigger.id);

          return (
            <View key={trigger.id} style={styles.triggerRow}>
              <View style={styles.triggerCopy}>
                <Text style={styles.triggerTitle}>{trigger.phrase}</Text>
                <Text style={styles.triggerMeta}>
                  {trigger.id} · word {trigger.wordIndex} · {trigger.sound}
                </Text>
              </View>
              <View
                style={[styles.triggerStatus, fired ? styles.triggerFired : styles.triggerPending]}
              >
                <Text style={styles.triggerStatusText}>{fired ? 'fired' : 'pending'}</Text>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.panel}>
        <Text style={styles.sectionTitle}>Log Tail</Text>
        {logTail.length === 0 ? (
          <Text style={styles.emptyText}>No events yet</Text>
        ) : (
          logTail.map((event, index) => (
            <View key={`${event.type}-${event.timestamp}-${index}`} style={styles.logRow}>
              <Text style={styles.logType}>{event.type}</Text>
              <Text style={styles.logMeta}>{formatLogLine(event)}</Text>
            </View>
          ))
        )}
      </View>
    </ScrollView>
  );
}

type SegmentedToggleProps<T extends string> = {
  label: string;
  options: T[];
  value: T;
  disabled: boolean;
  onChange(value: T): void;
};

function SegmentedToggle<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: SegmentedToggleProps<T>) {
  return (
    <View style={styles.segmentBlock}>
      <Text style={styles.segmentLabel}>{label}</Text>
      <View style={[styles.segmentControl, disabled ? styles.disabledControl : null]}>
        {options.map((option) => {
          const selected = option === value;

          return (
            <Pressable
              key={option}
              disabled={disabled}
              onPress={() => {
                onChange(option);
              }}
              style={[styles.segment, selected ? styles.segmentSelected : null]}
            >
              <Text style={[styles.segmentText, selected ? styles.segmentTextSelected : null]}>
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

type ActionButtonProps = {
  label: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onPress(): void;
};

function ActionButton({ label, disabled = false, style, onPress }: ActionButtonProps) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.buttonDisabled : null, style]}
    >
      <Text style={[styles.buttonText, disabled ? styles.buttonTextDisabled : null]}>{label}</Text>
    </Pressable>
  );
}

function createAsrProvider(name: ASRProviderName): ASRProvider {
  if (name === 'whisper-rn') {
    return new WhisperRnProvider();
  }

  return new SherpaOnnxProvider();
}

function createAudioProvider(name: AudioProviderName): AudioProvider {
  if (name === 'expo-audio') {
    return new ExpoAudioProvider();
  }

  return new ReactNativeSoundProvider();
}

async function getAudioProviderForManualPlay(
  selectedAudioProvider: AudioProviderName,
  activeProvidersRef: React.MutableRefObject<ActiveProviders | null>,
  manualAudioProviderRef: React.MutableRefObject<ManualAudioProvider | null>,
): Promise<AudioProvider> {
  const activeProviders = activeProvidersRef.current;

  if (activeProviders !== null) {
    return activeProviders.audio;
  }

  const manualAudioProvider = manualAudioProviderRef.current;

  if (manualAudioProvider?.name === selectedAudioProvider) {
    return manualAudioProvider.provider;
  }

  await manualAudioProvider?.provider.dispose();

  const provider = createAudioProvider(selectedAudioProvider);
  manualAudioProviderRef.current = { name: selectedAudioProvider, provider, preloaded: false };

  return provider;
}

function buildUiEvent(
  type: string,
  asr: ASRProviderName,
  audio: AudioProviderName,
  payload?: Record<string, unknown>,
  triggerId?: string,
): SpikeEvent {
  return {
    type,
    timestamp: now(),
    wallClock: new Date().toISOString(),
    providers: { asr, audio },
    ...(triggerId !== undefined ? { triggerId } : {}),
    ...(payload !== undefined ? { payload } : {}),
  };
}

function findLatestPayloadText(events: SpikeEvent[], type: string): string | undefined {
  for (const event of [...events].reverse()) {
    if (event.type !== type) {
      continue;
    }

    const text = event.payload?.text;

    if (typeof text === 'string' && text.length > 0) {
      return text;
    }
  }

  return undefined;
}

function formatLogLine(event: SpikeEvent): string {
  const parts = [formatTimestamp(event.timestamp)];

  if (event.triggerId !== undefined) {
    parts.push(event.triggerId);
  }

  const text = event.payload?.text;
  if (typeof text === 'string' && text.length > 0) {
    parts.push(text);
  }

  const message = event.payload?.message;
  if (typeof message === 'string' && message.length > 0) {
    parts.push(message);
  }

  return parts.join(' · ');
}

function formatTimestamp(timestamp: number): string {
  return `${Math.round(timestamp)}ms`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function now(): number {
  return globalThis.performance?.now?.() ?? Date.now();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f6f7f4',
  },
  content: {
    padding: 16,
    paddingBottom: 32,
    gap: 12,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  kicker: {
    color: '#63706a',
    fontSize: 13,
    fontWeight: '600',
  },
  title: {
    color: '#1d2520',
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0,
  },
  statusBadge: {
    borderRadius: 6,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusIdle: {
    backgroundColor: '#eef0ea',
    borderColor: '#d3d8cf',
  },
  statusRunning: {
    backgroundColor: '#e3f2df',
    borderColor: '#87b47c',
  },
  statusBadgeText: {
    color: '#243028',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  panel: {
    backgroundColor: '#ffffff',
    borderColor: '#dde2da',
    borderRadius: 8,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  sectionTitle: {
    color: '#1d2520',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0,
  },
  segmentBlock: {
    gap: 6,
  },
  segmentLabel: {
    color: '#52605a',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  segmentControl: {
    backgroundColor: '#edf1ed',
    borderRadius: 8,
    flexDirection: 'row',
    padding: 3,
  },
  disabledControl: {
    opacity: 0.58,
  },
  segment: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    minHeight: 42,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  segmentSelected: {
    backgroundColor: '#263a59',
  },
  segmentText: {
    color: '#3f4944',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
  },
  segmentTextSelected: {
    color: '#ffffff',
  },
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  button: {
    alignItems: 'center',
    backgroundColor: '#263a59',
    borderRadius: 7,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  buttonDisabled: {
    backgroundColor: '#d7dcd7',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },
  buttonTextDisabled: {
    color: '#788179',
  },
  message: {
    color: '#263029',
    fontSize: 14,
    fontWeight: '600',
  },
  meta: {
    color: '#69756e',
    fontSize: 12,
  },
  triggerButtons: {
    gap: 8,
  },
  triggerButton: {
    alignSelf: 'stretch',
  },
  textLabel: {
    color: '#63706a',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  liveText: {
    backgroundColor: '#f6f7f4',
    borderColor: '#e0e4dc',
    borderRadius: 7,
    borderWidth: 1,
    color: '#202820',
    fontSize: 15,
    lineHeight: 21,
    minHeight: 48,
    padding: 10,
  },
  triggerRow: {
    alignItems: 'center',
    borderColor: '#e8ebe5',
    borderRadius: 7,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
    padding: 10,
  },
  triggerCopy: {
    flex: 1,
    gap: 2,
  },
  triggerTitle: {
    color: '#1f2924',
    fontSize: 15,
    fontWeight: '800',
  },
  triggerMeta: {
    color: '#66726c',
    fontSize: 12,
  },
  triggerStatus: {
    borderRadius: 6,
    minWidth: 72,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  triggerPending: {
    backgroundColor: '#f2ede2',
  },
  triggerFired: {
    backgroundColor: '#def1e4',
  },
  triggerStatusText: {
    color: '#263029',
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'center',
  },
  emptyText: {
    color: '#6d7771',
    fontSize: 14,
  },
  logRow: {
    backgroundColor: '#f6f7f4',
    borderRadius: 7,
    padding: 9,
    gap: 2,
  },
  logType: {
    color: '#1f2924',
    fontSize: 13,
    fontWeight: '800',
  },
  logMeta: {
    color: '#5c6962',
    fontSize: 12,
    lineHeight: 16,
  },
});
