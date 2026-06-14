import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { checkCoreBoundary } from './check-core-boundary';

const makeProject = (): string => mkdtempSync(join(tmpdir(), 'book-effect-boundary-'));

describe('checkCoreBoundary', () => {
  it('rejects React Native and Expo imports from src/core', () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, 'src/core'), { recursive: true });
      writeFileSync(
        join(root, 'src/core/bad.ts'),
        [
          "import { Platform } from 'react-native';",
          "import { Asset } from 'expo-asset';",
          'export const value = Platform.OS + String(Asset);',
        ].join('\n'),
      );

      const result = checkCoreBoundary(root);

      expect(result.ok).toBe(false);
      expect(result.violations.map((v) => v.specifier)).toEqual(['react-native', 'expo-asset']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('allows relative imports inside src/core', () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, 'src/core'), { recursive: true });
      writeFileSync(
        join(root, 'src/core/good.ts'),
        "import { b } from './b';\nexport const a = b;",
      );
      writeFileSync(join(root, 'src/core/b.ts'), 'export const b = 1;');

      expect(checkCoreBoundary(root)).toEqual({ ok: true, violations: [] });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects relative imports that resolve outside src/core', () => {
    const root = makeProject();
    try {
      mkdirSync(join(root, 'src/core'), { recursive: true });
      writeFileSync(
        join(root, 'src/core/bad-relative.ts'),
        [
          "import { play } from '../audio/AudioPlayer';",
          "import plugin from '../../modules/audio-player';",
          'export const value = String(play) + String(plugin);',
        ].join('\n'),
      );

      const result = checkCoreBoundary(root);

      expect(result.ok).toBe(false);
      expect(result.violations.map((v) => v.specifier)).toEqual([
        '../audio/AudioPlayer',
        '../../modules/audio-player',
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
