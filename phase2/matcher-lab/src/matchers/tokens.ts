// Levenshtein distance between two strings (characters).
export function charEditDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prev = Array.from({ length: cols }, (_, j) => j);
  let curr = new Array<number>(cols).fill(0);

  for (let i = 1; i < rows; i += 1) {
    curr[0] = i;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1, // deletion
        (curr[j - 1] ?? 0) + 1, // insertion
        (prev[j - 1] ?? 0) + cost, // substitution / match
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[b.length] ?? 0;
}

// Two tokens count as the "same word" if they are identical or within one character edit.
// Larger differences (gift/guest, hard/heart) are left to the phrase-level edit budget as
// substitutions, so we do not over-merge unrelated words here.
export function fuzzyTokenEqual(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  return charEditDistance(a, b) <= 1;
}
