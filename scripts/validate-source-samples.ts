import { readFile } from 'node:fs/promises';
import { parseWeb } from '../src/server/acquisition/parsers';
import { sourceRecipes } from '../src/domain/source-catalog';
for (const [id, file, url, detail] of [
  ['ochre', 'ochre', 'https://ochrerecruitment.com/medical-jobs', false],
  [
    'ochre',
    'ochre-detail',
    'https://ochrerecruitment.com/job/ed-registrar-darwin-nt-jref-116410',
    true,
  ],
  ['salt', 'salt', 'https://saltmedics.com/doctor-jobs/', false],
  ['salt', 'salt-detail', 'https://saltmedics.com/job/consultant-anaesthetist-rockhampton/', true],
  ['medrecruit', 'medrecruit-list', 'https://medrecruit.medworld.com/jobs/listing', false],
] as const) {
  try {
    const html = await readFile(`data/research/${file}.html`, 'utf8');
    const parsed = parseWeb(html, url, id, sourceRecipes.find((s) => s.id === id)!.config, detail);
    console.log({
      source: id,
      sample: file,
      recognised: parsed.recognised,
      jobLinks: parsed.links.filter((l) => l.kind === 'detail').length,
      pagination: parsed.links
        .filter((l) => l.kind === 'listing')
        .map((l) => l.url)
        .slice(0, 10),
      candidates: parsed.candidates.length,
      reviewRecords: parsed.candidates.reduce((n, c) => n + c.extractions.length, 0),
    });
  } catch (e) {
    console.error(file, (e as Error).message);
    process.exitCode = 1;
  }
}
