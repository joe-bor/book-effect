import type { BookIndexEntry, CompiledBook } from './types';

const bookIndex = require('../../content/compiled/index.json') as BookIndexEntry[];

const books: Record<string, CompiledBook> = {
  'construction-christmas':
    require('../../content/compiled/construction-christmas.book.json') as CompiledBook,
};

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
