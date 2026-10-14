import { NextResponse } from 'next/server';
import { authenticated, configuration } from '@/server/auth';
import { beginGmail, disconnectGmail, gmailLabels, gmailStatus } from '@/server/acquisition/gmail';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const status = await gmailStatus();
    let error = '';
    const labels = status.connected
      ? await gmailLabels().catch(() => {
          error = 'Gmail could not refresh labels. Disconnect and reconnect if access has expired.';
          return [];
        })
      : [];
    return NextResponse.json(
      { ...status, labels, error },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Gmail connection unavailable. Check configuration or reconnect.' },
      { status: 400 },
    );
  }
}
export async function POST(request: Request) {
  try {
    if (!authenticated(request, true))
      return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const auth = await beginGmail(),
      response = NextResponse.json({ url: auth.url });
    response.cookies.set('radar_gmail_oauth', auth.cookie, {
      httpOnly: true,
      sameSite: 'lax',
      secure: configuration().remote,
      maxAge: 600,
      path: '/api/gmail',
    });
    return response;
  } catch {
    return NextResponse.json(
      { error: 'Configure GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET and SESSION_SECRET first.' },
      { status: 400 },
    );
  }
}
export async function DELETE(request: Request) {
  try {
    if (!authenticated(request, true))
      return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    await disconnectGmail();
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Could not disconnect Gmail' }, { status: 400 });
  }
}
