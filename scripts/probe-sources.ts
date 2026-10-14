// Read-only research aid. Saves public response fixtures locally; never enables a collector.
import { mkdir, writeFile } from 'node:fs/promises';
import { load } from 'cheerio';
const sources = process.argv.includes('--details')
  ? [
      ['ochre-detail', 'https://ochrerecruitment.com/job/ed-registrar-darwin-nt-jref-116410'],
      ['medrecruit-list', 'https://medrecruit.medworld.com/jobs/listing'],
    ]
  : [
      ['ochre', 'https://ochrerecruitment.com/medical-jobs'],
      ['medrecruit', 'https://medrecruit.medworld.com/jobs'],
      ['skilled', 'https://www.skilledmedical.com/'],
      ['jps', 'https://www.jpsmedical.com.au/jobs/'],
      ['cmr', 'https://www.cmr.com.au/medical-jobs/'],
      ['qld', 'https://smartjobs.qld.gov.au/jobtools/jncustomsearch.jobsearch?in_organid=14904'],
    ];
await mkdir('data/research', { recursive: true });
for (const [id, url] of sources) {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(25000),
      headers: { 'User-Agent': 'LocumRadar/0.2 source compatibility research' },
    });
    const html = await response.text();
    await writeFile(`data/research/${id}.html`, html);
    const $ = load(html);
    const links = [
      ...new Set(
        $('a[href]')
          .map((_, a) => $(a).attr('href'))
          .get(),
      ),
    ];
    const robots = await fetch(new URL('/robots.txt', response.url), {
      signal: AbortSignal.timeout(10000),
    });
    const rules = await robots.text();
    await writeFile(`data/research/${id}-robots.txt`, rules);
    console.log(
      JSON.stringify({
        id,
        status: response.status,
        url: response.url,
        title: $('title').text(),
        jsonld: $('script[type="application/ld+json"]').length,
        links: links.filter((l) => /job|vacanc|locum|page=|rss|feed/i.test(l)).slice(0, 18),
        robots: { status: robots.status, text: rules.slice(0, 1800) },
      }),
    );
  } catch (error) {
    console.log(JSON.stringify({ id, error: (error as Error).message }));
  }
}
