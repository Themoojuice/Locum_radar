import type { ReviewItem, SourceListing, Store } from '@/domain/model';

/** Characters of source text kept in list payloads; the full text is fetched on demand. */
export const PREVIEW_CHARS = 600;

/**
 * The workspace as the browser needs it for the feed. Full advertisement text,
 * extraction evidence and observation history stay on the server and are read
 * per opportunity, so national-scale data does not ship tens of megabytes to a
 * phone on every load. Resolved review items are history and are not sent.
 */
export function clientView(store: Store): Store & { partial: true } {
  return {
    ...store,
    partial: true,
    listings: store.listings.map(slimListing),
    observations: [],
    reviews: store.reviews.filter((r) => !r.resolved).map(slimReview),
  };
}
/**
 * Listing metadata only. Terms live on offers and requirements on the
 * opportunity, so the feed does not need the advertisement's copy of them; the
 * detail endpoint returns complete listings. The cast is deliberate: feed code
 * reads listing metadata only (see opportunity-detail for the full record).
 */
export function slimListing(l: SourceListing): SourceListing {
  const {
    rawText: _raw,
    evidence: _evidence,
    compensation: _pay,
    requirements: _req,
    shifts: _shifts,
    contentHash: _hash,
    ...meta
  } = l;
  void [_raw, _evidence, _pay, _req, _shifts, _hash];
  return meta as SourceListing;
}
export function slimReview(r: ReviewItem): ReviewItem & { truncated?: boolean } {
  const long = (r.rawText?.length ?? 0) > PREVIEW_CHARS || (r.draft?.rawText?.length ?? 0) > PREVIEW_CHARS;
  if (!long) return r;
  return {
    ...r,
    truncated: true,
    rawText: r.rawText ? `${r.rawText.slice(0, PREVIEW_CHARS)}…` : r.rawText,
    draft: r.draft ? { ...r.draft, rawText: undefined } : r.draft,
  };
}
