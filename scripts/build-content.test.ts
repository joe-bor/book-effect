import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildAllContent, compileBookSource } from './build-content';

const root = (): string => mkdtempSync(join(tmpdir(), 'book-effect-content-'));
const writeSound = (dir: string, name = 'boom.wav'): void => {
  mkdirSync(join(dir, 'sounds'), { recursive: true });
  writeFileSync(join(dir, 'sounds', name), 'seed');
};
const writeAsset = (dir: string, assetPath: string): void => {
  const path = join(dir, assetPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, 'seed');
};
const writeAuthoredBook = (
  project: string,
  folder: string,
  options?: {
    id?: string;
    sound?: string;
  },
): string => {
  const id = options?.id ?? folder;
  const sound = options?.sound ?? 'sounds/boom.wav';
  const bookDir = join(project, 'content/books', folder);
  mkdirSync(bookDir, { recursive: true });
  writeAsset(bookDir, sound);
  writeFileSync(
    join(bookDir, 'book.ts'),
    [
      'const book = {',
      `  id: ${JSON.stringify(id)},`,
      "  title: 'Test Book',",
      "  text: 'Alpha boom beta.',",
      '  triggers: [',
      `    { id: 'boom', phrase: 'boom', sound: ${JSON.stringify(sound)} },`,
      '  ],',
      '};',
      'export default book;',
      '',
    ].join('\n'),
  );
  return bookDir;
};

