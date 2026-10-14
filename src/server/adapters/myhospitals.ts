import { zoneForState, normaliseName } from '@/domain/ingestion';
import type { Facility } from '@/domain/model';
import { stateFrom } from './email-formats';

/**
 * National hospital directory from the AIHW MyHospitals API
 * (https://myhospitalsapi.aihw.gov.au, open, no key, CC BY). Each hospital
 * record carries its name, alternative names, coordinates, sector and state.
 * Towns are derived from names and are approximate; coordinates are the
 * authoritative location.
 */
export const MYHOSPITALS_URL = 'https://myhospitalsapi.aihw.gov.au/api/v1/reporting-units';

interface Unit {
  reporting_unit_code?: string;
  reporting_unit_name?: string;
  alternative_names?: string[];
  closed?: boolean;
  private?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  reporting_unit_type?: { reporting_unit_type_code?: string };
  mapped_reporting_units?: {
    map_type?: { mapped_reporting_unit_code?: string };
    mapped_reporting_unit?: { reporting_unit_code?: string };
  }[];
}

const suffix =
  /\s+(?:(?:base|general|district|regional|memorial|community|public|referral|university|multi[- ]?purpose|rural|and)\s+)*(?:hospital(?:\s+and\s+health\s+services?)?|health\s+services?|health\s+care\s+group|health|campus|multipurpose\s+service|mps)$/i;
/** "Latrobe Regional Hospital [Traralgon]" → "Latrobe"; "The Bendigo Hospital" → "Bendigo". */
export function shortName(name: string) {
  let v = name
    .replace(/\s*[[(][^\])]*[\])]\s*/g, ' ')
    .replace(/^the\s+/i, '')
    .trim();
  for (let i = 0; i < 3 && suffix.test(v); i++) v = v.replace(suffix, '').trim();
  return v === name.trim() ? '' : v;
}
export function townFor(name: string, alternatives: string[]) {
  const bracket = name.match(/[[(]([^\])]+)[\])]/)?.[1]?.trim();
  if (bracket) return bracket;
  const short = shortName(name).replace(/^royal\s+/i, '');
  // Directional names ("North West Regional", "Northern Beaches") are regions, not towns.
  if (short && short.split(' ').length <= 3 && !/^(north|south|east|west|central)/i.test(short))
    return short;
  // Alternative names are often other service names or acronyms, so use one
  // only when it reads like a place.
  const place = alternatives.find(
    (a) =>
      /^[A-Z][a-z]+(?:[ '-][A-Z][a-z]+){0,2}$/.test(a) &&
      !/hospital|health|service|centre|clinic|campus/i.test(a),
  );
  return place ?? '';
}

export function parseMyHospitals(body: unknown): Facility[] {
  const list = (body as { result?: Unit[] })?.result;
  if (!Array.isArray(list)) throw new Error('Unexpected MyHospitals response shape');
  const out: Facility[] = [];
  for (const u of list) {
    if (u.reporting_unit_type?.reporting_unit_type_code !== 'H' || u.closed) continue;
    const name = (u.reporting_unit_name ?? '').trim();
    const stateCode = u.mapped_reporting_units?.find(
      (m) => m.map_type?.mapped_reporting_unit_code === 'STATE_MAPPING',
    )?.mapped_reporting_unit?.reporting_unit_code;
    const state = stateFrom(stateCode ?? '');
    if (!name || !u.reporting_unit_code || !state) continue;
    const alternatives = (u.alternative_names ?? []).filter(Boolean);
    const short = shortName(name);
    const aliases = [...new Set([...alternatives, short].filter((a) => a && a !== name))];
    out.push({
      id: `aihw-${u.reporting_unit_code}`,
      name,
      aliases,
      town: townFor(name, alternatives),
      state,
      timezone: zoneForState[state],
      lat: typeof u.latitude === 'number' ? u.latitude : null,
      lon: typeof u.longitude === 'number' ? u.longitude : null,
      adventure: null,
      adventureNote: 'Not assessed',
      coverage: 'unknown',
      sector: u.private ? 'private' : 'public',
    });
  }
  return out;
}

/** Adds directory hospitals without overwriting facilities the user already has. */
export function mergeFacilities(existing: Facility[], directory: Facility[]) {
  let added = 0,
    linked = 0;
  for (const d of directory) {
    if (existing.some((f) => f.id === d.id)) continue;
    const same = existing.find(
      (f) => f.state === d.state && normaliseName(f.name) === normaliseName(d.name),
    );
    if (same) {
      same.aliases = [...new Set([...same.aliases, ...d.aliases])];
      same.sector ??= d.sector;
      linked++;
      continue;
    }
    existing.push(d);
    added++;
  }
  return { added, linked };
}

export interface FacilityMatch {
  facility: Facility | null;
  note: string | null;
}
/**
 * Resolves an advertised facility label ("Manning", "Coffs Harbour Hospital")
 * to one directory facility. Prefers public hospitals unless the label says
 * private, and returns no match when the best candidates tie.
 */
export function resolveFacility(
  label: string,
  state: Facility['state'] | null,
  facilities: Facility[],
): FacilityMatch {
  const wanted = normaliseName(label);
  if (wanted.length < 3) return { facility: null, note: null };
  // "Orange Hospital" should also find "Orange Health Service" via its short name.
  const core = normaliseName(shortName(label)) || wanted;
  const saysPrivate = /\bprivate\b/.test(wanted);
  const scored = facilities
    .filter((f) => !state || f.state === state)
    .map((f) => {
      const name = normaliseName(f.name);
      let score = 0;
      const aliases = f.aliases.map(normaliseName);
      const town = normaliseName(f.town);
      if (name === wanted) score = 3;
      else if (aliases.includes(wanted) || aliases.includes(core)) score = 2;
      else if (
        name.startsWith(`${wanted} `) ||
        name.startsWith(`${core} `) ||
        town === wanted ||
        town === core
      )
        score = 1;
      if (score && (town === wanted || town === core)) score += 1;
      if (score && f.sector === 'private' && !saysPrivate) score -= 2;
      return { f, score };
    })
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score);
  if (!scored.length) return { facility: null, note: null };
  const top = scored[0];
  if (scored[1]?.score === top.score)
    return {
      facility: null,
      note: `Facility "${label}" matches several hospitals (${scored
        .filter((c) => c.score === top.score)
        .slice(0, 3)
        .map((c) => c.f.name)
        .join(', ')}); choose one in review.`,
    };
  if (!state && top.score < 2) return { facility: null, note: null };
  const exact = normaliseName(top.f.name) === wanted;
  return {
    facility: top.f,
    note: exact
      ? null
      : `Facility "${label}" resolved to ${top.f.name}${top.f.id.startsWith('aihw-') ? ` (AIHW ${top.f.id.slice(5)})` : ''}; confirm it is the advertised site.`,
  };
}
