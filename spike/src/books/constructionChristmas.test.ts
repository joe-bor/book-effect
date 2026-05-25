import { describe, expect, it } from 'vitest';
import { normalizeWords } from '../matcher/naiveMatcher';
import { constructionChristmasBook } from './constructionChristmas';

function findPhraseIndex(text: string, phrase: string): number {
  const words = normalizeWords(text);
  const phraseWords = normalizeWords(phrase);

  return words.findIndex((_, index) =>
    phraseWords.every((phraseWord, phraseIndex) => words[index + phraseIndex] === phraseWord),
  );
}

describe('constructionChristmasBook', () => {
  it('keeps Task 13 trial triggers aligned to normalized book text', () => {
    expect(constructionChristmasBook.triggers).toEqual([
      {
        id: 'trigger-1',
        phrase: 'deadline',
        wordIndex: 67,
        sound: 'boom.wav',
        type: 'single-word',
      },
      {
        id: 'trigger-2',
        phrase: 'massive gift',
        wordIndex: 121,
        sound: 'sparkle.wav',
        type: 'phrase',
      },
      {
        id: 'trigger-3',
        phrase: 'pushes hard to clear the way',
        wordIndex: 87,
        sound: 'truck.wav',
        type: 'phrase',
      },
    ]);

    for (const trigger of constructionChristmasBook.triggers) {
      expect(findPhraseIndex(constructionChristmasBook.text, trigger.phrase)).toBe(
        trigger.wordIndex,
      );
    }
  });
});
