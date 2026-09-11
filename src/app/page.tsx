'use client';

import dynamic from 'next/dynamic';

/**
 * The whole experience is client-only and lazily loaded: three.js, the
 * renderer and the GLB are ~700KB gzipped that no crawler needs and that
 * a phone should not parse before the page has painted its black ground.
 */
const Experience = dynamic(
  () => import('@/experience/Experience').then((m) => m.Experience),
  { ssr: false, loading: () => <div className="stage" aria-hidden /> }
);

export default function Page() {
  return (
    <main>
      <Experience />
    </main>
  );
}
