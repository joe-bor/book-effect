import type { AuthoredBook } from '../../../src/content/types';

const book = {
  id: 'construction-christmas',
  title: 'Construction Site on Christmas Night',
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
    { id: 'christmas-night', phrase: 'Christmas night', sound: 'sounds/sparkle.wav' },
    { id: 'slamming-gear', phrase: 'slamming into gear', sound: 'sounds/truck.wav' },
    { id: 'major-job', phrase: 'major job to do', sound: 'sounds/truck.wav' },
    { id: 'full-tilt', phrase: 'full tilt', sound: 'sounds/truck.wav' },
    { id: 'deadline', phrase: 'deadline', sound: 'sounds/latency-click.wav' },
    { id: 'pushes-hard', phrase: 'pushes hard to clear the way', sound: 'sounds/truck.wav' },
    { id: 'powers-this-way', phrase: 'powers this way and that', sound: 'sounds/truck.wav' },
    { id: 'massive-gift', phrase: 'MASSIVE gift', sound: 'sounds/sparkle.wav' },
    { id: 'thank-you-card', phrase: 'thank-you card', sound: 'sounds/sparkle.wav' },
    { id: 'custom-made', phrase: 'custom made', sound: 'sounds/boom.wav' },
    {
      id: 'snowflake-falls',
      phrase: 'snowflake falls right on his nose',
      sound: 'sounds/sparkle.wav',
    },
    { id: 'right-on-time', phrase: 'right on time', sound: 'sounds/latency-click.wav' },
  ],
} satisfies AuthoredBook;

export default book;
