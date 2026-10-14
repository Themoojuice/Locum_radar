import https from 'node:https';
import { lookup } from 'node:dns/promises';
import robotsParser from 'robots-parser';
export const userAgent = 'LocumRadar/0.2 (personal vacancy research)';
export function publicIpv4(address: string) {
  const p = address.split('.').map(Number);
  return (
    p.length === 4 &&
    p.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    ![0, 10, 127].includes(p[0]) &&
    p[0] < 224 &&
    !(p[0] === 169 && p[1] === 254) &&
    !(p[0] === 172 && p[1] >= 16 && p[1] <= 31) &&
    !(p[0] === 192 && [168, 0, 2].includes(p[1])) &&
    !(p[0] === 100 && p[1] >= 64 && p[1] <= 127) &&
    !(p[0] === 198 && [18, 19, 51].includes(p[1])) &&
    !(p[0] === 203 && p[1] === 0)
  );
}
export function safeUrl(url: string, hosts: string[]) {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      hosts.includes(u.hostname) &&
      !u.username &&
      !u.password &&
      (!u.port || u.port === '443')
    );
  } catch {
    return false;
  }
}
export interface PageResponse {
  status: number;
  text: string;
  url: string;
  retryAfter?: string;
  location?: string;
}
export async function requestPage(
  url: string,
  hosts: string[],
  headers: Record<string, string> = {},
): Promise<PageResponse> {
  if (!safeUrl(url, hosts)) throw new Error('URL outside configured HTTPS hosts');
  const u = new URL(url);
  let dnsTimer: ReturnType<typeof setTimeout> | undefined;
  const addresses = await Promise.race([
    lookup(u.hostname, { family: 4, all: true }),
    new Promise<never>((_, reject) => {
      dnsTimer = setTimeout(() => reject(new Error('DNS timeout')), 10000);
    }),
  ]).finally(() => clearTimeout(dnsTimer));
  if (!addresses.length || addresses.some((a) => !publicIpv4(a.address)))
    throw new Error('Non-public network address rejected');
  return new Promise((resolve, reject) => {
    const req = https.get(
      u,
      {
        family: 4,
        headers: {
          'User-Agent': userAgent,
          'Accept-Encoding': 'identity',
          Accept: 'text/html,application/json,application/xml,text/plain',
          ...headers,
        },
        lookup: (_host, _options, cb) => cb(null, addresses[0].address, 4),
      },
      (res) => {
        const buffers: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 4000000) res.destroy(new Error('Response exceeds 4 MB'));
          else buffers.push(chunk);
        });
        res.on('end', () => {
          clearTimeout(timer);
          resolve({
            status: res.statusCode || 500,
            text: Buffer.concat(buffers).toString('utf8'),
            url,
            retryAfter: res.headers['retry-after'],
            location: res.headers.location,
          });
        });
        res.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('Request timed out')), 20000);
    req.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}
export function robotsAllows(text: string, url = 'https://example.com/jobs') {
  if (!/user-agent\s*:/i.test(text) || /<html/i.test(text)) return false;
  return (
    robotsParser(new URL('/robots.txt', url).href, text).isAllowed(url, 'LocumRadar') !== false
  );
}
export class PoliteReader {
  private robots = new Map<string, ReturnType<typeof robotsParser>>();
  private last = new Map<string, number>();
  constructor(
    private hosts: string[],
    private delay: number,
    private fetcher = requestPage,
  ) {}
  async read(url: string, redirects = 0): Promise<PageResponse> {
    if (!safeUrl(url, this.hosts)) throw new Error('URL outside source scope');
    const u = new URL(url);
    if (!this.robots.has(u.origin)) {
      const robotsUrl = new URL('/robots.txt', u).href;
      const r = await this.fetcher(robotsUrl, this.hosts);
      if (r.status !== 200 && r.status !== 404 && r.status !== 410)
        throw new Error('Robots rules unavailable; retry after source review');
      if (r.status === 200 && (!/user-agent\s*:/i.test(r.text) || /<html/i.test(r.text)))
        throw new Error('Unrecognised robots response');
      this.robots.set(
        u.origin,
        robotsParser(robotsUrl, r.status === 200 ? r.text : 'User-agent: *\nDisallow:'),
      );
      this.last.set(u.origin, Date.now());
    }
    const rules = this.robots.get(u.origin)!;
    if (rules.isAllowed(url, 'LocumRadar') === false)
      throw new Error('Path disallowed by robots rules');
    const delay = Math.max(this.delay, (rules.getCrawlDelay('LocumRadar') || 0) * 1000);
    if (delay > 60000) throw new Error('Source requires a crawl delay above this worker budget');
    await new Promise((r) =>
      setTimeout(r, Math.max(0, delay - (Date.now() - (this.last.get(u.origin) || 0)))),
    );
    const response = await this.fetcher(url, this.hosts);
    this.last.set(u.origin, Date.now());
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (!response.location || redirects >= 3) throw new Error('Redirect limit reached');
      return this.read(new URL(response.location, url).href, redirects + 1);
    }
    if (response.status === 429)
      throw new Error('Source rate-limited collection; wait before retrying');
    if (response.status >= 500 && redirects === 0) {
      await new Promise((r) => setTimeout(r, Math.max(delay, 2000)));
      return this.read(url, 1);
    }
    if (response.status !== 200)
      throw new Error(`HTTP ${response.status}; existing vacancies retained`);
    return response;
  }
}
