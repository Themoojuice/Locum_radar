import { NextResponse } from 'next/server';
import { configuration } from '@/server/auth';
import { finishGmail } from '@/server/acquisition/gmail';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const origin = configuration().origin.origin,
    url = new URL(request.url);
  let result = 'error';
  try {
    if (url.origin !== origin) throw new Error('Unexpected callback origin');
    const cookie = request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('radar_gmail_oauth='))
      ?.slice('radar_gmail_oauth='.length);
    if (!cookie || !url.searchParams.get('state') || !url.searchParams.get('code'))
      throw new Error('Missing OAuth response');
    await finishGmail(url.searchParams.get('code')!, url.searchParams.get('state')!, cookie);
    result = 'connected';
  } catch {
    /* Never expose an OAuth code, token or provider response. */
  }
  const response = NextResponse.redirect(origin + '/?gmail=' + result);
  response.cookies.set('radar_gmail_oauth', '', { path: '/api/gmail', maxAge: 0 });
  return response;
}
