import { readFile } from 'node:fs/promises';
import { load } from 'cheerio';
for (const file of ['medrecruit-list', 'salt', 'ochre']) {
  const $ = load(await readFile(`data/research/${file}.html`, 'utf8'));
  console.log(
    file,
    $('a[href]')
      .filter(
        (_, a) =>
          /page|offset|start=/.test($(a).attr('href') || '') ||
          /^(next|\d+|›|»|→)$/i.test($(a).text().trim()),
      )
      .map((_, a) => ({ text: $(a).text().trim().slice(0, 50), href: $(a).attr('href') }))
      .get()
      .slice(-30),
  );
  if (file === 'medrecruit-list')
    console.log(
      'Controls',
      $('button, [class*="pagination"]')
        .filter((_, el) =>
          /page|more|next|\d/i.test(($(el).attr('aria-label') || '') + $(el).text()),
        )
        .map((_, el) => ({
          text: $(el).text().trim().slice(0, 150),
          html: $.html(el).slice(0, 1500),
        }))
        .get()
        .slice(0, 18),
    );
}
