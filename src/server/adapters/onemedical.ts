import { load } from 'cheerio';
import { classifyRole, stateFrom } from './email-formats';
import type { CollectContext, CustomAdapter, JsonBlock } from './json-sources';

/**
 * 1Medical publishes a WordPress REST index of job posts whose titles encode
 * "Specialty | STATE | start | end". Town, rate and grade appear only on each
 * job page (about 1 MB each), so the collector reads the whole index cheaply,
 * keeps active posts within the profile's scope, and fetches detail pages only
 * for posts it has not seen, up to a per-run limit.
 */
const BASE = 'https://www.1medical.com.au';
export interface IndexEntry {
  id: number;
  link: string;
  specialty: string;
  state: string | null;
  start: string | null;
  end: string | null;
  title: string;
}
const decode = (v: string) => load(`<p>${v}</p>`)('p').text();
const dmy = (v: string) => {
  const m = v.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export function parseOneMedicalIndex(body: unknown): IndexEntry[] {
  if (!Array.isArray(body)) throw new Error('Unexpected 1Medical index shape');
  return body.flatMap((p: { id?: number; link?: string; title?: { rendered?: string } }) => {
    const title = decode(p.title?.rendered ?? '');
    const parts = title.split('|').map((v) => v.trim());
    if (!p.id || !p.link || parts.length !== 4) return [];
    return [
      {
        id: p.id,
        link: p.link,
        specialty: parts[0],
        state: stateFrom(parts[1]),
        start: dmy(parts[2]),
        end: dmy(parts[3]),
        title,
      },
    ];
  });
}

const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const dMonY = (v: string) => {
  const m = v.match(/(\d{1,2})-([A-Za-z]{3})-(\d{4})/);
  if (!m) return null;
  const month = months.indexOf(m[2].toLowerCase()) + 1;
  return month ? `${m[3]}-${String(month).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
};
export function parseOneMedicalDetail(html: string) {
  const $ = load(html);
  const role = $('h1').first().text().replace(/\s+/g, ' ').trim();
  const items = $('.role_detail_box li')
    .toArray()
    .map((li) => $(li).text().replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const location = items.find((v) => /,\s*[A-Z][a-z]+/.test(v) && !/\$/.test(v)) ?? '';
  const [town, stateName] = location.split(/,\s*/);
  const rateText = items.find((v) => /\$/.test(v)) ?? '';
  const startText = items.find((v) => /\d{1,2}-[A-Za-z]{3}-\d{4}/.test(v)) ?? '';
  const [startRaw, endRaw] = startText.replace(/^Starting\s*/i, '').split(/\s+-\s+/);
  const benefits = $('.jobdetail-page').text().replace(/\s+/g, ' ');
  return {
    role,
    town: (town ?? '').replace(/\s*\([^)]*\)/g, '').trim(),
    state: stateFrom(stateName ?? ''),
    rateText,
    start: startRaw ? dMonY(startRaw) : null,
    end: endRaw ? dMonY(endRaw) : null,
    accommodation: /travel and accommodation (are |is )?(provided|included)/i.test(benefits),
  };
}

export function oneMedicalBlock(entry: IndexEntry, html: string): JsonBlock {
  const d = parseOneMedicalDetail(html);
  const notes: string[] = [];
  const role = classifyRole(`${d.role} ${entry.specialty}`);
  notes.push(...role.notes);
  const rate = d.rateText.match(/^\$\s?([\d,]+(?:\.\d+)?)\s*per\s+(hour|day|shift)$/i);
  if (d.rateText && !rate) notes.push(`Rate needs review: "${d.rateText}".`);
  if (!d.town) notes.push('The job page gives no town.');
  notes.push('1Medical names the town, not the hospital; the facility is matched by town.');
  const start = d.start ?? entry.start,
    end = d.end ?? entry.end;
  if (!start) notes.push('Start is "ASAP" or missing; confirm the date.');
  return {
    labelled: [
      ['Title', `${d.role || entry.specialty} – ${d.town}`],
      ['Hospital', d.town],
      ['Town', d.town],
      ['State', d.state ?? entry.state],
      ['Specialty', role.specialty],
      ['Grade', role.grade],
      ['Minimum PGY', role.minPgy],
      ['Start', start],
      ['End', end],
      ['Rate', rate ? `AUD ${rate[1].replace(/,/g, '')}/${rate[2].toLowerCase()}` : null],
      ['Accommodation', d.accommodation ? 'included' : null],
      ['Listing ID', `1medical-${entry.id}`],
      ['URL', entry.link],
    ]
      .filter(([, v]) => v !== null && v !== undefined && v !== '')
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
    raw: [
      entry.title,
      d.role,
      `${d.town}, ${d.state ?? ''}`,
      d.rateText,
      d.accommodation ? 'Travel and accommodation provided.' : '',
    ]
      .filter(Boolean)
      .join('\n'),
    notes,
    url: entry.link,
  };
}

export const oneMedical: CustomAdapter = {
  sourceId: '1medical',
  hosts: ['www.1medical.com.au'],
  access: 'site-endpoint',
  robotsUrl: `${BASE}/robots.txt`,
  async collect(ctx: CollectContext) {
    const today = new Date().toISOString().slice(0, 10);
    const wanted: IndexEntry[] = [];
    let total = 0,
      active = 0;
    const maxIndexPages = ctx.env.DRY_RUN === 'true' ? 1 : 80;
    for (let page = 1; page <= maxIndexPages && !ctx.stopped(); page++) {
      if (page > 1) await ctx.pause();
      const res = await ctx.get(
        `${BASE}/wp-json/wp/v2/job_posts?per_page=100&page=${page}&_fields=id,link,title`,
        'application/json',
      );
      if (res.status === 400) break; // WordPress answers 400 past the last page.
      if (res.status !== 200) throw new Error(`1Medical index returned HTTP ${res.status}`);
      const entries = parseOneMedicalIndex(JSON.parse(res.text));
      total += entries.length;
      for (const e of entries) {
        if (!e.end || e.end < today) continue;
        active++;
        if (!ctx.seen.has(`1medical-${e.id}`)) wanted.push(e);
      }
      if (entries.length < 100) break;
    }
    const limit = Number(ctx.env.ONEMEDICAL_DETAIL_LIMIT ?? 150);
    // Everything is collected eventually; the most relevant and soonest jobs come first.
    const rank = new Map(
      wanted.map((e) => [e.id, ctx.relevance(classifyRole(e.specialty).specialty, e.state)]),
    );
    wanted.sort(
      (a, b) =>
        rank.get(b.id)! - rank.get(a.id)! || (a.start ?? '9999').localeCompare(b.start ?? '9999'),
    );
    ctx.log(
      `Index: ${total} posts, ${active} active, ${wanted.length} not yet read; reading up to ${limit} job pages, most relevant first.`,
    );
    const blocks: JsonBlock[] = [];
    for (const entry of wanted.slice(0, limit)) {
      if (ctx.stopped()) break;
      await ctx.pause();
      const res = await ctx.get(entry.link, 'text/html');
      if (res.status !== 200) {
        ctx.log(`Job ${entry.id} returned HTTP ${res.status}; skipped.`, 'warn');
        continue;
      }
      blocks.push(oneMedicalBlock(entry, res.text));
      if (blocks.length % 25 === 0)
        ctx.log(`Read ${blocks.length} of ${Math.min(limit, wanted.length)} job pages.`);
    }
    if (wanted.length > limit)
      ctx.log(
        `${wanted.length - limit} posts remain; they will be read on the next runs (raise ONEMEDICAL_DETAIL_LIMIT to read more at once).`,
        'warn',
      );
    return blocks;
  },
};
