import type { SpikeBook } from './types';

export const constructionChristmasBook: SpikeBook = {
  id: 'construction-christmas',
  title: 'Construction Site on Christmas Night',
  author: 'Sherri Duskey Rinker and AG Ford',
  text: [
    'The big truck rolled through the snow and stopped beside the quiet crane.',
    'A bell rang once, the lights came on, and the crew called boom across the yard.',
    'Under the winter sky, every engine waited for the next construction surprise.',
  ].join(' '),
  triggers: [
    { id: 'trigger-1', phrase: 'boom', wordIndex: 20, sound: 'boom.wav', type: 'single-word' },
    { id: 'trigger-2', phrase: 'big truck', wordIndex: 1, sound: 'truck.wav', type: 'phrase' },
    { id: 'trigger-3', phrase: 'winter sky', wordIndex: 29, sound: 'sparkle.wav', type: 'phrase' },
  ],
};
