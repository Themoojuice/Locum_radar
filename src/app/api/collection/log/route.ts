import { NextResponse } from 'next/server';
import { authenticated } from '@/server/auth';
import { logSince } from '@/server/progress';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  if (!authenticated(request))
    return NextResponse.json({ error: 'Sign in to view collection progress' }, { status: 401 });
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0) || 0;
  return NextResponse.json(logSince(since), { headers: { 'Cache-Control': 'private, no-store' } });
}
