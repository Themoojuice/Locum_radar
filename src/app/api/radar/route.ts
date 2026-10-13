import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated } from '@/server/auth';
import { readStore, transaction } from '@/server/database';
import { listingInputSchema, profileSchema, stages } from '@/domain/model';
import { ingest, mergeOpportunities, splitListing } from '@/domain/ingestion';
import { previewImport } from '@/server/extraction';
import { collectSource } from '@/server/collectors';
import { prepareCollection } from '@/server/maintenance';
import { requestStop } from '@/server/progress';
import { clientView } from '@/server/views';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const commandSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('profile'), profile: profileSchema }),
  z.object({
    command: z.literal('action'),
    opportunityId: z.string(),
    stage: z.enum(stages),
    notes: z.string().max(10000),
  }),
  z.object({
    command: z.literal('preview'),
    content: z.string().min(1).max(1000000),
    sourceId: z.string(),
    format: z.enum(['text', 'eml', 'json']),
  }),
  z.object({
    command: z.literal('import'),
    listings: z.array(listingInputSchema).min(1).max(100),
    reviewId: z.string().optional(),
  }),
  z.object({
    command: z.literal('source'),
    sourceId: z.string(),
    permission: z.enum(['unreviewed', 'approved', 'denied']),
    permissionEvidence: z.string().max(3000),
    enabled: z.boolean(),
  }),
  z.object({ command: z.literal('collect'), sourceId: z.string() }),
  z.object({ command: z.literal('prepare') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('merge'), from: z.string(), to: z.string() }),
  z.object({ command: z.literal('split'), listingId: z.string() }),
  z.object({ command: z.literal('resolve'), reviewId: z.string() }),
  z.object({ command: z.literal('delete'), opportunityId: z.string() }),
]);
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in to access your radar' }, { status: 401 });
    return NextResponse.json(clientView(await readStore()), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    console.error('Radar read failed:', error instanceof Error ? error.message : 'Unknown');
    return NextResponse.json(
      { error: 'Could not open the private database. Check server configuration.' },
      { status: 500 },
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!authenticated(request, true))
      return NextResponse.json({ error: 'Sign in to make changes' }, { status: 401 });
    if (Number(request.headers.get('content-length') || 0) > 1500000)
      return NextResponse.json({ error: 'Import is limited to 1.5 MB' }, { status: 413 });
    const text = await request.text();
    if (text.length > 1500000)
      return NextResponse.json({ error: 'Import is too large' }, { status: 413 });
    const body = commandSchema.parse(JSON.parse(text));
    if (body.command === 'preview')
      return NextResponse.json(
        await previewImport(
          body.content,
          body.sourceId,
          body.format,
          (await readStore()).facilities,
        ),
      );
    if (body.command === 'collect') return NextResponse.json(await collectSource(body.sourceId));
    if (body.command === 'prepare') return NextResponse.json(await prepareCollection());
    if (body.command === 'stop') {
      requestStop();
      return NextResponse.json({ ok: true });
    }
    const result = await transaction((s) => {
      switch (body.command) {
        case 'profile':
          s.profile = body.profile;
          return { ok: true };
        case 'action': {
          if (!s.opportunities.some((o) => o.id === body.opportunityId))
            throw new Error('Opportunity not found');
          s.actions = s.actions.filter((a) => a.opportunityId !== body.opportunityId);
          s.actions.push({
            opportunityId: body.opportunityId,
            stage: body.stage,
            notes: body.notes,
            updatedAt: new Date().toISOString(),
          });
          return { ok: true };
        }
        case 'import': {
          const results = body.listings.map((l) => ingest(s, l));
          if (body.reviewId) {
            const r = s.reviews.find((r) => r.id === body.reviewId);
            if (r) r.resolved = true;
          }
          return results;
        }
        case 'source': {
          const source = s.sources.find((v) => v.id === body.sourceId);
          if (!source) throw new Error('Source not found');
          if (
            body.enabled &&
            (body.permission !== 'approved' ||
              !body.permissionEvidence.trim() ||
              source.method === 'manual')
          )
            throw new Error('Enable only a supported adapter with recorded access permission.');
          Object.assign(source, {
            permission: body.permission,
            permissionEvidence: body.permissionEvidence,
            enabled: body.enabled,
          });
          return { ok: true };
        }
        case 'merge':
          mergeOpportunities(s, body.from, body.to);
          return { ok: true };
        case 'split':
          return { id: splitListing(s, body.listingId) };
        case 'resolve': {
          const item = s.reviews.find((r) => r.id === body.reviewId);
          if (!item) throw new Error('Review not found');
          item.resolved = true;
          return { ok: true };
        }
        case 'delete': {
          const ids = new Set(
            s.listings.filter((l) => l.opportunityId === body.opportunityId).map((l) => l.id),
          );
          s.listings = s.listings.filter((l) => !ids.has(l.id));
          s.offers = s.offers.filter((o) => o.opportunityId !== body.opportunityId);
          s.actions = s.actions.filter((a) => a.opportunityId !== body.opportunityId);
          s.reviews = s.reviews.filter(
            (r) => r.opportunityId !== body.opportunityId && r.candidateId !== body.opportunityId,
          );
          s.events = s.events.filter((e) => e.opportunityId !== body.opportunityId);
          s.opportunities = s.opportunities.filter((o) => o.id !== body.opportunityId);
          return { ok: true };
        }
      }
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        : error instanceof Error
          ? error.message
          : 'Request failed';
    return NextResponse.json({ error: message.slice(0, 2000) }, { status: 400 });
  }
}
