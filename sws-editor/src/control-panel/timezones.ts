// Choosing a time zone in three steps — continent, country, city — or with a
// filter (TY570, 14-11-2026: one list of 400 names could not be used on a 7"
// screen; the maintainer's proposal). Pure functions: the web panel draws them,
// and the LVGL viewer has the same rules in `control_panel.rs`.

import countries from "@/i18n/countries.json";

/** One zone and its country (ISO 3166 code), as the runtime reads `zone.tab`. */
export interface Zone { zone: string; country: string | null }

/** The continents in the order a list shows them; anything else is «other». */
export const CONTINENTS = ["Europe", "America", "Asia", "Africa", "Australia", "Pacific", "Atlantic", "Indian", "Antarctica", "Arctic"] as const;
export const OTHER = "other";

const NAMES = countries as Record<string, Record<string, string>>;

/** The zones a person picks from: those with a country, and UTC. tzdata also
 *  lists ~180 old aliases with no country (`US/Eastern`, `Etc/GMT+1`,
 *  `Europe/Belfast`: TY570, 14-11-2026); among the countries they were noise. */
export function pickable(zones: Zone[]): Zone[] {
  return zones.filter((z) => z.country !== null || z.zone === "UTC");
}

export function continentOf(zone: string): string {
  const i = zone.indexOf("/");
  const c = i < 0 ? "" : zone.slice(0, i);
  return (CONTINENTS as readonly string[]).includes(c) ? c : OTHER;
}

/** `America/Argentina/Buenos_Aires` → `Buenos Aires`. */
export function cityOf(zone: string): string {
  return zone.slice(zone.lastIndexOf("/") + 1).replace(/_/g, " ");
}

export function countryName(code: string, lang: string): string {
  return (NAMES[lang] ?? NAMES.en)[code] ?? NAMES.en[code] ?? code;
}

/** `Rome — Italia`, or the city alone for a zone without a country. */
export function zoneLabel(z: Zone, lang: string): string {
  return z.country ? `${cityOf(z.zone)} — ${countryName(z.country, lang)}` : cityOf(z.zone);
}

export function continentsIn(zones: Zone[]): string[] {
  const present = new Set(pickable(zones).map((z) => continentOf(z.zone)));
  return [...CONTINENTS, OTHER].filter((c) => present.has(c));
}

/** A row of the second step: a country with its zones, or a zone that has no
 *  country (`code: null`), which is picked directly. */
export interface CountryEntry { code: string | null; name: string; zones: string[] }

export function countriesIn(zones: Zone[], continent: string, lang: string): CountryEntry[] {
  const by = new Map<string, CountryEntry>();
  const loose: CountryEntry[] = [];
  for (const z of pickable(zones)) {
    if (continentOf(z.zone) !== continent) continue;
    if (!z.country) { loose.push({ code: null, name: cityOf(z.zone), zones: [z.zone] }); continue; }
    const e = by.get(z.country) ?? { code: z.country, name: countryName(z.country, lang), zones: [] };
    e.zones.push(z.zone);
    by.set(z.country, e);
  }
  const byName = (a: CountryEntry, b: CountryEntry) => a.name.localeCompare(b.name, lang);
  return [...[...by.values()].sort(byName), ...loose.sort(byName)];
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The zones whose city, country or name contain `filter`, accents ignored. */
export function search(zones: Zone[], filter: string, lang: string, max = 60): Zone[] {
  const f = fold(filter.trim());
  if (!f) return [];
  return pickable(zones)
    // The city path, not the continent: «ro» would find every «Europe/…».
    .filter((z) => fold(z.zone.slice(z.zone.indexOf("/") + 1).replace(/_/g, " ")).includes(f)
      || (z.country !== null && fold(countryName(z.country, lang)).includes(f)))
    .sort((a, b) => zoneLabel(a, lang).localeCompare(zoneLabel(b, lang), lang))
    .slice(0, max);
}
