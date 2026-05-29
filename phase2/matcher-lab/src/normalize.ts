// Ported verbatim from spike/src/matcher/naiveMatcher.ts so the baseline matcher
// reproduces the live Phase 1 behavior exactly. Shared by later (P2+) matchers.
export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}
