export function normalizeWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 0);
}

export function findPhraseInRecentText(recentText: string, phrase: string): boolean {
  const recent = normalizeWords(recentText).join(' ');
  const target = normalizeWords(phrase).join(' ');

  if (target.length === 0) {
    return false;
  }

  return recent.includes(target);
}
