import React, { useMemo, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Tenuta } from "@/components/Tenuta";
import { RinominaTagModal } from "@/components/RinominaTagModal";
import { OpzioniTipo } from "@/components/OpzioniTipo";
import { TipiTab } from "@/config/schede/TipiTab";
import { csvVariabiliETipi } from "@/tag/csvTag";
import { normalizzaTipo } from "@/tag/tipiScalari";
import type { GeneratorSpec, TagDataType, TagDef } from "@/types";
import { buildTagUsage, usiDiUnTag } from "@/search/tagUsage";
import { useAppStore } from "@/store";
import { sourceTagIds } from "@/tagCatalog";
import { useSezioneSincronizzata } from "@/config/useSezioneSincronizzata";
import { TRANS_COMP, BarraConflittoSezione, S, SaveBar } from "@/config/comuni";

// ── TAG tab ───────────────────────────────────────────────────────────────────

type TagSortCol = "id" | "description" | "data_type" | "history" | "datastore_id" | "value";

export function TagsTab() {
  const { t } = useTranslation();
  const storeProject        = useAppStore((s) => s.project);
  const updateProjectTags   = useAppStore((s) => s.updateProjectTags);
  const updateProjectTypes  = useAppStore((s) => s.updateProjectTypes);
  const tagValues           = useAppStore((s) => s.tagValues);
  const markSaveOk          = useAppStore((s) => s.markSaveOk);
  const datastoreIds        = storeProject?.datastores?.map((d) => ({ id: d.id, label: d.label })) ?? [];

  // Una scheda vuota mostrava solo la riga dei filtri, e il maintainer — il
  // 18-09-2026 — ci ha scritto dentro la variabile che voleva creare. Quindi:
  // niente righe = una riga vuota da compilare, come se «+ Aggiungi variabile»
  // fosse già premuto. Sta NELLO STATO e non in un effetto: il primo tentativo
  // era un `useEffect` su `tags.length`, e il `setTags([])` della
  // sincronizzazione dallo store, nello stesso giro di render, lo vinceva —
  // React tiene l'ultimo `set`, e a lunghezza invariata l'effetto non ripartiva.
  // `handleSave` scarta comunque le righe con id vuoto.
  const conRigaVuota = (v: TagDef[]): TagDef[] =>
    v.length ? v : [{ id: "", description: "", data_type: "float" }];
  const [tags, setTags]         = useState<TagDef[]>(conRigaVuota(storeProject?.tags ?? []));
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);
  const [exprOpen, setExprOpen] = useState<Set<number>>(new Set());
  // F1: riga espandibile "⚙" con unità/decimali/scaling/range/limiti per tag.
  const [metaOpen, setMetaOpen] = useState<Set<number>>(new Set());
  // T-69 Fase D: riga espandibile "∿" con la forma d'onda generata.
  const [genOpen, setGenOpen] = useState<Set<number>>(new Set());
  // Sort + filtri per colonna e vista "non usate". L'ordinamento agisce su
  // una vista derivata [{tag, origIdx}]: lo stato `tags` NON viene riordinato
  // (le righe editano per indice, e su disco l'ordine resta quello originale).
  const [sort, setSort] = useState<{ col: TagSortCol; dir: 1 | -1 } | null>(null);
  const [fltId, setFltId] = useState("");
  const [fltDesc, setFltDesc] = useState("");
  const [fltType, setFltType] = useState("");
  const [fltHist, setFltHist] = useState("");
  const [fltUse, setFltUse] = useState("");
  const allPages = useAppStore((s) => s.pages);
  const allFaceplates = useAppStore((s) => s.faceplates);
  const [showImport, setShowImport] = useState(false);
  // Quale delle due sottoschede si vede. L'altra resta montata (`Tenuta`), o
  // cambiando vista si perderebbe la bozza — lo stesso motivo per cui le
  // schede di Configurazione non si smontano dal 22-09-2026.
  const [vista, setVista] = useState<"variabili" | "tipi">("variabili");
  const [revTipi, setRevTipi] = useState(0);
  const [importText, setImportText] = useState("");
  const [importMsg, setImportMsg]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Sync local state when store changes (e.g. on initial project load or after ZIP import).
  // Traccia l'INTENZIONE dell'utente, non la differenza fra bozza e store.
  //
  // Questa tab era esclusa da "Salva tutto" dal 2026-07-28, dopo che un
  // confronto strutturale bozza-vs-store aveva scritto su disco una bozza
  // momentaneamente disallineata: audit `{"count": 0, "what": "tags"}` su un
  // progetto che sul disco aveva 16 variabili. Il difetto non era registrarsi
  // in `pendingSections`, era il criterio: "diverso dallo store" può essere
  // vero senza che nessuno abbia toccato niente.
  //
  // Con `touched` la domanda diventa quella giusta — "l'utente ha modificato
  // qualcosa?" — ed è lo schema che Notifiche usa già. Si alza solo nelle
  // mutazioni volute e mai nella sincronizzazione dallo store, che è
  // esattamente il caso che fece danno.
  const [touched, setTouched] = useState(false);

  // Depend on the full project object so content changes (not just count) trigger a refresh.
  // Vedi `useSezioneSincronizzata`: prima questo effetto dipendeva
  // dall'INTERO `storeProject`, che cambia identità a ogni salvataggio di
  // qualunque altra sezione — e cancellava la riga in corso di scrittura
  // azzerando anche `touched`, così niente avvisava.
  const sync = useSezioneSincronizzata<TagDef[]>({
    remoto: storeProject?.tags,
    applica: (v) => { setTags(conRigaVuota(v)); setTouched(false); },
    modificato: touched,
    progetto: storeProject?.meta?.name,
  });

  const addTag = () => {
    setTouched(true);
    setTags((prev) => [...prev, { id: "", description: "", data_type: "float" }]);
  };

  const updateTag = (idx: number, patch: Partial<TagDef>) => {
    setTouched(true);
    setTags((prev) => prev.map((t, i) => (i === idx ? { ...t, ...patch } : t)));
  };

  const removeTag = (idx: number) => {
    setTouched(true);
    setTags((prev) => conRigaVuota(prev.filter((_, i) => i !== idx)));
  };

  // Fase 0c: rinomina ovunque, con anteprima; la scheda la offre solo per gli
  // id già dichiarati sul disco (la bozza si rinomina scrivendo nel campo).
  const [rinominaDi, setRinominaDi] = useState<string | null>(null);
  const [esitoRinomina, setEsitoRinomina] = useState<string | null>(null);
  const dichiaratiSalvati = useMemo(() => new Set((storeProject?.tags ?? []).map((x) => x.id)), [storeProject]);

  const toggleExpr = (idx: number) =>
    setExprOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const toggleMeta = (idx: number) =>
    setMetaOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const toggleGen = (idx: number) =>
    setGenOpen((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const DEFAULT_GENERATOR: GeneratorSpec = { shape: "ramp", period_ms: 1000, min: 0, max: 100, enabled: true };

  /** Aggiorna il generatore del tag `idx`, riempiendo i campi assenti coi default. */
  const patchGenerator = (idx: number, tag: TagDef, patch: Partial<GeneratorSpec>) =>
    updateTag(idx, { generator: { ...DEFAULT_GENERATOR, ...tag.generator, ...patch } });

  /** True se il tag definisce almeno un campo F1 (unità/scaling/range/limiti). */
  const hasMeta = (t: TagDef) =>
    t.unit !== undefined || t.decimals !== undefined || t.write_min_role !== undefined ||
    t.write_data_type !== undefined ||
    t.raw_min !== undefined || t.raw_max !== undefined || t.eng_min !== undefined || t.eng_max !== undefined ||
    t.range_lo !== undefined || t.range_hi !== undefined ||
    t.limit_lo_lo !== undefined || t.limit_lo !== undefined || t.limit_hi !== undefined || t.limit_hi_hi !== undefined;

  // Tag → dove è usato (pagine via collectTagIds, allarmi, espressioni di
  // altri tag, script globali). Ricette e funzioni Python restano fuori
  // (tag potenzialmente dinamici): "non usata" = candidata, da verificare.
  // F8.3 — logica spostata in @/search/tagUsage: la stessa risposta serve alla
  // ricerca dell'editor, e due copie divergerebbero alla prima aggiunta.
  const usedTagInfo = useMemo(
    () => buildTagUsage({
      pages: allPages, faceplates: allFaceplates,
      alarms: storeProject?.alarms, tags, globalScripts: storeProject?.global_scripts,
    }),
    [allPages, allFaceplates, storeProject?.alarms, storeProject?.global_scripts, tags],
  );

  // Vista derivata: filtro → sort; ogni riga conserva origIdx per l'editing.
  const view = useMemo(() => {
    let rows = tags.map((tag, origIdx) => ({ tag, origIdx }));
    const has = (v: string | undefined, q: string) => (v ?? "").toLowerCase().includes(q.toLowerCase());
    if (fltId) rows = rows.filter((r) => has(r.tag.id, fltId));
    if (fltDesc) rows = rows.filter((r) => has(r.tag.description, fltDesc));
    if (fltType) rows = rows.filter((r) => normalizzaTipo(r.tag.data_type) === fltType);
    if (fltHist) rows = rows.filter((r) => (r.tag.history ? "yes" : "no") === fltHist);
    if (fltUse) {
      rows = rows.filter((r) => {
        const usato = usiDiUnTag(r.tag, usedTagInfo, storeProject?.types ?? []).length > 0;
        return (usato ? "used" : "unused") === fltUse;
      });
    }
    if (sort) {
      const { col, dir } = sort;
      const key = (r: { tag: TagDef }): string | number | boolean => {
        switch (col) {
          case "history": return r.tag.history ?? false;
          case "datastore_id": return r.tag.datastore_id ?? "";
          case "value": {
            const v = tagValues[r.tag.id]?.value;
            return v === undefined ? "" : (v as string | number | boolean);
          }
          default: return (r.tag[col] ?? "") as string;
        }
      };
      rows = [...rows].sort((a, b) => {
        const va = key(a); const vb = key(b);
        if (col === "value") {
          // i tag senza valore live in fondo, qualunque direzione
          if (va === "" && vb !== "") return 1;
          if (vb === "" && va !== "") return -1;
          const na = Number(va); const nb = Number(vb);
          if (Number.isFinite(na) && Number.isFinite(nb)) return (na - nb) * dir;
        }
        if (typeof va === "boolean" && typeof vb === "boolean") {
          return (va === vb ? 0 : va ? 1 : -1) * dir;
        }
        return String(va).localeCompare(String(vb), undefined, { sensitivity: "base", numeric: true }) * dir;
      });
    }
    return rows;
  }, [tags, sort, fltId, fltDesc, fltType, fltHist, fltUse, usedTagInfo, tagValues, storeProject?.types]);

  const filtersActive = !!(fltId || fltDesc || fltType || fltHist || fltUse);
  const clearFilters = () => { setFltId(""); setFltDesc(""); setFltType(""); setFltHist(""); setFltUse(""); };
  const clickSort = (col: TagSortCol) =>
    setSort((prev) => (prev?.col !== col ? { col, dir: 1 } : prev.dir === 1 ? { col, dir: -1 } : null));
  const sortMark = (col: TagSortCol) => (sort?.col === col ? (sort.dir === 1 ? " ▲" : " ▼") : "");

  const handleSave = async () => {
    const valid = tags.filter((t) => t.id.trim() !== "");
    setSaving(true);
    try {
      await api.updateTags(valid);
      updateProjectTags(valid);
      setTags(valid);
      setTouched(false);
      setSaved(true);
      // Segnala il salvataggio riuscito allo stesso stato globale che
      // saveAll() usa per la finestra "è stato un salvataggio nostro" del
      // watcher progetto (App.tsx) — altrimenti un salvataggio qui, che non
      // passa da saveAll(), fa comparire il banner "progetto cambiato
      // esternamente" sulla stessa sessione che ha appena salvato.
      markSaveOk();
      setTimeout(() => setSaved(false), 4000);
    } finally {
      setSaving(false);
    }
  };

  const handleExportCsv = () => {
    // Un file solo per variabili **e** tipi (22-09-2026): il perché e il
    // formato stanno in `tag/csvTag.ts`.
    const csv = csvVariabiliETipi(tags, storeProject?.types ?? []);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "variabili-e-tipi.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportSubmit = async () => {
    setImportMsg(null);
    try {
      const result = await api.importTagsCsv(importText);
      setImportMsg(t("cfgUi.tagsImported", { count: result.imported, tipi: result.tipi ?? 0 }));
      // Refresh from server
      const proj = await api.getProject();
      if (proj.tags) { setTags(proj.tags); updateProjectTags(proj.tags); }
      if (proj.types) updateProjectTypes(proj.types);
      // La sottoscheda Tipi tiene la sua copia locale: si rimonta, così
      // rilegge dallo store. Una sua bozza non salvata si perde, ma l'import
      // ha appena scritto sul server: era già superata.
      setRevTipi((n) => n + 1);
      setImportText("");
    } catch (e: unknown) {
      setImportMsg(t("cfgUi.errorMsg", { message: e instanceof Error ? e.message : t("cfgUi.importFailed") }));
    }
  };

  return (
    <div style={S.section}>
{/* Registrata di nuovo in `pendingSections` dal 2026-08-25: `touched` traccia
          l'intenzione dell'utente invece della differenza strutturale, che è
          ciò che nel 2026-07-28 aveva scritto su disco una bozza vuota. Vedi il
          commento su `touched` sopra. */}
      <SaveBar onSave={handleSave} saving={saving} saved={saved} section="tags" dirty={touched} notice={esitoRinomina} />
      {rinominaDi !== null && (
        <RinominaTagModal
          vecchio={rinominaDi}
          onDone={(e) => {
            // La scheda rilegge dallo store (sync) e dice cos'è successo.
            setTags(useAppStore.getState().project?.tags ?? []);
            setTouched(false);
            const n = e.punti.reduce((a, p) => a + p.n, 0);
            setEsitoRinomina(t("rinomina.fatto", { n }));
            setTimeout(() => setEsitoRinomina(null), 6000);
          }}
          onClose={() => setRinominaDi(null)}
        />
      )}
      {showImport && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 8000,
          background: "rgba(0,0,0,0.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowImport(false); }}
        >
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, width: 560, display: "flex", flexDirection: "column", gap: 10, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>{t("cfgUi.importTagsFromCsv")}</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
              {t("cfgUi.firstRowHeaderRequiredColumns")} <code>id</code>. Opzionali: <code>kind</code>, <code>owner</code>, <code>data_type</code>, <code>type_ref</code>, <code>array</code>, <code>description</code>, <code>unit</code>, <code>decimals</code>, <code>history</code>, <code>expression</code>, <code>write_min_role</code>, <code>raw_min</code>/<code>raw_max</code>, <code>eng_min</code>/<code>eng_max</code>, <code>range_lo</code>/<code>range_hi</code>, <code>limit_*</code>.
              {" "}{t("cfgUi.csvKind")}
              {" "}{t("cfgUi.csvColonneAssenti")}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => setImportText(ev.target?.result as string ?? "");
                reader.readAsText(file);
              }}
            />
            <button onClick={() => fileRef.current?.click()} style={{ ...S.btn("ghost"), alignSelf: "flex-start" }}>
              📂 Scegli file CSV…
            </button>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={t("cfgUi.idDataTypeDescriptionHistory")}
              rows={8}
              style={{ ...S.input, fontFamily: "monospace", fontSize: 11, resize: "vertical" }}
            />
            {importMsg && (
              <div style={{ fontSize: 12, color: importMsg.startsWith("✓") ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
                {importMsg}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button style={S.btn("ghost")} onClick={() => { setShowImport(false); setImportMsg(null); setImportText(""); }}>{t("common.cancel")}</button>
              <button style={S.btn("primary")} onClick={handleImportSubmit} disabled={!importText.trim()}>
                {t("cfgUi.import")}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Variabili e Tipi in una scheda sola (22-09-2026, scelta del
          maintainer): un tipo esiste solo per essere istanziato da una
          variabile, e tenerli in due schede separate rendeva possibile
          esportare le variabili senza i loro tipi — un file che non si può
          reimportare. Il Salva è uno (quello del progetto) e l'import/export
          CSV copre entrambe, quindi stanno sopra il selettore. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 2, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: 2 }}>
          {(["variabili", "tipi"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setVista(v)}
              style={{
                border: "none", borderRadius: 4, cursor: "pointer", fontSize: 12,
                padding: "4px 14px",
                background: vista === v ? "var(--brand-surface-2, #334155)" : "transparent",
                color: vista === v ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-muted, #94a3b8)",
                fontWeight: vista === v ? 700 : 400,
              }}
            >
              {v === "variabili" ? t("cfgUi.variablesTags") : t("config.tabs.types")}
              {v === "tipi" && (storeProject?.types ?? []).length > 0 ? ` (${(storeProject?.types ?? []).length})` : ""}
            </button>
          ))}
        </div>
        <div style={{ flex: 1 }} />
        <button style={S.btn("ghost")} onClick={handleExportCsv} title={t("cfg.downloadTagsCsv")}>{t("cfgUi.exportCsv")}</button>
        <button style={S.btn("ghost")} onClick={() => setShowImport(true)} title={t("cfg.importTagsCsv")}>{t("cfgUi.importCsv")}</button>
      </div>

      <Tenuta attiva={vista === "tipi"}><TipiTab key={revTipi} incorporata /></Tenuta>
      <Tenuta attiva={vista === "variabili"}>
      <div style={S.notice}>
        <Trans i18nKey="cfgUi.variablesNotice" values={{ tab: t("config.tabs.protocols") }} components={TRANS_COMP} />
      </div>

      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: 18 }} title={t("cfg.unusedLegend")}>●</th>
            <th style={{ ...S.th, width: "21%", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("id")}>{t("cfg.tagId")}{sortMark("id")}</th>
            <th style={{ ...S.th, width: "24%", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("description")}>{t("cfg.description")}{sortMark("description")}</th>
            <th style={{ ...S.th, width: "9%", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("data_type")}>{t("cfg.type")}{sortMark("data_type")}</th>
            <th style={{ ...S.th, width: "6%", textAlign: "center", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("history")}>{t("cfg.history")}{sortMark("history")}</th>
            <th style={{ ...S.th, width: "15%", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("datastore_id")}>{t("cfg.datastore")}{sortMark("datastore_id")}</th>
            <th style={{ ...S.th, width: "12%", cursor: "pointer", userSelect: "none" }} onClick={() => clickSort("value")}>{t("cfg.liveValue")}{sortMark("value")}</th>
            <th style={S.th} />
          </tr>
          {/* riga filtri per colonna — con sfondo ed etichetta, perché a scheda
              vuota è l'unica riga che si vede e somigliava a una riga da compilare */}
          <tr style={{ background: "rgba(148, 163, 184, 0.10)" }}>
            <td style={{ ...S.td, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", whiteSpace: "nowrap", fontStyle: "italic" }}>
              🔍 {t("cfg.filterRowLabel")}
            </td>
            <td style={S.td}>
              <input style={{ ...S.input, fontSize: 11 }} placeholder={t("cfg.filterPh")} value={fltId}
                onChange={(e) => setFltId(e.target.value)} spellCheck={false} />
            </td>
            <td style={S.td}>
              <input style={{ ...S.input, fontSize: 11 }} placeholder={t("cfg.filterPh")} value={fltDesc}
                onChange={(e) => setFltDesc(e.target.value)} spellCheck={false} />
            </td>
            <td style={S.td}>
              <select style={{ ...S.input, fontSize: 11, cursor: "pointer" }} value={fltType} onChange={(e) => setFltType(e.target.value)}>
                <option value="">—</option>
                <OpzioniTipo />
              </select>
            </td>
            <td style={S.td}>
              <select style={{ ...S.input, fontSize: 11, cursor: "pointer" }} value={fltHist} onChange={(e) => setFltHist(e.target.value)}>
                <option value="">—</option>
                <option value="yes">{t("common.yes")}</option>
                <option value="no">{t("common.no")}</option>
              </select>
            </td>
            <td style={S.td}>
              <select style={{ ...S.input, fontSize: 11, cursor: "pointer" }} value={fltUse} onChange={(e) => setFltUse(e.target.value)}>
                <option value="">{t("cfg.useAll")}</option>
                <option value="unused">{t("cfg.useUnused")}</option>
                <option value="used">{t("cfg.useUsed")}</option>
              </select>
            </td>
            <td style={S.td} colSpan={2}>
              {filtersActive && (
                <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", whiteSpace: "nowrap" }}>
                  {view.length}/{tags.length}{" "}
                  <button onClick={clearFilters} title={t("cfg.filterClear")}
                    style={{ background: "transparent", border: "none", color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer", fontSize: 11 }}>✕</button>
                </span>
              )}
            </td>
          </tr>
        </thead>
        <tbody>
          {view.map(({ tag, origIdx: i }: { tag: TagDef; origIdx: number }) => {
            const tv = tagValues[tag.id];
            // Le foglie contano: un oggetto si lega a `motore1.velocita`, non
            // a `motore1`. Senza, l'istanza risultava «non usata» e si poteva
            // cancellare lasciando la pagina legata al nulla.
            const usiTag = usiDiUnTag(tag, usedTagInfo, storeProject?.types ?? []);
            const uses = usiTag.length > 0 ? usiTag : undefined;
            const unused = tag.id.trim() !== "" && !uses;
            return (
              <React.Fragment key={i}>
              <tr style={{ background: unused ? "rgba(245,158,11,0.07)" : i % 2 === 0 ? "transparent" : "var(--brand-bg, #0f172a)" }}>
                <td style={{ ...S.td, textAlign: "center" }}
                  title={unused ? t("cfg.unusedHint") : uses ? `${t("cfg.usedIn")}: ${uses.slice(0, 4).map((u) => u.where).join(", ")}${uses.length > 4 ? "…" : ""}` : ""}>
                  {unused
                    ? <span style={{ color: "var(--brand-warning, #f59e0b)", fontSize: 12 }}>●</span>
                    : uses
                      ? <span style={{ color: "var(--brand-surface-2, #334155)", fontSize: 12 }}>●</span>
                      : null}
                </td>
                <td style={S.td}>
                  <input
                    style={S.input}
                    placeholder="es. pump1.speed"
                    value={tag.id}
                    onChange={(e) => updateTag(i, { id: e.target.value })}
                    spellCheck={false}
                  />
                </td>
                <td style={S.td}>
                  <input
                    style={S.input}
                    placeholder={t("cfg.descriptionOptional")}
                    value={tag.description}
                    onChange={(e) => updateTag(i, { description: e.target.value })}
                  />
                </td>
                <td style={S.td}>
                  {/* Mostra il nome canonico (`int` → i64) ma scrive nel file solo
                      quando l'utente cambia: gli alias sopravvivono finché si vuole. */}
                  <select
                    style={{ ...S.input, cursor: "pointer" }}
                    value={tag.type_ref ? `@${tag.type_ref}` : (normalizzaTipo(tag.data_type) ?? "f64")}
                    onChange={(e) => {
                      const v = e.target.value;
                      // Fase 2: scegliendo un tipo struttura la variabile
                      // diventa un'**istanza**, e le sue parti si raggiungono
                      // per percorso. `data_type` resta com'è: non conta più,
                      // e riportarlo indietro non deve perdere niente.
                      updateTag(i, v.startsWith("@")
                        ? { type_ref: v.slice(1) }
                        : { data_type: v as TagDataType, type_ref: undefined });
                    }}
                  >
                    <OpzioniTipo />
                    {(storeProject?.types ?? []).length > 0 && (
                      <optgroup label={t("cfg.tagTipiProgetto")}>
                        {(storeProject?.types ?? []).map((td) => (
                          <option key={td.id} value={`@${td.id}`}>{td.id}</option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={tag.history ?? false}
                    onChange={(e) => updateTag(i, { history: e.target.checked })}
                    style={{ cursor: "pointer" }}
                  />
                </td>
                <td style={S.td}>
                  {datastoreIds.length > 0 ? (
                    <select
                      style={{ ...S.input, cursor: "pointer" }}
                      value={tag.datastore_id ?? ""}
                      onChange={(e) => updateTag(i, { datastore_id: e.target.value || undefined })}
                      disabled={!tag.history}
                    >
                      <option value="">(default)</option>
                      {datastoreIds.map((d) => (
                        <option key={d.id} value={d.id}>{d.label}</option>
                      ))}
                    </select>
                  ) : (
                    <span style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 11 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "center" }}>
                  {tv != null ? (
                    <span style={{
                      fontSize: 12,
                      color: tv.quality === "Good" ? "var(--brand-success, #22c55e)" : tv.quality === "Bad" ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #eab308)",
                    }}>
                      {String(tv.value)}
                    </span>
                  ) : (
                    <span style={{ color: "var(--brand-surface-2, #334155)", fontSize: 12 }}>—</span>
                  )}
                </td>
                <td style={{ ...S.td, textAlign: "right" }}>
                  <button
                    style={{
                      ...S.btn("ghost"),
                      marginRight: 4,
                      color: tag.expression ? "#818cf8" : "var(--brand-text-subtle, #94a3b8)",
                      fontFamily: "monospace",
                      fontWeight: "bold",
                    }}
                    title={t("cfg.computedExpr")}
                    onClick={() => toggleExpr(i)}
                  >
                    λ
                  </button>
                  <button
                    style={{
                      ...S.btn("ghost"),
                      marginRight: 4,
                      color: hasMeta(tag) ? "#38bdf8" : "var(--brand-text-subtle, #94a3b8)",
                      fontWeight: "bold",
                    }}
                    title={t("cfg.tagMeta")}
                    onClick={() => toggleMeta(i)}
                  >
                    ⚙
                  </button>
                  <button
                    style={{
                      ...S.btn("ghost"),
                      marginRight: 4,
                      color: tag.generator?.enabled ? "#34d399" : "var(--brand-text-subtle, #94a3b8)",
                      fontWeight: "bold",
                    }}
                    title={t("cfg.tagGenerator")}
                    onClick={() => toggleGen(i)}
                  >
                    ∿
                  </button>
                  {dichiaratiSalvati.has(tag.id) && (
                    <button style={S.btnXs} title={t("cfg.renameTag")} onClick={() => setRinominaDi(tag.id)}>✎</button>
                  )}
                  {/* Fase 0c: una variabile usata non si cancella — al salvataggio
                      rinascerebbe (regola 0b). Prima si tolgono i riferimenti. */}
                  <button style={{ ...S.btn("danger"), ...(uses ? { opacity: 0.4, cursor: "not-allowed" } : {}) }}
                          disabled={!!uses}
                          title={uses ? t("cfg.deleteUsedHint", { n: uses.length, dove: uses.slice(0, 3).map((u) => u.where).join(", ") }) : undefined}
                          onClick={() => { if (!uses) removeTag(i); }}>✕</button>
                </td>
              </tr>
              {metaOpen.has(i) && (
                <tr style={{ background: "#0a1628" }}>
                  <td colSpan={8} style={{ ...S.td, paddingTop: 6, paddingBottom: 8 }}>
                    {(() => {
                      const numCell = (label: string, key: keyof TagDef, ph = "") => (
                        <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 90 }}>
                          {label}
                          <input
                            style={{ ...S.input, fontSize: 12 }}
                            type="number" placeholder={ph}
                            value={(tag[key] as number | undefined) ?? ""}
                            onChange={(e) => updateTag(i, { [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<TagDef>)}
                          />
                        </label>
                      );
                      return (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 90 }}>
                              {t("cfg.tagUnit")}
                              <input style={{ ...S.input, fontSize: 12 }} placeholder="°C, bar…"
                                value={tag.unit ?? ""}
                                onChange={(e) => updateTag(i, { unit: e.target.value || undefined })} />
                            </label>
                            {numCell(t("cfg.tagDecimals"), "decimals", "1")}
                            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 100 }}
                                   title={t("cfg.tagArrayHint")}>
                              {t("cfg.tagArray")}
                              <input style={{ ...S.input, fontSize: 12, fontFamily: "monospace" }} placeholder="2 o 2,3"
                                value={(tag.array ?? []).join(",")}
                                spellCheck={false}
                                onChange={(e) => {
                                  const v = e.target.value.split(",").map((x) => x.trim()).filter(Boolean).map(Number);
                                  const valido = v.length > 0 && v.every((n) => Number.isInteger(n) && n > 0);
                                  updateTag(i, { array: valido ? v : undefined });
                                }} />
                            </label>
                            {numCell("Range lo", "range_lo")}
                            {numCell("Range hi", "range_hi")}
                            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 120 }}>
                              {t("cfg.tagWriteRole")}
                              <select style={{ ...S.input, fontSize: 12, cursor: "pointer" }}
                                value={tag.write_min_role ?? ""}
                                onChange={(e) => updateTag(i, { write_min_role: (e.target.value || undefined) as TagDef["write_min_role"] })}>
                                <option value="">Operator (default)</option>
                                <option value="Viewer">Viewer</option>
                                <option value="Supervisor">Supervisor</option>
                                <option value="Admin">Admin</option>
                              </select>
                            </label>
                            <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 110 }}>
                              {t("cfg.tagWriteType")}
                              <select style={{ ...S.input, fontSize: 12, cursor: "pointer" }}
                                value={tag.write_data_type ? (normalizzaTipo(tag.write_data_type) ?? "") : ""}
                                onChange={(e) => updateTag(i, { write_data_type: (e.target.value || undefined) as TagDef["write_data_type"] })}>
                                <option value="">{t("cfg.tagWriteTypeSame")}</option>
                                <OpzioniTipo />
                              </select>
                            </label>
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                            <span style={{ fontSize: 10, color: "#38bdf8", width: 90, alignSelf: "center" }}>{t("cfg.tagScaling")}</span>
                            {numCell("Raw min", "raw_min")}
                            {numCell("Raw max", "raw_max")}
                            {numCell("Eng min", "eng_min")}
                            {numCell("Eng max", "eng_max")}
                          </div>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                            <span style={{ fontSize: 10, color: "#f59e0b", width: 90, alignSelf: "center" }}>{t("cfg.tagLimits")}</span>
                            {numCell("Lo-Lo", "limit_lo_lo")}
                            {numCell("Lo", "limit_lo")}
                            {numCell("Hi", "limit_hi")}
                            {numCell("Hi-Hi", "limit_hi_hi")}
                          </div>
                          <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
                            {t("cfg.tagMetaHint")}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                </tr>
              )}
              {(exprOpen.has(i) || !!tag.expression) && (
                <tr style={{ background: "#0a1628" }}>
                  <td colSpan={8} style={{ ...S.td, paddingTop: 4, paddingBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontSize: 11, color: "#818cf8", minWidth: 70, fontFamily: "monospace" }}>
                        λ espressione
                      </span>
                      <input
                        style={{ ...S.input, flex: 1, fontFamily: "monospace", fontSize: 12, color: "#c4b5fd" }}
                        placeholder='es. tags["motor.v"] * tags["motor.i"]'
                        value={tag.expression ?? ""}
                        onChange={(e) => updateTag(i, { expression: e.target.value || undefined })}
                        spellCheck={false}
                      />
                    </div>
                  </td>
                </tr>
              )}
              {(genOpen.has(i) || !!tag.generator) && (
                <tr style={{ background: "#0a1628" }}>
                  <td colSpan={8} style={{ ...S.td, paddingTop: 6, paddingBottom: 8 }}>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
                      <span style={{ fontSize: 11, color: "#34d399", width: 90, fontFamily: "monospace" }}>
                        ∿ {t("cfg.tagGenerator")}
                      </span>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
                        <input
                          type="checkbox"
                          checked={tag.generator?.enabled ?? false}
                          onChange={(e) => patchGenerator(i, tag, { enabled: e.target.checked })}
                        />
                        {t("cfg.tagGeneratorEnabled")}
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 100 }}>
                        {t("cfg.tagGeneratorShape")}
                        <select
                          style={{ ...S.input, fontSize: 12, cursor: "pointer" }}
                          value={tag.generator?.shape ?? "ramp"}
                          onChange={(e) => patchGenerator(i, tag, { shape: e.target.value as GeneratorSpec["shape"] })}
                        >
                          <option value="ramp">Ramp</option>
                          <option value="triangle">Triangle</option>
                          <option value="square">Square</option>
                        </select>
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 90 }}>
                        {t("cfg.tagGeneratorPeriod")}
                        <input
                          style={{ ...S.input, fontSize: 12 }}
                          type="number" min={50}
                          value={tag.generator?.period_ms ?? 1000}
                          onChange={(e) => patchGenerator(i, tag, { period_ms: Number(e.target.value) })}
                        />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 90 }}>
                        Min
                        <input
                          style={{ ...S.input, fontSize: 12 }}
                          type="number"
                          value={tag.generator?.min ?? 0}
                          onChange={(e) => patchGenerator(i, tag, { min: Number(e.target.value) })}
                        />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 90 }}>
                        Max
                        <input
                          style={{ ...S.input, fontSize: 12 }}
                          type="number"
                          value={tag.generator?.max ?? 100}
                          onChange={(e) => patchGenerator(i, tag, { max: Number(e.target.value) })}
                        />
                      </label>
                      <button
                        style={{ ...S.btn("ghost"), fontSize: 11 }}
                        onClick={() => updateTag(i, { generator: undefined })}
                      >
                        {t("cfg.tagGeneratorRemove")}
                      </button>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", marginTop: 6 }}>
                      {t("cfg.tagGeneratorHint")}
                    </div>
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>

      <BarraConflittoSezione sync={sync} t={t} />

      <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button style={S.btn("ghost")} onClick={addTag}>{t("cfgUi.addVariable")}</button>
      </div>

      {/* Orphan source tags — present in protocol sources but missing from project.tags */}
      {(() => {
        const explicitIds = new Set(tags.map(t => t.id));
        const orphanIds = [...sourceTagIds(storeProject).keys()].filter(id => !explicitIds.has(id));
        if (orphanIds.length === 0) return null;
        return (
          <div style={{ marginTop: 16, borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 12 }}>
            <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
              {t("cfgUi.tagsFromSourcesNotYet")}
            </div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", marginBottom: 8 }}>
              <Trans i18nKey="cfgUi.orphanTagsNotice" components={TRANS_COMP} />
            </div>
            {orphanIds.map((id) => (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 8,
                                     padding: "5px 8px", background: "var(--brand-bg, #0f172a)",
                                     border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 4, marginBottom: 2 }}>
                <span style={{ flex: 1, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace" }}>{id}</span>
                <span style={{ fontSize: 10, color: "var(--brand-surface-2, #334155)", padding: "1px 5px",
                               border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 3 }}>{t("cfgUi.fromSource")}</span>
                <button
                  title={t("cfg.addTagWithHistory")}
                  style={{ fontSize: 11, padding: "2px 8px", background: "#1e3a5f",
                           color: "#93c5fd", border: "1px solid #1e40af", borderRadius: 3, cursor: "pointer" }}
                  onClick={() => setTags(prev => [...prev, {
                    id, data_type: "float" as TagDataType, description: "", history: true,
                    datastore_id: datastoreIds[0]?.id,
                  }])}
                >
                  {t("cfgUi.enableHistory")}
                </button>
                <button
                  title={t("cfg.addTagNoHistory")}
                  style={{ fontSize: 11, padding: "2px 8px", background: "var(--brand-surface-2, #334155)",
                           color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-border, #475569)", borderRadius: 3, cursor: "pointer" }}
                  onClick={() => setTags(prev => [...prev, {
                    id, data_type: "float" as TagDataType, description: "", history: false,
                  }])}
                >
                  +
                </button>
              </div>
            ))}
          </div>
        );
      })()}
      </Tenuta>
    </div>
  );
}
