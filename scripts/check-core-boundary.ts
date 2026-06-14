import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

export type BoundaryViolation = {
  file: string;
  specifier: string;
};

export type BoundaryResult = {
  ok: boolean;
  violations: BoundaryViolation[];
};

const BLOCKED_PREFIXES = [
  'react-native',
  'expo',
  'expo-',
  'app/',
  '@/asr',
  '@/audio',
  '@/content',
  '@/session',
  '@/devlog',
  'src/asr',
  'src/audio',
  'src/content',
  'src/session',
  'src/devlog',
  'modules/',
];

export function checkCoreBoundary(root = process.cwd()): BoundaryResult {
  const coreDir = join(root, 'src/core');
  if (!existsSync(coreDir)) return { ok: true, violations: [] };

  const files = collectTsFiles(coreDir);
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of extractImportSpecifiers(source)) {
      if (isBlocked(specifier)) {
        violations.push({ file: relative(root, file), specifier });
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsFiles(path);
    return entry.isFile() && /\.[cm]?tsx?$/.test(entry.name) ? [path] : [];
  });
}

function extractImportSpecifiers(source: string): string[] {
  const specs: string[] = [];
  const patterns = [
    /import\s+(?:type\s+)?(?:[^'"]+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?[^'"]+from\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specs.push(match[1] as string);
    }
  }
  return specs;
}

function isBlocked(specifier: string): boolean {
  return BLOCKED_PREFIXES.some((prefix) => {
    if (prefix.endsWith('-') || prefix.endsWith('/')) {
      return specifier.startsWith(prefix);
    }
    return specifier === prefix || specifier.startsWith(`${prefix}/`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkCoreBoundary();
  if (!result.ok) {
    for (const violation of result.violations) {
      console.error(`${violation.file}: blocked core import "${violation.specifier}"`);
    }
    process.exitCode = 1;
  }
}
