import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { normalizeWords } from '../src/core/normalize';
import type { TriggerType } from '../src/core/types';
import type {
  AuthoredBook,
  AuthoredTrigger,
  BookIndexEntry,
  CompiledBook,
  CompiledTrigger,
} from '../src/content/types';

export type BuildContentResult = {
  books: CompiledBook[];
  index: BookIndexEntry[];
  assetPaths: string[];
};

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

type UnknownRecord = Record<string, unknown>;

type AuthoredBookFile = {
  book: AuthoredBook;
  bookDir: string;
  folderName: string;
};

export function compileBookSource(book: AuthoredBook, bookDir: string): CompiledBook {
  validateBookId(book.id);

  const tokens = normalizeWords(book.text);
  const warnings: string[] = [];
  const triggers = book.triggers.map((trigger) =>
    compileTrigger(trigger, tokens, book.id, bookDir, warnings),
  );

  return {
    id: book.id,
    title: book.title,
    tokens,
    triggers,
    sourceHash: hashSource(book),
    warnings,
  };
}

export async function buildAllContent(root = process.cwd()): Promise<BuildContentResult> {
  const contentRoot = join(root, 'content');
  const compiledDir = join(contentRoot, 'compiled');
  const bookFiles = findAuthoredBookFiles(join(contentRoot, 'books'));
  const authoredBooks: AuthoredBookFile[] = [];

  for (const bookFile of bookFiles) {
    const authoredBook = await importAuthoredBook(bookFile);
    authoredBooks.push({
      book: authoredBook,
      bookDir: dirname(bookFile),
      folderName: basename(dirname(bookFile)),
    });
  }

  validateUniqueBookIds(authoredBooks.map(({ book }) => book.id));

  const books: CompiledBook[] = [];
  for (const { book, bookDir, folderName } of authoredBooks) {
    if (book.id !== folderName) {
      throw new Error(`Book id "${book.id}" must match folder name "${folderName}".`);
    }
    books.push(compileBookSource(book, bookDir));
  }

  books.sort((a, b) => a.id.localeCompare(b.id));

  mkdirSync(compiledDir, { recursive: true });
  removeStaleGeneratedBooks(compiledDir);

  for (const book of books) {
    writeJson(join(compiledDir, `${book.id}.book.json`), book);
  }

  const index = books.map(({ id, title, sourceHash }) => ({ id, title, sourceHash }));
  writeJson(join(compiledDir, 'index.json'), index);

  const assetPaths = uniqueSorted(
    books.flatMap((book) => book.triggers.map((trigger) => trigger.sound)),
  );
  writeFileSync(join(compiledDir, 'assets.ts'), renderAssetRegistry(assetPaths));
  writeFileSync(join(compiledDir, 'books.ts'), renderBookRegistry(books));

  return { books, index, assetPaths };
}

function compileTrigger(
  trigger: AuthoredTrigger,
  tokens: readonly string[],
  bookId: string,
  bookDir: string,
  warnings: string[],
): CompiledTrigger {
  const phraseTokens = normalizeWords(trigger.phrase);
  const matches = findPhraseMatches(tokens, phraseTokens);

  validateSoundPath(trigger.sound);

  if (matches.length === 0) {
    throw new Error(`Phrase "${trigger.phrase}" was not found.`);
  }

  if (matches.length > 1 && trigger.occurrence === undefined) {
    throw new Error(`Phrase "${trigger.phrase}" matched ${matches.length} times; set occurrence.`);
  }

  const occurrence = trigger.occurrence ?? 1;
  const wordIndex = matches[occurrence - 1];
  if (wordIndex === undefined) {
    throw new Error(`Phrase "${trigger.phrase}" occurrence ${occurrence} was not found.`);
  }

  if (!existsSync(join(bookDir, trigger.sound))) {
    throw new Error(`Missing sound asset: ${trigger.sound}`);
  }

  const type: TriggerType = phraseTokens.length === 1 ? 'single-word' : 'phrase';
  if (type === 'single-word') {
    warnings.push(`Trigger "${trigger.id}" is a bare single-word trigger.`);
  }

  return {
    id: trigger.id,
    phrase: phraseTokens.join(' '),
    wordIndex,
    type,
    sound: toAssetPath(bookId, trigger.sound),
  };
}

function findPhraseMatches(tokens: readonly string[], phraseTokens: readonly string[]): number[] {
  if (phraseTokens.length === 0 || phraseTokens.length > tokens.length) {
    return [];
  }

  const matches: number[] = [];
  for (let start = 0; start <= tokens.length - phraseTokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < phraseTokens.length; offset += 1) {
      const expected = phraseTokens[offset];
      if (expected === undefined || tokens[start + offset] !== expected) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matches.push(start);
    }
  }
  return matches;
}

function validateBookId(id: string): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error(`Invalid book id: ${id}`);
  }
}

function validateUniqueBookIds(ids: readonly string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    validateBookId(id);
    if (seen.has(id)) {
      throw new Error(`Duplicate book id: ${id}`);
    }
    seen.add(id);
  }
}

