import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { findObjects } from "@/search/findObjects";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { findBrokenNavLinks, findOrphanPageIds } from "@/pageLayout";
import { resolvePageBackground } from "@/theme";
import { AlberoConfigurazione } from "./AlberoConfigurazione";
import { aggiungiOggetto, persistiFunzioni } from "./azioniEditor";
import { canConfigureProject, canEditProject } from "@/auth/permissions";
import { IntestazioneSezione, PREFISSO_MEMORIA, TitoloVista, useSezioneAperta, colonneGuide, guideAlbero } from "./stilePannelli";
import type { ObjectGroup, SynopticObject, SynopticPage } from "@/types";
import { BOOT_TYPES, eBoot, paginePerNavigazione, pagineDiBoot } from "@/boot/tipi";
import { impostaBootAbilitata } from "@/boot/abilitata";
import { discendentiDi, riconcilia, righe, spostaRispettoA, type ZonaRilascio } from "@/pageTree";

// ── Shared styles ─────────────────────────────────────────────────────────────

const S = {
  panel: {
    background: "var(--brand-surface, #1e293b)",
    color: "var(--brand-text-2, #cbd5e1)",
    display: "flex" as const,
    flexDirection: "column" as const,
    width: 220,
    borderRight: "1px solid var(--brand-surface-2, #334155)",
    overflow: "hidden" as const,
    flexShrink: 0,
  },
  row: (active?: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "3px 12px",
    cursor: "pointer",
    fontSize: 12,
    background: active ? "var(--brand-surface-2, #334155)" : "transparent",
    color: active ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-muted, #94a3b8)",
  }),
  iconBtn: {
    background: "transparent",
    border: "none",
    color: "var(--brand-text-subtle, #94a3b8)",
    cursor: "pointer",
    fontSize: 12,
    padding: "0 2px",
    lineHeight: 1,
    flexShrink: 0,
  } as React.CSSProperties,
  objBtn: {
    background: "var(--brand-bg, #0f172a)",
    color: "var(--brand-text-2, #cbd5e1)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    padding: "4px 6px",
    cursor: "pointer",
    fontSize: 12,
    textAlign: "left" as const,
    flex: "1 1 calc(50% - 4px)",
    minWidth: 0,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
  } as React.CSSProperties,
};

/** Vero quando la sezione è **la** vista del pannello, non una delle sette
 *  fisarmoniche in colonna (T-56 passo 2). Cambia due cose: l'intestazione non
 *  si può chiudere — chiudere l'unica vista lascerebbe un pannello vuoto — e il
 *  corpo prende tutta l'altezza invece del suo tetto in pixel. */
const ModoVista = createContext(false);

/** Vero quando la sezione è un **ramo dell'albero unico** del pannello
 *  (25-09-2026: niente più colonna di icone). L'intestazione è quella dei rami
 *  di configurazione, e il corpo non ha tetto: scorre l'albero intero, non la
 *  singola sezione. */
const InAlbero = createContext(false);

/** L'altezza del corpo di una sezione.
 *
 *  In colonna ogni sezione ha il suo tetto (220, 300, 240… a seconda di quanto
 *  contenuto tipico ha), altrimenti una sola lista lunga spingerebbe le altre
 *  sei fuori dallo schermo. Come vista quei tetti sono il contrario di quel che
 *  serve: la lista deve arrivare in fondo al pannello. */
function useCorpo(tetto = 220): React.CSSProperties {
  const vista = useContext(ModoVista);
  const albero = useContext(InAlbero);
  if (albero) return { padding: "2px 0" };
  return vista
    ? { overflowY: "auto", padding: "4px 0", flex: 1, minHeight: 0 }
    : { overflowY: "auto", padding: "4px 0", maxHeight: tetto };
}

