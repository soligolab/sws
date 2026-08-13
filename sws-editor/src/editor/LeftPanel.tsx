import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { findBrokenNavLinks, findOrphanPageIds } from "@/pageLayout";
import type { ObjectGroup, ProjectInfo, SynopticObject, SynopticPage } from "@/types";

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
  sectionHead: (_open: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    background: "var(--brand-bg, #0f172a)",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 700,
    color: "var(--brand-text-subtle, #64748b)",
    letterSpacing: 1,
    userSelect: "none",
    flexShrink: 0,
  }),
  chevron: (open: boolean): React.CSSProperties => ({
    display: "inline-block",
    transform: open ? "rotate(90deg)" : "rotate(0deg)",
    transition: "transform 0.15s",
    fontSize: 10,
    color: "var(--brand-border, #475569)",
  }),
  body: {
    overflowY: "auto" as const,
    maxHeight: 220,
    padding: "4px 0",
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
    color: "var(--brand-border, #475569)",
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

// ── Section accordion ─────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
  headerAction,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Optional extra control rendered in the header, before the chevron
   *  (e.g. a ⚙ settings button). Clicks on it don't toggle the section. */
  headerAction?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ flexShrink: 0 }}>
      <div style={S.sectionHead(open)} onClick={() => setOpen((v) => !v)}>
        <span>{title}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
          {headerAction && <span onClick={(e) => e.stopPropagation()}>{headerAction}</span>}
          <span style={S.chevron(open)}>▶</span>
        </span>
      </div>
      {open && <div>{children}</div>}
    </div>
  );
}

// ── Pages section ─────────────────────────────────────────────────────────────

