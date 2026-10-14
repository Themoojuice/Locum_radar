import { OAuth2Client, CodeChallengeMethod, type Credentials } from 'google-auth-library';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { configuration } from '../auth';
import { plainText } from '../extraction';
import { candidate, type Candidate } from './parsers';
import { transaction } from '../database';
import { configForSource } from '@/domain/source-catalog';
export const gmailScope = 'https://www.googleapis.com/auth/gmail.readonly';
const tokenFile = () => path.resolve('data/secrets/gmail.enc');
function key() {
  const secret = process.env.SESSION_SECRET || '';
  if (secret.length < 32)
    throw new Error('Gmail requires SESSION_SECRET with at least 32 characters');
  return createHash('sha256')
    .update('locum-radar:gmail:' + secret)
    .digest();
}
export function seal(value: unknown) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), content]).toString('base64url');
}
export function unseal<T>(text: string): T {
  const b = Buffer.from(text, 'base64url');
  const decipher = createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString());
}
export function gmailConfigured() {
  return (
    !!process.env.GMAIL_CLIENT_ID &&
    !!process.env.GMAIL_CLIENT_SECRET &&
    (process.env.SESSION_SECRET?.length || 0) >= 32
  );
}
function client() {
  if (!gmailConfigured()) throw new Error('Configure the Google client and session secret first');
  return new OAuth2Client(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    configuration().origin.origin + '/api/gmail/callback',
  );
}
type Tokens = Credentials;
async function saveTokens(tokens: Tokens) {
  const file = tokenFile();
  await mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.' + randomBytes(6).toString('hex') + '.tmp';
  await writeFile(temp, seal(tokens), { mode: 0o600 });
  await rename(temp, file);
}
async function readTokens(): Promise<Tokens | null> {
  try {
    return unseal<Tokens>(await readFile(tokenFile(), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(
      'Gmail connection could not be decrypted; reconnect after checking your secret',
      { cause: error },
    );
  }
}
export async function gmailStatus() {
  return { configured: gmailConfigured(), connected: gmailConfigured() && !!(await readTokens()) };
}
export async function beginGmail() {
  const oauth = client(),
    { codeVerifier, codeChallenge } = await oauth.generateCodeVerifierAsync();
  const state = randomBytes(24).toString('hex');
  return {
    cookie: seal({ state, codeVerifier, expires: Date.now() + 600000 }),
    url: oauth.generateAuthUrl({
      access_type: 'offline',
      scope: [gmailScope],
      prompt: 'consent',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: CodeChallengeMethod.S256,
    }),
  };
}
export async function finishGmail(code: string, state: string, cookie: string) {
  const saved = unseal<{ state: string; codeVerifier: string; expires: number }>(cookie);
  if (
    saved.expires < Date.now() ||
    state.length !== saved.state.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(saved.state))
  )
    throw new Error('OAuth state expired or mismatched');
  const oauth = client();
  const { tokens } = await oauth.getToken({ code, codeVerifier: saved.codeVerifier });
  if (!tokens.refresh_token || !tokens.scope?.split(' ').includes(gmailScope))
    throw new Error('Read-only Gmail access was not granted');
  await resetGmailSelection();
  const work = tokenQueue.catch(() => {}).then(() => saveTokens(tokens));
  tokenQueue = work;
  await work;
}
async function resetGmailSelection() {
  await transaction((store) => {
    for (const source of store.sources) {
      const config = configForSource(source);
      if (config?.kind !== 'gmail') continue;
      source.enabled = false;
      source.collector = { ...config, labelId: '' };
      delete source.crawl;
      source.lastSuccess = null;
      source.lastAttempt = null;
    }
  });
}
let tokenQueue: Promise<unknown> = Promise.resolve();
export async function gmailRequest<T>(relative: string): Promise<T> {
  if (!relative.startsWith('/gmail/v1/users/me/') || relative.includes('..'))
    throw new Error('Invalid Gmail endpoint');
  const work = tokenQueue
    .catch(() => {})
    .then(async () => {
      const tokens = await readTokens();
      if (!tokens) throw new Error('Connect Gmail first');
      const oauth = client();
      oauth.setCredentials(tokens);
      try {
        const result = await oauth.request<T>({
          url: 'https://gmail.googleapis.com' + relative,
          method: 'GET',
          timeout: 20000,
          retry: false,
          maxContentLength: 4000000,
          redirect: 'error',
        });
        if (oauth.credentials.access_token !== tokens.access_token)
          await saveTokens(oauth.credentials);
        return result.data;
      } catch {
        throw new Error(
          'Gmail request failed. Check the selected label or reconnect your account.',
        );
      }
    });
  tokenQueue = work;
  return work;
}
export async function gmailLabels() {
  const data = await gmailRequest<{ labels?: { id: string; name: string; type: string }[] }>(
    '/gmail/v1/users/me/labels',
  );
  return (data.labels || []).filter((l) => l.type === 'user').map(({ id, name }) => ({ id, name }));
}
export async function disconnectGmail() {
  // Local disconnect removes the stored connection; the user can also revoke consent in Google.
  await resetGmailSelection();
  const work = tokenQueue
    .catch(() => {})
    .then(async () => {
      await unlink(tokenFile()).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    });
  tokenQueue = work;
  await work;
}
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
export function parseGmailMessage(
  message: { id: string; labelIds?: string[]; internalDate?: string; payload?: GmailPart },
  labelId: string,
  sourceId: string,
): Candidate[] {
  if (!labelId || !message.labelIds?.includes(labelId)) return [];
  const texts: string[] = [],
    html: string[] = [],
    attachments: string[] = [];
  let nodes = 0;
  const walk = (part: GmailPart, depth = 0) => {
    if (++nodes > 200 || depth > 12) return;
    if (part.filename) {
      attachments.push(part.filename);
      return;
    }
    if (part.body?.data && part.body.data.length <= 2000000) {
      const value = Buffer.from(part.body.data, 'base64url').toString('utf8');
      if (part.mimeType === 'text/plain') texts.push(value);
      else if (part.mimeType === 'text/html') html.push(plainText(value));
    }
    part.parts?.forEach((p) => walk(p, depth + 1));
  };
  walk(message.payload || {});
  const headers = message.payload?.headers || [];
  const subject =
    headers.find((h) => h.name.toLowerCase() === 'subject')?.value || 'Recruiter message';
  const sender = headers.find((h) => h.name.toLowerCase() === 'from')?.value || 'Unknown sender';
  const body = (texts.length ? texts : html).join('\n').slice(0, 100000);
  const parts = body
    .split(/\n\s*---+\s*\n/)
    .filter(Boolean)
    .slice(0, 100);
  if (!parts.length) parts.push('No readable message body. Review the original email.');
  const timestamp = Number(message.internalDate);
  return parts.map((part, index) => {
    const item = candidate(
      subject,
      `Sender: ${sender}\n${part}`,
      message.id + ':' + index,
      null,
      sourceId,
      'email',
      Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp).toISOString() : null,
    );
    if (attachments.length)
      item.extractions.forEach((e) =>
        e.issues.unshift(
          `Attachments need separate review: ${attachments.join(', ').slice(0, 1000)}. No attachment content was extracted.`,
        ),
      );
    return item;
  });
}
