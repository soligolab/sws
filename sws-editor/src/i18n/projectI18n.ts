// ── Lingua dei CONTENUTI di progetto (T-40) ─────────────────────────────────
//
// Asse indipendente dalla lingua UI (react-i18next, vedi src/i18n/index.ts).
// L'autore scrive nei campi testo degli oggetti dei riferimenti `{{token}}`;
// la tabella lingue del progetto (project.languages) mappa token → traduzioni
// per codice lingua. Il viewer (e l'anteprima editor) risolvono i token nella
// lingua corrente prima di rendere gli oggetti.

import type { LanguageTable, SynopticObject } from "@/types";

const STORAGE_KEY = "sws.projectLang";

export function getStoredProjectLang(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ""; } catch { return ""; }
}
export function setStoredProjectLang(code: string): void {
  try { localStorage.setItem(STORAGE_KEY, code); } catch { /* ignore */ }
}

// Lingua di ANTEPRIMA dell'editor: in quale lingua il canvas dell'IDE risolve i
// token degli oggetti. Indipendente sia dalla lingua UI sia da projectLang (che
// è la lingua attiva del viewer). Impostata dal tab Configurazione → Lingue.
const EDITOR_PREVIEW_KEY = "sws.editorPreviewLang";

export function getStoredEditorPreviewLang(): string {
  try { return localStorage.getItem(EDITOR_PREVIEW_KEY) ?? ""; } catch { return ""; }
}
export function setStoredEditorPreviewLang(code: string): void {
  try { localStorage.setItem(EDITOR_PREVIEW_KEY, code); } catch { /* ignore */ }
}

/** Lingua effettiva: preferenza salvata (se valida) → default della tabella. */
export function effectiveProjectLang(table?: LanguageTable | null): string {
  const stored = getStoredProjectLang();
  if (stored && table?.langs?.includes(stored)) return stored;
  return table?.default ?? "";
}

const TOKEN_RE = /\{\{\s*([^}\s]+)\s*\}\}/g;

/** Sostituisce le occorrenze `{{token}}` in `str` con la traduzione per `lang`
 *  (fallback: default della tabella → token grezzo tra graffe se sconosciuto).
 *  Testo senza token passa invariato. */
export function resolveMsg(str: string, lang: string, table?: LanguageTable | null): string {
  if (!str || !table || str.indexOf("{{") < 0) return str;
  return str.replace(TOKEN_RE, (_m, key: string) => {
    const entry = table.entries.find((e) => e.key === key);
    if (!entry) return `{{${key}}}`;
    return entry.values[lang] ?? entry.values[table.default] ?? key;
  });
}

const TEXT_FIELDS: (keyof SynopticObject)[] = [
  "label", "text", "unit", "pipe_label", "bar_y_label", "pie_center_text", "text_list_default",
];

function hasToken(v: unknown): v is string {
  return typeof v === "string" && v.indexOf("{{") >= 0;
}

/** Ritorna un clone dell'oggetto con i token risolti nei campi testo noti
 *  (inclusi options[].label, table_rows[].label, text_list_entries[].label).
 *  Non tocca tag, colori, id o altri dati. Se nessun token è presente ritorna
 *  l'oggetto originale (identità → nessun re-render inutile). */
export function localizeObject(obj: SynopticObject, lang: string, table?: LanguageTable | null): SynopticObject {
  if (!table || !lang) return obj;
  let out: SynopticObject | null = null;
  const ensure = () => (out ??= { ...obj });

  for (const f of TEXT_FIELDS) {
    const v = obj[f];
    if (hasToken(v)) (ensure() as unknown as Record<string, unknown>)[f] = resolveMsg(v, lang, table);
  }
  if (obj.options?.some((o) => hasToken(o.label))) {
    ensure().options = obj.options.map((o) => (hasToken(o.label) ? { ...o, label: resolveMsg(o.label, lang, table) } : o));
  }
  if (obj.table_rows?.some((r) => hasToken(r.label))) {
    ensure().table_rows = obj.table_rows.map((r) => (hasToken(r.label) ? { ...r, label: resolveMsg(r.label, lang, table) } : r));
  }
  if (obj.text_list_entries?.some((e) => hasToken(e.label))) {
    ensure().text_list_entries = obj.text_list_entries.map((e) => (hasToken(e.label) ? { ...e, label: resolveMsg(e.label, lang, table) } : e));
  }
  return out ?? obj;
}

/** Localizza una lista di oggetti (identità quando non serve). */
export function localizeObjects(objs: SynopticObject[], lang: string, table?: LanguageTable | null): SynopticObject[] {
  if (!table || !lang) return objs;
  let changed = false;
  const mapped = objs.map((o) => { const r = localizeObject(o, lang, table); if (r !== o) changed = true; return r; });
  return changed ? mapped : objs;
}