// ── Section accordion ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
  headerAction,
  memoria,
  icona,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Optional extra control rendered in the header, before the chevron
   *  (e.g. a ⚙ settings button). Clicks on it don't toggle the section. */
  headerAction?: React.ReactNode;
  /** Chiave sotto cui ricordare aperta/chiusa (senza prefisso: lo mette
   *  `stilePannelli`). Fino al 2026-09-11 nessuna sezione di questo pannello
   *  ricordava niente: si ripartiva dai default a ogni montaggio, e i default
   *  aprivano Pagine, Oggetti e Cronologia insieme. */
  memoria?: string;
  /** Il glifo del ramo, quando la sezione sta nell'albero. */
  icona?: string;
}) {
  const vista = useContext(ModoVista);
  const albero = useContext(InAlbero);
  const [open, commuta] = useSezioneAperta(memoria, defaultOpen);
  if (albero) {
    return (
      <div style={{ padding: "0 8px" }}>
        <IntestazioneSezione titolo={title} icona={icona} aperta={open} onToggle={commuta} azione={headerAction} />
        {open && <div>{children}</div>}
      </div>
    );
  }
  if (vista) {
    return (
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <TitoloVista titolo={title} azione={headerAction} />
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {children}
        </div>
      </div>
    );
  }
  return (
    <div style={{ flexShrink: 0 }}>
      <IntestazioneSezione titolo={title} aperta={open} onToggle={commuta} azione={headerAction} rilievo />
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Pages section ─────────────────────────────────────────────────────────────

const CHIAVE_ALBERO_CHIUSI = PREFISSO_MEMORIA + "sinistra.alberoChiusi";

/** Un ramo dell'albero per pagine e immagini di boot: stessa intestazione
 *  degli altri rami, apertura ricordata. */
function RamoPagine({ titolo, icona, memoria, azione, children }: {
  titolo: string; icona: string; memoria: string; azione?: React.ReactNode; children: React.ReactNode;
}) {
  const [aperto, commuta] = useSezioneAperta(memoria, true);
  return (
    <div style={{ padding: "0 8px" }}>
      <IntestazioneSezione titolo={titolo} icona={icona} aperta={aperto} onToggle={commuta} azione={azione} />
      {aperto && children}
    </div>
  );
}

function PagesSection() {
  const { t } = useTranslation();
  const tutte         = useAppStore((s) => s.pages);
  // L'elenco delle pagine del pannello: le pagine di boot hanno la loro sezione.
  const pages         = paginePerNavigazione(tutte);
  const bootPages     = pagineDiBoot(tutte);
  const addBootPage   = useAppStore((s) => s.addBootPage);
  // F8 — serve alla miniatura: il colore della pagina dipende dal tema, e
  // qui era l'unico punto dell'IDE che non lo risolveva.
  const themeMode     = useAppStore((s) => s.themeMode);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const scegliPagina  = useAppStore((s) => s.setCurrentPage);
  // Dalla Configurazione (24-09-2026 il pannello è visibile anche lì) una
  // pagina scelta nell'albero riporta all'editor: è lì che la si guarda.
  const setCurrentPage = (id: string) => {
    scegliPagina(id);
    const st = useAppStore.getState();
    if (st.appMode === "config") st.setAppMode("edit");
  };
  const addPage       = useAppStore((s) => s.addPage);
  const deletePage    = useAppStore((s) => s.deletePage);
  const renamePage    = useAppStore((s) => s.renamePage);
  const impostaAlbero = useAppStore((s) => s.impostaAlberoPagine);
  const duplicatePage = useAppStore((s) => s.duplicatePage);
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const project       = useAppStore((s) => s.project);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; zona: ZonaRilascio } | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [chiusi, setChiusi] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(CHIAVE_ALBERO_CHIUSI) ?? "[]") as string[]); }
    catch { return new Set(); }
  });
  const ricordaChiusi = (n: Set<string>) => {
    setChiusi(n);
    try { localStorage.setItem(CHIAVE_ALBERO_CHIUSI, JSON.stringify([...n])); } catch { /* senza memoria si riparte tutto aperto */ }
  };
  const commutaNodo = (id: string) => {
    const n = new Set(chiusi);
    if (n.has(id)) n.delete(id); else n.add(id);
    ricordaChiusi(n);
  };
  const [linkReportOpen, setLinkReportOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const homePageId = project?.page_layout?.home_page_id;
  const bootPageId = project?.page_layout?.boot_page_id;
  const orphanIds = findOrphanPageIds(pages, homePageId, project?.page_layout?.page_tree);
  const albero = riconcilia(project?.page_layout?.page_tree, pages.map((p) => p.id));
  const righeAlbero = righe(albero, chiusi);
  const perId = new Map(pages.map((p) => [p.id, p]));
  const discendentiTrascinata = draggedId ? new Set(discendentiDi(albero, draggedId)) : new Set<string>();

  // Single-page YAML export — calls the runtime endpoint, then triggers a
  // browser download using the filename it returned. Persisted page state
  // must be on disk for export to see it; the LeftPanel "Salva tutto"
  // button is the user's responsibility to click first.
  const handleExportPage = async (name: string) => {
    try {
      const { blob, filename } = await api.exportSynopticYaml(name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(t("editor.exportFailed", { err: e instanceof Error ? e.message : String(e) }));
    }
  };

  // Single-page YAML import — reads the chosen file, posts to the runtime
  // (which assigns a fresh id + filename), then reloads the project so the
  // newly-imported page appears in the editor.
  const handleImportPage = async (file: File) => {
    try {
      const text = await file.text();
      const res = await api.importSynopticYaml(text);
      const project = await api.getProject();
      useAppStore.getState().setProject(project);
      // Reload pages list — the store doesn't auto-refresh from /api/project.
      const pagesLoaded = await api.loadAllPages();
      useAppStore.getState().setPages(pagesLoaded);
      useAppStore.getState().setCurrentPage(res.id);
    } catch (e) {
      window.alert(t("editor.importFailed", { err: e instanceof Error ? e.message : String(e) }));
    }
  };

  const beginRename = (id: string, name: string) => {
    setEditingId(id);
    setEditingValue(name);
  };
  const commitRename = () => {
    if (editingId) {
      const v = editingValue.trim();
      if (v) renamePage(editingId, v);
    }
    setEditingId(null);
    setEditingValue("");
  };

  // Trascinamento sull'albero: ogni riga ha tre zone — il quarto alto (prima), il
  // quarto basso (dopo) e il mezzo (dentro: diventa figlia). Il calcolo della
  // posizione è in `pageTree.spostaRispettoA`, che rifiuta i cicli.
  const onRowDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-sws-page", id);
  };
  const zonaDi = (e: React.DragEvent): ZonaRilascio => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = r.height > 0 ? (e.clientY - r.top) / r.height : 0.5;
    return y < 0.25 ? "prima" : y > 0.75 ? "dopo" : "dentro";
  };
  const onRowDragOver = (e: React.DragEvent, id: string) => {
    if (!draggedId || draggedId === id || discendentiTrascinata.has(id)) return;
    e.preventDefault();
    setDrop({ id, zona: zonaDi(e) });
  };
  const onRowDrop = (e: React.DragEvent, bersaglio: string) => {
    e.preventDefault();
    const zona = drop?.id === bersaglio ? drop.zona : zonaDi(e);
    const trascinata = draggedId;
    setDrop(null);
    setDraggedId(null);
    if (!trascinata) return;
    const nuovo = spostaRispettoA(albero, trascinata, bersaglio, zona);
    if (!nuovo) return;
    impostaAlbero(nuovo);
    // Rilasciata «dentro»: il bersaglio si apre, o la pagina sparirebbe alla vista.
    if (zona === "dentro" && chiusi.has(bersaglio)) { const n = new Set(chiusi); n.delete(bersaglio); ricordaChiusi(n); }
  };

  // Il corpo in due pezzi, uno per ramo dell'albero: pagine e immagini di boot.
  const corpoPagine = (
    <>
        {righeAlbero.map((r, iRiga) => {
          const p = perId.get(r.id);
          if (!p) return null;
          const mostraAzioni = hoverId === p.id || p.id === currentPageId;
          const zona = drop?.id === p.id ? drop.zona : null;
          return (
            <div
              key={p.id}
              data-pagina={p.name}
              data-livello={r.livello}
              draggable={editingId !== p.id}
              onDragStart={(e) => onRowDragStart(e, p.id)}
              onDragOver={(e) => onRowDragOver(e, p.id)}
              onDragLeave={() => setDrop((cur) => (cur?.id === p.id ? null : cur))}
              onDrop={(e) => onRowDrop(e, p.id)}
              onDragEnd={() => { setDraggedId(null); setDrop(null); }}
              onMouseEnter={() => setHoverId(p.id)}
              onMouseLeave={() => setHoverId((cur) => (cur === p.id ? null : cur))}
              style={{
                ...S.row(p.id === currentPageId), justifyContent: "space-between",
                gap: 4, paddingLeft: 6 + r.livello * 14, position: "relative",
                // La L che aggancia la pagina al suo genitore, più le
                // verticali dei livelli più in alto (25-09-2026). «Ultimo
                // figlio» si legge dalla riga dopo: se scende di livello (o
                // non c'è), dopo questa non ci sono sorelle.
                ...guideAlbero(colonneGuide(Math.max(0, r.livello - 1), 13), r.livello === 0 ? undefined : {
                  x: 13 + (r.livello - 1) * 14,
                  finoA: 18 + r.livello * 14,
                  ultimo: (righeAlbero[iRiga + 1]?.livello ?? -1) < r.livello,
                }),
                ...(zona === "prima" ? { boxShadow: "inset 0 2px 0 var(--brand-primary, #3b82f6)" } : {}),
                ...(zona === "dopo" ? { boxShadow: "inset 0 -2px 0 var(--brand-primary, #3b82f6)" } : {}),
                ...(zona === "dentro" ? { outline: "1px solid var(--brand-primary, #3b82f6)", outlineOffset: -1 } : {}),
                opacity: draggedId === p.id ? 0.5 : 1,
              }}
              onClick={() => editingId !== p.id && setCurrentPage(p.id)}
              onDoubleClick={() => !p.locked && beginRename(p.id, p.name)}
              title={t("editor.dblRename")}
            >
              {r.haFigli ? (
                <button
                  style={{ ...S.iconBtn, width: 14, flexShrink: 0, padding: 0 }}
                  title={r.aperto ? t("editor.treeCollapse") : t("editor.treeExpand")}
                  onClick={(e) => { e.stopPropagation(); commutaNodo(p.id); }}
                >{r.aperto ? "▾" : "▸"}</button>
              ) : (
                <span style={{ width: 14, flexShrink: 0 }} />
              )}
              <div style={{
                width: 28, height: 18, flexShrink: 0, borderRadius: 2, overflow: "hidden",
                // F8 — il colore lo dipinge il canvas, non questo contenitore: qui resta solo la
                // cornice (la miniatura risolve lo sfondo per il tema, come il resto dell'IDE).
                background: "var(--brand-bg, #0f172a)",
                border: "1px solid var(--brand-surface-2, #334155)",
                pointerEvents: "none",
              }}>
                {/* Anteprima di sola lettura, sempre in «rapporto» così la miniatura è un
                    ridimensionamento con bande, qualunque sia la modalità vera del progetto. */}
                <SvgCanvas
                  objects={p.objects}
                  background={resolvePageBackground(p.background, p.background_dark, themeMode)}
                  pageWidth={p.width || 1920}
                  pageHeight={p.height || 1080}
                  sizeMode="ratio"
                />
              </div>
              {editingId === p.id ? (
                <input
                  autoFocus
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") { setEditingId(null); setEditingValue(""); }
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    flex: 1, minWidth: 0,
                    background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
                    border: "1px solid var(--brand-border, #475569)", borderRadius: 3, padding: "1px 4px", fontSize: 12,
                  }}
                />
              ) : (
                <>
                  {p.id === homePageId && <span title={t("editor.homePageTitle")} style={{ flexShrink: 0 }}>🏠</span>}
                  {orphanIds.has(p.id) && <span title={t("editor.orphanPageTitle")} style={{ flexShrink: 0 }}>⚠️</span>}
                  {p.locked && !mostraAzioni && <span style={{ flexShrink: 0, fontSize: 10 }}>🔒</span>}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                    {p.name}
                  </span>
                  {mostraAzioni && (
                    // Le azioni stanno sopra il nome, a destra (come negli alberi dei file): il
                    // nome resta intero finché non si passa col mouse, e non si accorcia mai.
                    <span style={{
                      position: "absolute", right: 2, top: 0, bottom: 0, display: "flex", alignItems: "center", gap: 1,
                      paddingLeft: 6, background: "var(--brand-surface-2, #334155)", borderRadius: 3,
                    }}>
                      <button style={S.iconBtn} title={p.locked ? t("editor.unlockPage") : t("editor.lockPage")}
                        onClick={(e) => { e.stopPropagation(); updatePageProps(p.id, { locked: !p.locked }); }}>{p.locked ? "🔒" : "🔓"}</button>
                      <button style={S.iconBtn} title={t("editor.addChildPage")}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (chiusi.has(p.id)) { const n = new Set(chiusi); n.delete(p.id); ricordaChiusi(n); }
                          addPage(p.id);
                        }}>＋</button>
                      <button style={S.iconBtn} title={t("editor.duplicatePage")}
                        onClick={(e) => { e.stopPropagation(); duplicatePage(p.id); }}>⧉</button>
                      <button style={S.iconBtn} title={t("editor.exportPage")}
                        onClick={(e) => { e.stopPropagation(); handleExportPage(p.name); }}>⬇</button>
                      <button style={S.iconBtn} title={t("editor.rename")} disabled={p.locked}
                        onClick={(e) => { e.stopPropagation(); beginRename(p.id, p.name); }}>✎</button>
                      {pages.length > 1 && (
                        <button style={S.iconBtn} title={t("editor.deletePage")}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(t("editor.deletePageConfirm", { name: p.name }))) deletePage(p.id);
                          }}>×</button>
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
          );
        })}
        <div style={{ padding: "4px 8px", display: "flex", gap: 4 }}>
          <button
            onClick={() => addPage(null)}
            style={{ ...S.objBtn, flex: "1 1 auto", borderStyle: "dashed", color: "var(--brand-text-subtle, #64748b)" }}
          >
            {t("leftPanel.newPage")}
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title={t("editor.importPage")}
            style={{ ...S.objBtn, flex: "0 0 auto", borderStyle: "dashed", color: "var(--brand-text-subtle, #64748b)", padding: "4px 8px" }}
          >
            ⬆ YAML
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".yaml,.yml,application/x-yaml,text/yaml"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleImportPage(f);
              e.target.value = ""; // allow re-selecting the same file
            }}
          />
        </div>
    </>
  );
  const corpoBoot = (
    <>
        {bootPages.map((p) => (
          <div
            key={p.id}
            style={{ ...S.row(p.id === currentPageId), justifyContent: "space-between", gap: 6 }}
            onClick={() => editingId !== p.id && setCurrentPage(p.id)}
            onDoubleClick={() => !p.locked && beginRename(p.id, p.name)}
            title={t("editor.dblRename")}
          >
            <span style={{ flexShrink: 0 }}>🖼</span>
            {editingId === p.id ? (
              <input
                autoFocus
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitRename();
                  else if (e.key === "Escape") { setEditingId(null); setEditingValue(""); }
                }}
                onClick={(e) => e.stopPropagation()}
                style={{
                  flex: 1, background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
                  border: "1px solid var(--brand-border, #475569)", borderRadius: 3, padding: "1px 4px", fontSize: 12,
                }}
              />
            ) : (
              <>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {p.name}
                </span>
                <span style={{ display: "flex", gap: 2, flexShrink: 0, alignItems: "center" }}>
                  <label style={{ display: "flex", alignItems: "center", cursor: "pointer" }}
                         title={t("leftPanel.bootEnabledTitle")}
                         onClick={(e) => e.stopPropagation()}>
                    <input
                      type="radio"
                      name="boot-abilitata"
                      checked={bootPageId === p.id}
                      onChange={() => {
                        impostaBootAbilitata(p.id).catch((e) =>
                          window.alert(t("leftPanel.bootEnableFailed", { err: e instanceof Error ? e.message : String(e) })));
                      }}
                    />
                    <span aria-hidden="true">⭐</span>
                  </label>
                  <button style={S.iconBtn} title={t("editor.rename")} disabled={p.locked}
                    onClick={(e) => { e.stopPropagation(); beginRename(p.id, p.name); }}>✎</button>
                  <button style={S.iconBtn} title={t("editor.deletePage")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!window.confirm(t("editor.deletePageConfirm", { name: p.name }))) return;
                      deletePage(p.id);
                      // Eliminare la pagina abilitata azzera il puntatore: senza, il
                      // progetto punterebbe a una pagina che non esiste più.
                      if (bootPageId === p.id) impostaBootAbilitata(undefined).catch(() => {});
                    }}>×</button>
                </span>
              </>
            )}
          </div>
        ))}
        {bootPages.length === 0 && (
          <div style={{ padding: "2px 8px", fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
            {t("leftPanel.noBootPages")}
          </div>
        )}
        <div style={{ padding: "4px 8px" }}>
          <button
            onClick={addBootPage}
            style={{ ...S.objBtn, width: "100%", borderStyle: "dashed", color: "var(--brand-text-subtle, #64748b)" }}
          >
            {t("leftPanel.newBootPage")}
          </button>
        </div>
    </>
  );
  const modale = (
    <>
      {linkReportOpen && (
        <LinkReportModal
          pages={pages}
          orphanIds={orphanIds}
          onClose={() => setLinkReportOpen(false)}
          onJumpTo={(pageId, objId) => {
            setCurrentPage(pageId);
            if (objId) useAppStore.getState().selectObject(objId);
            setLinkReportOpen(false);
          }}
        />
      )}
    </>
  );

  return (
    <>
      {modale}
      <div data-testid="albero-pagine">
        <RamoPagine titolo={t("editor.sectionPages")} icona="📄" memoria="albero.pagine"
          azione={<button style={S.iconBtn} title={t("editor.checkLinksTitle")} onClick={() => setLinkReportOpen(true)}>🔗</button>}>
          {corpoPagine}
        </RamoPagine>
      </div>
      <RamoPagine titolo={t("leftPanel.bootPagesHeading")} icona="🖼" memoria="albero.boot">
        {corpoBoot}
      </RamoPagine>
    </>
  );
}

