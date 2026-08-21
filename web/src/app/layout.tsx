import type { Metadata, Viewport } from 'next';
import './globals.css';
import { getViewer } from '@/lib/auth';
import { SiteHeader } from '@/components/SiteHeader';

export const metadata: Metadata = {
  title: 'A2M8 API Contracts',
  description:
    'The contract between the college LMS backend and the AI service. Read it, comment on any part of it, propose changes.',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1115' },
  ],
};

// The header reflects who is signed in, so nothing here may be prerendered.
export const dynamic = 'force-dynamic';

/**
 * Applies the saved theme before first paint. Inline and synchronous on
 * purpose: deferring it would show a flash of the wrong palette on every load.
 */
const THEME_SCRIPT = `
try {
  var t = localStorage.getItem('a2m8-theme');
  if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
} catch (e) {}
`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getViewer();

  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <SiteHeader viewer={viewer} />
        {children}
      </body>
    </html>
  );
}
