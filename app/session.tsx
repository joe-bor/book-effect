import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { createSessionController } from '../src/app/createSessionController';
import { getBook, listBooks } from '../src/content';
import { useSession } from '../src/session/useSession';

export default function SessionRoute() {
  const params = useLocalSearchParams<{ bookId?: string }>();
  const fallbackBook = listBooks()[0];
  const bookId = params.bookId ?? fallbackBook?.id;
  const book = bookId === undefined ? undefined : getBook(bookId);
  const controller = useMemo(() => createSessionController(), []);

  if (book === undefined) {
    return (
      <View style={styles.centered}>
        <StatusBar style="dark" />
        <Text style={styles.errorText}>Book unavailable</Text>
      </View>
    );
  }

  return <SessionScreen bookTitle={book.title} controller={controller} book={book} />;
}

function SessionScreen({
  bookTitle,
  controller,
  book,
}: {
  bookTitle: string;
  controller: ReturnType<typeof createSessionController>;
  book: NonNullable<ReturnType<typeof getBook>>;
}) {
  const session = useSession(controller, book);
  const isActive =
    session.status === 'preloading' ||
    session.status === 'listening' ||
    session.status === 'recovering' ||
    session.status === 'stopping';

  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Recover reading position"
        onPress={session.recover}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.content}>
        <Text style={styles.bookTitle}>{bookTitle}</Text>
        <Text style={styles.status}>{statusLabel(session.status)}</Text>
        {session.error === undefined ? null : (
          <Text style={styles.errorText}>{session.error.message}</Text>
        )}
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isActive}
            onPress={() => {
              void session.start();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              isActive && styles.disabledButton,
              pressed && !isActive && styles.pressedButton,
            ]}
          >
            <Text style={styles.primaryButtonText}>Start</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            disabled={!isActive}
            onPress={() => {
              void session.stop();
            }}
            style={({ pressed }) => [
              styles.secondaryButton,
              !isActive && styles.disabledButton,
              pressed && isActive && styles.pressedButton,
            ]}
          >
            <Text style={styles.secondaryButtonText}>Stop</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function statusLabel(status: ReturnType<typeof useSession>['status']): string {
  switch (status) {
    case 'preloading':
      return 'Preloading';
    case 'listening':
      return 'Listening';
    case 'recovering':
      return 'Recovering';
    case 'stopping':
      return 'Stopping';
    case 'error':
      return 'Error';
    case 'idle':
      return 'Idle';
  }
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f8f6',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f4f8f6',
    padding: 24,
  },
  content: {
    zIndex: 1,
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  bookTitle: {
    color: '#17211f',
    fontSize: 28,
    fontWeight: '800',
  },
  status: {
    marginTop: 12,
    color: '#33443f',
    fontSize: 18,
    fontWeight: '600',
  },
  errorText: {
    marginTop: 12,
    color: '#9b2d25',
    fontSize: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 36,
  },
  primaryButton: {
    minHeight: 52,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: '#176b5c',
    paddingHorizontal: 20,
  },
  secondaryButton: {
    minHeight: 52,
    minWidth: 120,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#176b5c',
    backgroundColor: '#ffffff',
    paddingHorizontal: 20,
  },
  disabledButton: {
    opacity: 0.42,
  },
  pressedButton: {
    opacity: 0.78,
  },
  primaryButtonText: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '700',
  },
  secondaryButtonText: {
    color: '#176b5c',
    fontSize: 17,
    fontWeight: '700',
  },
});
