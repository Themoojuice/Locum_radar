export const gmailErrors = {
  expired:
    'The Google connection attempt expired or was replaced by another attempt. Click Connect Gmail with Google again in this tab and finish within 10 minutes.',
  cookie:
    'The connection cookie was missing when Google returned. Start again from this same browser at the address shown below; avoid switching between localhost and 127.0.0.1.',
  origin:
    'Google returned to a different app address. Check the exact redirect URI in Google app settings.',
  denied:
    'Google sign-in was cancelled or access was declined. Connect again and allow read-only access to Gmail.',
  scope:
    'Google did not grant the requested Gmail read permission. Connect again and select the Gmail permission on the consent screen.',
  refresh:
    'Google did not return ongoing access. Reconnect and complete the consent screen. If it repeats, remove Locum Radar from your Google account connections, then reconnect.',
  invalid_client:
    'Google rejected the app credentials. In Change Google app settings, check that the client ID and client secret belong to the same Web application client.',
  invalid_grant:
    'Google rejected the sign-in code. Start a fresh connection attempt; do not reload an old Google callback page.',
  network:
    'The app could not reach Google to finish sign-in. Check your internet connection, then reconnect.',
  storage:
    'Google authorised access, but Locum Radar could not save the connection locally. Check the server data directory and try again.',
  unknown:
    'The Google handoff failed. Start a fresh connection attempt. If it repeats, share the error reference shown here.',
} as const;
export type GmailErrorCode = keyof typeof gmailErrors;
export class GmailConnectionError extends Error {
  constructor(public code: GmailErrorCode) {
    super(code);
  }
}
export function gmailErrorCode(error: unknown): GmailErrorCode {
  if (error instanceof GmailConnectionError) return error.code;
  const e = error as { response?: { data?: { error?: unknown } }; code?: unknown };
  const code = e?.response?.data?.error;
  if (code === 'invalid_client' || code === 'invalid_grant') return code;
  if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'ECONNREFUSED'].includes(String(e?.code)))
    return 'network';
  return 'unknown';
}
export function gmailErrorMessage(code: string | null) {
  return gmailErrors[
    code && Object.hasOwn(gmailErrors, code) ? (code as GmailErrorCode) : 'unknown'
  ];
}