function PagesSection() {
  const { t } = useTranslation();
  const pages         = useAppStore((s) => s.pages);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const addPage       = useAppStore((s) => s.addPage);
  const deletePage    = useAppStore((s) => s.deletePage);
  const renamePage    = useAppStore((s) => s.renamePage);
  const reorderPage   = useAppStore((s) => s.reorderPage);
  const movePage      = useAppStore((s) => s.movePage);
  const duplicatePage = useAppStore((s) => s.duplicatePage);
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const project       = useAppStore((s) => s.project);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [linkReportOpen, setLinkReportOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const homePageId = project?.page_layout?.home_page_id;
  const orphanIds = findOrphanPageIds(pages, homePageId);

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
      const names = await api.listSynoptics();
      const pagesLoaded = await Promise.all(names.map((n) => api.getSynoptic(n)));
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

  // Drag & drop reorder — simple linear list (no nesting like ObjectsSection's
  // tree), so a minimal draggedId/dragOverId pair is enough; drop lands the
  // dragged page at the hovered row's index.
  const onRowDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("application/x-sws-page", id);
  };
  const onRowDragOver = (e: React.DragEvent, id: string) => {
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    setDragOverId(id);
  };
  const onRowDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!draggedId || draggedId === targetId) { setDraggedId(null); return; }
    const toIndex = pages.findIndex((p) => p.id === targetId);
    if (toIndex >= 0) movePage(draggedId, toIndex);
    setDraggedId(null);
  };

  return (
    <Section
      title={t("editor.sectionPages")}
      headerAction={
        <button style={S.iconBtn} title="Verifica collegamenti (link rotti + pagine orfane)"
          onClick={() => setLinkReportOpen(true)}>🔗</button>
      }
    >
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
      <div style={S.body}>
        {pages.map((p, pi) => (
          <div
            key={p.id}
            draggable
            onDragStart={(e) => onRowDragStart(e, p.id)}
            onDragOver={(e) => onRowDragOver(e, p.id)}
            onDragLeave={() => setDragOverId((cur) => (cur === p.id ? null : cur))}
            onDrop={(e) => onRowDrop(e, p.id)}
            onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
            style={{
              ...S.row(p.id === currentPageId), justifyContent: "space-between",
              gap: 6,
              ...(dragOverId === p.id ? { borderTop: "2px solid var(--brand-primary, #3b82f6)" } : {}),
              opacity: draggedId === p.id ? 0.5 : 1,
            }}
            onClick={() => editingId !== p.id && setCurrentPage(p.id)}
            onDoubleClick={() => !p.locked && beginRename(p.id, p.name)}
            title={t("editor.dblRename")}
          >
            <div style={{
              width: 32, height: 20, flexShrink: 0, borderRadius: 2, overflow: "hidden",
              background: p.background || "var(--brand-bg, #0f172a)",
              border: "1px solid var(--brand-surface-2, #334155)",
              pointerEvents: "none",
            }}>
              {/* Read-only preview: no onMove/onSelect -> !onMove viewer branch.
                  sizeMode forced to "ratio" so the thumbnail is always a
                  letterbox-fit scale-down, regardless of the project's real
                  sizeMode (fixed-mode's 1:1-no-scaling would otherwise blow
                  up this tiny box). */}
              <SvgCanvas
                objects={p.objects}
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
                  flex: 1,
                  background: "var(--brand-bg, #0f172a)",
                  color: "var(--brand-text, #e2e8f0)",
                  border: "1px solid var(--brand-border, #475569)",
                  borderRadius: 3,
                  padding: "1px 4px",
                  fontSize: 12,
                }}
              />
            ) : (
              <>
                {p.id === homePageId && (
                  <span title="Pagina iniziale (home)" style={{ flexShrink: 0 }}>🏠</span>
                )}
                {orphanIds.has(p.id) && (
                  <span title="Pagina orfana: nessun collegamento la raggiunge e non è la home" style={{ flexShrink: 0 }}>⚠️</span>
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                  {p.name}
                </span>
                <span style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                  <button
                    style={S.iconBtn}
                    title={p.locked ? "Sblocca pagina" : "Blocca pagina (sola lettura)"}
                    onClick={(e) => { e.stopPropagation(); updatePageProps(p.id, { locked: !p.locked }); }}
                  >{p.locked ? "🔒" : "🔓"}</button>
                  {pi > 0 && (
                    <button style={S.iconBtn} title={t("editor.moveUp")}
                      onClick={(e) => { e.stopPropagation(); reorderPage(p.id, "up"); }}>↑</button>
                  )}
                  {pi < pages.length - 1 && (
                    <button style={S.iconBtn} title={t("editor.moveDown")}
                      onClick={(e) => { e.stopPropagation(); reorderPage(p.id, "down"); }}>↓</button>
                  )}
                  <button style={S.iconBtn} title={t("editor.duplicatePage")}
                    onClick={(e) => { e.stopPropagation(); duplicatePage(p.id); }}>⧉</button>
                  <button style={S.iconBtn} title={t("editor.exportPage")}
                    onClick={(e) => { e.stopPropagation(); handleExportPage(p.name); }}>⬇</button>
                  <button
                    style={S.iconBtn}
                    title={t("editor.rename")}
                    disabled={p.locked}
                    onClick={(e) => { e.stopPropagation(); beginRename(p.id, p.name); }}
                  >✎</button>
                  {pages.length > 1 && (
                    <button
                      style={S.iconBtn}
                      title={t("editor.deletePage")}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (window.confirm(`Eliminare la pagina "${p.name}"? L'azione è annullabile con Ctrl-Z.`)) {
                          deletePage(p.id);
                        }
                      }}
                    >×</button>
                  )}
                </span>
              </>
            )}
          </div>
        ))}
        <div style={{ padding: "4px 8px", display: "flex", gap: 4 }}>
          <button
            onClick={addPage}
            style={{
              ...S.objBtn,
              flex: "1 1 auto",
              borderStyle: "dashed",
              color: "var(--brand-text-subtle, #64748b)",
            }}
          >
            + Nuova pagina
          </button>
          <button
            onClick={() => importInputRef.current?.click()}
            title={t("editor.importPage")}
            style={{
              ...S.objBtn,
              flex: "0 0 auto",
              borderStyle: "dashed",
              color: "var(--brand-text-subtle, #64748b)",
              padding: "4px 8px",
            }}
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
      </div>
    </Section>
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
  const broken = findBrokenNavLinks(pages);
  const orphanPages = pages.filter((p) => orphanIds.has(p.id));

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, width: "min(90vw, 460px)", maxHeight: "80vh", display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>Verifica collegamenti</div>
          <button style={{ background: "transparent", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 16 }} onClick={onClose}>✕</button>
        </div>

        <div style={{ overflow: "auto", flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 0.5, marginBottom: 6 }}>
            LINK ROTTI ({broken.length})
          </div>
          {broken.length === 0 ? (
            <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 14 }}>Nessun collegamento rotto.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginBottom: 14 }}>
              {broken.map((b) => (
                <div key={`${b.pageId}:${b.objId}`} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "#450a0a33", border: "1px solid #991b1b", borderRadius: 4, padding: "4px 8px" }}>
                  <span style={{ flex: 1, color: "var(--brand-danger-soft, #fca5a5)" }}>
                    <strong>{b.pageName}</strong> → "{b.objName}" punta a pagina inesistente ("{b.targetId}")
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
            <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>Nessuna pagina orfana.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {orphanPages.map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, background: "#78350f22", border: "1px solid #92400e", borderRadius: 4, padding: "4px 8px" }}>
                  <span style={{ flex: 1, color: "var(--brand-warning, #f59e0b)" }}>
                    "{p.name}" — nessun collegamento la raggiunge e non è la home
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
interface PaletteGroup { category: string; color: string; defaultOpen?: boolean; items: PaletteItem[] }

