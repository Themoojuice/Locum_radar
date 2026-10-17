import { it, expect, vi, beforeEach, afterEach } from 'vitest';
const finish = vi.hoisted(() => vi.fn());
vi.mock('@/server/acquisition/gmail', () => ({ finishGmail: finish }));
import { GET } from '@/app/api/gmail/callback/route';
import { GmailConnectionError, gmailErrorCode, gmailErrorMessage } from '@/domain/gmail-errors';
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'http://127.0.0.1:3000');
  vi.stubEnv('APP_PASSWORD', '');
  finish.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
const request = (host = '127.0.0.1:3000', cookie = true) =>
  new Request('http://localhost:3000/api/gmail/callback?code=private-code&state=state', {
    headers: {
      host,
      'sec-fetch-site': 'cross-site',
      ...(cookie ? { cookie: 'radar_gmail_oauth=sealed-state' } : {}),
    },
  });
it('accepts the configured browser host despite an internal localhost URL and verifies state', async () => {
  finish.mockResolvedValue(undefined);
  const response = await GET(request());
  expect(finish).toHaveBeenCalledWith('private-code', 'state', 'sealed-state');
  expect(response.headers.get('location')).toBe('http://127.0.0.1:3000/?gmail=connected');
  expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
});
it('rejects a different host before exchanging credentials', async () => {
  const response = await GET(request('other.example'));
  expect(finish).not.toHaveBeenCalled();
  expect(response.headers.get('location')).toContain('gmail_reason=origin');
});
it('reports a lost cookie without exchanging the code', async () => {
  const response = await GET(request('127.0.0.1:3000', false));
  expect(finish).not.toHaveBeenCalled();
  expect(response.headers.get('location')).toContain('gmail_reason=cookie');
});
it('reports only an allowlisted provider error and never its secret-bearing response', async () => {
  finish.mockRejectedValue({
    response: { data: { error: 'invalid_client', error_description: 'private-secret' } },
  });
  const response = await GET(request());
  expect(response.headers.get('location')).toContain('gmail_reason=invalid_client');
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('private-secret');
  expect(response.headers.get('location')).not.toContain('private-code');
});
it('distinguishes permission failures and safely handles unknown errors', () => {
  expect(gmailErrorCode(new GmailConnectionError('scope'))).toBe('scope');
  expect(gmailErrorCode({ response: { data: { error: 'private-secret' } } })).toBe('unknown');
  expect(gmailErrorMessage('scope')).toContain('permission');
  expect(gmailErrorMessage('unknown-input')).toContain('handoff failed');
});
