'use client';

import { useCallback, useState } from 'react';
import { offeringFor } from './offerings';
import type { ContributionType } from '../state/sceneState';

/**
 * Something to keep.
 *
 * Drawn rather than screenshotted, and drawn from the same few materials
 * the piece is made of: the near-black ground, one warm light, the serif.
 * It is a page from the thing, not an advertisement for it -- no logo
 * lockup, no call to action, no watermark shouting across the bottom.
 *
 * What it carries is the line they were given and the number of people
 * who have been here. Those are the two halves of the piece: something
 * became yours to let go of, and you were not the only one. What it never
 * carries is a word of what they wrote -- that was sampled into particles
 * in the browser and wiped, and it has never existed anywhere it could be
 * read from.
 */

const W = 1080;
const H = 1920;

/** Reads a font family off the live page, whatever the build named it. */
function familyOf(selector: string, fallback: string): string {
  const el = document.querySelector(selector);
  const family = el && getComputedStyle(el).fontFamily;
  return family || fallback;
}

function roundRect(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

/**
 * Everything is measured from the centre line, so the card holds together
 * whether the line it carries is three words or six.
 */
async function draw(type: ContributionType, count: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c) return null;

  // The page's own faces, if they have loaded. A card in a fallback serif
  // is still a card; one that renders before the font arrives is not.
  try {
    await document.fonts.ready;
  } catch {
    // Older browsers simply draw in whatever they have.
  }
  const serif = familyOf('.headline', 'Georgia, serif');
  const sans = familyOf('.brand', 'system-ui, sans-serif');

  // --- the room ---
  c.fillStyle = '#050403';
  c.fillRect(0, 0, W, H);

  // One warm source, high and behind, exactly as the scene is lit. Drawn
  // large and very low in opacity so it reads as air rather than as a
  // gradient laid over the top.
  const glow = c.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, W * 0.95);
  glow.addColorStop(0, 'rgba(196, 104, 46, 0.30)');
  glow.addColorStop(0.45, 'rgba(120, 58, 26, 0.10)');
  glow.addColorStop(1, 'rgba(5, 4, 3, 0)');
  c.fillStyle = glow;
  c.fillRect(0, 0, W, H);

  // A little grain, so the long dark falloff does not band on a phone.
  //
  // Tiled with drawImage rather than written with putImageData: that one
  // replaces pixels outright, alpha included, so it paints noise *over*
  // the room instead of into it and the card comes out flat grey.
  const tile = document.createElement('canvas');
  tile.width = tile.height = 128;
  const tc = tile.getContext('2d');
  if (tc) {
    const noise = tc.createImageData(128, 128);
    for (let i = 0; i < noise.data.length; i += 4) {
      const v = 110 + ((Math.random() * 70) | 0);
      noise.data[i] = noise.data[i + 1] = noise.data[i + 2] = v;
      noise.data[i + 3] = 255;
    }
    tc.putImageData(noise, 0, 0);

    c.save();
    c.globalAlpha = 0.04;
    c.globalCompositeOperation = 'overlay';
    for (let y = 0; y < H; y += 128) for (let x = 0; x < W; x += 128) c.drawImage(tile, x, y);
    c.restore();
  }

  const offering = offeringFor(type);
  const mid = H * 0.44;

  // --- the mark ---
  c.save();
  c.translate(W / 2, mid - 250);
  c.strokeStyle = 'rgba(232, 170, 108, 0.55)';
  c.lineWidth = 2.5;
  c.beginPath();
  c.arc(0, 0, 26, 0, Math.PI * 2);
  c.stroke();
  c.restore();

  // --- the line they were given ---
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255, 241, 226, 0.96)';
  c.font = `500 76px ${serif}`;
  c.fillText(offering.closing, W / 2, mid);

  // --- what it was ---
  c.fillStyle = 'rgba(255, 232, 210, 0.50)';
  c.font = `600 26px ${sans}`;
  const label = offering.name.toUpperCase().split('').join(' ');
  c.fillText(label, W / 2, mid + 92);

  // --- the rule ---
  c.strokeStyle = 'rgba(255, 228, 200, 0.16)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(W / 2 - 120, mid + 160);
  c.lineTo(W / 2 + 120, mid + 160);
  c.stroke();

  // --- the others ---
  // The half that makes it a collective rather than a keepsake.
  c.fillStyle = 'rgba(255, 236, 216, 0.72)';
  c.font = `500 34px ${serif}`;
  c.fillText(
    count > 0
      ? `${count.toLocaleString('en-IN')} ${count === 1 ? 'voice has' : 'voices have'} reached him.`
      : 'Left with Bappa.',
    W / 2,
    mid + 232
  );

  // --- the name, quietly, at the foot ---
  // Kept clear of the bottom fifth, which a story interface covers with
  // its own controls on most phones.
  c.fillStyle = 'rgba(255, 232, 210, 0.42)';
  c.font = `500 24px ${sans}`;
  c.fillText('B A P P A   2 0 2 6', W / 2, H - 300);

  c.fillStyle = 'rgba(255, 232, 210, 0.26)';
  c.font = `400 22px ${sans}`;
  c.fillText('He becomes what we leave behind.', W / 2, H - 254);

  // Keeps the composition off the very edge of a story frame.
  c.strokeStyle = 'rgba(255, 228, 200, 0.06)';
  roundRect(c, 40, 40, W - 80, H - 80, 8);
  c.stroke();

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

type State = 'idle' | 'working' | 'saved' | 'failed';

export function ShareCard({ type, count }: { type: ContributionType; count: number }) {
  const [state, setState] = useState<State>('idle');

  const keep = useCallback(async () => {
    if (state === 'working') return;
    setState('working');

    try {
      const blob = await draw(type, count);
      if (!blob) throw new Error('no image');

      const file = new File([blob], 'bappa-2026.png', { type: 'image/png' });

      // Sharing the file itself where the device can, so it arrives in
      // Stories or a chat as a picture rather than as a link to somewhere.
      const nav = navigator as Navigator & {
        canShare?: (d: ShareData) => boolean;
      };
      if (nav.canShare?.({ files: [file] })) {
        await nav.share({ files: [file] });
        setState('idle');
        return;
      }

      // Everywhere else: it lands in their downloads.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'bappa-2026.png';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setState('saved');
    } catch (e) {
      // A share the person themselves cancelled is not a failure.
      if (e instanceof DOMException && e.name === 'AbortError') setState('idle');
      else setState('failed');
    }
  }, [type, count, state]);

  return (
    <button className="aside aside--keep" onClick={keep} disabled={state === 'working'}>
      {state === 'working' ? 'Making it…' : state === 'saved' ? 'Saved' : state === 'failed' ? 'Try again' : 'Keep this'}
    </button>
  );
}