const PALETTE_GROUPS: PaletteGroup[] = [
  { category: "Forme", color: "#60a5fa", defaultOpen: true, items: [
    { type: "rect",    label: "Rettangolo", icon: "▭" },
    { type: "ellipse", label: "Ellisse",    icon: "○" },
    { type: "line",    label: "Linea",      icon: "╱" },
    { type: "text",    label: "Testo",      icon: "T" },
    { type: "image",   label: "Immagine",   icon: "🖼" },
  ]},
  { category: "Controlli", color: "#34d399", items: [
    { type: "button",    label: "Bottone",  icon: "⊡" },
    { type: "navbutton", label: "Nav page", icon: "↗" },
    { type: "checkbox",  label: "Checkbox", icon: "☑" },
    { type: "radio",     label: "Radio",    icon: "◉" },
    { type: "slider",    label: "Slider",   icon: "↔" },
    { type: "setpoint",  label: "Setpoint", icon: "🎯" },
    { type: "lang_selector", label: "Lingua ▾", icon: "🌐" },
    { type: "lang_button",   label: "Lingua btn", icon: "🏳" },
  ]},
  { category: "Display", color: "#fb923c", items: [
    { type: "gauge",        label: "Gauge",      icon: "◔" },
    { type: "led",          label: "LED",        icon: "●" },
    { type: "state_lamp",   label: "Lampada multi-stato", icon: "🔴" },
    { type: "progress_bar", label: "Progress",   icon: "▰" },
    { type: "table",        label: "Tabella",    icon: "≡" },
    { type: "trend",        label: "Trend",      icon: "∿" },
    { type: "xy_plot",      label: "Grafico XY", icon: "✥" },
    { type: "sparkline",    label: "Sparkline",  icon: "⌇" },
    { type: "text_list",    label: "Lista testi", icon: "≣" },
    { type: "bar_chart",    label: "Bar Chart",  icon: "▐" },
    { type: "pie_chart",    label: "Pie Chart",  icon: "◑" },
    { type: "alarm_viewer", label: "Allarmi",    icon: "⚠" },
    { type: "alarm_bell",   label: "Campanella allarmi", icon: "🔔" },
    { type: "alarm_banner", label: "Barra allarmi", icon: "▬" },
    { type: "recipe_panel", label: "Ricette",     icon: "📋" },
  ]},
  { category: "SCADA", color: "#f472b6", items: [
    { type: "symbol",    label: "Simbolo",   icon: "⚙" },
    { type: "pipe",      label: "Tubazione", icon: "⋯" },
    { type: "faceplate", label: "Faceplate", icon: "🧩" },
  ]},
  { category: "Layout", color: "#a78bfa", items: [
    { type: "grid", label: "Griglia", icon: "⊞" },
  ]},
];

