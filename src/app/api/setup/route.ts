import { NextResponse } from 'next/server';
import { z } from 'zod';
import { authenticated, configuration } from '@/server/auth';
import { credential, credentialNames, saveCredentials } from '@/server/credentials';
import { gmailStatus } from '@/server/acquisition/gmail';
export const runtime = 'nodejs';
export async function GET(request: Request) {
  try {
    if (!authenticated(request))
      return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    return NextResponse.json(
      {
        configured: Object.fromEntries(credentialNames.map((k) => [k, !!credential(k)])),
        redirectUri: configuration().origin.origin + '/api/gmail/callback',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch {
    return NextResponse.json({ error: 'Could not read connection settings' }, { status: 400 });
  }
}
const schema = z
  .object({
    GMAIL_CLIENT_ID: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/)
      .optional(),
    GMAIL_CLIENT_SECRET: z.string().trim().min(8).max(2000).optional(),
    ADZUNA_APP_ID: z.string().trim().min(1).max(2000).optional(),
    ADZUNA_APP_KEY: z.string().trim().min(1).max(2000).optional(),
    BRAVE_SEARCH_API_KEY: z.string().trim().min(1).max(2000).optional(),
    ANTHROPIC_API_KEY: z
      .string()
      .trim()
      .regex(/^sk-ant-[\w-]{20,}$/)
      .optional(),
  })
  .strict();
export async function POST(request: Request) {
  try {
    if (!authenticated(request, true))
      return NextResponse.json({ error: 'Sign in first' }, { status: 401 });
    const values = schema.parse(await request.json());
    if ((values.GMAIL_CLIENT_ID || values.GMAIL_CLIENT_SECRET) && (await gmailStatus()).connected)
      throw Error('Disconnect Gmail before replacing its app credentials');
    saveCredentials(values);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof z.ZodError
            ? 'Check the credential fields. A Google client ID ends in .apps.googleusercontent.com; an Anthropic key starts with sk-ant-.'
            : (e as Error).message,
      },
      { status: 400 },
    );
  }
}
