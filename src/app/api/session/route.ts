import { NextResponse } from 'next/server';
import {
  allowLogin,
  authenticated,
  checkPassword,
  createSession,
  sessionCookie,
  validateOrigin,
} from '@/server/auth';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    const config = validateOrigin(request);
    return NextResponse.json(
      { authenticated: authenticated(request), passwordRequired: !!config.password },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json(
      { error: 'Host or private-access configuration rejected.' },
      { status: 403 },
    );
  }
}
export async function POST(request: Request) {
  try {
    const config = validateOrigin(request, true);
    if (!allowLogin())
      return NextResponse.json(
        { error: 'Too many attempts. Try again in 15 minutes.' },
        { status: 429 },
      );
    const body = await request.text();
    if (body.length > 4096)
      return NextResponse.json({ error: 'Request too large' }, { status: 413 });
    const { password } = JSON.parse(body);
    if (
      typeof password !== 'string' ||
      !config.password ||
      !checkPassword(password, config.password)
    )
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookie, createSession(config.secret), {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.remote,
      path: '/',
      maxAge: 8 * 3600,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Login request or configuration rejected' }, { status: 400 });
  }
}
export async function DELETE(request: Request) {
  try {
    validateOrigin(request, true);
    const r = NextResponse.json({ ok: true });
    r.cookies.set(sessionCookie, '', { path: '/', maxAge: 0 });
    return r;
  } catch {
    return NextResponse.json({ error: 'Request rejected' }, { status: 403 });
  }
}
