import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { NavBar } from '@/components/nav/NavBar';
import { VerifyEmailBanner } from '@/components/nav/VerifyEmailBanner';
import { Providers } from './providers';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'CommunityHub',
    template: '%s · CommunityHub',
  },
  description:
    'Join interest-based communities, share updates, and organize meetups.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
        <Providers>
          {/* first tabbable element on every page */}
          <a
            href="#main-content"
            className="sr-only rounded-md bg-indigo-600 px-3 py-2 text-sm font-medium text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50"
          >
            Skip to content
          </a>
          <NavBar />
          {/* renders nothing unless signed in with an unconfirmed address */}
          <VerifyEmailBanner />
          <main id="main-content" className="flex-1">
            {children}
          </main>
        </Providers>
      </body>
    </html>
  );
}
