'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Map as MapLibreMap, GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import { Layers, MapPin, Radar } from 'lucide-react';
import type { Facility, Store } from '@/domain/model';
import type { EvaluatedJob } from '@/domain/engine';
import { facilityIntelligence } from '@/domain/coverage';
import { Badge, dateLabel, money } from './shared';

/*
 * National map explorer (MapLibre + OpenStreetMap data via OpenFreeMap, no key).
 * Circles are hospitals with vacancies in the current filter: size = number of
 * vacancies, colour = best score. The optional coverage layer shows directory
 * hospitals with no observed vacancy — "not observed", never "no vacancies".
 */
const STYLES = [
  'https://tiles.openfreemap.org/styles/positron',
  'https://tiles.openfreemap.org/styles/liberty',
];
/** Offline fallback: a simplified coastline so markers still read as Australia. */
const MAINLAND = [
  [142.5, -10.7],
  [143.5, -14],
  [145.3, -15],
  [146, -17.5],
  [147.5, -19.3],
  [149, -20.5],
  [150.5, -22.5],
  [152.5, -24.8],
  [153.2, -26],
  [153.6, -28.2],
  [153, -31],
  [152.5, -32.5],
  [151.2, -33.9],
  [150.2, -35.7],
  [150, -37.5],
  [148, -37.8],
  [146.3, -39.1],
  [144.6, -38.2],
  [143.5, -38.8],
  [141.6, -38.4],
  [140.5, -38],
  [139.6, -37],
  [139.3, -35.6],
  [138.5, -35.6],
  [138.1, -34.2],
  [137.5, -35.1],
  [136.8, -35.3],
  [137.8, -33.2],
  [136, -34.8],
  [135.3, -34.7],
  [134.2, -32.8],
  [132, -32],
  [129, -31.6],
  [126, -32.3],
  [124, -33],
  [121.5, -33.8],
  [119, -34.5],
  [117.9, -35.1],
  [116, -34.8],
  [115, -34.3],
  [115.7, -33.3],
  [115.7, -31.5],
  [114.9, -29.5],
  [114, -26.5],
  [113.6, -24.5],
  [114.2, -22],
  [116.7, -20.6],
  [119, -20],
  [121, -19.5],
  [122.3, -18],
  [123.5, -17],
  [125, -15.5],
  [127, -14],
  [128.5, -14.8],
  [129.5, -14.5],
  [130.2, -12.8],
  [131, -12.2],
  [132.5, -11.6],
  [133.5, -11.9],
  [135.5, -12.2],
  [136.7, -12.2],
  [136, -13.5],
  [135.5, -14.8],
  [137, -15.9],
  [139, -17.3],
  [140.8, -17.4],
  [141.5, -15],
  [141.6, -12.5],
  [142.5, -10.7],
];
const TASMANIA = [
  [144.6, -40.7],
  [146.6, -41.1],
  [148.3, -40.9],
  [148.3, -42.2],
  [147.3, -43.2],
  [146, -43.6],
  [145.2, -42.2],
  [144.6, -40.7],
];
const FALLBACK: StyleSpecification = {
  version: 8,
  sources: {
    land: {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: { type: 'MultiPolygon', coordinates: [[MAINLAND], [TASMANIA]] },
      },
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8eef0' } },
    {
      id: 'land',
      type: 'fill',
      source: 'land',
      paint: { 'fill-color': '#f3f5ee', 'fill-outline-color': '#b7c5b6' },
    },
  ],
};
type Point = {
  facility: Facility;
  jobs: EvaluatedJob[];
  best: number | null;
};

