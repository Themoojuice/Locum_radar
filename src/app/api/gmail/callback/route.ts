import { NextResponse } from 'next/server';
import { configuration } from '@/server/auth';
import { finishGmail } from '@/server/acquisition/gmail';
import { GmailConnectionError, gmailErrorCode } from '@/domain/gmail-errors';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  const origin = configuration().origin.origin,
    url = new URL(request.url);
  let result = 'error';
  let reason = 'unknown';
  try {
    // Next may reconstruct the internal URL with localhost. Check the browser Host instead.
    if ((request.headers.get('host') || url.host) !== new URL(origin).host)
      throw new GmailConnectionError('origin');
    if (url.searchParams.has('error')) throw new GmailConnectionError('denied');
    const cookie = request.headers
      .get('cookie')
      ?.split(';')
      .map((v) => v.trim())
      .find((v) => v.startsWith('radar_gmail_oauth='))
      ?.slice('radar_gmail_oauth='.length);
    if (!cookie) throw new GmailConnectionError('cookie');
    if (!url.searchParams.get('state') || !url.searchParams.get('code'))
      throw new GmailConnectionError('expired');
    await finishGmail(url.searchParams.get('code')!, url.searchParams.get('state')!, cookie);
    result = 'connected';
  } catch (error) {
    reason = gmailErrorCode(error);
    // Only a fixed diagnostic code is logged; never log provider responses or OAuth URLs.
    console.warn('Gmail connection failed:', reason);
  }
  const response = NextResponse.redirect(
    origin + '/?gmail=' + result + (result === 'error' ? '&gmail_reason=' + reason : ''),
  );
  response.cookies.set('radar_gmail_oauth', '', { path: '/api/gmail', maxAge: 0 });
  return response;
}
