import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated } from '@/server/auth';
import { readStore, transaction } from '@/server/database';
import { listingInputSchema, profileSchema, stages } from '@/domain/model';
import { ingest, mergeOpportunities, splitListing } from '@/domain/ingestion';
import { previewImport } from '@/server/extraction';
import { collectSource, configIdentity } from '@/server/collectors';
import { collectorConfigSchema } from '@/domain/acquisition';
import { configForSource, sourceRecipes, sourceFromRecipe } from '@/domain/source-catalog';
import { prepareCollection } from '@/server/maintenance';
import { requestStop } from '@/server/progress';
import { sourceAdapters } from '@/server/adapters/registry';
import { collectionEnabled } from '@/server/public-starter';
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
    collector: collectorConfigSchema.optional(),
    refreshGmail: z.boolean().optional(),
  }),
  z.object({ command: z.literal('catalog') }),
  z.object({
    command: z.literal('add-source'),
    name: z.string().min(1).max(150),
    collector: collectorConfigSchema,
  }),
  z.object({ command: z.literal('clear-evidence'), sourceId: z.string() }),
  z.object({ command: z.literal('collect'), sourceId: z.string() }),
  z.object({ command: z.literal('prepare') }),
  z.object({ command: z.literal('stop') }),
  z.object({ command: z.literal('merge'), from: z.string(), to: z.string() }),
  z.object({ command: z.literal('split'), listingId: z.string() }),
  z.object({ command: z.literal('resolve'), reviewId: z.string() }),
  z.object({ command: z.literal('delete'), opportunityId: z.string() }),
]);
import { screenStoredEmail } from '@/domain/email-screening';
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in to access your radar' }, { status: 401 });
    const store = await readStore();
    const documents = new Map(store.documents.map((d) => [d.id, d]));
    const reviews = store.reviews.map((r) =>
      r.publishedAt !== undefined
        ? r
        : {
            ...r,
            publishedAt:
              documents.get(r.id.replace(/^acquire-/, '').replace(/-\d+$/, ''))?.publishedAt ??
              null,
          },
    );
    // Evidence versions stay on the server; current review drafts already contain their relevant text.
    return NextResponse.json(
      { ...store, reviews, documents: [], starterAvailable: collectionEnabled() },
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
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
    if (body.command === 'collect') {
      requestStop(false);
      return NextResponse.json(await collectSource(body.sourceId));
    }
    if (body.command === 'prepare') return NextResponse.json(await prepareCollection());
    if (body.command === 'stop') {
      requestStop();
      return NextResponse.json({ ok: true });
    }
    const result = await transaction((s) => {
      switch (body.command) {
        case 'catalog': {
          for (const recipe of sourceRecipes) {
            const existing = s.sources.find((v) => v.id === recipe.id);
            if (!existing) s.sources.push(sourceFromRecipe(recipe));
            else {
              existing.collector ??= structuredClone(recipe.config);
              existing.qualification = recipe.qualification;
              if (recipe.accessRestriction && existing.permission === 'unreviewed') {
                existing.permission = 'denied';
                existing.permissionEvidence = recipe.accessRestriction;
                existing.enabled = false;
              }
              existing.method = sourceAdapters[existing.id] ? 'json-api' : 'collector';
            }
          }
          return { ok: true };
        }
        case 'add-source': {
          const id = 'custom-' + crypto.randomUUID();
          s.sources.push({
            id,
            name: body.name,
            url: body.collector.startUrls[0] || 'https://search.brave.com/',
            type: 'discovery',
            method: 'collector',
            collector: body.collector,
            permission: 'unreviewed',
            permissionEvidence: '',
            enabled: false,
            intervalHours: 24,
            lastSuccess: null,
            lastAttempt: null,
            error: null,
          });
          return { id };
        }
        case 'clear-evidence': {
          const source = s.sources.find((v) => v.id === body.sourceId);
          if (
            !source ||
            source.enabled ||
            (source.crawl?.leaseUntil && Date.parse(source.crawl.leaseUntil) > Date.now())
          )
            throw new Error(
              'Disable the source and wait for any active batch before clearing its evidence',
            );
          s.documents = s.documents.filter((d) => d.sourceId !== source.id);
          s.reviews = s.reviews.filter((r) => r.sourceId !== source.id || r.kind !== 'extraction');
          delete source.crawl;
          source.lastSuccess = null;
          return { ok: true };
        }
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
            body.collector &&
            configIdentity(source) !== configIdentity({ ...source, collector: body.collector })
          ) {
            if (source.crawl?.leaseUntil && Date.parse(source.crawl.leaseUntil) > Date.now())
              throw new Error('Wait for the current batch before changing the search scope');
            delete source.crawl;
            source.lastAttempt = null;
          }
          if (
            body.enabled &&
            (body.permission !== 'approved' ||
              !body.permissionEvidence.trim() ||
              !(
                body.collector ||
                configForSource(source) ||
                (source.method === 'json-api' && sourceAdapters[source.id])
              ))
          )
            throw new Error('Enable only a supported adapter with recorded access permission.');
          if (body.refreshGmail && body.collector?.kind === 'gmail') {
            if (source.crawl?.leaseUntil && Date.parse(source.crawl.leaseUntil) > Date.now())
              throw new Error('Wait for the current Gmail batch to finish');
            // Explicit refresh bypasses the scheduled interval; an unfinished scan resumes.
            if (source.crawl?.complete) delete source.crawl;
            source.lastAttempt = null;
          }
          if (body.collector?.kind === 'gmail') {
            for (const review of s.reviews.filter(
              (r) => r.sourceId === source.id && r.kind === 'extraction',
            ))
              review.emailScreen = screenStoredEmail(
                review,
                body.collector.gmailSenders,
                body.collector.gmailMode === 'label',
              );
          }
          Object.assign(source, {
            permission: body.permission,
            permissionEvidence: body.permissionEvidence,
            enabled: body.enabled,
            ...(body.collector ? { collector: body.collector, method: 'collector' } : {}),
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
          s.observations = s.observations.filter((o) => !ids.has(o.listingId));
          s.listings = s.listings.filter((l) => !ids.has(l.id));
          s.offers = s.offers.filter((o) => o.opportunityId !== body.opportunityId);
          s.actions = s.actions.filter((a) => a.opportunityId !== body.opportunityId);
          s.reviews = s.reviews.filter(
            (r) => r.opportunityId !== body.opportunityId && r.candidateId !== body.opportunityId,
          );
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