export function MapExplorer({
  jobs,
  store,
  onSelect,
}: {
  jobs: EvaluatedJob[];
  store: Store;
  onSelect: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [coverage, setCoverage] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  const points = useMemo(() => {
    const by = new Map<string, Point>();
    for (const j of jobs) {
      if (j.facility.lat === null || j.facility.lon === null) continue;
      const p = by.get(j.facility.id) ?? { facility: j.facility, jobs: [], best: null };
      p.jobs.push(j);
      if (j.ranking.score !== null && j.rankable) p.best = Math.max(p.best ?? 0, j.ranking.score);
      by.set(j.facility.id, p);
    }
    return by;
  }, [jobs]);
  const unplaced = jobs.filter((j) => j.facility.lat === null);
  const quiet = useMemo(() => {
    const observed = new Set(store.opportunities.map((o) => o.facilityId));
    return store.facilities.filter(
      (f) =>
        f.lat !== null && f.id.startsWith('aihw-') && f.sector !== 'private' && !observed.has(f.id),
    );
  }, [store.facilities, store.opportunities]);

  // Create the map once.
  useEffect(() => {
    let cancelled = false;
    let instance: MapLibreMap | null = null;
    (async () => {
      try {
        const lib = await import('maplibre-gl');
        lib.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
        if (cancelled || !container.current) return;
        instance = new lib.Map({
          container: container.current,
          style: STYLES[0],
          center: [134, -27],
          zoom: 3.1,
          minZoom: 2.5,
          maxZoom: 13,
          attributionControl: { compact: true },
          cooperativeGestures: true,
        });
        let styleIndex = 0;
        instance.on('error', (e) => {
          // A blocked or unavailable style falls back rather than leaving a blank box.
          if (!instance || instance.isStyleLoaded()) return;
          if (/style|Failed to fetch|NetworkError/i.test(String(e.error?.message ?? ''))) {
            styleIndex++;
            if (styleIndex < STYLES.length) instance.setStyle(STYLES[styleIndex]);
            else {
              instance.setStyle(FALLBACK);
              setFailed(true);
            }
          }
        });
        instance.addControl(new lib.NavigationControl({ showCompass: false }), 'top-right');
        instance.on('load', () => {
          if (!instance) return;
          // Frame the whole country whatever the screen shape.
          instance.fitBounds(
            [
              [112.5, -44],
              [154, -10],
            ],
            { padding: 16, duration: 0 },
          );
          instance.addSource('quiet', { type: 'geojson', data: empty() });
          instance.addLayer({
            id: 'quiet',
            type: 'circle',
            source: 'quiet',
            layout: { visibility: 'none' },
            paint: {
              'circle-radius': 3,
              'circle-color': '#9aa79a',
              'circle-opacity': 0.55,
            },
          });
          instance.addSource('jobs', { type: 'geojson', data: empty() });
          instance.addLayer({
            id: 'jobs-halo',
            type: 'circle',
            source: 'jobs',
            paint: {
              'circle-radius': ['+', 8, ['*', 3, ['sqrt', ['get', 'count']]]],
              'circle-color': scoreColour(),
              'circle-opacity': 0.16,
            },
          });
          instance.addLayer({
            id: 'jobs',
            type: 'circle',
            source: 'jobs',
            paint: {
              'circle-radius': ['+', 4, ['*', 1.6, ['sqrt', ['get', 'count']]]],
              'circle-color': scoreColour(),
              'circle-stroke-color': '#ffffff',
              'circle-stroke-width': 1.5,
            },
          });
          instance.addLayer({
            id: 'jobs-label',
            type: 'symbol',
            source: 'jobs',
            minzoom: 4.5,
            layout: {
              'text-field': ['get', 'label'],
              'text-size': 11,
              'text-offset': [0, 1.3],
              'text-anchor': 'top',
              'text-optional': true,
            },
            paint: { 'text-color': '#243a30', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
          });
          instance.on('click', 'jobs', (e) => {
            const id = e.features?.[0]?.properties?.id;
            if (id) setFocus(String(id));
          });
          instance.on('mouseenter', 'jobs', () => (instance!.getCanvas().style.cursor = 'pointer'));
          instance.on('mouseleave', 'jobs', () => (instance!.getCanvas().style.cursor = ''));
          setReady(true);
        });
        map.current = instance;
      } catch {
        setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      instance?.remove();
      map.current = null;
    };
  }, []);

  // Push data whenever filters change.
  useEffect(() => {
    if (!ready || !map.current) return;
    (map.current.getSource('jobs') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: [...points.values()].map((p) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [p.facility.lon!, p.facility.lat!] },
        properties: {
          id: p.facility.id,
          count: p.jobs.length,
          score: p.best ?? -1,
          label: `${p.facility.town || p.facility.name}${p.jobs.length > 1 ? ` · ${p.jobs.length}` : ''}`,
        },
      })),
    });
    (map.current.getSource('quiet') as GeoJSONSource | undefined)?.setData({
      type: 'FeatureCollection',
      features: quiet.map((f) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [f.lon!, f.lat!] },
        properties: { id: f.id },
      })),
    });
    map.current.setLayoutProperty('quiet', 'visibility', coverage ? 'visible' : 'none');
  }, [ready, points, quiet, coverage]);

  const focused = focus ? points.get(focus) : null;
  const intel = focused ? facilityIntelligence(store, focused.facility) : null;
  const ranked = [...points.values()].sort((a, b) => (b.best ?? -1) - (a.best ?? -1));

  return (
    <section className="panel map-panel v2">
      <div className="spread">
        <div>
          <p className="eyebrow">A LITTLE FURTHER AFIELD</p>
          <h2>{points.size} hospitals with vacancies in this view.</h2>
        </div>
        <button
          className={`button secondary small ${coverage ? 'active' : ''}`}
          onClick={() => setCoverage(!coverage)}
          aria-pressed={coverage}
        >
          <Layers size={15} />
          {coverage ? `Hide ${quiet.length} unobserved` : 'Show coverage gaps'}
        </button>
      </div>
      <div className="map-grid">
        <div className="map-canvas-wrap">
          <div ref={container} className="map-canvas" role="region" aria-label="Map of vacancies" />
          {!ready && !failed && <p className="map-loading">Loading the map…</p>}
          {failed && (
            <p className="map-loading failed">
              Map tiles are unavailable (offline or blocked); showing a schematic outline.
            </p>
          )}
          <div className="map-legend" aria-hidden>
            <span>
              <i style={{ background: '#1f6150' }} />
              80+
            </span>
            <span>
              <i style={{ background: '#5d8f6c' }} />
              60–79
            </span>
            <span>
              <i style={{ background: '#c39a45' }} />
              below 60
            </span>
            <span>
              <i style={{ background: '#8c948c' }} />
              not ranked
            </span>
            {coverage && (
              <span>
                <i className="quiet-dot" />
                no vacancy observed
              </span>
            )}
          </div>
        </div>
        <aside className="map-side">
          {focused && intel ? (
            <div className="facility-card">
              <button className="text-button small" onClick={() => setFocus(null)}>
                ← All hospitals
              </button>
              <h3>{focused.facility.name}</h3>
              <p className="muted small">
                {focused.facility.town}, {focused.facility.state}
                {focused.facility.biodiversity
                  ? ` · ${focused.facility.biodiversity.species} ${focused.facility.biodiversity.taxon} species within ${focused.facility.biodiversity.radiusKm} km`
                  : ''}
              </p>
              <dl className="intel">
                <div>
                  <dt>Observed vacancies</dt>
                  <dd>{intel.total}</dd>
                </div>
                <div>
                  <dt>Months with vacancies</dt>
                  <dd>
                    {intel.months}
                    {intel.recurring ? ' · recurring' : ''}
                  </dd>
                </div>
                <div>
                  <dt>Comparable hourly</dt>
                  <dd>
                    {intel.rate
                      ? `${money(intel.rate.min)}–${money(intel.rate.max)} (median ${money(intel.rate.median)})`
                      : 'No comparable rates'}
                  </dd>
                </div>
                <div>
                  <dt>Advertised by</dt>
                  <dd>{intel.sources.map((s) => `${s.name} (${s.count})`).join(', ') || '—'}</dd>
                </div>
              </dl>
              <ul className="map-jobs">
                {focused.jobs.map((j) => (
                  <li key={j.opportunity.id}>
                    <button onClick={() => onSelect(j.opportunity.id)}>
                      <span>
                        <strong>
                          {j.opportunity.specialty} {j.opportunity.grade}
                        </strong>
                        <small>
                          {dateLabel(j.opportunity.startDate)} –{' '}
                          {dateLabel(j.opportunity.endDate, true)}
                        </small>
                      </span>
                      <b>{j.ranking.score ?? '—'}</b>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <ul className="map-jobs">
              {ranked.slice(0, 60).map((p) => (
                <li key={p.facility.id}>
                  <button
                    onClick={() => {
                      setFocus(p.facility.id);
                      map.current?.flyTo({ center: [p.facility.lon!, p.facility.lat!], zoom: 7 });
                    }}
                  >
                    <span>
                      <strong>{p.facility.name}</strong>
                      <small>
                        {p.facility.town}, {p.facility.state} · {p.jobs.length} vacanc
                        {p.jobs.length === 1 ? 'y' : 'ies'}
                      </small>
                    </span>
                    <b>{p.best ?? '—'}</b>
                  </button>
                </li>
              ))}
              {!ranked.length && (
                <li className="muted small">
                  <Radar size={15} /> No mapped vacancies in this view.
                </li>
              )}
            </ul>
          )}
        </aside>
      </div>
      {unplaced.length > 0 && (
        <details className="unplaced">
          <summary>
            <MapPin size={14} /> {unplaced.length} vacancies at facilities without coordinates
          </summary>
          <ul>
            {unplaced.slice(0, 50).map((j) => (
              <li key={j.opportunity.id}>
                <button className="text-button" onClick={() => onSelect(j.opportunity.id)}>
                  {j.facility.name} · {j.opportunity.title}
                </button>{' '}
                <Badge>{j.ranking.score ?? '—'}</Badge>
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="map-caption">
        Map data © OpenStreetMap contributors, tiles by OpenFreeMap. Hospital locations from the
        AIHW MyHospitals directory. Grey dots are hospitals where no vacancy has been observed —
        coverage is partial, so that is not evidence of no vacancies.
      </p>
    </section>
  );
}
const empty = () => ({ type: 'FeatureCollection' as const, features: [] });
const scoreColour = () =>
  [
    'case',
    ['<', ['get', 'score'], 0],
    '#8c948c',
    ['>=', ['get', 'score'], 80],
    '#1f6150',
    ['>=', ['get', 'score'], 60],
    '#5d8f6c',
    '#c39a45',
  ] as unknown as string;
