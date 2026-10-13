import { NextResponse } from 'next/server';
import { authenticated } from '@/server/auth';
import { readObservations, readStore } from '@/server/database';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Full source evidence for one opportunity (listings with raw text, extraction
 * evidence and observation history) or one review item. The feed payload omits
 * these to stay small at national volume.
 */
export async function GET(request: Request) {
  if (!authenticated(request))
    return NextResponse.json({ error: 'Sign in to access your radar' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const opportunityId = params.get('opportunity'),
    reviewId = params.get('review');
  const store = await readStore();
  const headers = { 'Cache-Control': 'private, no-store' };
  if (reviewId) {
    const review = store.reviews.find((r) => r.id === reviewId);
    if (!review) return NextResponse.json({ error: 'Review not found' }, { status: 404 });
    return NextResponse.json({ review }, { headers });
  }
  if (!opportunityId)
    return NextResponse.json({ error: 'Name an opportunity or review' }, { status: 400 });
  const listings = store.listings.filter((l) => l.opportunityId === opportunityId);
  if (!listings.length && !store.opportunities.some((o) => o.id === opportunityId))
    return NextResponse.json({ error: 'Opportunity not found' }, { status: 404 });
  const observations = await readObservations(listings.map((l) => l.id));
  const events = store.events.filter((e) => e.opportunityId === opportunityId);
  return NextResponse.json({ listings, observations, events }, { headers });
}
