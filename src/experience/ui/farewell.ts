/**
 * The closing words, and when each one arrives.
 *
 * One schedule for picture and sound: the Overlay reads it for each line's
 * fade delay, and the score reads it to ring the only sound permitted after
 * the silence on the line it belongs to. Retiming a line moves both.
 *
 * `at` is milliseconds after the words begin, which is itself
 * VISARJAN_DURATION + DARKNESS_HOLD into Visarjan.
 */
export const FAREWELL_LINES = [
  { text: 'You built him.', at: 500 },
  { text: 'Now let him go.', at: 5000 },
  // A longer gap before the turn: this is the thought the piece is for.
  { text: 'The Internet remembers everything.', at: 11500 },
  { text: 'This didn’t have to.', at: 14500 },
  { text: 'GANPATI BAPPA MORYA', at: 21000 },
  { text: 'Until next year.', at: 26000 },
] as const;

/** Each line's opacity transition, in milliseconds. */
export const FAREWELL_FADE_MS = 3000;

/** The line the distant shankh sounds under. */
export const BELL_LINE = 4;
