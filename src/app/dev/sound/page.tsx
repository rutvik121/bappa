import { notFound } from 'next/navigation';
import { Lab } from './Lab';

/**
 * /dev/sound -- offline audition of the sound design.
 *
 * Development only. A production build answers 404 unless the dev flag is
 * explicitly set, and the lab's code is never fetched by a visitor.
 */
export default function SoundLabPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_BAPPA_DEV !== '1') {
    notFound();
  }
  return <Lab />;
}
