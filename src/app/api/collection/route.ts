import { NextResponse } from 'next/server';
import { authenticated } from '@/server/auth';
import { readStore } from '@/server/database';
import { collectionPlan } from '@/domain/collection';
import { gmailStatus } from '@/server/acquisition/gmail';
import { sourceAdapters } from '@/server/adapters/registry';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in to view collection progress' }, { status: 401 });
    const gmail = await gmailStatus().catch(() => ({ configured: false, connected: false }));
    return NextResponse.json(
      collectionPlan(await readStore(), process.env.COLLECTOR_ENABLED === 'true', Date.now(), {
        ...Object.fromEntries(
          Object.values(sourceAdapters).flatMap((a) => {
            const missing = a.missingConfig?.(process.env);
            return missing ? [[a.sourceId, missing]] : [];
          }),
        ),
        gmail: gmail.connected ? [] : ['Connect Gmail in Sources'],
        adzuna:
          process.env.ADZUNA_APP_ID && process.env.ADZUNA_APP_KEY
            ? []
            : ['Adzuna API credentials needed'],
        search: process.env.BRAVE_SEARCH_API_KEY ? [] : ['Brave Search API key needed'],
      }),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch {
    return NextResponse.json({ error: 'Could not read source progress' }, { status: 400 });
  }
}
