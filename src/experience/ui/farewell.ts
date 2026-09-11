/**
 * The closing words, and when each one arrives.
 *
 * Almost nothing. The dissolution carries the ending; the words only close
 * it. One thought, a pause, the chant -- and then they go too, and the
 * darkness is what is left. No explanation, no thanks, no replay.
 *
 * One schedule for picture and sound: the Overlay reads it for each line's
 * fade, and the score reads it to sound the shankh under the chant.
 *
 * `at` is milliseconds after the words begin, which is itself
 * VISARJAN_DURATION + DARKNESS_HOLD into Visarjan.
 */
export const FAREWELL_LINES = [
  { lines: ['Some things', 'aren’t meant to stay.'], at: 500, kind: 'verse' },
  { lines: ['Ganpati Bappa Morya'], at: 7500, kind: 'chant' },
] as const;

/** Each line's fade in, in milliseconds. */
export const FAREWELL_FADE_MS = 3000;

/** When the words leave, and only the darkness remains. */
export const FAREWELL_OUT_MS = 17000;

/** The line the distant shankh sounds under. */
export const BELL_LINE = 1;
