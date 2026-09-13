import type { Metadata, Viewport } from 'next';
import { Cormorant_Garamond, Hanken_Grotesk } from 'next/font/google';
import { Analytics } from '@vercel/analytics/next';
import './globals.css';

/**
 * Two faces. A serif with the proportions of carved inscription for
 * everything that is said to the visitor, and a quiet grotesque for
 * labels and actions. Self-hosted by Next at build time.
 */
const serif = Cormorant_Garamond({
  subsets: ['latin'],
  weight: ['500'],
  style: ['normal', 'italic'],
  variable: '--font-serif',
  display: 'swap',
});

const sans = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://bappa.live'),
  title: 'BAPPA 2026 — Leave something with Bappa',
  description:
    'A wish. A gratitude. A weight. A promise. A Ganpati made of what everyone leaves with him — for ten days, and then Visarjan.',
  openGraph: {
    title: 'BAPPA 2026 — Leave something with Bappa',
    description:
      'A wish. A gratitude. A weight. A promise. A Ganpati made of what everyone leaves with him — for ten days, and then Visarjan.',
    type: 'website',
    images: [{ url: '/icon.png', width: 512, height: 512, alt: 'BAPPA 2026' }],
  },
  twitter: {
    card: 'summary',
    title: 'BAPPA 2026 — Leave something with Bappa',
    description:
      'A wish. A gratitude. A weight. A promise. A Ganpati made of what everyone leaves with him — for ten days, and then Visarjan.',
    images: ['/icon.png'],
  },
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#050403',
  width: 'device-width',
  initialScale: 1,
  // Zoom stays available: text must be enlargeable for anyone who needs it.
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <head>
        {/* The GLB is the single blocking asset; start it during HTML parse. */}
        <link rel="preload" href="/models/ganpati.glb" as="fetch" crossOrigin="anonymous" />
      </head>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
