import { z } from 'zod';
export const collectorConfigSchema = z.object({
  kind: z.enum(['web', 'feed', 'sitemap', 'adzuna', 'gmail', 'search']),
  startUrls: z
    .array(z.url().refine((u) => new URL(u).protocol === 'https:', 'HTTPS required'))
    .max(12)
    .default([]),
  allowedHosts: z
    .array(z.string().regex(/^[a-z0-9.-]+$/i))
    .max(12)
    .default([]),
  detailPaths: z.array(z.string().min(1).max(200)).max(12).default([]),
  listingPaths: z.array(z.string().min(1).max(200)).max(12).default([]),
  nextSelector: z
    .string()
    .max(500)
    .default('a[rel="next"], .pagination a, .pager a, a.next, a.page-numbers'),
  contentSelector: z.string().max(500).default('main, article, [role="main"]'),
  maxPages: z.number().int().min(1).max(500).default(100),
  maxRecords: z.number().int().min(1).max(2000).default(500),
  delayMs: z.number().int().min(1000).max(60000).default(1500),
  query: z.string().max(500).default('locum doctor'),
  labelId: z.string().max(200).default(''),
  lookbackDays: z.number().int().min(1).max(365).default(90),
});
export type CollectorConfig = z.infer<typeof collectorConfigSchema>;
export interface FrontierItem {
  url: string;
  kind: 'listing' | 'detail' | 'feed' | 'sitemap' | 'api' | 'message';
  offset?: number;
  pageHash?: string;
  signature?: string;
}
export interface CrawlState {
  id: string;
  startedAt: string;
  queue: FrontierItem[];
  seen: string[];
  pages: number;
  records: number;
  newRecords?: number;
  reused?: number;
  errors: string[];
  limited: boolean;
  complete: boolean;
  configHash: string;
  leaseUntil?: string;
  leaseOwner?: string;
  retryAfter?: string;
}
export interface AcquisitionDocument {
  id: string;
  sourceId: string;
  externalId: string;
  url: string | null;
  title: string;
  text: string;
  contentHash: string;
  observedAt: string;
  publishedAt: string | null;
  kind: 'vacancy' | 'lead' | 'email';
}