function validateSoundPath(sound: string): void {
  const parts = sound.split('/');
  const isSafe =
    sound.startsWith('sounds/') &&
    !sound.startsWith('/') &&
    !sound.includes('\\') &&
    !/['"\x00-\x1f\x7f]/.test(sound) &&
    parts.every((part) => part.length > 0 && part !== '.' && part !== '..');

  if (!isSafe) {
    throw new Error(`Unsafe sound path: ${sound}`);
  }
}

function hashSource(book: AuthoredBook): string {
  const projection = {
    id: book.id,
    title: book.title,
    text: book.text,
    triggers: book.triggers.map((trigger) => ({
      id: trigger.id,
      phrase: trigger.phrase,
      sound: trigger.sound,
      ...(trigger.occurrence === undefined ? {} : { occurrence: trigger.occurrence }),
    })),
  };

  return createHash('sha256').update(stableStringify(projection)).digest('hex');
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as UnknownRecord)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

function findAuthoredBookFiles(booksDir: string): string[] {
  if (!existsSync(booksDir)) {
    return [];
  }

  return readdirSync(booksDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(booksDir, entry.name, 'book.ts'))
    .filter((file) => existsSync(file) && statSync(file).isFile())
    .sort((a, b) => a.localeCompare(b));
}

async function importAuthoredBook(bookFile: string): Promise<AuthoredBook> {
  const stats = statSync(bookFile);
  const url = `${pathToFileURL(bookFile).href}?contentBuild=${stats.mtimeMs}-${stats.size}`;
  const module = (await import(url)) as {
    default?: unknown;
  };
  return assertAuthoredBook(unwrapDefaultExport(module.default), bookFile);
}

function assertAuthoredBook(value: unknown, bookFile: string): AuthoredBook {
  if (value === null || typeof value !== 'object') {
    throw new Error(
      `Authored book ${relative(process.cwd(), bookFile)} must export a book object.`,
    );
  }

  const candidate = value as Partial<AuthoredBook>;
  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.title !== 'string' ||
    typeof candidate.text !== 'string' ||
    !Array.isArray(candidate.triggers)
  ) {
    throw new Error(`Authored book ${relative(process.cwd(), bookFile)} has invalid shape.`);
  }

  for (const trigger of candidate.triggers) {
    assertAuthoredTrigger(trigger, bookFile);
  }

  return candidate as AuthoredBook;
}

function unwrapDefaultExport(value: unknown): unknown {
  let current = value;
  for (let depth = 0; depth < 3; depth += 1) {
    if (looksLikeAuthoredBook(current)) {
      return current;
    }
    if (current === null || typeof current !== 'object' || !('default' in current)) {
      return current;
    }
    current = (current as UnknownRecord).default;
  }
  return current;
}

function looksLikeAuthoredBook(value: unknown): boolean {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Partial<AuthoredBook>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.title === 'string' &&
    typeof candidate.text === 'string' &&
    Array.isArray(candidate.triggers)
  );
}

function assertAuthoredTrigger(value: unknown, bookFile: string): asserts value is AuthoredTrigger {
  if (value === null || typeof value !== 'object') {
    throw new Error(`Authored book ${relative(process.cwd(), bookFile)} has invalid trigger.`);
  }

  const trigger = value as Partial<AuthoredTrigger>;
  if (
    typeof trigger.id !== 'string' ||
    typeof trigger.phrase !== 'string' ||
    typeof trigger.sound !== 'string' ||
    (trigger.occurrence !== undefined && typeof trigger.occurrence !== 'number')
  ) {
    throw new Error(`Authored book ${relative(process.cwd(), bookFile)} has invalid trigger.`);
  }
}

function removeStaleGeneratedBooks(compiledDir: string): void {
  for (const entry of readdirSync(compiledDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.book.json')) {
      rmSync(join(compiledDir, entry.name), { force: true });
    }
  }
}

function writeJson(path: string, value: JsonValue | CompiledBook | BookIndexEntry[]): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function renderAssetRegistry(assetPaths: readonly string[]): string {
  const lines = [
    '/* This file is generated by scripts/build-content.ts. */',
    '',
    'export const contentAssets = {',
    ...assetPaths.map(
      (assetPath) =>
        `  ${stringLiteral(assetPath)}: require(${stringLiteral(`../books/${assetPath}`)}),`,
    ),
    '} as const;',
    '',
    'export type ContentAssetPath = keyof typeof contentAssets;',
    '',
  ];

  return lines.join('\n');
}

function renderBookRegistry(books: readonly CompiledBook[]): string {
  const lines = [
    '/* This file is generated by scripts/build-content.ts. */',
    '',
    "import type { CompiledBook } from '../../src/content/types';",
    '',
    'export const compiledBooks = {',
    ...books.map(
      (book) =>
        `  ${stringLiteral(book.id)}: require(${stringLiteral(`./${book.id}.book.json`)}) as CompiledBook,`,
    ),
    '} as const;',
    '',
    'export type CompiledBookId = keyof typeof compiledBooks;',
    '',
  ];

  return lines.join('\n');
}

function stringLiteral(value: string): string {
  const json = JSON.stringify(value);
  return `'${json.slice(1, -1).replaceAll("'", "\\'")}'`;
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function toAssetPath(bookId: string, sound: string): string {
  return `${bookId}/${sound.replaceAll('\\', '/')}`;
}

function writeWarnings(result: BuildContentResult): void {
  for (const book of result.books) {
    for (const warning of book.warnings) {
      console.warn(`${book.id}: ${warning}`);
    }
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(resolve(entry)).href;
}

if (isDirectRun()) {
  buildAllContent()
    .then((result) => {
      writeWarnings(result);
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
