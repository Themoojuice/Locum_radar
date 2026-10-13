import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'Locum Radar — Find your next chapter',
  description: 'A private workspace for better Australian locum decisions.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-AU">
      <body>{children}</body>
    </html>
  );
}