// ── Link report modal (broken navbutton targets + orphaned pages) ───────────
// Consolidates points "link rotti" + "pagine orfane" in one report, since both
// come from the same navbutton graph traversal.

function LinkReportModal({
  pages, orphanIds, onClose, onJumpTo,
}: {
  pages: SynopticPage[];
  orphanIds: Set<string>;
  onClose: () => void;
  onJumpTo: (pageId: string, objId?: string) => void;
}) {
  const { t } = useTranslation();
  const broken = findBrokenNavLinks(pages);
  const orphanPages = pages.filter((p) => orphanIds.has(p.id));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, width: "min(90vw, 460px)", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{t("leftPanel.checkLinks")}</div>
          <button style={{ background: "transparent", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 16 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 0.5, marginBottom: 6 }}>
            LINK ROTTI ({broken.length})
          </div>
          {broken.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 14 }}>{t("leftPanel.noBrokenLinks")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {broken.map((b) => (
                <div key={`${b.pageId}:${b.objId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "#450a0a33", border: "1px solid #991b1b", borderRadius: 4, padding: "4px 8px" }}>
                  <span style={{ flex: 1, color: "var(--brand-danger-soft, #fca5a5)" }}>
                    <strong>{b.pageName}</strong> → "{b.objName}" {t("leftPanel.pointsToMissingPage")} ("{b.targetId}")
                  </span>
                  <button style={S.iconBtn} onClick={() => onJumpTo(b.pageId, b.objId)}>Vai</button>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 0.5, marginBottom: 6 }}>
            PAGINE ORFANE ({orphanPages.length})
          </div>
          {orphanPages.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("leftPanel.noOrphanPages")}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {orphanPages.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "#78350f22", border: "1px solid #92400e", borderRadius: 4, padding: "4px 8px" }}>
                  <span style={{ flex: 1, color: "var(--brand-warning, #f59e0b)" }}>
                    "{p.name}" {t("leftPanel.noLinkReachesItAnd")}
                  </span>
                  <button style={S.iconBtn} onClick={() => onJumpTo(p.id)}>Vai</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Objects palette section ───────────────────────────────────────────────────

interface PaletteItem { type: SynopticObject["type"]; label: string; icon: string }
/** Un gruppo della palette, con **due** colori d'accento.
 *
 *  Quello scuro non è un lusso: i pastelli scelti per lo sfondo scuro
 *  (`#60a5fa`, `#34d399`…) su una superficie chiara arrivano a **1,8:1** di
 *  contrasto — le intestazioni «CONTROLLI», «DISPLAY», «FORME» erano quasi
 *  invisibili col tema chiaro, segnalate dal maintainer il 2026-09-06. Le
 *  tinte `colorLight` sono gli stessi colori due gradini più scuri, e stanno
 *  sopra 4,5:1 su `#f8fafc`. */
interface PaletteGroup { category: string; color: string; colorLight: string; defaultOpen?: boolean; items: PaletteItem[] }

/** Esportata perché è **l'elenco autorevole dei tipi piazzabili**: il test
 *  d'inventario dei campi (T-56) e chiunque debba iterare sui tipi deve
 *  leggerlo da qui, non riscriverlo — un secondo elenco diverge in silenzio. */
export const PALETTE_GROUPS: PaletteGroup[] = [
  { category: "Forme", color: "#60a5fa", colorLight: "#2563eb", defaultOpen: true, items: [
    { type: "rect",    label: "Rettangolo", icon: "▭" },
    { type: "ellipse", label: "Ellisse",    icon: "○" },
    { type: "line",    label: "Linea",      icon: "╱" },
    { type: "text",    label: "Testo",      icon: "T" },
    { type: "image",   label: "Immagine",   icon: "🖼" },
  ]},
  { category: "Controlli", color: "#34d399", colorLight: "#047857", items: [
    { type: "button",    label: "Bottone",  icon: "⊡" },
    { type: "navbutton", label: "Nav page", icon: "↗" },
    { type: "page_navigator", label: "Page navigator", icon: "☰" },
    { type: "checkbox",  label: "Checkbox", icon: "☑" },
    { type: "radio",     label: "Radio",    icon: "◉" },
    { type: "slider",    label: "Slider",   icon: "↔" },
    { type: "setpoint",  label: "Setpoint", icon: "🎯" },
    { type: "lang_selector", label: "Lingua ▾", icon: "🌐" },
    { type: "lang_button",   label: "Lingua btn", icon: "🏳" },
  ]},
  { category: "Display", color: "#fb923c", colorLight: "#c2410c", items: [
    { type: "gauge",        label: "Gauge",      icon: "◔" },
    { type: "led",          label: "LED",        icon: "●" },
    { type: "state_lamp",   label: "Lampada multi-stato", icon: "🔴" },
    { type: "progress_bar", label: "Progress",   icon: "▰" },
    { type: "table",        label: "Tabella",    icon: "≡" },
    { type: "trend",        label: "Trend",      icon: "∿" },
    { type: "xy_plot",      label: "Grafico XY", icon: "✥" },
    { type: "sparkline",    label: "Sparkline",  icon: "⌇" },
    { type: "kpi_tile",     label: "KPI",        icon: "◧" },
    { type: "data_log",     label: "Data log",   icon: "≣" },
    { type: "text_list",    label: "Lista testi", icon: "≣" },
    { type: "bar_chart",    label: "Bar Chart",  icon: "▐" },
    { type: "pie_chart",    label: "Pie Chart",  icon: "◑" },
    { type: "alarm_viewer", label: "Allarmi",    icon: "⚠" },
    { type: "alarm_bell",   label: "Campanella allarmi", icon: "🔔" },
    { type: "alarm_banner", label: "Barra allarmi", icon: "▬" },
    { type: "alarm_history", label: "Storico allarmi", icon: "🕘" },
    { type: "recipe_panel", label: "Ricette",     icon: "📋" },
  ]},
  { category: "SCADA", color: "#f472b6", colorLight: "#be185d", items: [
    { type: "symbol",    label: "Simbolo",   icon: "⚙" },
    { type: "pipe",      label: "Tubazione", icon: "⋯" },
    { type: "faceplate", label: "Faceplate", icon: "🧩" },
  ]},
  { category: "Layout", color: "#a78bfa", colorLight: "#6d28d9", items: [
    { type: "grid", label: "Griglia", icon: "⊞" },
  ]},
];

/** Il colore d'accento del gruppo, scelto sul tema **risolto**.
 *
 *  `themeMode` può valere "system": chiedere allo store non basta, bisogna
 *  guardare cosa il tema ha effettivamente applicato. L'attributo
 *  `data-theme` sul `<html>` lo dice, ed è lo stesso che usa il CSS. */
function coloreGruppo(group: PaletteGroup, _mode: unknown): string {
  // `_mode` non si legge: serve a **far ri-renderizzare** il componente quando
  // il tema cambia. Il valore vero lo dà `data-theme` sul `<html>`, perché
  // `themeMode` può essere "system" e allora lo store non sa quale dei due sia
  // stato applicato. Senza la dipendenza dallo store, commutare il tema
  // lasciava le intestazioni del colore di prima fino al primo re-render per
  // altri motivi — cioè a volte sì e a volte no.
  const chiaro = typeof document !== "undefined"
    && document.documentElement.getAttribute("data-theme") === "light";
  return chiaro ? group.colorLight : group.color;
}

/** Una categoria della palette come sotto-ramo di Strumenti (25-09-2026):
 *  una riga per oggetto, con l'icona nel colore del gruppo. Prima erano
 *  riquadri su due colonne (22-09): nell'albero unico ogni cosa è una riga. */
function GruppoStrumenti({ group, showLvglBadge, ultimo }: { group: PaletteGroup; showLvglBadge: boolean; ultimo: boolean }) {
  const { t } = useTranslation();
  const themeMode = useAppStore((s) => s.themeMode);
  const [open, commuta] = useSezioneAperta(`strumenti.${group.category}`, group.defaultOpen ?? false);
  const colore = coloreGruppo(group, themeMode);
  return (
    <div>
      <button
        type="button"
        onClick={commuta}
        aria-expanded={open}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 20px",
          border: "none", background: "transparent", cursor: "pointer", textAlign: "left",
          ...guideAlbero([], { x: 13, finoA: 18, ultimo: ultimo && !open }),
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 9, width: 10, color: "var(--brand-text-subtle, #64748b)" }}>{open ? "▼" : "▶"}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: colore, letterSpacing: 0.5 }}>
          {t(`editor.palette.group.${group.category}`)}
        </span>
      </button>
      {open && group.items.map(({ type, icon }, iItem) => (
        <button
          key={type}
          type="button"
          data-testid={`strumento-${type}`}
          onClick={() => aggiungiOggetto(type)}
          title={t("leftPanel.strumentoAggiungi")}
          style={{
            width: "100%", display: "flex", alignItems: "center", gap: 6, padding: "3px 8px 3px 36px",
            border: "none", borderRadius: 4, background: "transparent", cursor: "pointer", textAlign: "left",
            fontSize: 12, color: "var(--brand-text-muted, #94a3b8)",
            ...guideAlbero(ultimo ? [] : [13], {
              x: 27, finoA: 34, ultimo: iItem === group.items.length - 1,
            }),
          }}
        >
          <span aria-hidden="true" style={{ width: 16, height: 16, lineHeight: "16px", fontSize: 13, textAlign: "center", color: colore, flexShrink: 0 }}>
            {icon}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {t(`editor.palette.item.${type}`)}
          </span>
          {/* In fondo alla riga e non sopra l'icona: nei riquadri c'era spazio,
              in una riga d'albero copriva l'icona. */}
          {showLvglBadge && LVGL_SUPPORTED_TYPES.has(type) && (
            <span
              title={t("editor.paletteLvglBadgeTitle")}
              style={{
                flexShrink: 0, fontSize: 8, fontWeight: 700, lineHeight: 1,
                color: "#0f172a", background: "#fbbf24", borderRadius: 2, padding: "1px 3px",
              }}
            >
              L
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

// Sottoinsieme di tipi che il motore LVGL sa interpretare oggi (vedi
// sws-lvgl-viewer/src/lvgl_render.rs SUPPORTED_TYPES — tenere allineati).
// Man mano che il motore cresce (Fase 6+), questo elenco cresce con lui.
const LVGL_SUPPORTED_TYPES = new Set<SynopticObject["type"]>([
  // `image` dal 2026-08-26: il viewer LVGL rasterizza gli SVG con resvg
  // (D2). Vale per i `src` .svg — un png o un jpg mostrano il segnaposto.
  "image",
  // Gli ultimi tre, dal 2026-08-27: il motore LVGL copre ora tutti e 35 i tipi
  // della palette. `kpi_tile` è composto dai renderer esistenti; `data_log` e
  // `alarm_history` sono tabelle riempite una volta al disegno, come sul web.
  "kpi_tile",
  "data_log",
  "alarm_history",
  "rect",
  "text",
  "button",
  "led",
  "slider",
  "progress_bar",
  "checkbox",
  "radio",
  "ellipse",
  "line",
  "gauge",
  "state_lamp",
  "table",
  "navbutton",
  "page_navigator",
  "trend",
  "alarm_viewer",
  "text_list",
  "bar_chart",
  "sparkline",
  "alarm_banner",
  "faceplate",
  "symbol",
  "grid",
  "pipe",
  "alarm_bell",
  "recipe_panel",
  "setpoint",
  "xy_plot",
  "pie_chart",
  "lang_button",
  "lang_selector",
]);

/** Per un progetto target LVGL, mostra solo gli oggetti che il motore sa
 *  già interpretare — evita di far piazzare qualcosa che poi nel viewer
 *  LVGL semplicemente non comparirà. Gruppi che restano senza item vengono
 *  nascosti del tutto invece di mostrare un accordion vuoto. */
function paletteForTarget(isLvgl: boolean, paginaBoot = false): PaletteGroup[] {
  // Una pagina di boot ammette solo gli oggetti statici: hanno la precedenza sul
  // motore di destinazione, perché il PNG lo produce il browser.
  if (paginaBoot) {
    return PALETTE_GROUPS
      .map((g) => ({ ...g, items: g.items.filter((i) => (BOOT_TYPES as readonly string[]).includes(i.type)) }))
      .filter((g) => g.items.length > 0);
  }
  if (!isLvgl) return PALETTE_GROUPS;
  return PALETTE_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => LVGL_SUPPORTED_TYPES.has(i.type)) }))
    .filter((g) => g.items.length > 0);
}

/** Il ramo «Strumenti» dell'albero (25-09-2026): la palette, che fino a
 *  ieri era una vista a sé (➕). Sta in cima all'albero, prima dei rami di
 *  configurazione, e c'è anche in Configurazione: un oggetto cliccato lì
 *  riporta all'editor e si aggiunge alla pagina corrente. */
function RamoStrumenti() {
  const { t } = useTranslation();
  const targetKind = useAppStore((s) => s.project?.target?.kind);
  const isLvgl = targetKind === "lvgl_framebuffer" || targetKind === "lvgl_wayland";
  const paginaBoot = useAppStore((s) => eBoot(s.pages.find((p) => p.id === s.currentPageId)));
  const groups = paletteForTarget(isLvgl, paginaBoot);
  const [aperto, commuta] = useSezioneAperta("config.strumenti", true);
  const nota = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", padding: "0 8px 6px 20px" };
  return (
    <div style={{ padding: "0 8px" }}>
      <IntestazioneSezione titolo={t("leftPanel.strumenti")} icona="🧰" aperta={aperto} onToggle={commuta} />
      {aperto && (<>
        {paginaBoot && <div style={nota}>{t("leftPanel.paletteBootHint")}</div>}
        {!paginaBoot && isLvgl && <div style={nota}>{t("editor.paletteLvglHint")}</div>}
        {groups.map((group) => (
          <GruppoStrumenti key={group.category} group={group} showLvglBadge={!isLvgl}
            ultimo={group === groups[groups.length - 1]} />
        ))}
      </>)}
    </div>
  );
}

// ── Objects-on-page section ──────────────────────────────────────────────────

type TreeNode =
  | { kind: "group"; group: ObjectGroup; members: SynopticObject[] }
  | { kind: "object"; obj: SynopticObject };

// ── Drag & drop + context menu types ─────────────────────────────────────────
//
// Drag&drop: two draggable kinds (object rows + group rows). The drop target
// tells onDrop where the dragged item should land:
//   - "before" / "after": insert adjacent to the target (top half / bottom half
//     of the row, computed in onDragOver)
//   - "inside": for group rows, drop the dragged object inside that group
//   - "root": special "Senza gruppo" drop zone at the bottom of the tree
//
// Context menu: opens on right-click on object/group rows. Position is in
// viewport coords; menu auto-closes on click outside or Esc.

type DragItem =
  | { kind: "object"; id: string }
  | { kind: "group";  id: string };

type DropTarget =
  | { kind: "object"; id: string; place: "before" | "after" }
  | { kind: "group";  id: string; place: "before" | "after" | "inside" }
  | { kind: "root";   place: "after" };

type ContextMenuState =
  | { kind: "object"; id: string; x: number; y: number }
  | { kind: "group";  id: string; x: number; y: number };

function ObjectsSection() {
  const corpoPagina = useCorpo(280);
  const { t } = useTranslation();
  const pages               = useAppStore((s) => s.pages);
  const currentPageId       = useAppStore((s) => s.currentPageId);
  const selectedId          = useAppStore((s) => s.selectedObjectId);
  const selectedIds         = useAppStore((s) => s.selectedObjectIds);
  const selectObject        = useAppStore((s) => s.selectObject);
  const selectMany          = useAppStore((s) => s.selectMany);
  const updateObject        = useAppStore((s) => s.updateObject);
  const duplicateObject     = useAppStore((s) => s.duplicateObject);
  const deleteObject        = useAppStore((s) => s.deleteObject);
  const groupObjects        = useAppStore((s) => s.groupObjects);
  const ungroupObjects      = useAppStore((s) => s.ungroupObjects);
  const renameGroup         = useAppStore((s) => s.renameGroup);
  const moveObjectAdjacent  = useAppStore((s) => s.moveObjectAdjacent);
  const moveObjectToGroupEnd = useAppStore((s) => s.moveObjectToGroupEnd);
  const moveGroupAdjacent   = useAppStore((s) => s.moveGroupAdjacent);
  const selectedCellChild    = useAppStore((s) => s.selectedCellChild);
  const setSelectedCell      = useAppStore((s) => s.setSelectedCell);
  const setSelectedCellChild = useAppStore((s) => s.setSelectedCellChild);
  // F8.3 — ricerca su tutte le pagine: serve navigare alla pagina del risultato
  // e conoscere i faceplate (i tag dei figli contano come tag dell'istanza).
  const setCurrentPage       = useAppStore((s) => s.setCurrentPage);
  const faceplates           = useAppStore((s) => s.faceplates);

  const project              = useAppStore((s) => s.project);
  // R3 (25-09-2026): gli oggetti di **tutte** le pagine, nell'ordine e nel
  // rientro del ramo Pagine. Nasce aperta solo la pagina corrente; le altre si
  // aprono a mano, e il loro elenco si calcola solo allora.
  const [pagineAperte, setPagineAperte] = useState<Set<string>>(() => new Set([currentPageId]));
  useEffect(() => {
    setPagineAperte((prev) => (prev.has(currentPageId) ? prev : new Set([...prev, currentPageId])));
  }, [currentPageId]);
  const commutaPagina = (id: string) =>
    setPagineAperte((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft]       = useState("");
  const [expandedGrids, setExpandedGrids] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupDraft, setGroupDraft] = useState("");
  const [filter, setFilter]     = useState("");
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);

  const currentPage = pages.find((p) => p.id === currentPageId);
  const allObjects = currentPage?.objects ?? [];
  const groups = currentPage?.groups ?? [];
  const fq = filter.trim().toLowerCase();
  // La ricerca è una sola, su tutte le pagine (nome, tipo, id, tag, testi):
  // prima c'erano un filtro sulla pagina e una casella «cerca in tutte le
  // pagine» con un elenco a parte. Ora filtra l'albero stesso.
  const hits = fq ? findObjects(pages, faceplates, fq) : [];
  const hitsByPage = new Map<string, typeof hits>();
  for (const hit of hits) {
    const arr = hitsByPage.get(hit.pageId) ?? [];
    if (!arr.some((h) => h.obj.id === hit.obj.id)) arr.push(hit);
    hitsByPage.set(hit.pageId, arr);
  }
  const filteredObjects = fq
    ? (hitsByPage.get(currentPageId) ?? []).map((h) => h.obj)
    : allObjects;

  const buildTree = (): TreeNode[] => {
    if (fq) {
      return filteredObjects.map((obj) => ({ kind: "object", obj }));
    }
    const tree: TreeNode[] = [];
    const grouped = new Map<string, SynopticObject[]>();
    for (const o of allObjects) {
      if (o.group_id && groups.some((g) => g.id === o.group_id)) {
        const arr = grouped.get(o.group_id) ?? [];
        arr.push(o);
        grouped.set(o.group_id, arr);
      }
    }
    const ungrouped = allObjects.filter(
      (o) => !o.group_id || !groups.some((g) => g.id === o.group_id)
    );
    for (const g of groups) {
      tree.push({ kind: "group", group: g, members: grouped.get(g.id) ?? [] });
    }
    for (const o of ungrouped) {
      tree.push({ kind: "object", obj: o });
    }
    return tree;
  };

  useEffect(() => {
    if (selectedCellChild) {
      setExpandedGrids((prev) =>
        prev.has(selectedCellChild.objectId)
          ? prev
          : new Set([...prev, selectedCellChild.objectId])
      );
    }
  }, [selectedCellChild?.objectId]);

  // Auto-expand group when a member is selected
  useEffect(() => {
    if (selectedId) {
      const obj = allObjects.find((o) => o.id === selectedId);
      if (obj?.group_id) {
        setExpandedGroups((prev) =>
          prev.has(obj.group_id!) ? prev : new Set([...prev, obj.group_id!])
        );
      }
    }
  }, [selectedId]);

  const toggleExpandGrid = (id: string) =>
    setExpandedGrids((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });

  const toggleExpandGroup = (id: string) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });

  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const commitRename = () => {
    if (renaming) {
      updateObject(renaming, { name: draft.trim() || undefined });
    }
    setRenaming(null);
    setDraft("");
  };

  const startRenameGroup = (id: string, name: string) => {
    setRenamingGroup(id);
    setGroupDraft(name);
  };
  const commitRenameGroup = () => {
    if (renamingGroup) {
      const v = groupDraft.trim();
      if (v) renameGroup(renamingGroup, v);
    }
    setRenamingGroup(null);
    setGroupDraft("");
  };

  // ── Drag & drop handlers ──
  // The dataTransfer is set to a marker string so dragging from outside the
  // tree (e.g. from desktop) is ignored. Hit-testing on row hover splits the
  // row into top half (place="before") and bottom half ("after"); for group
  // headers we also expose a center band ("inside") via top:25-75%.

  const computePlace = (e: React.DragEvent, allowInside: boolean): "before" | "after" | "inside" => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = e.clientY - r.top;
    const h = r.height;
    if (allowInside) {
      if (y < h * 0.25) return "before";
      if (y > h * 0.75) return "after";
      return "inside";
    }
    return y < h / 2 ? "before" : "after";
  };

  const onDragStartObject = (e: React.DragEvent, id: string) => {
    setDragItem({ kind: "object", id });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-sws-tree", `obj:${id}`);
  };

  const onDragStartGroup = (e: React.DragEvent, id: string) => {
    setDragItem({ kind: "group", id });
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-sws-tree", `grp:${id}`);
  };

  const onDragOverObjectRow = (e: React.DragEvent, id: string) => {
    if (!dragItem) return;
    // Object → object reorder is always allowed; group → object isn't (groups
    // only reorder relative to other groups).
    if (dragItem.kind === "group") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const place = computePlace(e, false) as "before" | "after";
    setDropTarget({ kind: "object", id, place });
  };

  const onDragOverGroupRow = (e: React.DragEvent, id: string) => {
    if (!dragItem) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragItem.kind === "object") {
      // Dropping an object on a group → either insert before/after the header
      // (treated as before/after the group as a block — i.e. move into a
      // neighbouring group) or "inside" to put the object into this group.
      const place = computePlace(e, true);
      setDropTarget({ kind: "group", id, place });
    } else {
      // Group → group reorder (only before/after).
      const place = computePlace(e, false) as "before" | "after";
      setDropTarget({ kind: "group", id, place });
    }
  };

  const onDragOverRootZone = (e: React.DragEvent) => {
    if (!dragItem || dragItem.kind !== "object") return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTarget({ kind: "root", place: "after" });
  };

  const onDropObject = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragItem || !dropTarget) { setDragItem(null); setDropTarget(null); return; }
    // Object → object: adjacent insert inheriting the target's group.
    if (dragItem.kind === "object" && dropTarget.kind === "object") {
      moveObjectAdjacent(dragItem.id, dropTarget.id, dropTarget.place);
    }
    // Object → group: "inside" appends to the group's tail; before/after
    // moves the object just outside the group block.
    else if (dragItem.kind === "object" && dropTarget.kind === "group") {
      if (dropTarget.place === "inside") {
        moveObjectToGroupEnd(dragItem.id, dropTarget.id);
      } else {
        // Find the first / last member of the target group to anchor next to.
        const page = pages.find((p) => p.id === currentPageId);
        const members = (page?.objects ?? []).filter((o) => o.group_id === dropTarget.id);
        if (members.length === 0) {
          // empty group → just put obj at the end (ungrouped), keeps order
          moveObjectToGroupEnd(dragItem.id, null);
        } else {
          const anchor = dropTarget.place === "before" ? members[0] : members[members.length - 1];
          moveObjectAdjacent(dragItem.id, anchor.id, dropTarget.place);
        }
      }
    }
    // Object → root drop zone: move to ungrouped tail.
    else if (dragItem.kind === "object" && dropTarget.kind === "root") {
      moveObjectToGroupEnd(dragItem.id, null);
    }
    // Group → group reorder.
    else if (dragItem.kind === "group" && dropTarget.kind === "group") {
      moveGroupAdjacent(dragItem.id, dropTarget.id, dropTarget.place === "inside" ? "before" : dropTarget.place);
    }
    setDragItem(null);
    setDropTarget(null);
  };

  const indicatorFor = (kind: "object" | "group", id: string): React.CSSProperties => {
    if (!dropTarget || dropTarget.kind !== kind || dropTarget.id !== id) return {};
    if (dropTarget.place === "inside") {
      return { boxShadow: "inset 0 0 0 2px #38bdf8", background: "#1e3a5f" };
    }
    return dropTarget.place === "before"
      ? { borderTop: "2px solid #38bdf8", marginTop: -2 }
      : { borderBottom: "2px solid #38bdf8", marginBottom: -2 };
  };

  const renderObjectRow = (o: SynopticObject, indent = 0, ultimo = false) => {
    const isSel = o.id === selectedId;
    const isRen = o.id === renaming;
    const label = o.name?.trim() || `${o.type}·${o.id.slice(-4)}`;
    const isGrid = o.type === "grid";
    const isExpanded = isGrid && expandedGrids.has(o.id);
    const cellsWithChildren = isGrid ? (o.grid_cells ?? []).filter((c) => !!c.child) : [];

    return (
      <React.Fragment key={o.id}>
        <div
          draggable={!isRen}
          onDragStart={(e) => onDragStartObject(e, o.id)}
          onDragOver={(e) => onDragOverObjectRow(e, o.id)}
          onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
          onDrop={onDropObject}
          onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "object", id: o.id, x: e.clientX, y: e.clientY }); }}
          onClick={() => !isRen && selectObject(o.id)}
          style={{
            ...S.row(isSel), gap: 4, paddingRight: 4, paddingLeft: 4 + indent,
            // Un oggetto sciolto è figlio del ramo; dentro un gruppo, figlio
            // del gruppo (`indent` vale 12 solo per i membri).
            ...guideAlbero(indent > 0 ? [13] : [], {
              x: indent > 0 ? 25 : 13, finoA: 6 + indent + 14, ultimo,
            }),
            ...indicatorFor("object", o.id),
          }}
        >
          {isGrid ? (
            <button
              style={{ ...S.iconBtn, width: 14, fontSize: 8, color: cellsWithChildren.length > 0 ? "var(--brand-text-muted, #94a3b8)" : "var(--brand-surface-2, #334155)", flexShrink: 0 }}
              title={isExpanded ? t("editor.collapse") : t("editor.expand")}
              onClick={(e) => { e.stopPropagation(); if (cellsWithChildren.length > 0) toggleExpandGrid(o.id); }}
            >
              {cellsWithChildren.length > 0 ? (isExpanded ? "▼" : "▶") : "·"}
            </button>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}
          {o.locked && (
            <span title={t("editor.locked")} style={{ fontSize: 10, flexShrink: 0, opacity: 0.7 }}>🔒</span>
          )}
          <span style={{ fontSize: 9, color: "var(--brand-text-subtle, #94a3b8)", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {o.type.slice(0, 5)}
          </span>
          {isRen ? (
            <input
              type="text" value={draft} autoFocus
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                else if (e.key === "Escape") { setRenaming(null); setDraft(""); }
              }}
              style={{ flex: 1, minWidth: 0, background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
            />
          ) : (
            <span
              onDoubleClick={(e) => { e.stopPropagation(); startRename(o.id, o.name ?? ""); }}
              title={t("editor.dblRename")}
              style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
            >
              {label}
            </span>
          )}
          <button style={S.iconBtn} title={t("editor.rename")} onClick={(e) => { e.stopPropagation(); startRename(o.id, o.name ?? ""); }}>✎</button>
          <button style={S.iconBtn} title={t("editor.duplicate")} onClick={(e) => { e.stopPropagation(); duplicateObject(o.id); }}>⧉</button>
          <button style={{ ...S.iconBtn, color: "var(--brand-danger, #ef4444)" }} title={t("editor.delete")} onClick={(e) => { e.stopPropagation(); deleteObject(o.id); }}>×</button>
        </div>
        {isExpanded && cellsWithChildren.map((c) => {
          const isChildSel = selectedCellChild?.objectId === o.id && selectedCellChild.row === c.row && selectedCellChild.col === c.col;
          const childLabel = c.child!.type + (c.child!.name ? ` — ${c.child!.name}` : "");
          return (
            <div
              key={`${o.id}-${c.row}-${c.col}`}
              onClick={() => { selectObject(o.id); setSelectedCell({ objectId: o.id, row: c.row, col: c.col }); setSelectedCellChild({ objectId: o.id, row: c.row, col: c.col }); }}
              style={{
                ...S.row(isChildSel), paddingLeft: indent + 24, paddingRight: 4, gap: 4,
                color: isChildSel ? "#5eead4" : "var(--brand-text-subtle, #64748b)",
                background: isChildSel ? "#0f2922" : "transparent",
                ...guideAlbero(indent > 0 ? [13, 25] : [13], {
                  x: (indent > 0 ? 25 : 13) + 12, finoA: indent + 24, ultimo: false,
                }),
              }}
              title={`Cella R${c.row + 1}, C${c.col + 1}`}
            >
              <span style={{ fontSize: 10, flexShrink: 0, color: "var(--brand-text-subtle, #94a3b8)" }}>↳</span>
              <span style={{ fontSize: 9, color: "var(--brand-text-subtle, #94a3b8)", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
                {c.child!.type.slice(0, 5)}
              </span>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                {childLabel}
              </span>
              <span style={{ fontSize: 9, color: "var(--brand-surface-2, #334155)", flexShrink: 0 }}>R{c.row + 1},{c.col + 1}</span>
            </div>
          );
        })}
      </React.Fragment>
    );
  };

  const tree = buildTree();
  const navigabili = paginePerNavigazione(pages);
  const perIdPagina = new Map(navigabili.map((p) => [p.id, p]));
  const righePagine = righe(riconcilia(project?.page_layout?.page_tree, navigabili.map((p) => p.id)), new Set());
  const totaleOggetti = navigabili.reduce((n, p) => n + p.objects.length, 0);

  // Una pagina che non è la corrente, in sola lettura: un clic su un oggetto
  // porta alla sua pagina e lo seleziona. Trascinare fra pagine è un'altra
  // funzione (piano R3); rinomina e menu valgono sulla pagina corrente.
  const corpoAltraPagina = (pg: SynopticPage, rientro: number) => {
    const risultati = fq ? hitsByPage.get(pg.id) ?? [] : null;
    const oggetti = risultati ? risultati.map((h) => h.obj) : pg.objects;
    if (oggetti.length === 0) {
      return (
        <p style={{ padding: `2px 8px 2px ${rientro + 18}px`, fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
          {t("editor.noObjects")}
        </p>
      );
    }
    return oggetti.map((o) => {
      const hit = risultati?.find((h) => h.obj.id === o.id);
      return (
        <div
          key={`${pg.id}-${o.id}`}
          data-testid={`object-other-page-${o.id}`}
          onClick={() => { setCurrentPage(pg.id); selectObject(o.id); }}
          style={{ ...S.row(false), gap: 4, paddingRight: 4, paddingLeft: rientro + 18, cursor: "pointer" }}
          title={`${o.type} · ${o.id}`}
        >
          <span style={{ fontSize: 9, color: "var(--brand-text-subtle, #94a3b8)", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {o.type.slice(0, 5)}
          </span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
            {o.name?.trim() || `${o.type}·${o.id.slice(-4)}`}
          </span>
          {hit && (
            <span style={{ fontSize: 9, flexShrink: 0, padding: "1px 4px", borderRadius: 3,
                           background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)" }}>
              {hit.reason === "tag" ? `tag ${hit.detail}` : hit.reason === "type" ? hit.obj.type : t(`editor.match_${hit.reason}`)}
            </span>
          )}
        </div>
      );
    });
  };

  return (
    <Section title={`${t("editor.sectionPageObjects")} (${totaleOggetti})`} defaultOpen={false} memoria="sinistra.struttura" icona="🗂">
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
        <input
          type="text"
          placeholder={t("editor.searchAllPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "3px 6px", fontSize: 11 }}
        />
        {fq && (
          <div style={{ marginTop: 3, fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
            {t("editor.risultatiInPagine", { n: hits.length, pagine: hitsByPage.size })}
          </div>
        )}
      </div>
      {selectedIds.length >= 2 && (
        <div style={{ padding: "3px 8px", borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
          <button
            onClick={() => groupObjects(selectedIds)}
            style={{ ...S.objBtn, flex: "none", width: "100%", borderStyle: "dashed", color: "#38bdf8", borderColor: "#0ea5e9", fontSize: 11 }}
          >
            + Raggruppa selezionati ({selectedIds.length})
          </button>
        </div>
      )}
      <div style={corpoPagina}>
        {fq && hits.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
            {t("editor.noMatch")}
          </p>
        )}
        {righePagine.map((r) => {
          const pg = perIdPagina.get(r.id);
          if (!pg) return null;
          if (fq && !hitsByPage.has(pg.id)) return null;
          const corrente = pg.id === currentPageId;
          const aperta = fq ? true : pagineAperte.has(pg.id);
          const rientro = r.livello * 12;
          return (
            <React.Fragment key={pg.id}>
              <div
                data-testid={`objects-page-${pg.id}`}
                style={{ ...S.row(false), gap: 4, paddingLeft: 4 + rientro, paddingRight: 4,
                         fontWeight: corrente ? 700 : 400,
                         color: corrente ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-muted, #94a3b8)" }}
                onClick={() => commutaPagina(pg.id)}
                title={corrente ? t("editor.paginaCorrente") : t("editor.apriPagina")}
              >
                <span style={{ ...S.iconBtn, width: 14, fontSize: 8 }}>{aperta ? "▼" : "▶"}</span>
                <span style={{ fontSize: 11, flexShrink: 0 }}>📄</span>
                <span
                  style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
                  onDoubleClick={(e) => { e.stopPropagation(); setCurrentPage(pg.id); }}
                >
                  {pg.name}
                </span>
                <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", flexShrink: 0 }}>
                  {fq ? hitsByPage.get(pg.id)?.length : pg.objects.length}
                </span>
              </div>
              {aperta && !corrente && corpoAltraPagina(pg, rientro)}
              {aperta && corrente && (
                <div style={{ paddingLeft: rientro + 8 }}>
        {tree.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
            {fq ? t("editor.noMatch") : t("editor.noObjects")}
          </p>
        )}
        {dragItem?.kind === "object" && (
          <div
            onDragOver={onDragOverRootZone}
            onDrop={onDropObject}
            style={{
              padding: "6px 10px",
              fontSize: 10,
              color: "var(--brand-text-subtle, #64748b)",
              borderTop: "1px dashed var(--brand-surface-2, #334155)",
              borderBottom: "1px dashed var(--brand-surface-2, #334155)",
              background: dropTarget?.kind === "root" ? "#1e3a5f" : "var(--brand-bg, #0f172a)",
              textAlign: "center" as const,
              fontStyle: "italic" as const,
            }}
          >
            ⤓ Trascina qui per rimuovere dal gruppo
          </div>
        )}
        {tree.map((node, iNodo) => {
          if (node.kind === "group") {
            const { group, members } = node;
            const isExpanded = expandedGroups.has(group.id);
            const allMembersSel = members.length > 0 && members.every((m) => selectedIds.includes(m.id));
            const isRenamingThis = renamingGroup === group.id;
            return (
              <React.Fragment key={group.id}>
                {/* Group row */}
                <div
                  draggable={!isRenamingThis}
                  onDragStart={(e) => onDragStartGroup(e, group.id)}
                  onDragOver={(e) => onDragOverGroupRow(e, group.id)}
                  onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
                  onDrop={onDropObject}
                  onContextMenu={(e) => { e.preventDefault(); setMenu({ kind: "group", id: group.id, x: e.clientX, y: e.clientY }); }}
                  onClick={() => members.length > 0 && selectMany(members.map((m) => m.id))}
                  style={{
                    ...S.row(allMembersSel),
                    ...guideAlbero([], { x: 13, finoA: 18, ultimo: iNodo === tree.length - 1 && !isExpanded }),
                    gap: 4, paddingRight: 4,
                    background: allMembersSel ? "#1e3a5f" : "var(--brand-bg, #172033)",
                    color: allMembersSel ? "#93c5fd" : "var(--brand-text-subtle, #64748b)",
                    borderBottom: "1px solid var(--brand-surface, #1e293b)",
                    ...indicatorFor("group", group.id),
                  }}
                  title={t("editor.groupSelectHint")}
                >
                  <button
                    style={{ ...S.iconBtn, width: 14, fontSize: 8, flexShrink: 0 }}
                    onClick={(e) => { e.stopPropagation(); toggleExpandGroup(group.id); }}
                    title={isExpanded ? t("editor.collapse") : t("editor.expand")}
                  >
                    {isExpanded ? "▼" : "▶"}
                  </button>
                  <span style={{ fontSize: 11, flexShrink: 0 }}>📁</span>
                  {isRenamingThis ? (
                    <input
                      type="text" value={groupDraft} autoFocus
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setGroupDraft(e.target.value)}
                      onBlur={commitRenameGroup}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRenameGroup();
                        else if (e.key === "Escape") { setRenamingGroup(null); setGroupDraft(""); }
                      }}
                      style={{ flex: 1, minWidth: 0, background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "1px 4px", fontSize: 11 }}
                    />
                  ) : (
                    <span
                      onDoubleClick={(e) => { e.stopPropagation(); startRenameGroup(group.id, group.name); }}
                      title={t("editor.dblRename")}
                      style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}
                    >
                      {group.name} ({members.length})
                    </span>
                  )}
                  <button
                    style={S.iconBtn} title={t("editor.renameGroup")}
                    onClick={(e) => { e.stopPropagation(); startRenameGroup(group.id, group.name); }}
                  >✎</button>
                  <button
                    style={{ ...S.iconBtn, color: "var(--brand-warning, #f59e0b)" }} title={t("editor.ungroup")}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(t("editor.ungroupConfirm", { name: group.name }))) {
                        ungroupObjects(group.id);
                      }
                    }}
                  >⊔</button>
                </div>
                {/* Group members */}
                {isExpanded && members.map((o, i) => renderObjectRow(o, 12, i === members.length - 1))}
              </React.Fragment>
            );
          }
          return renderObjectRow(node.obj, 0, iNodo === tree.length - 1);
        })}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
      {menu && (
        <ObjectsContextMenu
          state={menu}
          onClose={() => setMenu(null)}
          actions={{
            renameObject: (id) => startRename(id, allObjects.find((o) => o.id === id)?.name ?? ""),
            duplicateObject,
            deleteObject,
            groupSelection: () => groupObjects(selectedIds),
            moveToGroup: (objId, gid) => {
              if (gid == null) {
                moveObjectToGroupEnd(objId, null);
              } else {
                moveObjectToGroupEnd(objId, gid);
              }
            },
            renameGroup: (id) => startRenameGroup(id, groups.find((g) => g.id === id)?.name ?? ""),
            ungroup: ungroupObjects,
          }}
          groups={groups}
          currentSelection={selectedIds}
        />
      )}
    </Section>
  );
}

// ── Context menu component ───────────────────────────────────────────────────

interface ContextMenuActions {
  renameObject: (id: string) => void;
  duplicateObject: (id: string) => void;
  deleteObject: (id: string) => void;
  groupSelection: () => void;
  moveToGroup: (objId: string, groupId: string | null) => void;
  renameGroup: (id: string) => void;
  ungroup: (id: string) => void;
}

function ObjectsContextMenu({
  state, onClose, actions, groups, currentSelection,
}: {
  state: ContextMenuState;
  onClose: () => void;
  actions: ContextMenuActions;
  groups: ObjectGroup[];
  currentSelection: string[];
}) {
  const { t } = useTranslation();
  // Close on outside click + Esc. Mounted in a fixed-position overlay so it
  // floats above the rest of the panel; no portal needed since z-index alone
  // wins inside this stacking context.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onClickAway = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClickAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClickAway);
    };
  }, [onClose]);

  // Clamp menu inside viewport so it doesn't overflow when right-click happens
  // near the bottom/right edge of the screen.
  const W = 220, H = 260;
  const x = Math.min(state.x, window.innerWidth - W - 6);
  const y = Math.min(state.y, window.innerHeight - H - 6);

  const menuStyle: React.CSSProperties = {
    position: "fixed", left: x, top: y, zIndex: 1000,
    background: "var(--brand-bg, #0f172a)", color: "var(--brand-text-2, #cbd5e1)",
    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    fontSize: 12, minWidth: 200,
    padding: "4px 0",
  };
  const item: React.CSSProperties = {
    padding: "5px 12px", cursor: "pointer",
    display: "flex", alignItems: "center", gap: 8,
  };
  const danger: React.CSSProperties = { ...item, color: "var(--brand-danger-soft, #fca5a5)" };
  const sep: React.CSSProperties = { borderTop: "1px solid var(--brand-surface, #1e293b)", margin: "4px 0" };
  const sub: React.CSSProperties = { padding: "3px 24px", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" };

  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const close = () => onClose();

  return (
    <div style={menuStyle} onMouseDown={stop} onClick={stop}>
      {state.kind === "object" ? (
        <>
          <div style={item} onClick={() => { actions.renameObject(state.id); close(); }}>
            <span style={{ width: 16 }}>✎</span> Rinomina
          </div>
          <div style={item} onClick={() => { actions.duplicateObject(state.id); close(); }}>
            <span style={{ width: 16 }}>⧉</span> Duplica
          </div>
          {currentSelection.length >= 2 && currentSelection.includes(state.id) && (
            <div style={item} onClick={() => { actions.groupSelection(); close(); }}>
              <span style={{ width: 16 }}>📁</span> Raggruppa selezione ({currentSelection.length})
            </div>
          )}
          <div style={sep} />
          <div style={{ ...item, color: "var(--brand-text-subtle, #64748b)", cursor: "default" }}>{t("editor.moveToGroup")}</div>
          {groups.length === 0 && (
            <div style={{ ...sub, color: "var(--brand-text-subtle, #94a3b8)", fontStyle: "italic" }}>{t("leftPanel.noGroup")}</div>
          )}
          {groups.map((g) => (
            <div key={g.id} style={sub} onClick={() => { actions.moveToGroup(state.id, g.id); close(); }}>
              📁 {g.name}
            </div>
          ))}
          <div style={sub} onClick={() => { actions.moveToGroup(state.id, null); close(); }}>
            ⤓ Senza gruppo
          </div>
          <div style={sep} />
          <div style={danger} onClick={() => { actions.deleteObject(state.id); close(); }}>
            <span style={{ width: 16 }}>×</span> {t("leftPanel.delete")}
          </div>
        </>
      ) : (
        <>
          <div style={item} onClick={() => { actions.renameGroup(state.id); close(); }}>
            <span style={{ width: 16 }}>✎</span> Rinomina gruppo
          </div>
          <div style={sep} />
          <div style={danger} onClick={() => { actions.ungroup(state.id); close(); }}>
            <span style={{ width: 16 }}>⊔</span> Separa gruppo
          </div>
        </>
      )}
    </div>
  );
}

// ── Functions section ─────────────────────────────────────────────────────────
//
// Lists every project-level Python function. Click a row to open its editor
// in the right-side properties panel. Each row has inline rename, duplicate,
// and delete. After every CRUD verb we call `onFunctionsChanged()` so the
// host can persist the new list to PUT /api/project/functions.

function FunctionsSection({ onFunctionsChanged }: { onFunctionsChanged: () => void }) {
  const corpo = useCorpo(240);
  const { t } = useTranslation();
  const project          = useAppStore((s) => s.project);
  const selectedFnId     = useAppStore((s) => s.selectedFunctionId);
  const selectFunction   = useAppStore((s) => s.selectFunction);
  const addFunction      = useAppStore((s) => s.addFunction);
  const duplicateFunction = useAppStore((s) => s.duplicateFunction);
  const renameFunction   = useAppStore((s) => s.renameFunction);
  const deleteFunction   = useAppStore((s) => s.deleteFunction);

  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft]       = useState("");

  const functions = project?.functions ?? [];

  const handleAdd = () => {
    addFunction();
    onFunctionsChanged();
  };
  const handleDuplicate = (id: string) => {
    duplicateFunction(id);
    onFunctionsChanged();
  };
  const handleDelete = (id: string) => {
    deleteFunction(id);
    onFunctionsChanged();
  };
  const startRename = (id: string, name: string) => {
    setRenaming(id);
    setDraft(name);
  };
  const commitRename = () => {
    if (renaming) {
      const next = draft.trim();
      if (next) renameFunction(renaming, next);
      onFunctionsChanged();
    }
    setRenaming(null);
    setDraft("");
  };

  return (
    <Section title={`${t("editor.sectionFunctions")} (${functions.length})`} defaultOpen={false} memoria="sinistra.funzioni" icona="ƒ">
      <div style={corpo}>
        {functions.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
            {t("leftPanel.noFunctionsCreateOneBelow")}
          </p>
        )}
        {/* Rimando all'altra superficie Python del progetto (Q21). Le funzioni
            aspettano di essere chiamate da un oggetto; gli script partono da
            soli, a tempo o su evento. Sono cose diverse, ma chi cerca "il
            Python del progetto" le cerca insieme — e prima nessuno dei due
            punti diceva che l'altro esistesse. */}
        <p style={{ padding: "4px 12px 8px", fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: 0 }}>
          {t("leftPanel.forScriptsThatStartOn")} <strong>Configurazione → Python</strong>.
        </p>
        {functions.map((f) => {
          const isSel = f.id === selectedFnId;
          const isRen = f.id === renaming;
          return (
            <div
              key={f.id}
              onClick={() => !isRen && selectFunction(f.id)}
              style={{ ...S.row(isSel), gap: 4, paddingRight: 4,
                ...guideAlbero([], { x: 13, finoA: 20, ultimo: f === functions[functions.length - 1] }) }}
              title={f.description ?? f.name}
            >
              <span style={{
                fontSize: 9, color: "var(--brand-success, #22c55e)", width: 24, flexShrink: 0,
                textTransform: "uppercase", letterSpacing: 0.5,
              }}>
                fn
              </span>
              {isRen ? (
                <input
                  type="text"
                  value={draft}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    else if (e.key === "Escape") { setRenaming(null); setDraft(""); }
                  }}
                  style={{
                    flex: 1, minWidth: 0,
                    background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
                    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3,
                    padding: "1px 4px", fontSize: 11,
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => { e.stopPropagation(); startRename(f.id, f.name); }}
                  style={{
                    flex: 1, minWidth: 0,
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    fontSize: 11,
                  }}
                >
                  {f.name}
                </span>
              )}
              <button
                style={S.iconBtn}
                title={t("editor.rename")}
                onClick={(e) => { e.stopPropagation(); startRename(f.id, f.name); }}
              >✎</button>
              <button
                style={S.iconBtn}
                title={t("editor.duplicate")}
                onClick={(e) => { e.stopPropagation(); handleDuplicate(f.id); }}
              >⧉</button>
              <button
                style={{ ...S.iconBtn, color: "var(--brand-danger, #ef4444)" }}
                title={t("editor.delete")}
                onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
              >×</button>
            </div>
          );
        })}
        <div style={{ padding: "4px 8px" }}>
          <button
            onClick={handleAdd}
            style={{
              ...S.objBtn,
              flex: "none",
              width: "100%",
              borderStyle: "dashed",
              color: "var(--brand-text-subtle, #64748b)",
            }}
          >
            {t("leftPanel.newFunction")}
          </button>
        </div>
      </div>
    </Section>
  );
}

// ── Tags section ──────────────────────────────────────────────────────────────


// ── Sources section ───────────────────────────────────────────────────────────

// ── Main LeftPanel export ─────────────────────────────────────────────────────

// Resizable width, persisted across sessions (like other editor UI prefs
// such as sws.uiLang). Plain localStorage — this is layout-only, no other
// component needs to react to it, so no Zustand store entry is needed.
const LEFT_PANEL_WIDTH_KEY = "sws.leftPanelWidth";
const LEFT_PANEL_MIN = 160;
const LEFT_PANEL_MAX = 480;

/** Il pannello sinistro è **un albero solo** (25-09-2026, richiesta del
 *  maintainer): pagine, immagini di boot, strumenti (la palette), oggetti della
 *  pagina, funzioni, tag, e i rami di configurazione. Ogni ramo si apre e si
 *  chiude, e lo ricorda; scorre l'albero intero.
 *
 *  La storia, perché ogni forma di prima ha avuto un motivo:
 *  - fino all'11-09-2026 sette fisarmoniche in colonna, con tetti di altezza
 *    diversi, che «si fondevano»;
 *  - T-56 (11-09) una vista per volta scelta da una colonna di icone;
 *  - 20-09 le pagine fisse in cima, perché sparivano aprendo la palette;
 *  - 24-09 la vista ⚙ con l'albero di configurazione, e il pannello anche in
 *    Configurazione;
 *  - 25-09 via le icone, via il pulsante Editor/Configurazione in testata, e
 *    tutto nell'albero. Il problema del 20-09 non torna: le pagine sono il
 *    primo ramo e restano aperte finché non le si chiude. */
export function LeftPanel() {
  const { t } = useTranslation();
  const setProject = useAppStore((s) => s.setProject);
  const authRole   = useAppStore((s) => s.authRole);
  const puoConfigurare = canConfigureProject(authRole);
  const puoModificare  = canEditProject(authRole);

  const conPagine = puoModificare;

  const [panelWidth, setPanelWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(LEFT_PANEL_WIDTH_KEY));
    return stored >= LEFT_PANEL_MIN && stored <= LEFT_PANEL_MAX ? stored : 220;
  });
  const widthRef = useRef(panelWidth);

  useEffect(() => {
    api.getProject()
      .then((p) => setProject(p))
      .catch(() => {});
  }, []);

  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(LEFT_PANEL_MAX, Math.max(LEFT_PANEL_MIN, startWidth + (ev.clientX - startX)));
      widthRef.current = next;
      setPanelWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(LEFT_PANEL_WIDTH_KEY, String(widthRef.current));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  return (
    <div style={{ display: "flex", flexShrink: 0, position: "relative" }}>
      <div style={{ ...S.panel, width: panelWidth }}>
        <InAlbero.Provider value={true}>
          <div data-testid="albero-pannello" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "4px 0" }}>
            {conPagine && <PagesSection />}
            {conPagine && <RamoStrumenti />}
            {conPagine && <ObjectsSection />}
            {conPagine && <FunctionsSection onFunctionsChanged={persistiFunzioni} />}
            {/* Le variabili non hanno più un ramo loro: stanno sotto
                «Progetto › Variabili», dove si modificano (25-09-2026). Chi
                non può configurare vede quella foglia e basta. */}
            <AlberoConfigurazione soloVariabili={!puoConfigurare} />
          </div>
        </InAlbero.Provider>
      </div>
      <div
        onMouseDown={onResizeStart}
        title={t("editor.dragToResize")}
        style={{ position: "absolute", top: 0, right: -3, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 10 }}
      />
    </div>
  );
}

