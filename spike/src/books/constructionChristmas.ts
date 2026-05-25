import type { SpikeBook } from './types';

export const constructionChristmasBook: SpikeBook = {
  id: 'construction-christmas',
  title: 'Construction Site on Christmas Night',
  author: 'Sherri Duskey Rinker and AG Ford',
  text: [
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
  ].join(' '),
  triggers: [
    { id: 'trigger-1', phrase: 'deadline', wordIndex: 67, sound: 'boom.wav', type: 'single-word' },
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
  ],
};