describe('compileBookSource', () => {
  it('resolves exact phrases and derives trigger type', () => {
    const dir = root();
    try {
      writeSound(dir);
      const compiled = compileBookSource(
        {
          id: 'test-book',
          title: 'Test Book',
          text: 'Alpha boom beta massive gift.',
          triggers: [
            { id: 'boom', phrase: 'boom', sound: 'sounds/boom.wav' },
            { id: 'gift', phrase: 'massive gift', sound: 'sounds/boom.wav' },
          ],
        },
        dir,
      );

      expect(compiled.triggers).toMatchObject([
        { id: 'boom', wordIndex: 1, type: 'single-word' },
        { id: 'gift', wordIndex: 3, type: 'phrase' },
      ]);
      expect(compiled.sourceHash).toMatch(/^[a-f0-9]{64}$/);
      expect(compiled.warnings).toContain('Trigger "boom" is a bare single-word trigger.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('requires occurrence for repeated phrases', () => {
    const dir = root();
    try {
      writeSound(dir);
      expect(() =>
        compileBookSource(
          {
            id: 'repeat',
            title: 'Repeat',
            text: 'goodnight moon then goodnight moon',
            triggers: [{ id: 'goodnight', phrase: 'goodnight moon', sound: 'sounds/boom.wav' }],
          },
          dir,
        ),
      ).toThrow('Phrase "goodnight moon" matched 2 times; set occurrence.');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses occurrence to select a repeated phrase', () => {
    const dir = root();
    try {
      writeSound(dir);
      const compiled = compileBookSource(
        {
          id: 'repeat',
          title: 'Repeat',
          text: 'goodnight moon then goodnight moon',
          triggers: [
            {
              id: 'goodnight-2',
              phrase: 'goodnight moon',
              occurrence: 2,
              sound: 'sounds/boom.wav',
            },
          ],
        },
        dir,
      );
      expect(compiled.triggers[0]).toMatchObject({ id: 'goodnight-2', wordIndex: 3 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws for missing phrases and missing sounds', () => {
    const dir = root();
    try {
      writeSound(dir);
      expect(() =>
        compileBookSource(
          {
            id: 'missing-phrase',
            title: 'Missing Phrase',
            text: 'alpha beta',
            triggers: [{ id: 'x', phrase: 'not here', sound: 'sounds/boom.wav' }],
          },
          dir,
        ),
      ).toThrow('Phrase "not here" was not found.');

      expect(() =>
        compileBookSource(
          {
            id: 'missing-sound',
            title: 'Missing Sound',
            text: 'alpha beta',
            triggers: [{ id: 'alpha', phrase: 'alpha', sound: 'sounds/nope.wav' }],
          },
          dir,
        ),
      ).toThrow('Missing sound asset: sounds/nope.wav');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe book IDs', () => {
    const dir = root();
    try {
      writeSound(dir);
      expect(() =>
        compileBookSource(
          {
            id: 'Bad Book',
            title: 'Bad Book',
            text: 'alpha boom',
            triggers: [{ id: 'boom', phrase: 'boom', sound: 'sounds/boom.wav' }],
          },
          dir,
        ),
      ).toThrow('Invalid book id: Bad Book');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects unsafe sound paths before asset existence checks', () => {
    const unsafeSounds = [
      '../outside.wav',
      'audio/boom.wav',
      'sounds\\boom.wav',
      "sounds/bo'om.wav",
      'sounds/bo\nom.wav',
    ];

    for (const sound of unsafeSounds) {
      const dir = root();
      try {
        writeAsset(dir, sound);
        expect(() =>
          compileBookSource(
            {
              id: 'test-book',
              title: 'Test Book',
              text: 'alpha boom',
              triggers: [{ id: 'boom', phrase: 'boom', sound }],
            },
            dir,
          ),
        ).toThrow(`Unsafe sound path: ${sound}`);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });
});

describe('buildAllContent', () => {
  it('writes compiled books, index, and a static asset registry', async () => {
    const project = root();
    try {
      const bookDir = join(project, 'content/books/test-book');
      mkdirSync(bookDir, { recursive: true });
      writeSound(bookDir, 'boom.wav');
      writeSound(bookDir, 'sparkle.wav');
      writeFileSync(
        join(bookDir, 'book.ts'),
        [
          'const book = {',
          "  id: 'test-book',",
          "  title: 'Test Book',",
          "  text: 'Alpha boom beta sparkle.',",
          '  triggers: [',
          "    { id: 'boom', phrase: 'boom', sound: 'sounds/boom.wav' },",
          "    { id: 'sparkle', phrase: 'sparkle', sound: 'sounds/sparkle.wav' },",
          '  ],',
          '};',
          'export default book;',
          '',
        ].join('\n'),
      );

      await buildAllContent(project);

      const compiled = JSON.parse(
        readFileSync(join(project, 'content/compiled/test-book.book.json'), 'utf8'),
      ) as {
        id: string;
        title: string;
        tokens: string[];
        sourceHash: string;
        triggers: { id: string; sound: string }[];
      };
      expect(compiled).toMatchObject({
        id: 'test-book',
        title: 'Test Book',
        tokens: ['alpha', 'boom', 'beta', 'sparkle'],
        triggers: [
          { id: 'boom', sound: 'test-book/sounds/boom.wav' },
          { id: 'sparkle', sound: 'test-book/sounds/sparkle.wav' },
        ],
      });

      const index = JSON.parse(
        readFileSync(join(project, 'content/compiled/index.json'), 'utf8'),
      ) as unknown;
      expect(index).toEqual([
        { id: 'test-book', title: 'Test Book', sourceHash: compiled.sourceHash },
      ]);

      const registry = readFileSync(join(project, 'content/compiled/assets.ts'), 'utf8');
      expect(registry.match(/require\(/g)).toHaveLength(2);
      expect(registry).toContain(
        "  'test-book/sounds/boom.wav': require('../books/test-book/sounds/boom.wav'),",
      );
      expect(registry).toContain(
        "  'test-book/sounds/sparkle.wav': require('../books/test-book/sounds/sparkle.wav'),",
      );

      const bookRegistry = readFileSync(join(project, 'content/compiled/books.ts'), 'utf8');
      expect(bookRegistry.match(/require\(/g)).toHaveLength(1);
      expect(bookRegistry).toContain(
        "  'test-book': require('./test-book.book.json') as CompiledBook,",
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('rejects duplicate book IDs before writing generated files', async () => {
    const project = root();
    try {
      writeAuthoredBook(project, 'duplicate');
      writeAuthoredBook(project, 'duplicate-copy', { id: 'duplicate' });

      await expect(buildAllContent(project)).rejects.toThrow('Duplicate book id: duplicate');
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('rejects book IDs that do not match their folder name', async () => {
    const project = root();
    try {
      writeAuthoredBook(project, 'folder-name', { id: 'actual-id' });

      await expect(buildAllContent(project)).rejects.toThrow(
        'Book id "actual-id" must match folder name "folder-name".',
      );
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
