import { normalizeWords } from '../normalize';

/**
 * Book text copied verbatim from spike/src/books/constructionChristmas.ts
 * (`constructionChristmasBook.text`, the joined sentences). We copy rather than import so the
 * offline harness never reaches across the `spike/` boundary. Tokenizing this with the shared
 * `normalizeWords` yields exactly 202 tokens, and the three triggers' `wordIndex` values line up
 * with the first token of each phrase (deadline=67, pushes=87, massive=121) — see book.test.ts.
 */
export const constructionChristmasBookText = [
  "Down in the big construction site, there's work to do for Christmas night!",
  'The last big project of the year; the team is slamming into gear.',
  'So much is riding on the crew--they have a major job to do!',
  'A special house is being built. The trucks are racing at full tilt.',
  "This important work can't wait; they'll get it done and make it great.",
  "Bulldozer's deadline is almost here. He has a lot of ground to clear!",
  'Working at full-speed all day (rooaaar!), he pushes hard to clear the way.',
  'For hours he powers, this way and that, and clears the site in no time flat.',
  'He turns away to end his shift, but in his way: a MASSIVE gift!',
  'With cable "ribbon" from the yard, it\'s topped off with a thank-you card.',
  'An awesome carbon steel blade--custom paint job, custom made!',
  'Merry Christmas, Bulldozer. Goodnight.',
  "Excavator has no time to spare. He's rolling, digging everywhere.",
  'Scooping, chugging at full blast (vvvvvvrrr!), he digs up the foundation--fast!',
  'Clouds roll in, a brisk wind blows, a snowflake falls right on his nose!',
  "The clock in town begins to chime. His job's done right, and right on time.",
].join(' ');

/** The book's normalized token stream — the index space all triggers' `wordIndex` live in. */
export const constructionChristmasBookTokens: readonly string[] = normalizeWords(
  constructionChristmasBookText,
);