function PaletteGroupAccordion({ group, onAdd, showLvglBadge }: { group: PaletteGroup; onAdd: (type: SynopticObject["type"]) => void; showLvglBadge: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(group.defaultOpen ?? false);
  return (
    <div>
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 10px", cursor: "pointer", background: "var(--brand-bg, #0a111e)", borderBottom: "1px solid var(--brand-surface, #1e293b)" }}
        onClick={() => setOpen((v) => !v)}
      >
        <span style={{ fontSize: 10, fontWeight: 700, color: group.color, letterSpacing: 0.5 }}>
          {t(`editor.palette.group.${group.category}`).toUpperCase()}
        </span>
        <span style={{ fontSize: 9, color: "var(--brand-border, #475569)" }}>{open ? "▼" : "▶"}</span>
      </div>
      {open && (
        <div style={{ padding: "4px 8px", display: "flex", flexDirection: "column", gap: 2 }}>
          {group.items.map(({ type, icon }) => (
            <button
              key={type}
              onClick={() => onAdd(type)}
              style={{ ...S.objBtn, flex: "none", width: "100%", display: "flex", alignItems: "center", gap: 6 }}
            >
              <span style={{ position: "relative", fontSize: 14, color: group.color, flexShrink: 0, width: 18, textAlign: "center" as const }}>
                {icon}
                {showLvglBadge && LVGL_SUPPORTED_TYPES.has(type) && (
                  <span
                    title={t("editor.paletteLvglBadgeTitle")}
                    style={{
                      position: "absolute",
                      bottom: -3,
                      right: -1,
                      fontSize: 7,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: "#0f172a",
                      background: "#fbbf24",
                      borderRadius: 2,
                      padding: "1px 2px",
                      pointerEvents: "none",
                    }}
                  >
                    L
                  </span>
                )}
              </span>
              <span>{t(`editor.palette.item.${type}`)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Sottoinsieme di tipi che il motore LVGL sa interpretare oggi (vedi
// sws-lvgl-viewer/src/lvgl_render.rs SUPPORTED_TYPES — tenere allineati).
// Man mano che il motore cresce (Fase 6+), questo elenco cresce con lui.
const LVGL_SUPPORTED_TYPES = new Set<SynopticObject["type"]>([
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
function paletteForTarget(isLvgl: boolean): PaletteGroup[] {
  if (!isLvgl) return PALETTE_GROUPS;
  return PALETTE_GROUPS
    .map((g) => ({ ...g, items: g.items.filter((i) => LVGL_SUPPORTED_TYPES.has(i.type)) }))
    .filter((g) => g.items.length > 0);
}

function ObjectPalette({ onAdd }: { onAdd: (type: SynopticObject["type"]) => void }) {
  const { t } = useTranslation();
  const targetKind = useAppStore((s) => s.project?.target?.kind);
  const isLvgl = targetKind === "lvgl_framebuffer" || targetKind === "lvgl_wayland";
  const groups = paletteForTarget(isLvgl);
  return (
    <Section title={t("editor.sectionObjects")}>
      {isLvgl && (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", padding: "0 4px 8px" }}>
          {t("editor.paletteLvglHint")}
        </div>
      )}
      {groups.map((group) => (
        <PaletteGroupAccordion key={group.category} group={group} onAdd={onAdd} showLvglBadge={!isLvgl} />
      ))}
    </Section>
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
  const filteredObjects = fq
    ? allObjects.filter((o) =>
        (o.name ?? "").toLowerCase().includes(fq) ||
        o.type.toLowerCase().includes(fq) ||
        o.id.toLowerCase().includes(fq)
      )
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

  const renderObjectRow = (o: SynopticObject, indent = 0) => {
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
          style={{ ...S.row(isSel), gap: 4, paddingRight: 4, paddingLeft: 4 + indent, ...indicatorFor("object", o.id) }}
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
          <span style={{ fontSize: 9, color: "var(--brand-border, #475569)", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
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
              style={{ ...S.row(isChildSel), paddingLeft: indent + 24, paddingRight: 4, gap: 4, color: isChildSel ? "#5eead4" : "var(--brand-text-subtle, #64748b)", background: isChildSel ? "#0f2922" : "transparent" }}
              title={`Cella R${c.row + 1}, C${c.col + 1}`}
            >
              <span style={{ fontSize: 10, flexShrink: 0, color: "var(--brand-border, #475569)" }}>↳</span>
              <span style={{ fontSize: 9, color: "var(--brand-border, #475569)", width: 34, flexShrink: 0, textTransform: "uppercase", letterSpacing: 0.5 }}>
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

  return (
    <Section title={`${t("editor.sectionPageObjects")} (${allObjects.length})`} defaultOpen={false}>
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
        <input
          type="text"
          placeholder={t("editor.filterPlaceholder")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          style={{ width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "3px 6px", fontSize: 11 }}
        />
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
      <div style={{ ...S.body, maxHeight: 280 }}>
        {tree.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-border, #475569)", margin: 0 }}>
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
        {tree.map((node) => {
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
                      if (window.confirm(`Separare il gruppo "${group.name}"? Gli oggetti torneranno alla radice.`)) {
                        ungroupObjects(group.id);
                      }
                    }}
                  >⊔</button>
                </div>
                {/* Group members */}
                {isExpanded && members.map((o) => renderObjectRow(o, 12))}
              </React.Fragment>
            );
          }
          return renderObjectRow(node.obj);
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
            <div style={{ ...sub, color: "var(--brand-border, #475569)", fontStyle: "italic" }}>nessun gruppo</div>
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
            <span style={{ width: 16 }}>×</span> Elimina
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
    <Section title={`${t("editor.sectionFunctions")} (${functions.length})`} defaultOpen={false}>
      <div style={{ ...S.body, maxHeight: 240 }}>
        {functions.length === 0 && (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-border, #475569)", margin: 0 }}>
            Nessuna funzione. Crea una funzione qui sotto e collegala agli
            eventi degli oggetti.
          </p>
        )}
        {functions.map((f) => {
          const isSel = f.id === selectedFnId;
          const isRen = f.id === renaming;
          return (
            <div
              key={f.id}
              onClick={() => !isRen && selectFunction(f.id)}
              style={{ ...S.row(isSel), gap: 4, paddingRight: 4 }}
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
            + Nuova funzione
          </button>
        </div>
      </div>
    </Section>
  );
}

// ── Tags section ──────────────────────────────────────────────────────────────

function TagsSection() {
  const project   = useAppStore((s) => s.project);
  const tagValues = useAppStore((s) => s.tagValues);

  const tags = project?.tags ?? [];

  const dot = (q: string) => {
    const color = q === "Good" ? "var(--brand-success, #22c55e)" : q === "Bad" ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #eab308)";
    return (
      <span
        style={{
          display: "inline-block",
          width: 6, height: 6,
          borderRadius: "50%",
          background: color,
          flexShrink: 0,
        }}
      />
    );
  };

  if (tags.length === 0) {
    return (
      <Section title="TAG" defaultOpen={false}>
        <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-border, #475569)", margin: 0 }}>
          Nessun tag — carica un progetto.
        </p>
      </Section>
    );
  }

  return (
    <Section title={`TAG (${tags.length})`} defaultOpen={false}>
      <div style={S.body}>
        {tags.map((t) => {
          const tv = tagValues[t.id];
          return (
            <div key={t.id} style={{ ...S.row(), gap: 6, justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
                {tv ? dot(tv.quality) : (
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--brand-surface-2, #334155)", flexShrink: 0 }} />
                )}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
                  {t.id}
                </span>
              </div>
              {tv != null && (
                <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11, flexShrink: 0 }}>
                  {String(tv.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

// ── Sources section ───────────────────────────────────────────────────────────

function SourcesSection({ project }: { project: ProjectInfo | null }) {
  const { t } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const sources = project?.sources ?? [];

  return (
    <Section title={`${t("editor.sectionSources")} (${sources.length})`} defaultOpen={false}>
      <div style={{ ...S.body, maxHeight: 200 }}>
        {sources.length === 0 ? (
          <p style={{ padding: "8px 12px", fontSize: 11, color: "var(--brand-border, #475569)", margin: 0 }}>
            Nessuna sorgente configurata.
          </p>
        ) : (
          sources.map((src) => (
            <div
              key={src.id}
              onClick={() => navigateToConfig("protocols")}
              style={{ ...S.row(false), justifyContent: "space-between", cursor: "pointer" }}
              title={t("editor.gotoProtocols")}
            >
              <span style={{ fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
                {src.id}
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700, letterSpacing: 0.5, padding: "1px 4px", borderRadius: 3,
                background: src.kind === "mqtt" ? "#4c1d95"
                  : src.kind === "opcua_client" ? "#1d4733"
                  : "#1e3a5f",
                color: src.kind === "mqtt" ? "#c4b5fd"
                  : src.kind === "opcua_client" ? "var(--brand-success-soft, #86efac)"
                  : "#93c5fd",
                flexShrink: 0,
              }}>
                {src.kind === "mqtt" ? "MQTT"
                  : src.kind === "opcua_client" ? "OPC-UA"
                  : "MBUS"}
              </span>
            </div>
          ))
        )}
        <div style={{ padding: "4px 12px" }}>
          <span
            onClick={() => navigateToConfig("protocols")}
            style={{ fontSize: 10, color: "var(--brand-border, #475569)", fontStyle: "italic", cursor: "pointer" }}
          >
            Vai alla configurazione →
          </span>
        </div>
      </div>
    </Section>
  );
}

// ── Main LeftPanel export ─────────────────────────────────────────────────────

interface LeftPanelProps {
  onAddObject: (type: SynopticObject["type"]) => void;
  onFunctionsChanged: () => void;
}

// Resizable width, persisted across sessions (like other editor UI prefs
// such as sws.uiLang). Plain localStorage — this is layout-only, no other
// component needs to react to it, so no Zustand store entry is needed.
const LEFT_PANEL_WIDTH_KEY = "sws.leftPanelWidth";
const LEFT_PANEL_MIN = 160;
const LEFT_PANEL_MAX = 480;

export function LeftPanel({ onAddObject, onFunctionsChanged }: LeftPanelProps) {
  const project    = useAppStore((s) => s.project);
  const setProject = useAppStore((s) => s.setProject);

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
    <div style={{ ...S.panel, width: panelWidth, position: "relative" }}>
      <div style={{ overflowY: "auto" as const, flex: 1 }}>
        <PagesSection />
        <ObjectPalette onAdd={onAddObject} />
        <ObjectsSection />
        <FunctionsSection onFunctionsChanged={onFunctionsChanged} />
        <TagsSection />
        <SourcesSection project={project} />
      </div>

      <HistorySection />

      <div
        onMouseDown={onResizeStart}
        title="Trascina per ridimensionare"
        style={{ position: "absolute", top: 0, right: -3, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 10 }}
      />
    </div>
  );
}

// ── History section (cronologia visuale) ──────────────────────────────────────

function HistorySection() {
  const { t } = useTranslation();
  const past         = useAppStore((s) => s.past);
  const future       = useAppStore((s) => s.future);
  const undo         = useAppStore((s) => s.undo);
  const redo         = useAppStore((s) => s.redo);
  const jumpToPast   = useAppStore((s) => s.jumpToPast);
  const jumpToFuture = useAppStore((s) => s.jumpToFuture);

  const currentRef = useRef<HTMLDivElement>(null);
  const totalSteps = past.length + future.length;

  const [open, setOpen] = useState(true);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [past.length, future.length]);

  const btn = (enabled: boolean): React.CSSProperties => ({
    flex: 1,
    background: enabled ? "var(--brand-bg, #0f172a)" : "var(--brand-surface, #1e293b)",
    color: enabled ? "var(--brand-text-2, #cbd5e1)" : "var(--brand-border, #475569)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    padding: "3px 0",
    cursor: enabled ? "pointer" : "not-allowed",
    fontSize: 11,
  });

  return (
    <div style={{ borderTop: "1px solid var(--brand-surface-2, #334155)", flexShrink: 0 }}>
      <div style={S.sectionHead(open)} onClick={() => setOpen((v) => !v)}>
        <span>CRONOLOGIA ({totalSteps} step)</span>
        <span style={S.chevron(open)}>▶</span>
      </div>
      {open && (
        <>
          <div style={{ overflowY: "auto", maxHeight: 180 }}>
            {/* Stato iniziale */}
            <div style={{ ...S.row(false), fontSize: 11, color: "var(--brand-border, #475569)", fontStyle: "italic" }}>
              Stato iniziale
            </div>
            {/* Past entries — oldest to newest, clicking jumps to that state */}
            {past.map((entry, idx) => (
              <div
                key={idx}
                onClick={() => jumpToPast(idx)}
                style={{ ...S.row(false), fontSize: 11, paddingLeft: 16, cursor: "pointer" }}
                title={t("editor.historyBack", { label: entry.label })}
              >
                {entry.label}
              </div>
            ))}
            {/* Current marker */}
            <div
              ref={currentRef}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "3px 12px",
                background: "#134e4a",
                color: "#5eead4",
                fontSize: 11,
                fontWeight: 700,
                borderTop: "1px solid #0f3d38",
                borderBottom: "1px solid #0f3d38",
              }}
            >
              ▶ CORRENTE
            </div>
            {/* Future entries — next redo target first */}
            {future.map((entry, idx) => (
              <div
                key={idx}
                onClick={() => jumpToFuture(idx)}
                style={{
                  ...S.row(false),
                  fontSize: 11,
                  paddingLeft: 16,
                  cursor: "pointer",
                  opacity: 0.5,
                  fontStyle: "italic",
                }}
                title={t("editor.historyRestore", { label: entry.label })}
              >
                {entry.label}
              </div>
            ))}
          </div>
          <div style={{ padding: "5px 8px", display: "flex", gap: 5 }}>
            <button style={btn(past.length > 0)} onClick={undo} disabled={past.length === 0} title="Ctrl-Z">
              ↶ Annulla
            </button>
            <button style={btn(future.length > 0)} onClick={redo} disabled={future.length === 0} title="Ctrl-Y">
              ↷ Rifai
            </button>
          </div>
        </>
      )}
    </div>
  );
}
