'use client';

/**
 * Turns a string into a cloud of points shaped like the words themselves.
 *
 * The text is drawn once to an offscreen 2D canvas, the glyph coverage is
 * read back, and the lit pixels become particle anchors. Nothing here
 * leaves the device: the canvas is local, the pixels are discarded in the
 * same call, and only anonymous coordinates are returned. The string is
 * wiped by the caller immediately afterwards.
 */

export interface SampledText {
  /**
   * Normalised glyph points, xy interleaved, in [0,1] with y pointing
   * down, relative to the ink's own bounding box (not the canvas).
   */
  points: Float32Array;
  /** Aspect ratio (w/h) of the inked block, for mapping onto the screen. */
  aspect: number;
}

/** Sampling grid, in canvas pixels. Finer than this only costs time. */
const STRIDE = 2;
const CANVAS_W = 1600;
const PAD = 24;
const LINE_HEIGHT = 1.5;

/**
 * Glyph coverage scales with the square of the font size, and coverage is
 * what the particle count is drawn from. Rendering at the on-screen size
 * yields only a couple of hundred samples for a short phrase -- far too
 * few to read as letterforms -- so the text is drawn large and the canvas
 * height is kept bounded by shrinking the face as the text grows.
 */
/**
 * The serif stack the page actually resolved, read from the CSS variable
 * next/font sets on <html>, so the canvas draws with the same face the
 * visitor wrote in.
 */
function readSerifFamily(): string {
  const fallback = '"Cormorant Garamond", Georgia, serif';
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--font-serif').trim();
    return v ? `${v}, ${fallback}` : fallback;
  } catch {
    return fallback;
  }
}

function fontSizeFor(length: number): number {
  if (length <= 24) return 150;
  if (length <= 60) return 110;
  if (length <= 140) return 76;
  return 52;
}

export function sampleTextPoints(text: string, maxPoints: number): SampledText | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;

  const fontPx = fontSizeFor(trimmed.length);
  // The same serif the visitor wrote in, so the words that assemble out of
  // particles are recognisably the words they just wrote.
  const font = `500 ${fontPx}px ${readSerifFamily()}`;

  // --- wrap to the canvas width, mirroring how the input reads on screen ---
  ctx.font = font;
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > CANVAS_W - PAD * 2 && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);

  const lineH = fontPx * LINE_HEIGHT;
  canvas.width = CANVAS_W;
  canvas.height = Math.max(1, Math.ceil(lines.length * lineH + fontPx * 0.5));

  // Re-assigning the size resets the context state, so restate it.
  ctx.font = font;
  ctx.fillStyle = '#fff';
  // Left-aligned to match the input the particles are replacing.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  lines.forEach((l, i) => {
    ctx.fillText(l, PAD, (i + 0.5) * lineH + fontPx * 0.25);
  });

  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // --- collect covered pixels, tracking the ink's own bounds ---
  const xs: number[] = [];
  const ys: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let y = 0; y < canvas.height; y += STRIDE) {
    for (let x = 0; x < canvas.width; x += STRIDE) {
      // Alpha only: the glyphs are drawn opaque white on transparent.
      if (data[(y * canvas.width + x) * 4 + 3] > 110) {
        xs.push(x);
        ys.push(y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const total = xs.length;
  if (total === 0) return null;

  const inkW = Math.max(1, maxX - minX);
  const inkH = Math.max(1, maxY - minY);

  // --- thin down to the budget ---
  // A partial Fisher-Yates: an evenly-strided pick would follow the
  // row-major scan and comb the glyphs into visible scanlines.
  const take = Math.min(total, maxPoints);
  const idx = new Uint32Array(total);
  for (let i = 0; i < total; i++) idx[i] = i;
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(Math.random() * (total - i));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }

  const points = new Float32Array(take * 2);
  for (let i = 0; i < take; i++) {
    const s = idx[i];
    // Sub-pixel jitter breaks up the sampling grid, so strokes read as
    // grain rather than as a dot matrix. Normalised to the ink box so the
    // block maps predictably onto the input's rectangle on screen.
    points[i * 2] = (xs[s] - minX + (Math.random() - 0.5) * STRIDE) / inkW;
    points[i * 2 + 1] = (ys[s] - minY + (Math.random() - 0.5) * STRIDE) / inkH;
  }

  return { points, aspect: inkW / inkH };
}
