import type { ContributionType } from '../state/sceneState';

/**
 * The four offerings, in words.
 *
 * Four invitations rather than four categories in a form: each has its own
 * name, its own one-line reason, its own way of asking, its own last
 * gesture before the words become material, and its own line afterwards.
 * No two share an action -- "submit" and "continue" appear nowhere.
 *
 * The closing line completes the feeling; it never explains the animation.
 */
export interface Offering {
  id: ContributionType;
  name: string;
  /** Why you would choose it, in one line. */
  line: string;
  /** The question asked while writing. */
  prompt: string;
  placeholder: string;
  /** The last human action before the words become material. */
  offer: string;
  /** What remains after he has taken it in. */
  closing: string;
}

export const OFFERINGS: readonly Offering[] = [
  {
    id: 'GRATITUDE',
    name: 'Gratitude',
    line: "Something you're thankful for.",
    prompt: 'Tell me.',
    placeholder: 'Someone. Something. A moment.',
    offer: 'Leave it with me.',
    closing: "It's with me now.",
  },
  {
    id: 'WISH',
    name: 'Wish',
    line: 'Something you hope for.',
    prompt: 'Tell me.',
    placeholder: 'Whatever you hope for.',
    offer: 'Leave it with me.',
    closing: 'May it find its way.',
  },
  {
    id: 'VIGHNA',
    name: 'Obstacle',
    line: 'Something weighing on you.',
    prompt: 'Tell me.',
    placeholder: 'The thing you have been carrying.',
    offer: 'Leave it with me.',
    closing: 'Leave it here.',
  },
  {
    id: 'PROMISE',
    name: 'Promise',
    line: 'Something you mean to keep.',
    prompt: 'Tell me.',
    placeholder: 'Something small enough to keep.',
    offer: 'Leave it with me.',
    closing: 'Now, keep it.',
  },
];

export function offeringFor(id: ContributionType): Offering {
  return OFFERINGS.find((o) => o.id === id) ?? OFFERINGS[0];
}

/**
 * A small mark for each: a diya flame, a rising path, a stone, a sprout.
 * Drawn as single hairline strokes so they read as part of the typography,
 * not as icons dropped onto it.
 */
export function OfferingMark({ id }: { id: ContributionType }) {
  return (
    <svg
      className="door-mark"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {id === 'GRATITUDE' && (
        <>
          <path d="M8 2.6c2.1 2.5 3.1 4.4 3.1 6.1a3.1 3.1 0 0 1-6.2 0c0-1.7 1-3.6 3.1-6.1z" />
          <path d="M5.2 13.6h5.6" />
        </>
      )}
      {id === 'WISH' && (
        <>
          <path d="M3 13c3.4-.6 6.4-3.4 8.4-8.2" />
          <circle cx="12" cy="3.4" r="1" />
        </>
      )}
      {id === 'VIGHNA' && <path d="M3.4 11.6 2.8 8l2.9-3.4 4.4.3 2.9 3.5-1 3.6-4.9 1.2z" />}
      {id === 'PROMISE' && (
        <>
          <path d="M8 13.8V7.6" />
          <path d="M8 8.4C8 5.8 6.3 4.2 3.6 4.2c0 2.6 1.8 4.2 4.4 4.2z" />
          <path d="M8 10c0-2.3 1.6-3.8 4.4-3.8 0 2.4-1.7 3.8-4.4 3.8z" />
        </>
      )}
    </svg>
  );
}
