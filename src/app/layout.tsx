import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BAPPA 2026 — The Internet’s Ganpati',
  description:
    'A digital temple. Leave something with Bappa, and let the collective carry it.',
};

export const viewport: Viewport = {
  themeColor: '#050403',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // The scene fills the frame; a pinch-zoom would only break it.
  userScalable: false,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* The GLB is the single blocking asset; start it during HTML parse. */}
        <link rel="preload" href="/models/ganpati.glb" as="fetch" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
