'use client';
import dynamic from 'next/dynamic';

/**
 * The workspace is private, data-driven and loads everything after sign-in, so
 * it renders in the browser only. That lets it read saved filters on its first
 * render without a server/client mismatch.
 */
export const ClientApp = dynamic(() => import('./radar-app').then((m) => m.RadarApp), {
  ssr: false,
  loading: () => (
    <p role="status" className="notice boot">
      Opening your private workspace…
    </p>
  ),
});
