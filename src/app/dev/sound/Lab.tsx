'use client';

import dynamic from 'next/dynamic';

export const Lab = dynamic(() => import('../../../experience/dev/SoundLab').then((m) => m.SoundLab), {
  ssr: false,
});
