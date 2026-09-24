import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { LanguageTable, LangEntry } from "@/types";
import { useAppStore } from "@/store";
import { contaAutomatiche, eAutomatica, marcaComeUmana } from "@/i18n/tabellaLingue";
import { migraTestiProgetto } from "@/i18n/migraTesti";
import { S, SaveBar } from "@/config/comuni";

// ── ConfigView root ───────────────────────────────────────────────────────────

// ── Languages tab (T-40): project message translation table ─────────────────
// I quattro fornitori di traduzione e cosa vogliono come chiave. Specchio di
// `Fornitore::richiede_chiave()` in `sws-web/src/traduttore.rs:54`: quattro
// righe, e la divergenza è dichiarata qui invece di un endpoint in più.
// «optional» è LibreTranslate, che accetta `api_key` (`traduttore.rs:312`)
// ma fino al 18-09-2026 non aveva il campo per darla.
const FORNITORI = ["my_memory", "libre_translate", "google", "ia"] as const;
const CHIAVE: Record<string, "required" | "optional" | "ide" | "none"> = {
  my_memory: "none",
  libre_translate: "optional",
  google: "required",
  ia: "ide",
};

export function LanguagesTab() {
  const markSaveOk = useAppStore((s) => s.markSaveOk);
  const { t } = useTranslation();
  const storeTable       = useAppStore((s) => s.project?.languages);
  const updateLanguages  = useAppStore((s) => s.updateProjectLanguages);
  const editorPreviewLang = useAppStore((s) => s.editorPreviewLang);
  const setEditorPreviewLang = useAppStore((s) => s.setEditorPreviewLang);
  const [table, setTable] = useState<LanguageTable>(() => storeTable ?? { default: "", langs: [], entries: [] });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Filtro (per colonna: "key" o codice lingua) + ordinamento (solo visuale).
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ col: string; dir: "asc" | "desc" } | null>(null);

  useEffect(() => { if (storeTable) setTable(storeTable); }, [storeTable]);

  // Intenzione dell'utente, non confronto strutturale (vedi TagsTab).
  const [touched, setTouched] = useState(false);
  const patch = (p: Partial<LanguageTable>) => { setTouched(true); setTable((tb) => ({ ...tb, ...p })); };

  const cellText = (e: LangEntry, col: string) => (col === "key" ? e.key : e.values[col] ?? "");
  const setFilter = (col: string, q: string) => setFilters((f) => ({ ...f, [col]: q }));
  const toggleSort = (col: string) =>
    setSort((s) => (s?.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  // Vista filtrata+ordinata che CONSERVA l'indice originale in table.entries:
  // gli handler di modifica lavorano su quell'indice, non sulla posizione a video.
  const view = (() => {
    const rows = table.entries
      .map((e, origIdx) => ({ e, origIdx }))
      .filter(({ e }) =>
        Object.entries(filters).every(([col, q]) =>
          !q.trim() || cellText(e, col).toLowerCase().includes(q.trim().toLowerCase())));
    if (sort) {
      const dir = sort.dir === "asc" ? 1 : -1;
      rows.sort((a, b) => cellText(a.e, sort.col).localeCompare(cellText(b.e, sort.col), undefined, { numeric: true }) * dir);
    }
    return rows;
  })();

  const addLang = () => {
    const code = window.prompt(t("langtab.langCodePrompt"))?.trim().toLowerCase();
    if (!code || table.langs.includes(code)) return;
    patch({ langs: [...table.langs, code], default: table.default || code });
  };
  const removeLang = (code: string) => {
    // Ripulisci filtro/ordinamento riferiti alla colonna rimossa, altrimenti un
    // filtro stale su una lingua sparita nasconderebbe righe.
    setFilters((f) => { const n = { ...f }; delete n[code]; return n; });
    setSort((s) => (s?.col === code ? null : s));
    setTouched(true);
    setTable((tb) => ({
      default: tb.default === code ? (tb.langs.find((l) => l !== code) ?? "") : tb.default,
      langs: tb.langs.filter((l) => l !== code),
      entries: tb.entries.map((e) => { const v = { ...e.values }; delete v[code]; return { ...e, values: v }; }),
    }));
  };
  const addRow = () => { setFilters({}); setSort(null); patch({ entries: [...table.entries, { key: "", values: {} }] }); };
  const removeRow = (idx: number) => patch({ entries: table.entries.filter((_, i) => i !== idx) });
  const setKey = (idx: number, key: string) =>
    patch({ entries: table.entries.map((e, i) => (i === idx ? { ...e, key } : e)) });
  // Scrivere a mano in una cella la rende lavoro umano: il marchio «automatica»
  // per quella lingua sparisce (`marcaComeUmana`, gemello di `marca_come_umana`
  // in Rust). Fino al 18-09-2026 il marchio restava, e «ritraduci tutto» poteva
  // riscrivere una correzione fatta a mano — la promessa «una traduzione umana
  // non si sovrascrive mai» valeva solo lato runtime.
  const setVal = (idx: number, code: string, val: string) =>
    patch({ entries: table.entries.map((e, i) =>
      (i === idx ? marcaComeUmana({ ...e, values: { ...e.values, [code]: val } }, code) : e)) });

  // Le proposte si modificano, si accettano o si buttano. Accettarle le sposta
  // fra i valori e toglie il marchio «automatica»: da quel momento sono lavoro
  // umano, e la passata di traduzione successiva non le tocca più.
  const setProposta = (idx: number, code: string, val: string) =>
    patch({ entries: table.entries.map((e, i) => (i === idx
      ? { ...e, proposte: { ...(e.proposte ?? {}), [code]: val } } : e)) });

  const approvaProposta = (idx: number, code: string) =>
    patch({ entries: table.entries.map((e, i) => {
      if (i !== idx) return e;
      const { [code]: testo, ...restanti } = e.proposte ?? {};
      return {
        ...e,
        values: { ...e.values, [code]: testo ?? "" },
        proposte: restanti,
        auto: (e.auto ?? []).filter((l) => l !== code),
      };
    }) });

  const scartaProposta = (idx: number, code: string) =>
    patch({ entries: table.entries.map((e, i) => {
      if (i !== idx) return e;
      const { [code]: _via, ...restanti } = e.proposte ?? {};
      return { ...e, proposte: restanti };
    }) });


  const handleSave = async () => {
    const clean: LanguageTable = { ...table, entries: table.entries.filter((e) => e.key.trim() !== "") };
    setSaving(true);
    try {
      await api.updateLanguages(clean);
      updateLanguages(clean);
      setTable(clean);
      setTouched(false);
      // Senza questo il watcher del progetto scambia il NOSTRO salvataggio per
      // un cambio esterno e fa comparire la barra «il progetto sul runtime è
      // cambiato». Premere «Ricarica» lì butta via il lavoro non salvato — il
      // maintainer ci ha perso degli oggetti appena inseriti, il 15-09-2026.
      // Tutte le altre schede di ConfigView lo chiamavano già; questa no.
      markSaveOk();
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  };


  // ── Migrazione dei testi letterali (progetti nati prima delle lingue) ─────
  const [migrando, setMigrando] = useState(false);
  const migraTesti = async () => {
    const st = useAppStore.getState();
    const clean: LanguageTable = { ...table, entries: table.entries.filter((e) => e.key.trim() !== "") };
    const esito = migraTestiProgetto({
      pages: st.pages, faceplates: st.faceplates, alarms: st.project?.alarms ?? [], tabella: clean,
    });
    const r = esito.riepilogo;
    if (r.campi === 0) { window.alert(t("langtab.migrateNothing")); return; }
    if (!window.confirm(t("langtab.migrateConfirm", {
      campi: r.campi, nuove: r.vociNuove, riusi: r.riusi,
      pagine: r.pagineToccate.length, faceplate: r.faceplateToccati.length, allarmi: r.allarmi,
    }))) return;
    setMigrando(true);
    try {
      // Il backup viene prima di qualunque scrittura: se non si riesce a farlo
      // non si migra, perché la migrazione riscrive molti file.
      await api.createBackup();
      // Le pagine in memoria vengono prima, poi ogni scrittura dichiara di essere
      // nostra: senza `markSaveOk` il watcher del progetto vede cambiare
      // `project.yaml`, mostra «cambiato sul runtime» e un «Ricarica» butta le
      // pagine migrate ma non ancora salvate (successo il 20-09-2026: tabella
      // piena, pagine rimaste letterali).
      const mod = new Set(r.pagineToccate);
      st.updatePagesProps(esito.pages.filter((p) => mod.has(p.id)).map((p) => ({ id: p.id, patch: { objects: p.objects } })));
      st.setFaceplates(esito.faceplates);
      await api.updateLanguages(esito.tabella);
      updateLanguages(esito.tabella);
      setTable(esito.tabella);
      markSaveOk();
      if (r.allarmi > 0) {
        await api.updateAlarms(esito.alarms);
        st.updateProjectAlarms(esito.alarms);
        markSaveOk();
      }
      const modificati = new Set(r.faceplateToccati);
      for (const f of esito.faceplates.filter((x) => modificati.has(x.id))) await api.saveFaceplate(f);
      markSaveOk();
      // `saveAll` esce in silenzio se un altro salvataggio è in corso: si aspetta.
      for (let i = 0; i < 50 && useAppStore.getState().saveStatus === "saving"; i++) {
        await new Promise((res) => setTimeout(res, 200));
      }
      await useAppStore.getState().saveAll();
      const fine = useAppStore.getState();
      if (fine.saveStatus === "error") throw new Error(fine.saveError ?? "save");
      markSaveOk();
      window.alert(t("langtab.migrateDone", { campi: r.campi }));
    } catch (e) {
      window.alert(t("langtab.migrateFailed", { reason: e instanceof Error ? e.message : String(e) }));
    } finally { setMigrando(false); }
  };

  // ── Traduzione automatica (Fase 4) ────────────────────────────────────────
  //
  // Il default è la modalità SEMPLICE: chi preme «traduci» deve ottenere una
  // traduzione, non un modulo di configurazione. I fornitori a pagamento
  // (Google, e l'assistente IA già configurato) stanno nello stesso elenco.
  const [traduttore, setTraduttore] = useState("my_memory");
  const [chiaveTrad, setChiaveTrad] = useState("");
  const [urlTrad, setUrlTrad] = useState("");
  const [traducendo, setTraducendo] = useState<string | null>(null);

  // ── Configurazione del fornitore, persistita nell'istanza (F5) ────────────
  //
  // Fino a qui fornitore/chiave/url erano stato locale del componente: si
  // sceglieva Google e si ridigitava la chiave a ogni sessione. Al mount si
  // rilegge quanto salvato — se l'istanza non lo espone (non-IDE, o ruolo
  // senza permesso) resta la modalità semplice di sempre, in silenzio: non è
  // un errore da mostrare, è la stessa condizione di `translateLanguages`.
  const [haChiaveSalvata, setHaChiaveSalvata] = useState(false);
  const [salvandoFornitore, setSalvandoFornitore] = useState(false);
  const [esitoFornitore, setEsitoFornitore] = useState<string | null>(null);

  useEffect(() => {
    api.getConfigTraduzione()
      .then((c) => {
        setTraduttore(c.fornitore);
        setUrlTrad(c.url ?? "");
        setHaChiaveSalvata(c.ha_chiave);
      })
      .catch(() => { /* istanza non-IDE, o ruolo senza permesso: resta il default */ });
  }, []);

  const salvaFornitore = async () => {
    setSalvandoFornitore(true); setEsitoFornitore(null);
    try {
      // La chiave si manda solo se scritta ora: lasciarla vuota tiene quella
      // già salvata, stessa convenzione di `putAiConfig`/`AssistenteSection`.
      await api.putConfigTraduzione(traduttore, urlTrad.trim() || undefined, chiaveTrad.trim() || undefined);
      if (chiaveTrad.trim()) { setHaChiaveSalvata(true); setChiaveTrad(""); }
      setEsitoFornitore(t("langtab.fornitoreSalvato"));
    } catch (e) {
      setEsitoFornitore(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoFornitore(false);
    }
  };

  const cancellaChiaveFornitore = async () => {
    if (!window.confirm(t("langtab.confermaCancellaChiave", { fornitore: t(`langtab.fornitore.${traduttore}`) }))) return;
    setSalvandoFornitore(true); setEsitoFornitore(null);
    try {
      await api.deleteConfigTraduzioneChiave(traduttore);
      setHaChiaveSalvata(false);
      setEsitoFornitore(t("langtab.chiaveCancellata"));
    } catch (e) {
      setEsitoFornitore(e instanceof Error ? e.message : String(e));
    } finally {
      setSalvandoFornitore(false);
    }
  };

  const traduci = async (verso: string) => {
    if (!verso || verso === table.default) return;
    // Quante voci partiranno davvero: una richiesta di rete ciascuna, in fila.
    // Dirlo prima è l'unica onestà possibile su un'attesa che può durare
    // minuti — il maintainer l'ha vissuta come un blocco senza spiegazione.
    const quante = table.entries.filter(
      (e) => (e.values[table.default] ?? "").trim() !== "" && (e.values[verso] ?? "").trim() === "",
    ).length;
    if (quante === 0) {
      window.alert(t("langtab.nothingToTranslate", { verso }));
      return;
    }
    if (!window.confirm(t("langtab.translateConfirm", { quante, verso }))) return;
    // Si salva prima: il server traduce ciò che ha su disco, e una riga appena
    // digitata e non salvata non verrebbe tradotta — senza che nessuno capisca
    // perché.
    await handleSave();
    setTraducendo(verso);
    try {
      const r = await api.translateLanguages({
        a: verso,
        sovrascrivi: false,
        config: {
          fornitore: traduttore,
          url: urlTrad.trim() || undefined,
          chiave: chiaveTrad.trim() || undefined,
        },
      });
      const p = await api.getProject();
      if (p) {
        useAppStore.getState().setProject(p);
        // **E anche la copia locale di questa scheda.** Senza, la tabella qui
        // resta quella di prima della traduzione: il salvataggio successivo —
        // compreso quello che `traduci` fa da sé all'inizio — rimanderebbe al
        // server la versione vecchia, CANCELLANDO le traduzioni appena fatte.
        // È il difetto per cui una colonna risultava vuota dopo aver tradotto
        // verso due lingue di fila.
        if (p.languages) setTable(p.languages);
      }
      // Anche questa è una scrittura nostra su project.yaml: va dichiarata, o
      // il watcher la legge come un cambio esterno.
      markSaveOk();
      const problemi = r.problemi.length
        ? "\n\n" + t("langtab.untranslatedRows", { n: r.problemi.length }) + "\n" + r.problemi.slice(0, 8).join("\n")
        : "";
      // Le proposte non sono un errore: sono lavoro recuperabile. Vanno dette
      // per prime, o l'autore non sa che c'è qualcosa in rosso ad aspettarlo.
      // La guardia check_i18n_ui ha visto crescere questo file di una stringa
      // quando il testo qui sotto è stato riscritto: giusto, era italiano
      // cablato in un dialogo. Ora passa dal catalogo.
      const daApprovare = r.proposte ? "\n\n" + t("langtab.daApprovare", { n: r.proposte }) : "";
      window.alert(
        t("langtab.translatedResult", { tradotte: r.tradotte, verso, saltate: r.saltate }) +
          daApprovare +
          problemi +
          "\n\n" + t("langtab.translatedReviewWarning"),
      );
    } catch (e) {
      window.alert(t("langtab.translationFailed", { message: e instanceof Error ? e.message : String(e) }));
    } finally {
      setTraducendo(null);
    }
  };

  const exportCsv = () => {
    const cols = ["key", ...table.langs];
    const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const rows = table.entries.map((e) => [e.key, ...table.langs.map((l) => e.values[l] ?? "")].map(esc).join(","));
    const csv = [cols.join(","), ...rows].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "languages.csv" });
    a.click(); URL.revokeObjectURL(url);
  };

  const importCsv = async (file: File) => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 1) return;
    // parser CSV minimale con supporto virgolette
    const parse = (line: string): string[] => {
      const out: string[] = []; let cur = "", q = false;
      for (let i = 0; i < line.length; i++) { const c = line[i];
        if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
        else if (c === '"') q = true; else if (c === ",") { out.push(cur); cur = ""; } else cur += c; }
      out.push(cur); return out;
    };
    const header = parse(lines[0]).map((h) => h.trim());
    const langs = header.slice(1).filter(Boolean);
    const entries: LangEntry[] = lines.slice(1).map((l) => {
      const cells = parse(l); const values: Record<string, string> = {};
      langs.forEach((lang, i) => { if (cells[i + 1] !== undefined) values[lang] = cells[i + 1]; });
      return { key: (cells[0] ?? "").trim(), values };
    }).filter((e) => e.key !== "");
    setFilters({}); setSort(null); // le lingue cambiano: filtro/ordinamento vecchi non valgono più
    setTouched(true);
    setTable((tb) => ({ default: tb.default || langs[0] || "", langs, entries }));
  };

  const CELL: React.CSSProperties = { border: "1px solid var(--brand-surface-2, #334155)", padding: 0 };
  const IN: React.CSSProperties = { width: "100%", background: "transparent", border: "none", color: "var(--brand-text, #e2e8f0)", padding: "5px 8px", fontSize: 12, boxSizing: "border-box" };

  return (
    <div style={S.section}>
      <SaveBar onSave={handleSave} saving={saving} saved={saved} savedNotice={t("langtab.saved")} section="languages" dirty={touched} />
      <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12, lineHeight: 1.5 }}>{t("langtab.intro")}</div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>{t("langtab.projectLang")}:</span>
        <select value={table.default} onChange={(e) => patch({ default: e.target.value })}
          title={t("langtab.projectLangHint")}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}>
          {table.langs.length === 0 && <option value="">—</option>}
          {table.langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginLeft: 6 }}>{t("langtab.editorLang")}:</span>
        <select value={table.langs.includes(editorPreviewLang) ? editorPreviewLang : table.default}
          onChange={(e) => setEditorPreviewLang(e.target.value)}
          title={t("langtab.editorLangHint")}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}>
          {table.langs.length === 0 && <option value="">—</option>}
          {table.langs.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
        <button onClick={addLang} style={S.btn("primary")}>{t("langtab.addLang")}</button>
        <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginLeft: 10 }}>{t("langtab.traduciCon")}</span>
        <select value={traduttore} onChange={(e) => setTraduttore(e.target.value)}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12 }}>
          {FORNITORI.map((f) => <option key={f} value={f}>{t(`langtab.fornitore.${f}`)}</option>)}
        </select>
        {CHIAVE[traduttore] !== "none" && CHIAVE[traduttore] !== "ide" && (
          <input type="password" value={chiaveTrad} onChange={(e) => setChiaveTrad(e.target.value)}
            placeholder={haChiaveSalvata
              ? t("langtab.chiaveSalvataPlaceholder")
              : t(CHIAVE[traduttore] === "required" ? "langtab.chiaveApi" : "langtab.chiaveApiFacoltativa")}
            autoComplete="off"
            style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12, width: 140 }} />
        )}
        {traduttore === "libre_translate" && (
          <input type="text" value={urlTrad} onChange={(e) => setUrlTrad(e.target.value)}
            placeholder="https://libretranslate.com"
            style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", fontSize: 12, width: 190 }} />
        )}
        {/* F5: fornitore/url/chiave persistiti nell'istanza — una volta salvati
            non si ridigitano a ogni sessione. Esplicito perché è una scrittura
            fuori dal progetto, non un effetto collaterale del salvataggio
            della tabella. */}
        <button onClick={salvaFornitore} disabled={salvandoFornitore} style={S.btn("ghost")}
          title={t("langtab.salvaFornitoreHint")}>
          {t("langtab.salvaFornitore")}
        </button>
        {haChiaveSalvata && (
          <button onClick={cancellaChiaveFornitore} disabled={salvandoFornitore} style={S.btn("ghost")}>
            {t("langtab.cancellaChiave")}
          </button>
        )}
        {esitoFornitore && (
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{esitoFornitore}</span>
        )}
        {traducendo && (
          <span style={{ fontSize: 12, color: "var(--brand-warning-soft, #fbbf24)" }}>
            {t("langtab.traducendo", { lang: traducendo })}
          </span>
        )}
        {contaAutomatiche(table) > 0 && (
          <span style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)", marginLeft: 8 }}
            title={t("langtab.autoHint")}>
            {t("langtab.autoCount", { n: contaAutomatiche(table) })}
          </span>
        )}
        {table.langs.filter((l) => l !== table.default).map((l) => (
          <button key={l} onClick={() => traduci(l)} disabled={traducendo !== null}
            title={t("cfgUi.fillsEmptyCells", { lang: l })}
            style={S.btn("ghost")}>
            {traducendo === l ? `→ ${l}…` : `→ ${l}`}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={migraTesti} style={S.btn("ghost")} disabled={migrando} title={t("langtab.migrateHint")}>{t("langtab.migrate")}</button>
        <button onClick={exportCsv} style={S.btn("ghost")} disabled={table.entries.length === 0}>{t("langtab.exportCsv")}</button>
        <button onClick={() => fileRef.current?.click()} style={S.btn("ghost")}>{t("langtab.importCsv")}</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) importCsv(f); }} />
      </div>

      {table.langs.length === 0 ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 20 }}>{t("langtab.noLangs")}</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: "24%" }}>
                <span onClick={() => toggleSort("key")} title={t("langtab.sortHint")} style={{ cursor: "pointer", userSelect: "none" }}>
                  {t("langtab.key")}{sort?.col === "key" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </span>
              </th>
              {table.langs.map((l) => (
                <th key={l} style={{ ...S.th }}>
                  <span onClick={() => toggleSort(l)} title={t("langtab.sortHint")} style={{ cursor: "pointer", userSelect: "none" }}>
                    {l}{l === table.default ? " ★" : ""}{sort?.col === l ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </span>
                  <button onClick={() => removeLang(l)} title={t("langtab.removeLang")}
                    style={{ marginLeft: 6, background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer" }}>✕</button>
                </th>
              ))}
              <th style={{ ...S.th, width: 32 }} />
            </tr>
            <tr>
              <th style={{ ...CELL, padding: 0 }}>
                <input value={filters["key"] ?? ""} onChange={(ev) => setFilter("key", ev.target.value)}
                  placeholder={t("langtab.filterPlaceholder")} style={{ ...IN, fontFamily: "monospace" }} spellCheck={false} />
              </th>
              {table.langs.map((l) => (
                <th key={l} style={{ ...CELL, padding: 0 }}>
                  <input value={filters[l] ?? ""} onChange={(ev) => setFilter(l, ev.target.value)}
                    placeholder={t("langtab.filterPlaceholder")} style={IN} />
                </th>
              ))}
              <th style={{ ...CELL, padding: 0 }} />
            </tr>
          </thead>
          <tbody>
            {view.map(({ e, origIdx }) => (
              <tr key={origIdx}>
                <td style={CELL}>
                  <input value={e.key} onChange={(ev) => setKey(origIdx, ev.target.value)} placeholder="start_pompa"
                    style={{ ...IN, fontFamily: "monospace" }} spellCheck={false} />
                </td>
                {table.langs.map((l) => (
                  <td key={l} style={CELL}>
                    {/* Una PROPOSTA non è una traduzione: sta fuori da
                        `values` e non raggiunge nessun pannello finché una
                        persona non la guarda. Ci finisce ciò che il fornitore
                        ha restituito mutilato — tipicamente un segnaposto di
                        formato perso, cioè una frase senza il proprio numero.
                        Prima veniva scartata in silenzio. */}
                    {e.proposte?.[l] ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <input
                          value={e.proposte[l]}
                          onChange={(ev) => setProposta(origIdx, l, ev.target.value)}
                          style={{ ...IN, borderColor: "var(--brand-danger, #ef4444)", color: "var(--brand-danger-soft, #fca5a5)" }}
                          title={t("langtab.propostaHint")}
                        />
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span style={{ fontSize: 10, color: "var(--brand-danger-soft, #fca5a5)" }}>
                            {t("langtab.daApprovareBreve")}
                          </span>
                          <button onClick={() => approvaProposta(origIdx, l)} style={S.btn("ghost")}
                            title={t("langtab.approva")}>✓</button>
                          <button onClick={() => scartaProposta(origIdx, l)} style={S.btn("ghost")}
                            title={t("langtab.scarta")}>✕</button>
                        </div>
                      </div>
                    ) : eAutomatica(e, l) ? (
                      // Riempita dalla macchina e mai riletta: bordo tratteggiato,
                      // finché una persona non la tocca. Prima era identica a una
                      // cella scritta a mano, e il marchio non si vedeva da nessuna parte.
                      <input value={e.values[l] ?? ""} onChange={(ev) => setVal(origIdx, l, ev.target.value)}
                        style={{ ...IN, borderStyle: "dashed", borderColor: "var(--brand-warning, #eab308)" }}
                        title={t("langtab.autoHint")} />
                    ) : (
                      <input value={e.values[l] ?? ""} onChange={(ev) => setVal(origIdx, l, ev.target.value)} style={IN} />
                    )}
                  </td>
                ))}
                <td style={{ ...CELL, textAlign: "center" }}>
                  <button onClick={() => removeRow(origIdx)} style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14 }}>✕</button>
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={table.langs.length + 2} style={{ ...CELL, color: "var(--brand-text-subtle, #64748b)", padding: 16, textAlign: "center" }}>
                {table.entries.length === 0 ? t("langtab.empty") : t("langtab.noMatch")}
              </td></tr>
            )}
          </tbody>
        </table>
      )}
      <button onClick={addRow} style={{ ...S.btn("ghost"), marginTop: 10 }} disabled={table.langs.length === 0}>{t("langtab.addRow")}</button>
    </div>
  );
}
