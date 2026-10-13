import { NextResponse } from 'next/server';
import { authenticated } from '@/server/auth';
import { readStore } from '@/server/database';
import { collectionPlan } from '@/domain/collection';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in to view collection progress' }, { status: 401 });
    return NextResponse.json(
      collectionPlan(await readStore(), process.env.COLLECTOR_ENABLED === 'true'),
      {
        headers: { 'Cache-Control': 'private, no-store' },
      },
    );
  } catch {
    return NextResponse.json({ error: 'Could not read source progress' }, { status: 400 });
  }
}
