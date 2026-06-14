import { compiledBooks } from '../../content/compiled/books';
import type { BookIndexEntry, CompiledBook } from './types';

const bookIndex = require('../../content/compiled/index.json') as BookIndexEntry[];

const books: Readonly<Record<string, CompiledBook>> = compiledBooks;

export function listBooks(): BookIndexEntry[] {
  return [...bookIndex];
}

export function getBook(id: string): CompiledBook | undefined {
  return books[id];
}

export function requireBook(id: string): CompiledBook {
  const book = getBook(id);
  if (book === undefined) {
    throw new Error(`Unknown compiled book: ${id}`);
  }
  return book;
}
