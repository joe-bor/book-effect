import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

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
  const coreDir = resolve(root, 'src/core');
  if (!existsSync(coreDir)) return { ok: true, violations: [] };

  const files = collectTsFiles(coreDir);
  const violations: BoundaryViolation[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const specifier of extractImportSpecifiers(source)) {
      if (isBlocked(specifier, file, coreDir)) {
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

function isBlocked(specifier: string, file: string, coreDir: string): boolean {
  if (isRelativeSpecifier(specifier)) {
    return !isInsideCore(resolve(dirname(file), specifier), coreDir);
  }

  return BLOCKED_PREFIXES.some((prefix) => {
    if (prefix.endsWith('-') || prefix.endsWith('/')) {
      return specifier.startsWith(prefix);
    }
    return specifier === prefix || specifier.startsWith(`${prefix}/`);
  });
}

function isRelativeSpecifier(specifier: string): boolean {
  return (
    specifier === '.' ||
    specifier === '..' ||
    specifier.startsWith('./') ||
    specifier.startsWith('../')
  );
}

function isInsideCore(path: string, coreDir: string): boolean {
  const relativePath = relative(coreDir, path);
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath));
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
