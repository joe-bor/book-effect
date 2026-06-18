import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { listBooks } from '../src/content';
import type { BookIndexEntry } from '../src/content';

const books = listBooks();

export default function LibraryRoute() {
  return (
    <View style={styles.screen}>
      <StatusBar style="dark" />
      <FlatList
        data={books}
        keyExtractor={(book) => book.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => <BookRow book={item} />}
      />
    </View>
  );
}

function BookRow({ book }: { book: BookIndexEntry }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        router.push({ pathname: '/session', params: { bookId: book.id } });
      }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <Text style={styles.title}>{book.title}</Text>
      <Text style={styles.meta}>{book.id}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#f4f8f6',
  },
  list: {
    gap: 12,
    padding: 16,
  },
  row: {
    minHeight: 72,
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbdad4',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  rowPressed: {
    backgroundColor: '#e3eee9',
  },
  title: {
    color: '#17211f',
    fontSize: 18,
    fontWeight: '700',
  },
  meta: {
    marginTop: 4,
    color: '#5d6b66',
    fontSize: 13,
  },
});
