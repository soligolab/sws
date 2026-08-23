import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { QDOT_BUILTIN_TYPES, SvgCanvas, normalizeFaceplateParams, type CanvasViewApi } from "@/canvas/SvgCanvas";
import { PALETTE } from "@/canvas/TrendCanvas";
import { resolvePageBackground } from "@/theme";
import { EditorToolbar } from "@/editor/EditorToolbar";
import { LeftPanel } from "@/editor/LeftPanel";
import { PageTabs } from "@/editor/PageTabs";
import { FunctionEditor } from "@/editor/FunctionEditor";
import { TagInput } from "@/components/TagInput";
import { BindableInput } from "@/components/BindableInput";
import { ImageBrowser } from "@/components/ImageBrowser";
import { SYMBOL_LIST } from "@/symbols/library";
import { ASPECT_RATIOS, editorFitSize, effectiveSizeMode, getDevicePresets, referenceResolutionFor, STANDARD_DEVICE_PRESETS } from "@/pageLayout";
import { getBrand } from "@/branding";
import { genId } from "@/id";
import type { SymbolMeta } from "@/symbols/library";
import { useAppStore } from "@/store";
import { localizeObjects } from "@/i18n/projectI18n";
import type { AlignMode } from "@/store";
import type { AlarmSeverity, ButtonAction, FunctionDef, GridCell, PageLayoutConfig, PageSizeMode, RadioOption, SubCellEntry, SubGrid, SynopticObject, TableRow, TextListEntry, TrendTrace } from "@/types";

// ── Shared styles ─────────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)",
  color: "var(--brand-text-2, #cbd5e1)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  overflowY: "auto",
};
const RIGHT_PANEL_WIDTH_KEY = "sws.rightPanelWidth";
const RIGHT_PANEL_MIN = 220;
const RIGHT_PANEL_MAX = 560;

const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 13,
  boxSizing: "border-box",
};

// ── SymbolGallery ─────────────────────────────────────────────────────────────
// Visual grid picker — shows a mini SVG preview for built-in symbols and an
// <img> for vendored/custom SVG files. Replaces the old plain <select>.

type GalleryTile =
  | { kind: "builtin" | "vendored"; id: string; label: string; meta: SymbolMeta }
  | { kind: "custom"; id: string; label: string; url: string };

function SymbolGallery({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const customSymbols = useAppStore((s) => s.customSymbols);

  const tiles: GalleryTile[] = [
    ...SYMBOL_LIST.map((m) => ({ kind: m.kind, id: m.id, label: m.label, meta: m } as GalleryTile)),
    ...customSymbols.map((s) => ({ kind: "custom" as const, id: `custom:${s.id}`, label: s.label, url: s.url })),
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(4, 1fr)",
      gap: 4,
      maxHeight: 260,
      overflowY: "auto",
      padding: 2,
    }}>
      {tiles.map((tile) => {
        const sel = value === tile.id;
        const isBi = tile.kind === "builtin";
        return (
          <button
            key={tile.id}
            title={tile.label}
            onClick={() => onChange(tile.id)}
            style={{
              background: sel ? "#1e3a5f" : "var(--brand-bg, #0f172a)",
              border: `2px solid ${sel ? "var(--brand-warning-soft, #facc15)" : "var(--brand-surface-2, #334155)"}`,
              borderRadius: 4,
              cursor: "pointer",
              padding: "4px 2px 3px",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 2,
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            <div style={{ width: 44, height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {isBi && (tile as { meta: SymbolMeta }).meta.render ? (
                <svg width={40} height={38} viewBox="0 0 100 100" style={{ overflow: "visible" }}>
                  {(tile as { meta: SymbolMeta }).meta.render!({ state: "on", off: "var(--brand-text-subtle, #64748b)", on: "var(--brand-success, #22c55e)", alarm: "var(--brand-danger, #ef4444)" })}
                </svg>
              ) : (
                <img
                  src={tile.kind === "custom"
                    ? (tile as Extract<GalleryTile, { kind: "custom" }>).url
                    : (tile as { meta: SymbolMeta }).meta.path}
                  style={{ width: 36, height: 34, objectFit: "contain" }}
                  draggable={false}
                />
              )}
            </div>
            <span style={{
              fontSize: 8,
              color: sel ? "var(--brand-warning-soft, #facc15)" : "var(--brand-text-subtle, #64748b)",
              lineHeight: 1.1,
              textAlign: "center",
              maxWidth: "100%",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              padding: "0 2px",
            }}>
              {tile.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── SymbolPickerModal ─────────────────────────────────────────────────────────
// Full-screen overlay that lets the user choose a symbol at placement time.

function SymbolPickerModal({ onPick, onCancel }: {
  onPick: (symbolId: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState("pump");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onPick(selected);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selected, onPick, onCancel]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9998,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        width: 420, maxHeight: "80vh",
        display: "flex", flexDirection: "column", overflow: "hidden",
      }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--brand-text-2, #cbd5e1)", fontWeight: 600 }}>{t("symbol.choose")}</span>
          <button onClick={onCancel} style={{ background: "transparent", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 16 }}>✕</button>
        </div>
        <div style={{ overflowY: "auto", padding: 12, flex: 1 }}>
          <SymbolGallery value={selected} onChange={setSelected} />
        </div>
        <div style={{ padding: "8px 14px", borderTop: "1px solid var(--brand-surface, #1e293b)", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onCancel} style={{ padding: "4px 14px", fontSize: 12, background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)", borderRadius: 4, cursor: "pointer" }}>{t("common.cancel")}</button>
          <button onClick={() => onPick(selected)} style={{ padding: "4px 14px", fontSize: 12, background: "#1e3a5f", border: "1px solid var(--brand-primary, #3b82f6)", color: "#93c5fd", borderRadius: 4, cursor: "pointer" }}>{t("symbol.insert")}</button>
        </div>
      </div>
    </div>
  );
}

/** Object types that support rotation/flip/opacity in the canvas.
 *  Keep in sync with the `applyTransform()` call sites in SvgCanvas.tsx —
 *  `lang_button`/`lang_selector` were rendered with it there but missing
 *  here, so their transform panel was unreachable in the properties UI. */
const SUPPORTS_TRANSFORM = new Set([
  "rect", "ellipse", "text", "image",
  "gauge", "led", "progress_bar", "table",
  "button", "navbutton", "symbol",
  "lang_button", "lang_selector",
]);

// ── Multi-selection helpers ───────────────────────────────────────────────────

/** Fields that are identical across all objects; mixed fields → undefined. */
function mergeObjects(objs: SynopticObject[]): Partial<SynopticObject> {
  if (objs.length === 0) return {};
  const keys = new Set(objs.flatMap((o) => Object.keys(o))) as Set<keyof SynopticObject>;
  const out: Partial<SynopticObject> = {};
  for (const k of keys) {
    const vals = objs.map((o) => (o as unknown as Record<string, unknown>)[k as string]);
    if (vals.every((v) => v === vals[0])) (out as Record<string, unknown>)[k as string] = vals[0];
  }
  return out;
}

/** Keys present in any object whose values differ across the selection. */
function buildMixedKeys(objs: SynopticObject[]): Set<keyof SynopticObject> {
  const result = new Set<keyof SynopticObject>();
  if (objs.length < 2) return result;
  const allKeys = new Set(objs.flatMap((o) => Object.keys(o))) as Set<keyof SynopticObject>;
  for (const k of allKeys) {
    const vals = objs.map((o) => (o as unknown as Record<string, unknown>)[k as string]);
    if (!vals.every((v) => v === vals[0])) result.add(k);
  }
  return result;
}

// ── EditorShell ───────────────────────────────────────────────────────────────

export function EditorShell() {
  const pages           = useAppStore((s) => s.pages);
  const currentPageId   = useAppStore((s) => s.currentPageId);
  const selectedId      = useAppStore((s) => s.selectedObjectId);
  const selectedIds     = useAppStore((s) => s.selectedObjectIds);
  const selectedFnId    = useAppStore((s) => s.selectedFunctionId);
  const project         = useAppStore((s) => s.project);
  const customSymbols   = useAppStore((s) => s.customSymbols);
  const faceplates      = useAppStore((s) => s.faceplates);
  const updateFunction  = useAppStore((s) => s.updateFunction);
  const tagValues       = useAppStore((s) => s.tagValues);
  const gridSize        = useAppStore((s) => s.gridSize);
  const snapEnabled     = useAppStore((s) => s.snapEnabled);
  const gridColor       = useAppStore((s) => s.gridColor);
  const themeMode       = useAppStore((s) => s.themeMode);
  const editorPreviewLang = useAppStore((s) => s.editorPreviewLang);
  const addObject       = useAppStore((s) => s.addObject);
  const updateObject    = useAppStore((s) => s.updateObject);
  const deleteObject    = useAppStore((s) => s.deleteObject);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const reorderObject   = useAppStore((s) => s.reorderObject);
  const selectObject    = useAppStore((s) => s.selectObject);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const duplicateSelection = useAppStore((s) => s.duplicateSelection);
  const selectMany      = useAppStore((s) => s.selectMany);
  const copySelection   = useAppStore((s) => s.copySelection);
  const pasteClipboard  = useAppStore((s) => s.pasteClipboard);
  const setClipboard    = useAppStore((s) => s.setClipboard);
  const alignSelection  = useAppStore((s) => s.alignSelection);
  const groupObjects    = useAppStore((s) => s.groupObjects);
  const undo            = useAppStore((s) => s.undo);
  const redo            = useAppStore((s) => s.redo);
  const updateObjects    = useAppStore((s) => s.updateObjects);
  const updatePageProps  = useAppStore((s) => s.updatePageProps);
  const updateGridCell      = useAppStore((s) => s.updateGridCell);
  const selectedCell        = useAppStore((s) => s.selectedCell);
  const selectedCellChild   = useAppStore((s) => s.selectedCellChild);
  const selectedCellRange   = useAppStore((s) => s.selectedCellRange);
  const selectedSubCell     = useAppStore((s) => s.selectedSubCell);
  const setSelectedCell     = useAppStore((s) => s.setSelectedCell);
  const setSelectedCellChild = useAppStore((s) => s.setSelectedCellChild);
  const setSelectedCellRange = useAppStore((s) => s.setSelectedCellRange);
  const setSelectedSubCell  = useAppStore((s) => s.setSelectedSubCell);
  const mergeCellRange      = useAppStore((s) => s.mergeCellRange);
  const unmergeCell         = useAppStore((s) => s.unmergeCell);
  const splitCell           = useAppStore((s) => s.splitCell);
  const joinSplitCell       = useAppStore((s) => s.joinSplitCell);
  const updateSubCellAt     = useAppStore((s) => s.updateSubCellAt);

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];

  // Canvas viewport: the transform itself lives inside SvgCanvas (pan writes
  // at mousemove rate), we only mirror the zoom *factor* for the toolbar
  // readout — SvgCanvas reports it only when it actually changes.
  const viewApi = useRef<CanvasViewApi | null>(null);
  const [zoom, setZoom] = useState(1);
  const fitPageSize = useMemo(
    () => editorFitSize(currentPage, project?.page_layout),
    [currentPage?.width, currentPage?.height, project?.page_layout],
  );
  // Il canvas mostra i messaggi {{token}} risolti nella lingua di ANTEPRIMA
  // scelta nel tab Configurazione → Lingue (store `editorPreviewLang`); il
  // pannello proprietà lavora su `objects` grezzi così l'autore vede/edita i
  // token (T-40). Fallback al default della tabella se la lingua scelta non
  // esiste nel progetto corrente (regge il cambio progetto).
  const projLangs   = project?.languages?.langs ?? [];
  const previewLang = projLangs.includes(editorPreviewLang)
    ? editorPreviewLang
    : (project?.languages?.default ?? "");
  const canvasObjects = useMemo(
    () => localizeObjects(objects, previewLang, project?.languages),
    [objects, previewLang, project?.languages],
  );
  const selected    = objects.find((o) => o.id === selectedId) ?? null;
  const multi       = selectedIds.length > 1;
  const functions   = project?.functions ?? [];
  const selectedFn  = functions.find((f) => f.id === selectedFnId) ?? null;

  // Multi-selection derived state
  const selectedObjects = useMemo(
    () => objects.filter((o) => selectedIds.includes(o.id)),
    [objects, selectedIds],
  );
  const mergedProps = useMemo(
    () => (multi ? mergeObjects(selectedObjects) : {}),
    [multi, selectedObjects],
  );
  const mixedKeys = useMemo(
    () => (multi ? buildMixedKeys(selectedObjects) : new Set<keyof SynopticObject>()),
    [multi, selectedObjects],
  );
  const allSameType = multi &&
    selectedObjects.length > 0 &&
    selectedObjects.every((o) => o.type === selectedObjects[0].type);
  const batchChange = useCallback(
    (patch: Partial<SynopticObject>) => updateObjects(selectedIds, patch),
    [selectedIds, updateObjects],
  );

  // Persist the whole `project.functions` list to the server. Called by the
  // FunctionEditor's save button and by FunctionsSection's CRUD verbs (so
  // add/rename/delete take effect for the run endpoint without a refresh).
  const persistFunctions = () => {
    const list = useAppStore.getState().project?.functions ?? [];
    api.updateFunctions(list).catch(console.error);
  };

  const [helpOpen, setHelpOpen] = useState(false);
  const [symbolPickPos, setSymbolPickPos] = useState<{ x: number; y: number } | null>(null);
  const [pendingImagePos, setPendingImagePos] = useState<{ x: number; y: number } | null>(null);

  // Right (properties) panel resizable width, persisted like the left panel's.
  // The <aside> sits at the far right of the layout, so its resize handle is
  // on its LEFT border and dragging left/right maps to width the opposite way
  // around from LeftPanel's own handle (on its right border).
  const [rightPanelWidth, setRightPanelWidth] = useState<number>(() => {
    const stored = Number(localStorage.getItem(RIGHT_PANEL_WIDTH_KEY));
    return stored >= RIGHT_PANEL_MIN && stored <= RIGHT_PANEL_MAX ? stored : 280;
  });
  const rightWidthRef = useRef(rightPanelWidth);
  const onRightResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: MouseEvent) => {
      const next = Math.min(RIGHT_PANEL_MAX, Math.max(RIGHT_PANEL_MIN, startWidth - (ev.clientX - startX)));
      rightWidthRef.current = next;
      setRightPanelWidth(next);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightWidthRef.current));
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const handleSelect = (id: string | null, shift?: boolean) => {
    if (id === null) { selectObject(null); return; }
    if (shift) toggleSelection(id);
    else       selectObject(id);
  };

  // Document-level keyboard shortcuts. Skipped when typing in a form field
  // so renaming an object doesn't trigger delete-on-backspace.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (inField) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const ids  = useAppStore.getState().selectedObjectIds;
      if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0) {
        e.preventDefault(); deleteSelection();
      } else if (ctrl && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault(); undo();
      } else if ((ctrl && (e.key === "y" || e.key === "Y")) ||
                 (ctrl && e.shiftKey && (e.key === "z" || e.key === "Z"))) {
        e.preventDefault(); redo();
      } else if (ctrl && (e.key === "c" || e.key === "C") && ids.length > 0) {
        e.preventDefault(); copySelection();
      } else if (ctrl && (e.key === "x" || e.key === "X")) {
        e.preventDefault();
        const cell = useAppStore.getState().selectedCell;
        if (cell) {
          // Cut cell child to clipboard if the selected cell has one.
          const state = useAppStore.getState();
          const page = state.pages.find((p) => p.id === state.currentPageId);
          const gridObj = page?.objects.find((o) => o.id === cell.objectId);
          const cellDef = (gridObj?.grid_cells as GridCell[] | undefined)
            ?.find((c) => c.row === cell.row && c.col === cell.col);
          if (cellDef?.child) {
            setClipboard([cellDef.child], state.currentPageId);
            state.updateGridCell(state.currentPageId, cell.objectId,
              { ...cellDef, child: undefined });
            return;
          }
        }
        const subCell = useAppStore.getState().selectedSubCell;
        if (subCell) {
          const state = useAppStore.getState();
          const page = state.pages.find((p) => p.id === state.currentPageId);
          const gridObj = page?.objects.find((o) => o.id === subCell.objectId);
          const topCell = (gridObj?.grid_cells as GridCell[] | undefined)
            ?.find((c) => c.row === subCell.row && c.col === subCell.col);
          const entry = resolveSubCellEntry(topCell, subCell.path);
          if (entry?.child) {
            setClipboard([entry.child], state.currentPageId);
            state.updateSubCellAt(
              state.currentPageId,
              subCell.objectId,
              subCell.row, subCell.col,
              subCell.path,
              { child: undefined },
            );
            return;
          }
        }
        // Fall back to cutting the page-level selection.
        if (ids.length > 0) { copySelection(); deleteSelection(); }
      } else if (ctrl && (e.key === "v" || e.key === "V")) {
        e.preventDefault();
        const cell = useAppStore.getState().selectedCell;
        if (cell) {
          // Paste first clipboard item as a child of the selected cell.
          const state = useAppStore.getState();
          const { clipboard } = state;
          if (clipboard.length > 0) {
            const page = state.pages.find((p) => p.id === state.currentPageId);
            const gridObj = page?.objects.find((o) => o.id === cell.objectId);
            const cellDef = (gridObj?.grid_cells as GridCell[] | undefined)
              ?.find((c) => c.row === cell.row && c.col === cell.col)
              ?? { row: cell.row, col: cell.col };
            state.updateGridCell(state.currentPageId, cell.objectId,
              { ...cellDef, child: { ...clipboard[0] } });
          }
        } else {
          const subCell = useAppStore.getState().selectedSubCell;
          if (subCell) {
            const state = useAppStore.getState();
            if (state.clipboard.length > 0) {
              state.updateSubCellAt(
                state.currentPageId,
                subCell.objectId,
                subCell.row, subCell.col,
                subCell.path,
                { child: { ...state.clipboard[0] } },
              );
            }
          } else {
            pasteClipboard();
          }
        }
      } else if (ctrl && (e.key === "d" || e.key === "D") && ids.length > 0) {
        e.preventDefault(); duplicateSelection();
      } else if (ctrl && e.key === "a") {
        e.preventDefault();
        const state = useAppStore.getState();
        const page = state.pages.find((p) => p.id === state.currentPageId);
        if (page && page.objects.length > 0) selectMany(page.objects.map((o) => o.id));
      } else if (ctrl && (e.key === "g" || e.key === "G") && ids.length >= 2) {
        e.preventDefault(); groupObjects(ids);
      } else if (ctrl && e.key === "]" && ids.length === 1) {
        e.preventDefault(); reorderObject(ids[0], e.shiftKey ? "front" : "forward");
      } else if (ctrl && e.key === "[" && ids.length === 1) {
        e.preventDefault(); reorderObject(ids[0], e.shiftKey ? "back" : "backward");
      } else if (!ctrl && ids.length > 0 &&
                 (e.key === "ArrowLeft" || e.key === "ArrowRight" ||
                  e.key === "ArrowUp"   || e.key === "ArrowDown")) {
        e.preventDefault();
        const state = useAppStore.getState();
        const step = e.shiftKey ? (state.snapEnabled && state.gridSize > 0 ? state.gridSize : 10) : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp"   ? -step : e.key === "ArrowDown"  ? step : 0;
        const page = state.pages.find((p) => p.id === state.currentPageId);
        if (page) {
          ids.forEach((id) => {
            const obj = page.objects.find((o) => o.id === id);
            if (!obj) return;
            const patch: Partial<SynopticObject> = { x: (obj.x ?? 0) + dx, y: (obj.y ?? 0) + dy };
            if (obj.type === "line") { patch.x2 = (obj.x2 ?? obj.x + 100) + dx; patch.y2 = (obj.y2 ?? obj.y) + dy; }
            state.updateObject(id, patch);
          });
        }
      } else if (e.key === "?" || (e.shiftKey && e.key === "?")) {
        setHelpOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [deleteSelection, undo, redo, copySelection, pasteClipboard, duplicateSelection, setClipboard, selectMany, reorderObject, groupObjects]);

  const nextPos = () => {
    const n = objects.length;
    return { x: 60 + (n % 6) * 25, y: 60 + Math.floor(n / 6) * 25 };
  };

  const handleAddObject = (type: SynopticObject["type"]) => {
    const { x, y } = nextPos();
    switch (type) {
      case "rect":
        addObject({ type, x, y, width: 150, height: 80, fill: "#4a90d9" });
        break;
      case "ellipse":
        addObject({ type, x, y, width: 120, height: 80, fill: "#4a90d9" });
        break;
      case "line":
        addObject({ type, x, y, x2: x + 120, y2: y, stroke: "var(--brand-text, #e2e8f0)", stroke_width: 2 });
        break;
      case "text":
        addObject({ type, x, y: y + 14, text: "Testo", font_size: 14, color: "var(--brand-text, #e2e8f0)", text_anchor: "start" });
        break;
      case "button":
        addObject({ type, x, y, width: 120, height: 40, fill: "var(--brand-primary, #3b82f6)", label: "Bottone", write_value: true });
        break;
      case "navbutton":
        addObject({ type, x, y, width: 140, height: 36, label: "Vai alla pagina" });
        break;
      case "lang_selector":
        addObject({ type, x, y, width: 120, height: 32 });
        break;
      case "lang_button":
        addObject({ type, x, y, width: 70, height: 32, target_lang: "" });
        break;
      case "checkbox":
        addObject({ type, x, y, width: 120, height: 30, label: "Checkbox", checked_value: true, unchecked_value: false });
        break;
      case "radio":
        addObject({ type, x, y, width: 160, height: 80, label: "Radio", orientation: "vertical",
          options: [{ label: "Opzione 1", value: "1" }, { label: "Opzione 2", value: "2" }] });
        break;
      case "slider":
        addObject({ type, x, y, width: 200, height: 40, min: 0, max: 100, step: 1, orientation: "horizontal" });
        break;
      case "setpoint":
        addObject({ type, x, y, width: 140, height: 56, label: "Setpoint", min: 0, max: 100, step: 1 });
        break;
      case "gauge":
        addObject({ type, x, y, width: 180, height: 180, min: 0, max: 100, label: "Gauge" });
        break;
      case "led":
        addObject({ type, x, y, width: 40, height: 40, on_value: true, on_color: "var(--brand-success, #22c55e)", off_color: "#374151" });
        break;
      case "state_lamp":
        addObject({ type, x, y, width: 140, height: 24, font_size: 13,
          text_list_entries: [
            { value: 0, label: "Fermo", color: "var(--brand-text-muted, #94a3b8)" },
            { value: 1, label: "Marcia", color: "var(--brand-success, #22c55e)" },
            { value: 2, label: "Allarme", color: "var(--brand-danger, #ef4444)" },
          ] });
        break;
      case "progress_bar":
        addObject({ type, x, y, width: 200, height: 30, min: 0, max: 100, fill: "var(--brand-primary, #3b82f6)", show_value: true });
        break;
      case "table":
        addObject({ type, x, y, width: 300, height: 120,
          table_rows: [{ label: "Tag 1", tag: "", format: "{value:.1f}" }] });
        break;
      case "trend":
        addObject({ type, x, y, width: 360, height: 180,
          trend_tags: [{ tag: "" }], window_s: 60 });
        break;
      case "xy_plot":
        addObject({ type, x, y, width: 200, height: 200,
          xy_trail_s: 30, line_color: "var(--brand-primary, #3b82f6)" });
        break;
      case "text_list":
        addObject({ type, x, y, width: 120, height: 32, font_size: 16, text_anchor: "middle",
          text_list_entries: [
            { value: 0, label: "Chiuso", color: "var(--brand-text-muted, #94a3b8)" },
            { value: 1, label: "Aperto", color: "var(--brand-success, #22c55e)" },
          ],
          text_list_default: "N/D", text_list_default_color: "var(--brand-danger, #ef4444)" });
        break;
      case "bar_chart":
        addObject({ type, x, y, width: 240, height: 180, min: 0, max: 100,
          bar_orientation: "vertical", bar_show_values: true, bar_show_labels: true,
          bar_show_thresholds: true, bar_gap: 0.2,
          bar_series: [
            { tag: "", label: "Linea 1", color: "var(--brand-primary, #3b82f6)" },
            { tag: "", label: "Linea 2", color: "var(--brand-success, #22c55e)" },
          ] });
        break;
      case "pie_chart":
        addObject({ type, x, y, width: 200, height: 200, pie_mode: "pie",
          pie_show_labels: true,
          pie_slices: [
            { tag: "", label: "Zona 1", color: "var(--brand-primary, #3b82f6)" },
            { tag: "", label: "Zona 2", color: "var(--brand-success, #22c55e)" },
            { tag: "", label: "Zona 3", color: "var(--brand-warning, #f59e0b)" },
          ] });
        break;
      case "sparkline":
        addObject({ type, x, y, width: 120, height: 30, tag: "",
          spark_window_s: 60, spark_color: "var(--brand-primary, #3b82f6)",
          spark_fill: true, spark_fill_opacity: 0.2, spark_stroke_width: 1.5 });
        break;
      case "kpi_tile":
        addObject({ type, x, y, width: 180, height: 100, tag: "", label: "KPI",
          spark_window_s: 3600 });
        break;
      case "data_log":
        addObject({ type, x, y, width: 380, height: 240, tag: "", label: "Data log",
          window_s: 3600, datalog_page_size: 25 });
        break;
      case "alarm_viewer":
        addObject({ type, x, y, width: 360, height: 160,
          alarm_viewer_max_rows: 5, alarm_viewer_mode: "list",
          alarm_viewer_show_ack: true, alarm_viewer_show_ts: true, alarm_viewer_show_empty: true });
        break;
      case "alarm_bell":
        addObject({ type, x, y, width: 130, height: 34,
          alarm_bell_show_history: true, alarm_bell_show_shelve: true });
        break;
      case "alarm_banner":
        addObject({ type, x, y, width: 600, height: 32 });
        break;
      case "alarm_history":
        addObject({ type, x, y, width: 420, height: 220 });
        break;
      case "recipe_panel":
        addObject({ type, x, y, width: 260, height: 160 });
        break;
      case "image":
        setPendingImagePos({ x, y });
        return; // addObject called after image is chosen in browser
      case "symbol":
        setSymbolPickPos({ x, y });
        return; // addObject called when user confirms in modal
      case "grid":
        addObject({ type, x, y, width: 400, height: 300,
          label: "Grid",
          grid_rows: 2, grid_cols: 2,
          grid_cells: [],
          grid_show_borders: true,
          grid_border_color: "var(--brand-text-subtle, #64748b)" });
        break;
      case "pipe":
        addObject({
          type, x, y,
          points: [{ x, y }, { x: x + 120, y }, { x: x + 120, y: y + 80 }],
          routing: "straight",
          pipe_style: "flat",
          stroke: "var(--brand-text-subtle, #64748b)",
          stroke_width: 8,
        });
        break;
      case "faceplate":
        addObject({ type, x, y, width: 120, height: 80 });
        break;
    }
  };

  // When a project-level function is selected, take over the whole main
  // area with the full-screen FunctionEditor. The LeftPanel stays on the
  // left (so the user can keep navigating between functions) but canvas
  // and properties panel are hidden.
  const persistFunctionsAsync = async () => {
    const list = useAppStore.getState().project?.functions ?? [];
    await api.updateFunctions(list);
  };

  if (selectedFn) {
    return (
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LeftPanel
          onAddObject={handleAddObject}
          onFunctionsChanged={persistFunctions}
        />
        <FunctionEditor
          fn={selectedFn}
          onPatch={(patch) => updateFunction(selectedFn.id, patch)}
          onPersist={persistFunctionsAsync}
          onClose={() => useAppStore.getState().selectFunction(null)}
        />
      </div>
    );
  }

  return (
    // Column: contextual toolbar, page tabs, then the panels row. minWidth 0
    // matters — <main> is a flex row and the canvas would otherwise squeeze
    // the two strips.
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, overflow: "hidden" }}>
      <EditorToolbar viewApi={viewApi} zoom={zoom} canFitPage={fitPageSize !== null} />
      <PageTabs />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {pendingImagePos && (
        <ImageBrowser
          onSelect={(path) => {
            addObject({ type: "image", x: pendingImagePos.x, y: pendingImagePos.y,
                        width: 120, height: 80, src: path });
            setPendingImagePos(null);
          }}
          onClose={() => setPendingImagePos(null)}
        />
      )}
      {symbolPickPos && (
        <SymbolPickerModal
          onPick={(symbolId) => {
            addObject({
              type: "symbol",
              x: symbolPickPos.x,
              y: symbolPickPos.y,
              width: 80,
              height: 80,
              symbol_id: symbolId,
              state_off_color: "var(--brand-text-subtle, #64748b)",
              state_on_color: "var(--brand-success, #22c55e)",
              state_alarm_color: "var(--brand-danger, #ef4444)",
            });
            setSymbolPickPos(null);
          }}
          onCancel={() => setSymbolPickPos(null)}
        />
      )}
      {/* Left panel: project tree + object palette + settings */}
      <LeftPanel
        onAddObject={handleAddObject}
        onFunctionsChanged={persistFunctions}
      />

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={canvasObjects}
          tagValues={tagValues}
          background={resolvePageBackground(currentPage?.background, currentPage?.background_dark, themeMode)}
          selectedId={selectedId}
          selectedIds={selectedIds}
          gridSize={gridSize}
          snapEnabled={snapEnabled}
          gridColor={gridColor}
          customSymbols={customSymbols}
          faceplates={faceplates}
          pageWidth={currentPage?.width}
          pageHeight={currentPage?.height}
          pageId={currentPageId}
          selectedCell={selectedCell}
          selectedCellChild={selectedCellChild}
          selectedCellRange={selectedCellRange}
          selectedSubCell={selectedSubCell}
          onSelect={handleSelect}
          onSelectMany={selectMany}
          onMove={currentPage?.locked ? () => {} : (id, patch) => updateObject(id, patch)}
          onSelectCell={(objectId, row, col) => setSelectedCell({ objectId, row, col })}
          onSelectCellChild={(objectId, row, col) => setSelectedCellChild({ objectId, row, col })}
          onSelectCellRange={(objectId, r1, c1, r2, c2) =>
            setSelectedCellRange({ objectId, r1, c1, r2, c2 })}
          onSelectSubCell={(objectId, row, col, path) =>
            setSelectedSubCell({ objectId, row, col, path })}
          viewApi={viewApi}
          onZoomChange={setZoom}
          fitPageSize={fitPageSize}
        />
      </div>

      {/* Properties panel — context-sensitive:
            multi-select  → MultiSelectionProps
            child selected → ObjectProps for the child
            cell selected  → GridCellEditor for the cell
            grid selected  → ObjectProps for the grid
            nothing        → PageProps                   */}
      <aside style={{ ...PANEL, width: rightPanelWidth, borderLeft: "1px solid var(--brand-surface-2, #334155)", position: "relative" }}>
        <div
          onMouseDown={onRightResizeStart}
          title="Trascina per ridimensionare"
          style={{ position: "absolute", top: 0, left: -3, bottom: 0, width: 6, cursor: "ew-resize", zIndex: 10 }}
        />
        {/* Locked page: fieldset[disabled] natively disables every nested
            form control (inputs/selects/buttons) in one shot — no need to
            thread a `disabled` prop through every ObjectProps variant. */}
        <fieldset disabled={!!currentPage?.locked} style={{ border: "none", margin: 0, padding: 0, display: "contents" }}>
        {multi ? (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1 }}>
              PROPRIETÀ
            </span>
            <MultiSelectionProps
              count={selectedIds.length}
              selectedObjects={selectedObjects}
              mergedProps={mergedProps}
              mixedKeys={mixedKeys}
              allSameType={allSameType}
              pages={pages.filter((p) => p.id !== currentPageId)}
              functions={functions}
              onAlign={alignSelection}
              onDuplicate={duplicateSelection}
              onDelete={deleteSelection}
              onBatchChange={batchChange}
            />
          </>
        ) : selected ? (() => {
          const otherPages = pages.filter((p) => p.id !== currentPageId);

          // ── Sub-cell (slot of a split cell) selected ───────────────────
          if (selected.type === "grid" && selectedSubCell?.objectId === selected.id
              && selectedSubCell.path.length > 0) {
            const cells = (selected.grid_cells ?? []) as GridCell[];
            const cellDef = cells.find(
              (c) => c.row === selectedSubCell.row && c.col === selectedSubCell.col,
            );
            // Walk the path through cellDef.sub to find the entry the user
            // clicked. Bail to the regular cell branch if the path is no
            // longer valid (e.g., the user unsplit while it was selected).
            const path = selectedSubCell.path;
            const entry = resolveSubCellEntry(cellDef, path);
            const parentSub = resolveParentSubGrid(cellDef, path);
            if (cellDef && entry !== null && parentSub) {
              const gridLabel = selected.name?.trim() || `griglia·${selected.id.slice(-4)}`;
              const isSplit = !!entry.sub;
              const pathLabel = path.map((s) => s.toUpperCase()).join("→");
              const updateSub = (patch: Partial<typeof entry>) =>
                updateSubCellAt(currentPageId, selected.id,
                  selectedSubCell.row, selectedSubCell.col, path, patch);
              const child = entry.child;
              return (
                <>
                  <PanelBreadcrumb
                    parts={[
                      { label: gridLabel, onClick: () => { setSelectedCell(null); setSelectedSubCell(null); } },
                      { label: `R${selectedSubCell.row + 1} C${selectedSubCell.col + 1}`, onClick: () => setSelectedSubCell(null) },
                      `slot ${pathLabel}`,
                    ]}
                  />
                  <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginBottom: 6 }}>
                    Sub-cella interna ({parentSub.orientation === "rows" ? "alto/basso" : "sinistra/destra"}).
                  </div>
                  <CellStructureActions
                    isMerged={false}
                    isSplit={isSplit}
                    onUnmerge={() => {}}
                    onSplitRows={() => splitCell(currentPageId, selected.id,
                      selectedSubCell.row, selectedSubCell.col, "rows", path)}
                    onSplitCols={() => splitCell(currentPageId, selected.id,
                      selectedSubCell.row, selectedSubCell.col, "cols", path)}
                    onJoinSplit={() => joinSplitCell(currentPageId, selected.id,
                      selectedSubCell.row, selectedSubCell.col, path)}
                  />
                  <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                    Colore sfondo:
                    <input type="color" value={entry.bg_color ?? "var(--brand-surface, #1e293b)"}
                      onChange={(e) => updateSub({ bg_color: e.target.value })}
                      style={{ width: 28, height: 22, border: "1px solid var(--brand-surface-2, #334155)", background: "transparent", cursor: "pointer" }} />
                    {entry.bg_color && (
                      <button onClick={() => updateSub({ bg_color: undefined })}
                        style={{ background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)", borderRadius: 4, padding: "1px 8px", fontSize: 10, cursor: "pointer" }}>
                        reset
                      </button>
                    )}
                  </label>
                  {isSplit ? (
                    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 8 }}>
                      Questa sub-cella è ora divisa. Seleziona una delle sue
                      sotto-celle nel canvas per editarne il contenuto.
                    </div>
                  ) : child ? (
                    <ObjectProps
                      obj={child}
                      pages={otherPages}
                      functions={functions}
                      onChange={(patch) => updateSub({ child: { ...child, ...patch } })}
                      onDelete={() => updateSub({ child: undefined })}
                    />
                  ) : (
                    <SubCellAddChild
                      onAdd={(type) => updateSub({ child: makeDefaultChild(type) })}
                    />
                  )}
                </>
              );
            }
          }

          // ── Child sub-selected ──────────────────────────────────────────
          if (selected.type === "grid" && selectedCellChild?.objectId === selected.id) {
            const cells = (selected.grid_cells ?? []) as GridCell[];
            const cellDef = cells.find(
              (c) => c.row === selectedCellChild.row && c.col === selectedCellChild.col,
            );
            const child = cellDef?.child;
            if (child) {
              const gridLabel = selected.name?.trim() || `griglia·${selected.id.slice(-4)}`;
              const childLabel = child.name?.trim() || child.type;
              return (
                <>
                  <PanelBreadcrumb
                    parts={[
                      { label: gridLabel, onClick: () => { setSelectedCell(null); setSelectedCellChild(null); } },
                      { label: `R${selectedCellChild.row + 1} C${selectedCellChild.col + 1}`, onClick: () => setSelectedCellChild(null) },
                      childLabel,
                    ]}
                  />
                  <ObjectProps
                    obj={child}
                    pages={otherPages}
                    functions={functions}
                    onChange={(patch) =>
                      updateGridCell(currentPageId, selected.id, {
                        ...cellDef!,
                        child: { ...child, ...patch },
                      })
                    }
                    onDelete={() =>
                      updateGridCell(currentPageId, selected.id, { ...cellDef!, child: undefined })
                    }
                  />
                </>
              );
            }
          }

          // ── Cell range selected (multi-cell, for merge) ────────────────
          if (selected.type === "grid" && selectedCellRange?.objectId === selected.id) {
            const { r1, c1, r2, c2 } = selectedCellRange;
            const rows = r2 - r1 + 1;
            const cols = c2 - c1 + 1;
            const gridLabel = selected.name?.trim() || `griglia·${selected.id.slice(-4)}`;
            return (
              <>
                <PanelBreadcrumb
                  parts={[
                    { label: gridLabel, onClick: () => setSelectedCellRange(null) },
                    `${rows}×${cols} celle (R${r1 + 1}-${r2 + 1}, C${c1 + 1}-${c2 + 1})`,
                  ]}
                />
                <CellRangeMergeActions
                  onMerge={() => {
                    const err = mergeCellRange(currentPageId, selected.id, r1, c1, r2, c2);
                    if (err) alert(err);
                  }}
                  onCancel={() => setSelectedCellRange(null)}
                />
              </>
            );
          }

          // ── Cell selected (no child sub-selected) ──────────────────────
          if (selected.type === "grid" && selectedCell?.objectId === selected.id) {
            const cells = (selected.grid_cells ?? []) as GridCell[];
            const cellDef = cells.find(
              (c) => c.row === selectedCell.row && c.col === selectedCell.col,
            ) ?? { row: selectedCell.row, col: selectedCell.col };
            const gridLabel = selected.name?.trim() || `griglia·${selected.id.slice(-4)}`;
            const isMerged = (cellDef.rowspan ?? 1) > 1 || (cellDef.colspan ?? 1) > 1;
            const isSplit = !!cellDef.sub;
            return (
              <>
                <PanelBreadcrumb
                  parts={[
                    { label: gridLabel, onClick: () => setSelectedCell(null) },
                    `R${selectedCell.row + 1} C${selectedCell.col + 1}`,
                  ]}
                />
                <CellStructureActions
                  isMerged={isMerged}
                  isSplit={isSplit}
                  onUnmerge={() => unmergeCell(currentPageId, selected.id, selectedCell.row, selectedCell.col)}
                  onSplitRows={() => splitCell(currentPageId, selected.id, selectedCell.row, selectedCell.col, "rows")}
                  onSplitCols={() => splitCell(currentPageId, selected.id, selectedCell.row, selectedCell.col, "cols")}
                  onJoinSplit={() => joinSplitCell(currentPageId, selected.id, selectedCell.row, selectedCell.col)}
                />
                <GridCellEditor
                  cell={cellDef}
                  functions={functions}
                  onChange={(patch) =>
                    updateGridCell(currentPageId, selected.id, { ...cellDef, ...patch })
                  }
                />
              </>
            );
          }

          // ── Regular object (or grid with no cell selected) ─────────────
          return (
            <>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1 }}>
                PROPRIETÀ
              </span>
              <ZOrderBar id={selected.id} objectCount={objects.length} onReorder={reorderObject} />
              <ObjectProps
                obj={selected}
                pages={otherPages}
                functions={functions}
                onChange={(patch) => updateObject(selected.id, patch)}
                onDelete={() => deleteObject(selected.id)}
              />
            </>
          );
        })() : (
          <>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1 }}>
              PROPRIETÀ
            </span>
            <PageProps
              name={currentPage?.name ?? ""}
              background={currentPage?.background ?? "#1a1a2e"}
              background_dark={currentPage?.background_dark}
              width={currentPage?.width}
              height={currentPage?.height}
              auto_rotate_skip={currentPage?.auto_rotate_skip}
              zones={currentPage?.zones}
              locked={currentPage?.locked}
              sizeMode={effectiveSizeMode(project?.page_layout)}
              onChange={(patch) => updatePageProps(currentPageId, patch)}
            />
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginTop: 8, display: "block" }}>
              IMPOSTAZIONI PROGETTO
            </span>
            <ProjectPageLayoutSettings />
          </>
        )}
        </fieldset>
      </aside>
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      </div>
    </div>
  );
}

// ── Keyboard shortcut help overlay ───────────────────────────────────────────

const SHORTCUTS = [
  ["shortcut.navCanvas", ""],
  ["Ctrl + rotella",    "shortcut.zoomCursor"],
  ["Rotella",           "shortcut.panV"],
  ["Shift + rotella",   "shortcut.panH"],
  ["Click medio + drag","shortcut.panFree"],
  ["Ctrl+0",            "shortcut.zoomReset"],
  ["Ctrl+Shift+0",      "shortcut.zoomFit"],
  ["shortcut.selection", ""],
  ["Click",             "shortcut.selectObj"],
  ["Shift+click",       "shortcut.toggleSel"],
  ["Drag su sfondo",    "shortcut.rubberBand"],
  ["Ctrl+A",            "shortcut.selectAll"],
  ["shortcut.edit", ""],
  ["Canc / Backspace",  "shortcut.deleteSel"],
  ["Ctrl+C",            "shortcut.copy"],
  ["Ctrl+X",            "shortcut.cut"],
  ["Ctrl+V",            "shortcut.paste"],
  ["Ctrl+D",            "shortcut.duplicate"],
  ["Ctrl+Z",            "shortcut.undo"],
  ["Ctrl+Y",            "shortcut.redo"],
  ["Frecce",            "shortcut.move1px"],
  ["Shift+Frecce",      "shortcut.moveGrid"],
  ["Shift + drag angolo", "shortcut.resizeAspect"],
  ["Z-order", ""],
  ["Ctrl+]",            "shortcut.bringForward"],
  ["Ctrl+Shift+]",      "shortcut.bringFront"],
  ["Ctrl+[",            "shortcut.sendBackward"],
  ["Ctrl+Shift+[",      "shortcut.sendBack"],
  ["shortcut.groups", ""],
  ["Ctrl+G",            "shortcut.group"],
  ["shortcut.other", ""],
  ["?",                 "shortcut.toggleHelp"],
];

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)", display: "flex",
        alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
          padding: "20px 28px", minWidth: 400, maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("shortcut.title")}</span>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 16, lineHeight: 1 }}
          >×</button>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <tbody>
            {SHORTCUTS.map(([key, desc]) =>
              desc === "" ? (
                <tr key={key}>
                  <td colSpan={2} style={{ color: "var(--brand-border, #475569)", fontWeight: 700, fontSize: 10,
                    letterSpacing: 0.5, textTransform: "uppercase", paddingTop: 10, paddingBottom: 4 }}>
                    {t(key)}
                  </td>
                </tr>
              ) : (
                <tr key={key} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <td style={{ padding: "5px 12px 5px 0", color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace",
                    whiteSpace: "nowrap", minWidth: 160 }}>
                    {key}
                  </td>
                  <td style={{ padding: "5px 0", color: "var(--brand-text-2, #cbd5e1)" }}>{t(desc)}</td>
                </tr>
              )
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Z-order bar ───────────────────────────────────────────────────────────────

function ZOrderBar({
  id,
  objectCount,
  onReorder,
}: {
  id: string;
  objectCount: number;
  onReorder: (id: string, dir: "front" | "forward" | "backward" | "back") => void;
}) {
  const { t } = useTranslation();
  if (objectCount < 2) return null;
  const btnStyle: React.CSSProperties = {
    background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)",
    borderRadius: 3, cursor: "pointer", fontSize: 11, padding: "2px 6px",
    flex: 1, textAlign: "center" as const,
  };
  return (
    <div style={{ display: "flex", gap: 3, marginBottom: 6 }}>
      <button style={btnStyle} title={t("props.bringToFront")} onClick={() => onReorder(id, "front")}>⬆⬆</button>
      <button style={btnStyle} title={t("props.forward")} onClick={() => onReorder(id, "forward")}>↑</button>
      <button style={btnStyle} title={t("props.backward")} onClick={() => onReorder(id, "backward")}>↓</button>
      <button style={btnStyle} title={t("props.sendToBack")} onClick={() => onReorder(id, "back")}>⬇⬇</button>
    </div>
  );
}

// ── Panel breadcrumb ──────────────────────────────────────────────────────────

/** Breadcrumb chip. A plain string is non-interactive; an object with
 *  `onClick` becomes a small button that lets the user step "up" one
 *  level of the selection hierarchy (typically: child → cell → grid). */
type BreadcrumbPart = string | { label: string; onClick?: () => void };

function PanelBreadcrumb({ parts }: { parts: BreadcrumbPart[] }) {
  const { t } = useTranslation();
  return (
    <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginBottom: 6, display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
      {parts.map((p, i) => {
        const part = typeof p === "string" ? { label: p } : p;
        const isLast = i === parts.length - 1;
        const clickable = !isLast && !!part.onClick;
        return (
          <span key={i} style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {i > 0 && <span style={{ color: "var(--brand-surface-2, #334155)" }}>›</span>}
            {clickable ? (
              <button
                type="button"
                onClick={part.onClick}
                title={t("props.backToLevel")}
                style={{
                  background: "transparent", border: "none", padding: 0,
                  color: "var(--brand-primary, #3b82f6)", cursor: "pointer", fontSize: 10,
                  textDecoration: "underline dotted",
                  font: "inherit",
                }}
              >
                {part.label}
              </button>
            ) : (
              <span style={{ color: isLast ? "var(--brand-text-muted, #94a3b8)" : "var(--brand-border, #475569)" }}>{part.label}</span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/** Compact accordion section. Open/closed state persists in localStorage
 *  per `storageKey`, so switching between selected objects doesn't reset
 *  the user's preference. Body is only rendered when open (cheap collapse
 *  for sections that contain expensive UI like color pickers or galleries). */
function CollapsibleSection({
  title, storageKey, defaultOpen = false, headerExtra, hint, children,
}: {
  title: string;
  storageKey?: string;
  defaultOpen?: boolean;
  /** Right-aligned slot next to the title (e.g. count badge "(2)"). */
  headerExtra?: React.ReactNode;
  /** Shown italic below the header when the section is collapsed. Use to
   *  signal "section visible but currently not applicable", e.g. "Imposta
   *  un tag per personalizzare i colori". */
  hint?: string;
  children: React.ReactNode;
}) {
  const lsKey = storageKey ? `sws.objprops.${storageKey}` : null;
  const [open, setOpen] = useState<boolean>(() => {
    if (lsKey) {
      try {
        const v = localStorage.getItem(lsKey);
        if (v === "1") return true;
        if (v === "0") return false;
      } catch { /* ignore */ }
    }
    return defaultOpen;
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      if (lsKey) {
        try { localStorage.setItem(lsKey, next ? "1" : "0"); } catch { /* ignore */ }
      }
      return next;
    });
  };
  return (
    <div style={{ borderTop: "1px solid var(--brand-surface, #1e293b)", paddingTop: 4, marginTop: 4 }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 6,
          background: "transparent", border: "none", padding: "4px 0",
          color: "var(--brand-text-muted, #94a3b8)", fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
          textAlign: "left", cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 9, color: "var(--brand-text-subtle, #64748b)", width: 10 }}>{open ? "▼" : "▶"}</span>
        <span style={{ flex: 1, textTransform: "uppercase" }}>{title}</span>
        {headerExtra}
      </button>
      {!open && hint && (
        <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", fontStyle: "italic", margin: "0 0 4px 16px" }}>
          {hint}
        </div>
      )}
      {open && <div style={{ paddingLeft: 4, paddingBottom: 4 }}>{children}</div>}
    </div>
  );
}

/** Walk `cell.sub.a|b.sub.a|b...` along `path` and return the leaf entry.
 *  Returns an empty entry `{}` for slots that exist in the structure but
 *  haven't been materialised yet (just split, no content added) — the
 *  panel needs to treat them as editable. Returns null only when the
 *  path itself is no longer valid (cell un-split, etc.). */
function resolveSubCellEntry(cell: GridCell | undefined, path: ("a" | "b")[]): SubCellEntry | null {
  if (!cell || path.length === 0) return null;
  let sub: SubGrid | undefined = cell.sub;
  let entry: SubCellEntry | undefined;
  for (const slot of path) {
    if (!sub) return null;
    entry = sub[slot];
    sub = entry?.sub;
  }
  return entry ?? {};
}

/** Return the `SubGrid` that owns the slot addressed by `path`. For path
 *  length 1, that's `cell.sub`; for deeper paths, the parent SubGrid is
 *  reached by walking path[0..-2]. Returns null if the path is broken. */
function resolveParentSubGrid(cell: GridCell | undefined, path: ("a" | "b")[]): SubGrid | null {
  if (!cell || path.length === 0) return null;
  let sub: SubGrid | undefined = cell.sub;
  for (let i = 0; i < path.length - 1; i++) {
    if (!sub) return null;
    sub = sub[path[i]]?.sub;
  }
  return sub ?? null;
}

// ── Cell range / structure action toolbars ────────────────────────────────────

const ACT_BTN: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)",
  padding: "4px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11,
};

function CellRangeMergeActions({ onMerge, onCancel }: {
  onMerge: () => void;
  onCancel: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
      <button onClick={onMerge} style={{ ...ACT_BTN, background: "#0f766e", borderColor: "#14b8a6" }}>
        🔗 Unisci celle
      </button>
      <button onClick={onCancel} style={ACT_BTN}>
        Annulla selezione
      </button>
    </div>
  );
}

function SubCellAddChild({ onAdd }: { onAdd: (type: string) => void }) {
  const [type, setType] = useState("rect");
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>
        Aggiungi un oggetto in questo slot:
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <select
          style={{ ...INPUT, flex: 1, cursor: "pointer" }}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {CELL_CHILD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <button
          onClick={() => onAdd(type)}
          style={{ background: "#1d4ed8", border: "1px solid var(--brand-primary-hover, #2563eb)", color: "#bfdbfe", borderRadius: 4, cursor: "pointer", fontSize: 12, padding: "2px 10px", flexShrink: 0 }}
        >
          + Aggiungi
        </button>
      </div>
      <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "4px 0 0" }}>
        Oppure: copia un oggetto dalla pagina (Ctrl+C) e premi Ctrl+V con la cella padre selezionata.
      </p>
    </div>
  );
}

function CellStructureActions({ isMerged, isSplit, onUnmerge, onSplitRows, onSplitCols, onJoinSplit }: {
  isMerged: boolean;
  isSplit: boolean;
  onUnmerge: () => void;
  onSplitRows: () => void;
  onSplitCols: () => void;
  onJoinSplit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
      {isMerged && (
        <button onClick={onUnmerge} style={ACT_BTN}>
          ↔ Annulla unione
        </button>
      )}
      {!isMerged && !isSplit && (
        <>
          <button onClick={onSplitRows} style={ACT_BTN} title={t("props.splitV")}>
            ⬓ Dividi orizzontalmente
          </button>
          <button onClick={onSplitCols} style={ACT_BTN} title={t("props.splitH")}>
            ⬔ Dividi verticalmente
          </button>
        </>
      )}
      {isSplit && (
        <button onClick={onJoinSplit} style={ACT_BTN}>
          ⌧ Rimuovi split
        </button>
      )}
    </div>
  );
}

// ── Page properties (shown when nothing selected) ─────────────────────────────

function PageProps({
  name,
  background,
  background_dark,
  width,
  height,
  auto_rotate_skip,
  zones,
  locked,
  sizeMode,
  onChange,
}: {
  name: string;
  background: string;
  background_dark?: string;
  width?: number;
  height?: number;
  auto_rotate_skip?: boolean;
  zones?: string[];
  locked?: boolean;
  sizeMode: PageSizeMode;
  onChange: (patch: Partial<{ name: string; background: string; background_dark: string | undefined; width: number | undefined; height: number | undefined; auto_rotate_skip: boolean | undefined; zones: string[] | undefined }>) => void;
}) {
  const { t } = useTranslation();
  const ro = !!locked; // read-only when the page is locked
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--brand-border, #475569)", marginBottom: 4 }}>{t("props.pageT")}</div>
      {locked && (
        <div style={{ fontSize: 11, color: "var(--brand-warning, #f59e0b)", background: "#451a0322", border: "1px solid #92400e", borderRadius: 4, padding: "4px 8px", marginBottom: 8 }}>
          🔒 Pagina bloccata — sola lettura. Sblocca dall'elenco pagine per modificare.
        </div>
      )}
      <div>
        <div style={LABEL}>Nome</div>
        <input
          type="text"
          style={INPUT}
          value={name}
          disabled={ro}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <div style={LABEL}>{t("props.backgroundLight")}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
            value={background}
            disabled={ro}
            onChange={(e) => onChange({ background: e.target.value })}
          />
          <input
            type="text"
            style={{ ...INPUT }}
            value={background}
            disabled={ro}
            onChange={(e) => onChange({ background: e.target.value })}
          />
        </div>
      </div>
      <div>
        <div style={LABEL}>{t("props.backgroundDark")}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
            value={background_dark || background}
            disabled={ro}
            onChange={(e) => onChange({ background_dark: e.target.value })}
          />
          <input
            type="text"
            style={{ ...INPUT }}
            value={background_dark ?? ""}
            placeholder={background}
            disabled={ro}
            onChange={(e) => onChange({ background_dark: e.target.value || undefined })}
          />
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
        DIMENSIONI PAGINA
      </div>
      {sizeMode === "fixed" && (
        <>
          <div style={{ marginBottom: 6 }}>
            <div style={LABEL}>Preset dispositivo</div>
            <select
              disabled={ro}
              style={{ ...INPUT, cursor: ro ? "default" : "pointer" }}
              value=""
              onChange={(e) => {
                const preset = getDevicePresets().find((d) => d.label === e.target.value);
                if (preset) onChange({ width: preset.width, height: preset.height });
              }}
            >
              <option value="">Personalizzato…</option>
              <optgroup label="Standard">
                {STANDARD_DEVICE_PRESETS.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
              </optgroup>
              {getBrand().devicePresets.length > 0 && (
                <optgroup label={getBrand().shortName}>
                  {getBrand().devicePresets.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
                </optgroup>
              )}
            </select>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
            <div>
              <div style={LABEL}>{t("props.widthPx")}</div>
              <input
                type="number"
                style={INPUT}
                disabled={ro}
                placeholder={t("props.fluid")}
                value={width ?? ""}
                onChange={(e) => onChange({ width: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <div>
              <div style={LABEL}>{t("props.heightPx")}</div>
              <input
                type="number"
                style={INPUT}
                disabled={ro}
                placeholder={t("props.fluid")}
                value={height ?? ""}
                onChange={(e) => onChange({ height: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 0" }}>
            Dimensione esatta (1:1, nessuno scaling a runtime). Un bordo tratteggiato blu indica i limiti della pagina.
          </p>
        </>
      )}
      {sizeMode === "ratio" && (
        <p style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", margin: "0 0 4px" }}>
          Dimensione fissata dalle <em>Impostazioni pagine del progetto</em> (rapporto comune a
          tutte le pagine): {width ?? "—"}×{height ?? "—"}. Scala mantenendo le proporzioni a runtime.
        </p>
      )}
      {sizeMode === "fluid" && (
        <p style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", margin: "0 0 4px" }}>
          Nessuna dimensione dichiarata (modalità Fluida): il contenuto si disegna 1:1 nella
          viewport disponibile, senza scaling né confini.
        </p>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
        <input
          type="checkbox"
          id="auto-rotate-skip"
          checked={auto_rotate_skip ?? false}
          disabled={ro}
          onChange={(e) => onChange({ auto_rotate_skip: e.target.checked || undefined })}
          style={{ cursor: "pointer" }}
        />
        <label htmlFor="auto-rotate-skip" style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
          Escludi dal ciclo automatico (kiosk)
        </label>
      </div>
      <div style={{ marginTop: 8 }}>
        <div style={LABEL}>{t("props.zonesAll")}</div>
        <input
          type="text"
          style={INPUT}
          disabled={ro}
          placeholder={t("props.zonesPlaceholder")}
          title={t("props.zonesHint")}
          value={(zones ?? []).join(", ")}
          onChange={(e) => {
            const zlist = e.target.value ? e.target.value.split(",").map((z) => z.trim()).filter(Boolean) : undefined;
            onChange({ zones: zlist });
          }}
        />
      </div>
      <p style={{ fontSize: 11, color: "var(--brand-border, #475569)", margin: "8px 0 0" }}>
        Seleziona un oggetto sul canvas per modificarne le proprietà.
      </p>
    </>
  );
}

// ── Project-wide page layout settings ─────────────────────────────────────────
// Size mode (Fixed/Ratio/Fluid) + aspect ratio + home page + hide-chrome. Era
// un modale dietro un'icona ⚙ poco visibile nel pannello sinistro — spostato
// qui, sezione a sé nel pannello destro (non fusa con "Proprietà" della
// pagina corrente: queste impostazioni valgono per l'intero progetto, non
// solo per la pagina selezionata). Salvataggio esplicito e separato dal
// salvataggio a batch delle pagine — non un compromesso di comodità: lo
// stesso store dichiara (store/index.ts) che i setter `updateProject*` sono
// deliberatamente non dirty-tracked, per non rompere il tracking pensato per
// `pagesRev`/`savedPagesRev`.
function ProjectPageLayoutSettings() {
  const project = useAppStore((s) => s.project);
  const pages = useAppStore((s) => s.pages);
  const updateProjectPageLayout = useAppStore((s) => s.updateProjectPageLayout);
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const [sizeMode, setSizeMode] = useState<PageSizeMode>(project?.page_layout?.size_mode ?? "fixed");
  const [aspectRatio, setAspectRatio] = useState<string>(project?.page_layout?.aspect_ratio ?? ASPECT_RATIOS[0].ratio);
  const [homePageId, setHomePageId] = useState<string>(project?.page_layout?.home_page_id ?? "");
  const [hideChrome, setHideChrome] = useState<boolean>(project?.page_layout?.hide_viewer_chrome ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ref = referenceResolutionFor(aspectRatio);

  const handleSave = async () => {
    setSaving(true); setError(null);
    const cfg: PageLayoutConfig = {
      size_mode: sizeMode,
      aspect_ratio: sizeMode === "ratio" ? aspectRatio : undefined,
      home_page_id: homePageId || undefined,
      hide_viewer_chrome: hideChrome || undefined,
    };
    try {
      await api.updatePageLayout(cfg);
      updateProjectPageLayout(cfg);
      // "Ratio" mode: every page must share the same standard reference
      // resolution — otherwise a page with a stale literal width/height
      // (e.g. 800×480, a different ratio) would letterbox-scale against the
      // WRONG aspect ratio at runtime. Client-side only; the maintainer still
      // saves the project explicitly like any other canvas edit.
      if (sizeMode === "ratio") {
        for (const p of pages) updatePageProps(p.id, { width: ref.width, height: ref.height });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
      <div>
        <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }}>Modalità dimensionamento</div>
        {([
          { v: "fixed" as const, label: "Fisso (1:1, nessuno scaling)" },
          { v: "ratio" as const, label: "Solo proporzioni (scala mantenendo il rapporto)" },
          { v: "fluid" as const, label: "Fluido (nessuna dimensione dichiarata)" },
        ]).map((opt) => (
          <label key={opt.v} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", padding: "4px 0", cursor: "pointer" }}>
            <input type="radio" name="sizeMode" checked={sizeMode === opt.v} onChange={() => setSizeMode(opt.v)} />
            {opt.label}
          </label>
        ))}
      </div>

      {sizeMode === "ratio" && (
        <div>
          <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Rapporto</div>
          <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}
            style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12, width: "100%" }}>
            {ASPECT_RATIOS.map((a) => <option key={a.ratio} value={a.ratio}>{a.label}</option>)}
          </select>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>
            Risoluzione di riferimento: {ref.width}×{ref.height}
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 }}>Pagina iniziale (home)</div>
        <select value={homePageId} onChange={(e) => setHomePageId(e.target.value)}
          style={{ background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 8px", fontSize: 12, width: "100%" }}>
          <option value="">— Prima pagina della lista —</option>
          {pages.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      <div>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
          <input type="checkbox" checked={hideChrome} onChange={(e) => setHideChrome(e.target.checked)}
            style={{ marginTop: 2, accentColor: "var(--brand-primary, #3b82f6)" }} />
          <span>
            Viewer a schermo pieno: nascondi barra superiore e fascia allarmi
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 3, lineHeight: 1.45 }}>
              Sul pannello viene renderizzata solo l'area della pagina. Gli allarmi
              attivi compaiono sovrapposti, senza rubare spazio. <strong>Attenzione</strong>:
              senza la barra la navigazione tra pagine può avvenire solo con oggetti
              "Pulsante pagina" sul synoptic o con la rotazione automatica.
            </div>
          </span>
        </label>
      </div>

      {error && <div style={{ color: "var(--brand-danger, #ef4444)", fontSize: 12 }}>Errore: {error}</div>}

      <button style={{ alignSelf: "flex-start", background: "var(--brand-success-bg, #166534)", color: "#bbf7d0", border: "1px solid #15803d", borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontSize: 13 }} disabled={saving} onClick={handleSave}>
        {saving ? "Salvataggio…" : "Salva impostazioni progetto"}
      </button>
    </div>
  );
}

// ── Multi-selection properties (alignment toolbar) ────────────────────────────

function MultiSelectionProps({
  count,
  selectedObjects,
  mergedProps,
  mixedKeys,
  allSameType,
  pages,
  functions,
  onAlign,
  onDuplicate,
  onDelete,
  onBatchChange,
}: {
  count: number;
  selectedObjects: SynopticObject[];
  mergedProps: Partial<SynopticObject>;
  mixedKeys: Set<keyof SynopticObject>;
  allSameType: boolean;
  pages: { id: string; name: string }[];
  functions: FunctionDef[];
  onAlign: (mode: AlignMode) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBatchChange: (patch: Partial<SynopticObject>) => void;
}) {
  const { t } = useTranslation();
  const btn: React.CSSProperties = {
    background: "var(--brand-bg, #0f172a)",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    color: "var(--brand-text-2, #cbd5e1)",
    cursor: "pointer",
    fontSize: 13,
    padding: "6px 0",
    flex: 1,
  };
  return (
    <>
      <div style={{ fontSize: 11, color: "var(--brand-border, #475569)", marginBottom: 4 }}>
        Selezione multipla
      </div>
      <div style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", marginBottom: 4 }}>
        {count} oggetti selezionati
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, fontWeight: 700, letterSpacing: 0.5 }}>
        ALLINEA ORIZZONTALE
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title={t("props.alignLeft")}   onClick={() => onAlign("left")}>⇤</button>
        <button style={btn} title={t("props.centerH")}   onClick={() => onAlign("center-x")}>↔</button>
        <button style={btn} title={t("props.alignRight")}     onClick={() => onAlign("right")}>⇥</button>
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>
        ALLINEA VERTICALE
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title={t("props.alignTop")}      onClick={() => onAlign("top")}>⤒</button>
        <button style={btn} title={t("props.centerV")}     onClick={() => onAlign("middle-y")}>↕</button>
        <button style={btn} title={t("props.alignBottom")}     onClick={() => onAlign("bottom")}>⤓</button>
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>
        DISTRIBUISCI (≥3 oggetti)
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title={t("props.distributeH")} onClick={() => onAlign("distribute-x")}>⇔</button>
        <button style={btn} title={t("props.distributeV")}   onClick={() => onAlign("distribute-y")}>⇕</button>
      </div>

      {/* F8.1 — uniforma le dimensioni al primo oggetto selezionato. */}
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>
        {t("props.matchSize")}
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title={t("props.matchWidth")}  onClick={() => onAlign("match-width")}>↔=</button>
        <button style={btn} title={t("props.matchHeight")} onClick={() => onAlign("match-height")}>↕=</button>
      </div>

      <div style={{ height: 1, background: "var(--brand-surface-2, #334155)", margin: "8px 0" }} />

      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ ...btn, background: "#1e3a8a", color: "#bfdbfe" }} onClick={onDuplicate}>
          Duplica
        </button>
        <button style={{ ...btn, background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", borderColor: "#991b1b" }} onClick={onDelete}>
          Elimina
        </button>
      </div>

      <div style={{ height: 1, background: "var(--brand-surface-2, #334155)", margin: "8px 0" }} />

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", fontWeight: 700, letterSpacing: 0.5 }}>
        PROPRIETÀ COMUNI
      </div>
      <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 6px" }}>
        {allSameType
          ? `Tipo "${selectedObjects[0].type}" — campi vuoti = valori diversi (vari).`
          : "Tipi diversi — solo sezioni universali."}
      </p>

      {allSameType ? (
        <ObjectProps
          obj={{ id: "__multi__", type: selectedObjects[0].type, x: 0, y: 0, ...mergedProps } as SynopticObject}
          pages={pages}
          functions={functions}
          mixedKeys={mixedKeys}
          onChange={onBatchChange}
          onDelete={onDelete}
        />
      ) : (
        <CrossTypeProps
          mergedProps={mergedProps}
          mixedKeys={mixedKeys}
          functions={functions}
          onChange={onBatchChange}
        />
      )}

      <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8 }}>
        Shift+click per aggiungere/togliere dalla selezione. Ctrl-C/V, Ctrl-D,
        Ctrl-Z/Y, Canc come scorciatoie.
      </p>
    </>
  );
}

// ── Cross-type properties (shown when selection has mixed types) ──────────────

function CrossTypeProps({
  mergedProps,
  mixedKeys,
  functions,
  onChange,
}: {
  mergedProps: Partial<SynopticObject>;
  mixedKeys: Set<keyof SynopticObject>;
  functions: FunctionDef[];
  onChange: (patch: Partial<SynopticObject>) => void;
}) {
  const { t } = useTranslation();
  const field = (label: string, content: React.ReactNode) => (
    <div key={label}>
      <div style={LABEL}>{label}</div>
      {content}
    </div>
  );
  const isMixed = (k: keyof SynopticObject) => mixedKeys.has(k);

  const numInput = (k: keyof SynopticObject, fallback: number) => (
    <input
      type="number"
      style={INPUT}
      value={isMixed(k) ? "" : (mergedProps[k] !== undefined ? (mergedProps[k] as number) : fallback)}
      placeholder={isMixed(k) ? "(vari)" : undefined}
      onChange={(e) => onChange({ [k]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<SynopticObject>)}
    />
  );

  const textInput = (k: keyof SynopticObject, placeholder?: string) => (
    <input
      type="text"
      style={INPUT}
      placeholder={isMixed(k) ? "(vari)" : placeholder}
      value={isMixed(k) ? "" : ((mergedProps[k] as string) ?? "")}
      onChange={(e) => onChange({ [k]: e.target.value } as Partial<SynopticObject>)}
    />
  );

  const tagInput = (k: keyof SynopticObject, placeholder?: string) => (
    <TagInput
      style={INPUT}
      placeholder={isMixed(k) ? "(vari)" : placeholder}
      value={isMixed(k) ? "" : ((mergedProps[k] as string) ?? "")}
      onChange={(v) => onChange({ [k]: v } as Partial<SynopticObject>)}
    />
  );

  const colorInput = (k: keyof SynopticObject, fallback: string) => {
    const mixed = isMixed(k);
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none", opacity: mixed ? 0.4 : 1 }}
          value={mixed ? "#808080" : ((mergedProps[k] as string) ?? fallback)}
          onChange={(e) => onChange({ [k]: e.target.value } as Partial<SynopticObject>)}
        />
        <input
          type="text"
          style={INPUT}
          placeholder={mixed ? "(vari)" : undefined}
          value={mixed ? "" : ((mergedProps[k] as string) ?? fallback)}
          onChange={(e) => onChange({ [k]: e.target.value } as Partial<SynopticObject>)}
        />
      </div>
    );
  };

  const grid2: React.CSSProperties = { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 };

  return (
    <>
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, fontWeight: 700, letterSpacing: 0.5 }}>POSIZIONE</div>
      <div style={grid2}>
        {field(t("props.xLabel"), numInput("x", 0))}
        {field(t("props.yLabel"), numInput("y", 0))}
        {field(t("props.width"), numInput("width", 100))}
        {field(t("props.height"), numInput("height", 40))}
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>ASPETTO</div>
      {field(t("props.fill"), colorInput("fill", "var(--brand-primary, #3b82f6)"))}
      {field(t("props.stroke"), colorInput("stroke", "#ffffff"))}
      <div style={grid2}>
        {field(t("props.strokeW"), numInput("stroke_width", 1))}
        {field(t("props.opacity"), numInput("opacity", 1))}
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>TRASFORMAZIONE</div>
      <div style={grid2}>
        {field(t("props.rotationDegSym"), numInput("rotation", 0))}
        {field(t("props.zIndex"), numInput("z_index", 0))}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
          <input type="checkbox"
            checked={!isMixed("flip_h") && !!(mergedProps.flip_h)}
            onChange={(e) => onChange({ flip_h: e.target.checked })}
            style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
          /> Flip H
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
          <input type="checkbox"
            checked={!isMixed("flip_v") && !!(mergedProps.flip_v)}
            onChange={(e) => onChange({ flip_v: e.target.checked })}
            style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
          /> Flip V
        </label>
      </div>
      {field(t("props.transition"), numInput("transition_duration_ms", 0))}

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>VISIBILITÀ</div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox"
          checked={!isMixed("visible") && mergedProps.visible !== false}
          onChange={(e) => onChange({ visible: e.target.checked })}
          style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
        /> Visibile
      </label>
      {field(t("props.tagVisibility"), tagInput("visible_tag", "tag.bool…"))}

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>TAG</div>
      {field(t("props.tag"), tagInput("tag", "tag.id…"))}
      {field(t("props.format"), textInput("format", "{value}"))}

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>INDICATORE QUALITÀ</div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox"
          checked={!isMixed("quality_dot") && mergedProps.quality_dot !== false}
          onChange={(e) => onChange({ quality_dot: e.target.checked ? undefined : false })}
          style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
        /> Mostra indicatore qualità
      </label>
      {mergedProps.quality_dot !== false && (
        <>
          {field(t("props.colorGood"), colorInput("quality_dot_good_color", "var(--brand-success, #22c55e)"))}
          {field(t("props.colorUncertain"), colorInput("quality_dot_uncertain_color", "var(--brand-warning, #eab308)"))}
          {field(t("props.colorBad"), colorInput("quality_dot_bad_color", "var(--brand-danger, #ef4444)"))}
        </>
      )}

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, fontWeight: 700, letterSpacing: 0.5 }}>EVENTI</div>
      <EventFunctionPicker
        label="Al click (on_press)"
        fnName={(mergedProps.on_press_fn as string | undefined)}
        args={mergedProps.on_press_args}
        functions={functions}
        onChange={(fn, args) => onChange({ on_press_fn: fn, on_press_args: args })}
      />
      <EventFunctionPicker
        label="Al rilascio (on_release)"
        fnName={(mergedProps.on_release_fn as string | undefined)}
        args={mergedProps.on_release_args}
        functions={functions}
        onChange={(fn, args) => onChange({ on_release_fn: fn, on_release_args: args })}
      />
    </>
  );
}

// ── Object properties ─────────────────────────────────────────────────────────

function ObjectProps({
  obj,
  pages,
  functions,
  mixedKeys = new Set<keyof SynopticObject>(),
  onChange,
  onDelete,
}: {
  obj: SynopticObject;
  pages: { id: string; name: string }[];
  functions: FunctionDef[];
  /** Keys whose values differ across a multi-selection — inputs show as empty with "(vari)" placeholder. */
  mixedKeys?: Set<keyof SynopticObject>;
  onChange: (p: Partial<SynopticObject>) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  // D (2026-08-23): cattura waypoint dal canvas — stato condiviso nello store.
  const capturePathTarget = useAppStore((st) => st.capturePathTarget);
  const setCapturePathTarget = useAppStore((st) => st.setCapturePathTarget);
  const setMotionMarker = useAppStore((st) => st.setMotionMarker);
  const [imgBrowserOpen, setImgBrowserOpen] = useState(false);
  // Immagini di progetto per la sezione SFONDO: lista lazy (solo quando la
  // sezione esiste per il tipo selezionato) + input file per l'upload.
  const [projectImages, setProjectImages] = useState<{ name: string; size_bytes: number }[] | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const bgFileRef = useRef<HTMLInputElement | null>(null);
  const projLangs = useAppStore((s) => s.project?.languages?.langs) ?? [];
  const faceplates = useAppStore((s) => s.faceplates);
  // NB: selezionare l'array `entries` (riferimento stabile nello store) e
  // derivare le chiavi in useMemo. Un selettore che fa `.map()` ritornerebbe
  // un nuovo array a ogni render → snapshot instabile → loop infinito e crash
  // del pannello (regressione T-40).
  const langEntries = useAppStore((s) => s.project?.languages?.entries);
  const langKeys = useMemo(() => langEntries?.map((e) => e.key).filter(Boolean) ?? [], [langEntries]);

  const field = (label: string, content: React.ReactNode) => (
    <div key={label}>
      <div style={LABEL}>{label}</div>
      {content}
    </div>
  );

  const numInput = (key: keyof SynopticObject, fallback: number) => (
    <input
      type="number"
      style={INPUT}
      value={mixedKeys.has(key) ? "" : (obj[key] !== undefined ? (obj[key] as number) : fallback)}
      placeholder={mixedKeys.has(key) ? "(vari)" : undefined}
      onChange={(e) => onChange({ [key]: e.target.value === "" ? undefined : Number(e.target.value) } as Partial<SynopticObject>)}
    />
  );

  const textInput = (key: keyof SynopticObject, placeholder?: string) => (
    <input
      type="text"
      style={INPUT}
      placeholder={mixedKeys.has(key) ? "(vari)" : placeholder}
      value={mixedKeys.has(key) ? "" : ((obj[key] as string) ?? "")}
      onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
    />
  );

  const tagInput = (placeholder?: string) => (
    <TagInput
      style={INPUT}
      placeholder={mixedKeys.has("tag") ? "(vari)" : placeholder}
      value={mixedKeys.has("tag") ? "" : (obj.tag ?? "")}
      onChange={(v) => onChange({ tag: v })}
    />
  );

  const colorInput = (key: keyof SynopticObject, fallback: string) => {
    const mixed = mixedKeys.has(key);
    return (
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          type="color"
          style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none", opacity: mixed ? 0.4 : 1 }}
          value={mixed ? "#808080" : ((obj[key] as string) ?? fallback)}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
        />
        <input
          type="text"
          style={INPUT}
          placeholder={mixed ? "(vari)" : undefined}
          value={mixed ? "" : ((obj[key] as string) ?? fallback)}
          onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
        />
      </div>
    );
  };

  /** Severity checkbox row shared by every alarm-display widget
   *  (alarm_bell, alarm_banner, alarm_viewer) — previously copy-pasted
   *  per widget (and missing entirely for alarm_viewer, despite the
   *  underlying field/renderer support already existing there). */
  const severityFilterField = (key: "alarm_bell_severities" | "alarm_banner_severities" | "alarm_viewer_severities") => (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {(["Info", "Warning", "Critical"] as const).map((sev) => {
        const list = (obj[key] as AlarmSeverity[] | undefined) ?? [];
        const checked = list.length === 0 || list.includes(sev);
        return (
          <label key={sev} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => {
                const all: AlarmSeverity[] = ["Info", "Warning", "Critical"];
                const current = list.length === 0 ? all : list;
                const next = e.target.checked ? [...current, sev] : current.filter((s) => s !== sev);
                onChange({ [key]: next.length === all.length ? undefined : next } as Partial<SynopticObject>);
              }}
            />{sev}
          </label>
        );
      })}
    </div>
  );

  /** "VOCI" editor shared by text_list and state_lamp — both drive a shape/text
   *  purely off the same text_list_entries field (value → label → color). */
  // Sovrapposizione/buco fra la voce `i` e la sua vicina numerica successiva
  // (ordinate per value_min, non per ordine nell'array — l'array resta ciò
  // che decide chi vince in caso di sovrapposizione reale, vedi
  // matchTextListEntry in SvgCanvas.tsx; qui serve solo a capire cosa è
  // "adiacente" numericamente). Solo per voci con un range impostato — le
  // voci a valore esatto sono un punto, non un intervallo, restano fuori.
  // Il confine è semi-aperto (min ≤ v < max) per scelta esplicita del
  // maintainer: nessun cambio di semantica qui, solo comunicarla meglio.
  const rangeWarning = (entries: TextListEntry[] | undefined, i: number): string | null => {
    const list = entries ?? [];
    const e = list[i];
    if (!e || (e.value_min === undefined && e.value_max === undefined)) return null;
    const thisMax = e.value_max ?? Infinity;
    const ranged = list
      .map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => entry.value_min !== undefined || entry.value_max !== undefined)
      .sort((a, b) => (a.entry.value_min ?? -Infinity) - (b.entry.value_min ?? -Infinity));
    const pos = ranged.findIndex(({ idx }) => idx === i);
    const next = pos >= 0 ? ranged[pos + 1] : undefined;
    if (!next) return null;
    const nextMin = next.entry.value_min ?? -Infinity;
    const nextLabel = next.entry.label || "?";
    if (nextMin < thisMax) return `⚠ ${t("props.rangeOverlap", { label: nextLabel })}`;
    if (nextMin > thisMax) return `⚠ ${t("props.rangeGap", { from: thisMax, to: nextMin, label: nextLabel })}`;
    return null;
  };

  const textListEntriesField = () => (
    <>
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>VOCI</div>
      {(obj.text_list_entries ?? []).map((e, i) => {
        const warning = rangeWarning(obj.text_list_entries, i);
        return (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 6, padding: 4, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}>
          <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <input style={{ ...INPUT, width: 54 }} placeholder="val" value={String(e.value)}
              onChange={(ev) => {
                const raw = ev.target.value;
                const v = raw === "true" ? true : raw === "false" ? false : isNaN(Number(raw)) || raw === "" ? raw : Number(raw);
                const next = [...(obj.text_list_entries ?? [])]; next[i] = { ...e, value: v };
                onChange({ text_list_entries: next });
              }} />
            <input style={{ ...INPUT, flex: 1 }} placeholder={t("props.labelPh")} value={e.label}
              onChange={(ev) => { const next = [...(obj.text_list_entries ?? [])]; next[i] = { ...e, label: ev.target.value }; onChange({ text_list_entries: next }); }} />
            <input type="color" value={e.color ?? "var(--brand-text, #e2e8f0)"} title={t("props.colorText")}
              onChange={(ev) => { const next = [...(obj.text_list_entries ?? [])]; next[i] = { ...e, color: ev.target.value }; onChange({ text_list_entries: next }); }}
              style={{ width: 28, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, cursor: "pointer" }} />
            <button style={{ ...INPUT, width: "auto", padding: "0 6px", cursor: "pointer" }}
              onClick={() => { const next = (obj.text_list_entries ?? []).filter((_, j) => j !== i); onChange({ text_list_entries: next }); }}>✕</button>
          </div>
          {/* Range di validità opzionale — indentato sotto label+colore per
              suggerire che è un affinamento del "val" a sinistra, non un
              campo alla pari. Vuoti = confronto esatto su "val" come oggi.
              Notazione [min–max) esplicita: il max è escluso (semi-aperto),
              vedi rangeWarning sopra e props.rangeHint sotto per il perché. */}
          <div style={{ display: "flex", gap: 4, alignItems: "center", paddingLeft: 58 }}>
            <span style={{ fontSize: 11, color: "var(--brand-border, #475569)" }}>[</span>
            <input style={{ ...INPUT, width: 56 }} type="number" placeholder={t("props.rangeMin")}
              value={e.value_min ?? ""}
              onChange={(ev) => {
                const raw = ev.target.value;
                const next = [...(obj.text_list_entries ?? [])]; next[i] = { ...e, value_min: raw === "" ? undefined : Number(raw) };
                onChange({ text_list_entries: next });
              }} />
            <span style={{ fontSize: 10, color: "var(--brand-border, #475569)" }}>–</span>
            <input style={{ ...INPUT, width: 56 }} type="number" placeholder={t("props.rangeMax")}
              value={e.value_max ?? ""}
              onChange={(ev) => {
                const raw = ev.target.value;
                const next = [...(obj.text_list_entries ?? [])]; next[i] = { ...e, value_max: raw === "" ? undefined : Number(raw) };
                onChange({ text_list_entries: next });
              }} />
            <span style={{ fontSize: 11, color: "var(--brand-border, #475569)" }}>)</span>
          </div>
          {warning && (
            <div style={{ fontSize: 10, color: "var(--brand-warning, #f59e0b)", paddingLeft: 58 }}>
              {warning}
            </div>
          )}
        </div>
        );
      })}
      <button style={{ ...INPUT, width: "100%", cursor: "pointer", marginBottom: 4 }}
        onClick={() => onChange({ text_list_entries: [...(obj.text_list_entries ?? []), { value: 0, label: "Stato", color: "var(--brand-text, #e2e8f0)" }] })}>
        + Aggiungi voce
      </button>
      <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
        {t("props.rangeHint")}
      </p>
    </>
  );

  const BOX_TYPES = ["rect", "ellipse", "button", "navbutton", "checkbox", "radio", "slider", "gauge", "led", "progress_bar", "table", "trend", "symbol", "grid",
    // 2026-08-23: W/H per tutti i box-like (prima si ridimensionavano solo con le maniglie)
    "image", "xy_plot", "kpi_tile", "data_log", "alarm_viewer", "alarm_bell", "alarm_banner",
    "recipe_panel", "faceplate", "setpoint", "text_list", "state_lamp", "lang_button", "alarm_history",
    "lang_selector", "bar_chart", "pie_chart", "sparkline"];
  // F7.4: il testo entra fra i box-like solo col wrap attivo — senza wrap la
  // larghezza è stimata dal contenuto e i campi W/H non farebbero niente.
  const isShape = BOX_TYPES.includes(obj.type) || (obj.type === "text" && !!obj.text_wrap);
  const hasStroke = obj.type === "rect" || obj.type === "ellipse" || obj.type === "line";
  // Tipi che disegnano il layer di sfondo universale (bg_color/bg_image) in
  // SvgCanvas.tsx. Sottoinsieme iniziale scelto per coprire i pattern di
  // rendering più diversi; si estende insieme al rendering, non da solo.
  const BG_TYPES = [
    "rect", "text", "button", "gauge", "symbol", "trend",
    "ellipse", "navbutton", "lang_button", "lang_selector", "led", "state_lamp",
    "progress_bar", "slider", "setpoint", "checkbox", "radio", "table",
    "xy_plot", "text_list", "bar_chart", "pie_chart", "sparkline", "kpi_tile", "data_log",
    "alarm_bell", "alarm_banner", "recipe_panel", "grid", "image", "faceplate", "alarm_history",
  ];

  return (
    <>
      {/* Identità compatta — 1 riga "Nome [input]" + 1 riga "type · id".
          Sostituisce le 3 righe sparse precedenti per recuperare ~30 px. */}
      {field(t("props.name"),
        <input
          type="text" style={INPUT}
          placeholder={obj.type}
          value={obj.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
        />
      )}
      <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", margin: "-2px 0 6px", display: "flex", gap: 6 }}>
        <span style={{ background: "var(--brand-surface, #1e293b)", padding: "1px 6px", borderRadius: 3, color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>
          {obj.type}
        </span>
        <span style={{ fontFamily: "monospace" }}>{obj.id}</span>
      </div>

      {/* Position + Size — usa field() a larghezza piena per evitare overflow
          del pulsante BindableInput nelle celle strette del grid 2-colonne. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
        <div>
          <div style={LABEL}>X</div>
          <BindableInput obj={obj} propName="x" onChange={onChange}>{numInput("x", 0)}</BindableInput>
        </div>
        <div>
          <div style={LABEL}>Y</div>
          <BindableInput obj={obj} propName="y" onChange={onChange}>{numInput("y", 0)}</BindableInput>
        </div>
        {isShape && (
          <>
            <div>
              <div style={LABEL}>W</div>
              <BindableInput obj={obj} propName="width" onChange={onChange}>{numInput("width", 100)}</BindableInput>
            </div>
            <div>
              <div style={LABEL}>H</div>
              <BindableInput obj={obj} propName="height" onChange={onChange}>{numInput("height", 50)}</BindableInput>
            </div>
          </>
        )}
      </div>

      {/* Line endpoint */}
      {obj.type === "line" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
          <div>
            <div style={LABEL}>X2</div>
            <BindableInput obj={obj} propName="x2" onChange={onChange}>{numInput("x2", obj.x + 100)}</BindableInput>
          </div>
          <div>
            <div style={LABEL}>Y2</div>
            <BindableInput obj={obj} propName="y2" onChange={onChange}>{numInput("y2", obj.y)}</BindableInput>
          </div>
        </div>
      )}

      {/* Fill */}
      {(obj.type === "rect" || obj.type === "ellipse" || obj.type === "button" || obj.type === "navbutton") &&
        field(t("props.color"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "#4a90d9")}</BindableInput>)}

      {/* Stroke */}
      {hasStroke && (
        <>
          {field(t("props.border"), <BindableInput obj={obj} propName="stroke" onChange={onChange}>{colorInput("stroke", "var(--brand-text, #e2e8f0)")}</BindableInput>)}
          {field(t("props.borderThickness"), <BindableInput obj={obj} propName="stroke_width" onChange={onChange}>{numInput("stroke_width", 1)}</BindableInput>)}
        </>
      )}
      {/* F7.6 — il navbutton disegnava il bordo col colore primario del tema,
          non modificabile: stessi due campi degli altri tipi con bordo. */}
      {obj.type === "navbutton" && (
        <>
          {field(t("props.border"), <BindableInput obj={obj} propName="stroke" onChange={onChange}>{colorInput("stroke", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          {field(t("props.borderThickness"), <BindableInput obj={obj} propName="stroke_width" onChange={onChange}>{numInput("stroke_width", 1.5)}</BindableInput>)}
        </>
      )}

      {/* F7.6 — rifiniture di forma: raggio angoli, tratteggio, sfumatura. */}
      {(obj.type === "rect" || obj.type === "navbutton") &&
        field(t("props.cornerRadius"), numInput("corner_radius", 0))}
      {obj.type === "rect" && (
        <>
          {field(t("props.borderDash"),
            <select style={{ ...INPUT, cursor: "pointer" }}
              value={obj.stroke_dasharray ?? ""}
              onChange={(e) => onChange({ stroke_dasharray: e.target.value || undefined })}>
              <option value="">{t("props.dashSolid")}</option>
              <option value="6 3">{t("props.dashDashed")}</option>
              <option value="2 3">{t("props.dashDotted")}</option>
              <option value="10 4 2 4">{t("props.dashDashDot")}</option>
            </select>
          )}
          {field(t("props.gradient"),
            <select style={{ ...INPUT, cursor: "pointer" }}
              value={obj.fill_gradient ?? ""}
              onChange={(e) => onChange({ fill_gradient: (e.target.value || undefined) as "vertical" | "horizontal" | "radial" | undefined })}>
              <option value="">{t("props.gradientNone")}</option>
              <option value="vertical">{t("props.gradientVertical")}</option>
              <option value="horizontal">{t("props.gradientHorizontal")}</option>
              <option value="radial">{t("props.gradientRadial")}</option>
            </select>
          )}
          {obj.fill_gradient && (
            <>
              {field(t("props.gradientLight"), colorInput("gradient_light_color", "#ffffff"))}
              {field(t("props.gradientDark"), colorInput("gradient_dark_color", "#000000"))}
              <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
                {t("props.gradientHint")}
              </p>
            </>
          )}
        </>
      )}

      {/* F7.6 — adattamento dell'immagine al box. */}
      {obj.type === "image" &&
        field(t("props.imageFit"),
          <select style={{ ...INPUT, cursor: "pointer" }}
            value={obj.image_fit ?? "stretch"}
            onChange={(e) => onChange({ image_fit: e.target.value === "stretch" ? undefined : (e.target.value as "contain" | "cover") })}>
            <option value="stretch">{t("props.fitStretch")}</option>
            <option value="contain">{t("props.fitContain")}</option>
            <option value="cover">{t("props.fitCover")}</option>
          </select>
        )}

      {/* F7.6 — forma del led. */}
      {obj.type === "led" &&
        field(t("props.ledShape"),
          <select style={{ ...INPUT, cursor: "pointer" }}
            value={obj.led_shape ?? "circle"}
            onChange={(e) => onChange({ led_shape: e.target.value === "circle" ? undefined : (e.target.value as "square" | "triangle") })}>
            <option value="circle">{t("props.shapeCircle")}</option>
            <option value="square">{t("props.shapeSquare")}</option>
            <option value="triangle">{t("props.shapeTriangle")}</option>
          </select>
        )}

      {/* Sfondo universale (colore + immagine URL) — un solo punto di
          inserimento: per estenderlo a un tipo nuovo basta aggiungerlo a
          BG_TYPES qui sotto e disegnare il layer nel suo blocco di
          SvgCanvas.tsx (bgLayer). */}
      {BG_TYPES.includes(obj.type) && (
        <>
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            {t("props.bgSection")}
          </div>
          {/* 2026-08-23: su rect/button/navbutton/lang_button lo sfondo È il
              fill ("Colore" qui sopra): il colore doppio spariva sotto il
              corpo opaco. Resta bg_image. */}
          {!["rect", "button", "navbutton", "lang_button"].includes(obj.type) && field(t("props.bgColor"),
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input
                type="color"
                style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none", opacity: obj.bg_color ? 1 : 0.4 }}
                value={obj.bg_color ?? "#0f172a"}
                onChange={(e) => onChange({ bg_color: e.target.value })}
              />
              {obj.bg_color && (
                <button
                  title={t("props.bgClear")}
                  style={{ background: "transparent", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 13, padding: "0 4px" }}
                  onClick={() => onChange({ bg_color: undefined })}
                >✕</button>
              )}
            </div>
          )}
          {field(t("props.bgImage"),
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="text" style={INPUT} placeholder="https://… / /api/project/images/…"
                  value={obj.bg_image ?? ""}
                  onChange={(e) => onChange({ bg_image: e.target.value || undefined })}
                />
                <button
                  style={{ ...INPUT, cursor: "pointer", whiteSpace: "nowrap", width: "auto", flex: "none", opacity: bgUploading ? 0.6 : 1 }}
                  disabled={bgUploading}
                  title={t("props.bgUploadHint")}
                  onClick={() => bgFileRef.current?.click()}
                >{bgUploading ? "…" : t("props.bgUpload")}</button>
              </div>
              <input
                ref={bgFileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.gif,.svg,.webp"
                style={{ display: "none" }}
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  // Nome sanificato: la whitelist server accetta solo [A-Za-z0-9._-].
                  const safe = f.name.replace(/[^A-Za-z0-9._-]+/g, "_");
                  setBgUploading(true);
                  try {
                    const res = await api.uploadProjectImage(safe, f);
                    onChange({ bg_image: res.url });
                    setProjectImages(null); // ricarica la lista al prossimo focus
                  } catch (err: any) {
                    alert(`Upload fallito: ${err?.message ?? err}`);
                  } finally {
                    setBgUploading(false);
                  }
                }}
              />
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value=""
                onFocus={() => {
                  if (projectImages === null) {
                    api.listProjectImages().then(setProjectImages).catch(() => setProjectImages([]));
                  }
                }}
                onChange={(e) => {
                  if (e.target.value) onChange({ bg_image: `/api/project/images/${e.target.value}` });
                  e.target.value = "";
                }}
              >
                <option value="">{t("props.bgPickUploaded")}</option>
                {(projectImages ?? []).map((im) => (
                  <option key={im.name} value={im.name}>{im.name} ({Math.round(im.size_bytes / 1024)} KB)</option>
                ))}
              </select>
            </div>
          )}
        </>
      )}

      {/* Tag binding */}
      {!["navbutton","gauge","slider","checkbox","radio","led","progress_bar","trend","pipe","text_list","state_lamp","setpoint","xy_plot",
        // 2026-08-23: tipi dove obj.tag NON è il dato primario (serie/figli
        // propri) o è puro rumore — il campo vive nella sezione qualità come
        // "Tag di stato" (alimenta bordo-allarme/stale/Bad-gray/QDot).
        "kpi_tile","data_log","sparkline","bar_chart","pie_chart","table","symbol",
        "alarm_viewer","alarm_bell","alarm_banner","alarm_history","recipe_panel","grid","faceplate",
        "image","lang_button","lang_selector"].includes(obj.type) && field(t("props.tag"), tagInput("es. pump1.speed"))}

      {/* Token picker (T-40): insert {{key}} into the primary text field so the
          viewer resolves it per the project language table. */}
      {langKeys.length > 0 && ("text" in obj || "label" in obj || ["text","button","navbutton","led","checkbox","gauge","progress_bar","slider","symbol","bar_chart","pie_chart","alarm_viewer"].includes(obj.type)) && field(t("props.insertToken"),
        <select style={{ ...INPUT, cursor: "pointer" }} value=""
          onChange={(e) => {
            const key = e.target.value; if (!key) return;
            const fieldName = obj.type === "text" ? "text" : "label";
            const prev = (obj as unknown as Record<string, unknown>)[fieldName];
            const base = typeof prev === "string" ? prev : "";
            onChange({ [fieldName]: `${base}{{${key}}}` } as Partial<SynopticObject>);
          }}>
          <option value="">{t("props.insertTokenHint")}</option>
          {langKeys.map((k) => <option key={k} value={k}>{`{{${k}}}`}</option>)}
        </select>
      )}

      {/* Text object: static content + typography */}
      {obj.type === "text" && (
        <>
          {/* F7.4 — con il testo multiriga il campo statico diventa un'area:
              gli a-capo scritti a mano vengono rispettati dal rendering. */}
          {obj.text_wrap
            ? field(t("props.textStatic"),
                <textarea
                  style={{ ...INPUT, minHeight: 56, fontFamily: "inherit", resize: "vertical" }}
                  placeholder="Es. Temperatura caldaia"
                  value={obj.text ?? ""}
                  onChange={(e) => onChange({ text: e.target.value || undefined })}
                />)
            : field(t("props.textStatic"), <BindableInput obj={obj} propName="text" onChange={onChange}>{textInput("text", "Es. Temperatura caldaia")}</BindableInput>)}
          {field(t("props.formatBound"), <BindableInput obj={obj} propName="format" onChange={onChange}>{textInput("format", "{value:.1f} °C")}</BindableInput>)}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
            Se è impostato un Tag, vince il formato (usa <code>{"{value}"}</code>); altrimenti viene
            mostrato il testo statico.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.dimensionPx")}</div><BindableInput obj={obj} propName="font_size" onChange={onChange}>{numInput("font_size", 14)}</BindableInput></div>
            <div>
              <div style={LABEL}>{t("props.alignment")}</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.text_anchor ?? "start"}
                onChange={(e) => onChange({ text_anchor: e.target.value as "start" | "middle" | "end" })}
              >
                <option value="start">{t("props.left")}</option>
                <option value="middle">{t("props.center")}</option>
                <option value="end">{t("props.right")}</option>
              </select>
            </div>
          </div>
          {/* F7.4 — testo multiriga dentro il box dichiarato. */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginTop: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={!!obj.text_wrap}
              onChange={(e) => onChange({ text_wrap: e.target.checked || undefined })}
              style={{ accentColor: "var(--brand-primary, #3b82f6)" }} />
            {t("props.textWrap")}
          </label>
          {obj.text_wrap && (
            <>
              <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 4px" }}>
                {t("props.textWrapHint")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div>
                  <div style={LABEL}>{t("props.vAlign")}</div>
                  <select style={{ ...INPUT, cursor: "pointer" }}
                    value={obj.text_valign ?? "top"}
                    onChange={(e) => onChange({ text_valign: e.target.value === "top" ? undefined : (e.target.value as "middle" | "bottom") })}>
                    <option value="top">{t("props.vAlignTop")}</option>
                    <option value="middle">{t("props.vAlignMiddle")}</option>
                    <option value="bottom">{t("props.vAlignBottom")}</option>
                  </select>
                </div>
                <div><div style={LABEL}>{t("props.lineHeight")}</div>{numInput("line_height", 1.25)}</div>
              </div>
            </>
          )}
          {field(t("props.fontFamily"),
            <BindableInput obj={obj} propName="font_family" onChange={onChange}>
              <input
                type="text" style={INPUT}
                placeholder="es. system-ui, sans-serif"
                value={obj.font_family ?? ""}
                onChange={(e) => onChange({ font_family: e.target.value || undefined })}
                spellCheck={false}
              />
            </BindableInput>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={LABEL}>Peso</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={String(obj.font_weight ?? "normal")}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = Number(v);
                  onChange({ font_weight: Number.isFinite(n) && v.match(/^\d+$/) ? n : v });
                }}
              >
                <option value="normal">{t("props.normal400")}</option>
                <option value="bold">{t("props.bold700")}</option>
                <option value="300">300</option>
                <option value="500">500</option>
                <option value="600">600</option>
                <option value="800">800</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Stile</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.font_style ?? "normal"}
                onChange={(e) => onChange({ font_style: e.target.value as "normal" | "italic" })}
              >
                <option value="normal">{t("props.normalOpt")}</option>
                <option value="italic">{t("props.italic")}</option>
              </select>
            </div>
          </div>
          {field(t("props.colorText"), <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "var(--brand-text, #e2e8f0)")}</BindableInput>)}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!obj.text_color_by_threshold}
              onChange={(e) => onChange({ text_color_by_threshold: e.target.checked || undefined })}
            />
            {t("props.colorByThreshold")}
          </label>
          {obj.text_color_by_threshold && (
            <>
              <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 4px" }}>
                {t("props.colorByThresholdHint")}
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div><div style={LABEL}>{t("props.warnLow")}</div><BindableInput obj={obj} propName="warn_low" onChange={onChange}>{numInput("warn_low", 0)}</BindableInput></div>
                <div><div style={LABEL}>{t("props.warnHigh")}</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
                <div><div style={LABEL}>{t("props.alarmLow")}</div><BindableInput obj={obj} propName="alarm_low" onChange={onChange}>{numInput("alarm_low", 0)}</BindableInput></div>
                <div><div style={LABEL}>{t("props.alarmHigh")}</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
              </div>
            </>
          )}
        </>
      )}

      {/* Button label + write value + built-in action */}
      {obj.type === "button" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Bottone")}</BindableInput>)}
          {field(t("props.labelColor"), <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "#ffffff")}</BindableInput>)}
          {field(t("props.buttonMode"), (
            <select style={{ ...INPUT, cursor: "pointer" }} value={obj.button_mode ?? "write"}
              onChange={(e) => onChange({ button_mode: e.target.value === "write" ? undefined : e.target.value as SynopticObject["button_mode"] })}>
              <option value="write">{t("props.modeWrite")}</option>
              <option value="momentary">{t("props.modeMomentary")}</option>
              <option value="toggle">{t("props.modeToggle")}</option>
              <option value="set">{t("props.modeSet")}</option>
              <option value="reset">{t("props.modeReset")}</option>
              <option value="increment">{t("props.modeIncrement")}</option>
              <option value="decrement">{t("props.modeDecrement")}</option>
            </select>
          ))}
          {obj.button_mode === "momentary" && field(t("props.releaseValue"),
            <input type="text" style={INPUT} placeholder="false"
              value={obj.release_value !== undefined ? String(obj.release_value) : ""}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const v = raw === "" ? undefined
                  : raw === "true" ? true : raw === "false" ? false
                  : !Number.isNaN(Number(raw)) ? Number(raw) : raw;
                onChange({ release_value: v });
              }} />
          )}
          {(obj.button_mode === "increment" || obj.button_mode === "decrement") && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div><div style={LABEL}>Step</div>{numInput("step", 1)}</div>
              <div><div style={LABEL}>Min</div>{numInput("min", 0)}</div>
              <div><div style={LABEL}>Max</div>{numInput("max", 100)}</div>
            </div>
          )}
          {field(t("props.writeValue"),
            <BindableInput obj={obj} propName="write_value" onChange={onChange}>
              <input
                type="text"
                style={INPUT}
                placeholder={t("props.trueHint")}
                value={obj.write_value !== undefined ? String(obj.write_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ write_value: v });
                }}
              />
            </BindableInput>
          )}
          {field(t("props.builtinAction"),
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.button_action?.type ?? ""}
                onChange={(e) => {
                  const t = e.target.value as ButtonAction["type"] | "";
                  if (!t) { onChange({ button_action: undefined }); return; }
                  if (t === "navigate") onChange({ button_action: { type: "navigate", url: "" } });
                  else if (t === "open_faceplate") onChange({ button_action: { type: "open_faceplate", faceplate_id: "", params: {} } });
                  else onChange({ button_action: { type: t } as ButtonAction });
                }}
              >
                <option value="">{t("props.dashNone")}</option>
                <option value="login">{t("props.loginModal")}</option>
                <option value="logout">{t("props.logoutReadonly")}</option>
                <option value="navigate">{t("props.navigateUrl")}</option>
                <option value="open_faceplate">{t("props.openFaceplate")}</option>
              </select>
              {obj.button_action?.type === "navigate" && (() => {
                const act = obj.button_action as { type: "navigate"; url: string; target?: "self" | "blank" };
                return (
                  <>
                    <input
                      type="text"
                      style={INPUT}
                      placeholder="https://..."
                      value={act.url}
                      onChange={(e) => onChange({ button_action: { ...act, url: e.target.value } })}
                    />
                    {/* "Apri in": su un pannello in kiosk una scheda nuova non si
                        chiude facilmente, quindi la scelta è per pulsante. */}
                    <select
                      style={{ ...INPUT, cursor: "pointer" }}
                      value={act.target ?? "blank"}
                      onChange={(e) => onChange({ button_action: { ...act, target: e.target.value as "self" | "blank" } })}
                    >
                      <option value="blank">{t("props.openInNewTab")}</option>
                      <option value="self">{t("props.openInSameTab")}</option>
                    </select>
                  </>
                );
              })()}
              {obj.button_action?.type === "open_faceplate" && (() => {
                const act = obj.button_action as { type: "open_faceplate"; faceplate_id: string; params?: Record<string, string> };
                const defn = faceplates.find((f) => f.id === act.faceplate_id);
                return (
                  <>
                    <select style={{ ...INPUT, cursor: "pointer" }} value={act.faceplate_id}
                      onChange={(e) => onChange({ button_action: { ...act, faceplate_id: e.target.value, params: {} } })}>
                      <option value="">{t("props.faceplateChoose")}</option>
                      {faceplates.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
                    </select>
                    {defn && normalizeFaceplateParams(defn).map((p) => (
                      <div key={p.name} style={{ display: "flex", gap: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", width: 80, flexShrink: 0 }}>
                          {p.name}{p.required ? " *" : ""}
                        </span>
                        {p.type === "tag" ? (
                          <TagInput style={{ ...INPUT, flex: 1 }} placeholder={p.default ?? ""}
                            value={act.params?.[p.name] ?? ""}
                            onChange={(v) => onChange({ button_action: { ...act, params: { ...(act.params ?? {}), [p.name]: v } } })} />
                        ) : (
                          <input type="text" style={{ ...INPUT, flex: 1 }} placeholder={p.default ?? ""}
                            value={act.params?.[p.name] ?? ""}
                            onChange={(e) => onChange({ button_action: { ...act, params: { ...(act.params ?? {}), [p.name]: e.target.value } } })} />
                        )}
                      </div>
                    ))}
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}

      {/* NavButton */}
      {obj.type === "navbutton" && (() => {
        const targetMissing = !!obj.target_page && !pages.some((p) => p.id === obj.target_page);
        return (
          <>
            {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Vai alla pagina")}</BindableInput>)}
            {field(t("props.targetPage"),
              <select
                style={{
                  ...INPUT,
                  cursor: "pointer",
                  borderColor: targetMissing ? "#dc2626" : (INPUT.border ? undefined : "var(--brand-surface-2, #334155)"),
                }}
                value={obj.target_page ?? ""}
                onChange={(e) => onChange({ target_page: e.target.value || undefined })}
              >
                <option value="">{t("props.dashSelect")}</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {targetMissing && (
                  <option value={obj.target_page} disabled>
                    ⚠ pagina inesistente: {obj.target_page}
                  </option>
                )}
              </select>
            )}
            {targetMissing && (
              <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", marginTop: -4 }}>
                La pagina di destinazione è stata eliminata. Seleziona un'altra pagina o rimuovi il navbutton.
              </div>
            )}
            {field(t("props.labelColor"), <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "#e2e8f0")}</BindableInput>)}
          </>
        );
      })()}

      {/* Language button (T-40) */}
      {obj.type === "lang_button" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "IT")}</BindableInput>)}
          {field(t("props.targetLang"),
            <select style={{ ...INPUT, cursor: "pointer" }} value={obj.target_lang ?? ""}
              onChange={(e) => onChange({ target_lang: e.target.value || undefined })}>
              <option value="">{t("props.dashSelect")}</option>
              {projLangs.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          )}
        </>
      )}

      {/* Language selector (T-40) — auto-lists the project languages */}
      {obj.type === "lang_selector" && (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", padding: "4px 0" }}>
          {t("props.langSelectorHint")}
        </div>
      )}

      {/* Gauge */}
      {obj.type === "gauge" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Gauge")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. pump1.speed"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
          </div>
          {field(t("props.unit"), <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          {field(t("props.decimals"), <BindableInput obj={obj} propName="decimals" onChange={onChange}>{numInput("decimals", 1)}</BindableInput>)}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.warnLow")}</div><BindableInput obj={obj} propName="warn_low" onChange={onChange}>{numInput("warn_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.warnHigh")}</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.alarmLow")}</div><BindableInput obj={obj} propName="alarm_low" onChange={onChange}>{numInput("alarm_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.alarmHigh")}</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
          </div>
          {field(t("props.showValue"),
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
          {field(t("props.needleColor"), <BindableInput obj={obj} propName="stroke" onChange={onChange}>{colorInput("stroke", "#e2e8f0")}</BindableInput>)}
          {field(t("props.textsColor"), <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "#e2e8f0")}</BindableInput>)}

          {/* F7.6 — quadrante: apertura dell'arco e tacche numerate. */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700 }}>
            {t("props.dial")}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.startAngle")}</div>{numInput("gauge_start_angle", -135)}</div>
            <div><div style={LABEL}>{t("props.endAngle")}</div>{numInput("gauge_end_angle", 135)}</div>
          </div>
          {field(t("props.ticks"), numInput("gauge_ticks", 0))}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
            {t("props.ticksHint")}
          </p>

          {/* F7.6 — secondo indicatore (setpoint). */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700 }}>
            {t("props.secondIndicator")}
          </div>
          <TagInput value={obj.gauge_sp_tag ?? ""} onChange={(v) => onChange({ gauge_sp_tag: v || undefined })}
            placeholder={t("props.setpointTagPlaceholder")} />
          {obj.gauge_sp_tag && field(t("props.color"), colorInput("gauge_sp_color", "#f59e0b"))}

          {/* F7.6 — zone colorate del fondo scala. */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700 }}>
            {t("props.zones")}
          </div>
          {(obj.gauge_zones ?? []).map((z, i) => (
            <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3 }}>
              <input type="number" style={{ ...INPUT, width: 56 }} value={z.from}
                onChange={(e) => {
                  const zs = [...(obj.gauge_zones ?? [])];
                  zs[i] = { ...zs[i], from: Number(e.target.value) };
                  onChange({ gauge_zones: zs });
                }} />
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>→</span>
              <input type="number" style={{ ...INPUT, width: 56 }} value={z.to}
                onChange={(e) => {
                  const zs = [...(obj.gauge_zones ?? [])];
                  zs[i] = { ...zs[i], to: Number(e.target.value) };
                  onChange({ gauge_zones: zs });
                }} />
              <input type="color" style={{ ...INPUT, padding: 2, height: 26, width: 38, cursor: "pointer", flex: "none" }}
                value={z.color}
                onChange={(e) => {
                  const zs = [...(obj.gauge_zones ?? [])];
                  zs[i] = { ...zs[i], color: e.target.value };
                  onChange({ gauge_zones: zs });
                }} />
              <button title={t("props.remove")}
                onClick={() => {
                  const zs = [...(obj.gauge_zones ?? [])];
                  zs.splice(i, 1);
                  onChange({ gauge_zones: zs.length > 0 ? zs : undefined });
                }}
                style={{ ...INPUT, width: 26, padding: 0, cursor: "pointer", flex: "none" }}>×</button>
            </div>
          ))}
          <button
            onClick={() => {
              const zs = [...(obj.gauge_zones ?? [])];
              const lo = obj.min ?? 0; const hi = obj.max ?? 100;
              const from = zs.length > 0 ? zs[zs.length - 1].to : lo;
              zs.push({ from, to: hi, color: "#22c55e" });
              onChange({ gauge_zones: zs });
            }}
            style={{ ...INPUT, cursor: "pointer", marginBottom: 4 }}>+ {t("props.addZone")}</button>
        </>
      )}

      {/* Slider */}
      {obj.type === "slider" && (
        <>
          {field(t("props.tag"), tagInput("es. pump1.speed"))}
          {field(t("props.color"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
            <div><div style={LABEL}>Step</div><BindableInput obj={obj} propName="step" onChange={onChange}>{numInput("step", 1)}</BindableInput></div>
          </div>
          {field(t("props.orientation"),
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.orientation ?? "horizontal"}
              onChange={(e) => onChange({ orientation: e.target.value as "horizontal" | "vertical" })}
            >
              <option value="horizontal">{t("props.horizontal")}</option>
              <option value="vertical">{t("props.vertical")}</option>
            </select>
          )}
          {field(t("props.showValue"),
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
          {field(t("props.readOnly"),
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
          {field(t("props.writeOnRelease"),
            <input type="checkbox" checked={obj.write_on_release !== false}
              onChange={(e) => onChange({ write_on_release: e.target.checked ? undefined : false })} />
          )}
          {field(t("props.writeDeadband"), numInput("write_deadband", 0))}
        </>
      )}

      {/* Setpoint */}
      {obj.type === "setpoint" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Setpoint")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. pump1.speed_sp"))}
          {field(t("props.unit"), <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          {field(t("props.decimals"), <BindableInput obj={obj} propName="decimals" onChange={onChange}>{numInput("decimals", 1)}</BindableInput>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
            <div><div style={LABEL}>Step</div><BindableInput obj={obj} propName="step" onChange={onChange}>{numInput("step", 1)}</BindableInput></div>
          </div>
          {field(t("props.readOnly"),
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
        </>
      )}

      {/* Checkbox */}
      {obj.type === "checkbox" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Checkbox")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. pump1.run"))}
          {field(t("props.color"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          {field(t("props.valueOn"),
            <BindableInput obj={obj} propName="checked_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder={t("props.trueHint")}
                value={obj.checked_value !== undefined ? String(obj.checked_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ checked_value: v });
                }} />
            </BindableInput>
          )}
          {field(t("props.valueOff"),
            <BindableInput obj={obj} propName="unchecked_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder={t("props.falseHint")}
                value={obj.unchecked_value !== undefined ? String(obj.unchecked_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ unchecked_value: v });
                }} />
            </BindableInput>
          )}
          {field(t("props.readOnly"),
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
        </>
      )}

      {/* Radio */}
      {obj.type === "radio" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Radio")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. pump1.mode"))}
          {field(t("props.color"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          {field(t("props.orientation"),
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.orientation ?? "vertical"}
              onChange={(e) => onChange({ orientation: e.target.value as "horizontal" | "vertical" })}
            >
              <option value="vertical">{t("props.vertical")}</option>
              <option value="horizontal">{t("props.horizontal")}</option>
            </select>
          )}
          {field(t("props.readOnly"),
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
          <RadioOptionsEditor
            options={(obj.options as RadioOption[] | undefined) ?? []}
            onChange={(opts) => onChange({ options: opts as SynopticObject["options"] })}
          />
        </>
      )}

      {/* LED */}
      {obj.type === "led" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. pump1.run"))}
          {field(t("props.valueOn"),
            <BindableInput obj={obj} propName="on_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder={t("props.trueHint")}
                value={obj.on_value !== undefined ? String(obj.on_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ on_value: v });
                }} />
            </BindableInput>
          )}
          {field(t("props.colorOn"),  <BindableInput obj={obj} propName="on_color" onChange={onChange}>{colorInput("on_color",  "var(--brand-success, #22c55e)")}</BindableInput>)}
          {field(t("props.colorOff"), <BindableInput obj={obj} propName="off_color" onChange={onChange}>{colorInput("off_color", "#374151")}</BindableInput>)}
        </>
      )}

      {/* Progress bar */}
      {obj.type === "progress_bar" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. tank1.level"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
          </div>
          {field(t("props.unit"), <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          {field(t("props.decimals"), <BindableInput obj={obj} propName="decimals" onChange={onChange}>{numInput("decimals", 1)}</BindableInput>)}
          {field(t("props.colorBar"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.warnLow")}</div><BindableInput obj={obj} propName="warn_low" onChange={onChange}>{numInput("warn_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.warnHigh")}</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.alarmLow")}</div><BindableInput obj={obj} propName="alarm_low" onChange={onChange}>{numInput("alarm_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.alarmHigh")}</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
          </div>
          {field(t("props.showValue"),
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
        </>
      )}

      {/* Table */}
      {obj.type === "table" && (() => {
        // F7.1 — colonne mostrate, in ordine fisso di presentazione; l'utente
        // sceglie quali accendere (le tre storiche sono il default).
        const ALL_COLS = ["label", "value", "unit", "quality", "time"] as const;
        const active = obj.table_columns ?? ["label", "value", "quality"];
        const toggleCol = (c: typeof ALL_COLS[number]) => {
          const next = active.includes(c) ? active.filter((x) => x !== c) : ALL_COLS.filter((x) => active.includes(x) || x === c);
          onChange({ table_columns: next.length > 0 ? [...next] : undefined });
        };
        return (
          <>
            <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>
              {t("props.columns")}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ALL_COLS.map((c) => (
                <label key={c} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={active.includes(c)} onChange={() => toggleCol(c)} />
                  {t(`props.col_${c}`)}
                </label>
              ))}
            </div>
            {field(t("props.labelHeader"), textInput("table_label_header", "DATI"))}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div><div style={LABEL}>{t("props.dimensionPx")}</div>{numInput("table_font_size", 11)}</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={obj.table_sortable !== false}
                  onChange={(e) => onChange({ table_sortable: e.target.checked ? undefined : false })} />
                {t("props.sortable")}
              </label>
              <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={obj.table_filterable === true}
                  onChange={(e) => onChange({ table_filterable: e.target.checked || undefined })} />
                {t("props.filterRow")}
              </label>
            </div>
            <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "4px 0" }}>
              {t("props.tableHint")}
            </p>
            <TableRowsEditor
              rows={(obj.table_rows as TableRow[] | undefined) ?? []}
              onChange={(rows) => onChange({ table_rows: rows as SynopticObject["table_rows"] })}
            />
          </>
        );
      })()}

      {/* Trend */}
      {obj.type === "trend" && (() => {
        // TRACCE unificate (migrazione 2026-08-23): ogni riga è un
        // TrendTrace {tag, label, colore, stile…}. La traccia 1 non è più
        // speciale; niente più campo Tag separato né line_color.
        const traces = obj.trend_tags ?? [];
        const patchTrace = (idx: number, patch: Partial<TrendTrace>) => {
          const next = traces.map((tr, i) => (i === idx ? { ...tr, ...patch } : tr));
          onChange({ trend_tags: next });
        };
        const removeTrace = (idx: number) =>
          onChange({ trend_tags: traces.filter((_, i) => i !== idx) });
        const traceRow = (tr: TrendTrace, idx: number) => (
          <div key={idx} style={{ marginBottom: 6, padding: 4, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 3, alignItems: "center" }}>
              <TagInput
                style={{ ...INPUT, flex: 1 }}
                placeholder={t("props.exBoiler")}
                value={tr.tag}
                onChange={(v) => patchTrace(idx, { tag: v })}
              />
              <input
                style={{ ...INPUT, width: 90 }}
                placeholder={t("props.traceLabel")}
                value={tr.label ?? ""}
                onChange={(e) => patchTrace(idx, { label: e.target.value || undefined })}
              />
              <button
                title={t("props.remove")}
                style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                onClick={() => removeTrace(idx)}
              >×</button>
            </div>
            <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
              <input
                type="color"
                value={tr.color ?? PALETTE[idx % PALETTE.length]}
                onChange={(e) => patchTrace(idx, { color: e.target.value })}
                title={t("props.color")}
                style={{ width: 26, height: 22, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }}
              />
              <input
                type="number" min={0.5} max={10} step={0.5}
                value={tr.width ?? 1.5}
                title={t("props.strokeWidth")}
                onChange={(e) => patchTrace(idx, { width: e.target.value === "" ? undefined : Number(e.target.value) })}
                style={{ ...INPUT, width: 46, padding: "2px 4px" }}
              />
              <select
                value={tr.dash ?? "solid"}
                title={t("props.dashPattern")}
                onChange={(e) => patchTrace(idx, { dash: e.target.value === "solid" ? undefined : (e.target.value as TrendTrace["dash"]) })}
                style={{ ...INPUT, width: 84, padding: "2px 4px" }}
              >
                <option value="solid">{t("props.dashSolid")}</option>
                <option value="dashed">{t("props.dashDashed")}</option>
                <option value="dotted">{t("props.dashDotted")}</option>
              </select>
              <label style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 2, alignItems: "center" }}>
                <input type="checkbox" checked={tr.fill ?? false} onChange={(e) => patchTrace(idx, { fill: e.target.checked || undefined })} />
                {t("props.fillArea")}
              </label>
              {tr.fill && (
                <input
                  type="number" min={0} max={1} step={0.05}
                  value={tr.fill_opacity ?? 0.15}
                  title={t("props.fillOpacity")}
                  onChange={(e) => patchTrace(idx, { fill_opacity: e.target.value === "" ? undefined : Number(e.target.value) })}
                  style={{ ...INPUT, width: 46, padding: "2px 4px" }}
                />
              )}
              <label style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 2, alignItems: "center" }}>
                <input type="checkbox" checked={tr.smooth ?? false} onChange={(e) => patchTrace(idx, { smooth: e.target.checked || undefined })} />
                {t("props.smoothCurve")}
              </label>
              <label style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 2, alignItems: "center" }} title={t("props.ownScaleHint")}>
                <input type="checkbox" checked={tr.own_scale ?? false} onChange={(e) => patchTrace(idx, { own_scale: e.target.checked || undefined })} />
                {t("props.ownScale")}
              </label>
              <label style={{ fontSize: 10, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 2, alignItems: "center" }} title={t("props.traceHiddenHint")}>
                <input type="checkbox" checked={tr.hidden ?? false} onChange={(e) => patchTrace(idx, { hidden: e.target.checked || undefined })} />
                {t("props.traceHidden")}
              </label>
            </div>
          </div>
        );

        return (
        <>
          {/* TRACCE — la prima cosa che si configura */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            {t("props.traces")}
          </div>
          {traces.map(traceRow)}
          <button
            style={{ ...INPUT, cursor: "pointer", color: "var(--brand-text-subtle, #64748b)", borderStyle: "dashed", width: "100%", marginBottom: 8 }}
            onClick={() => onChange({ trend_tags: [...traces, { tag: "" }] })}
          >
            + {t("props.addTrace")}
          </button>

          {field(t("props.windowS"), <BindableInput obj={obj} propName="window_s" onChange={onChange}>{numInput("window_s", 60)}</BindableInput>)}
          {field(t("props.panStepS"), numInput("pan_step_s", Math.round((obj.window_s ?? 60) * 0.25)))}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-4px 0 0" }}>
            {t("props.panStepSHint")}
          </p>

          {/* Formato data/ora (asse X + tooltip) */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            FORMATO DATA/ORA
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={LABEL}>Ordine data</div>
              <select
                style={INPUT}
                value={obj.trend_dt_date_order ?? "dmy"}
                onChange={(e) => onChange({ trend_dt_date_order: e.target.value as SynopticObject["trend_dt_date_order"] })}
              >
                <option value="dmy">GG/MM (europeo)</option>
                <option value="mdy">MM/GG (americano)</option>
                <option value="ymd">AAAA/MM/GG</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Separatore</div>
              <select
                style={INPUT}
                value={obj.trend_dt_separator ?? "/"}
                onChange={(e) => onChange({ trend_dt_separator: e.target.value as SynopticObject["trend_dt_separator"] })}
              >
                <option value="/">/ (GG/MM)</option>
                <option value="-">- (GG-MM)</option>
                <option value=".">. (GG.MM)</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Formato ora</div>
              <select
                style={INPUT}
                value={obj.trend_dt_time_format ?? "24h"}
                onChange={(e) => onChange({ trend_dt_time_format: e.target.value as SynopticObject["trend_dt_time_format"] })}
              >
                <option value="24h">24h</option>
                <option value="12h">12h (AM/PM)</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
              <input type="checkbox" checked={obj.trend_dt_show_year ?? false}
                onChange={(e) => onChange({ trend_dt_show_year: e.target.checked || undefined })} />
              Mostra anno
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
              <input type="checkbox" checked={obj.trend_dt_show_seconds ?? false}
                onChange={(e) => onChange({ trend_dt_show_seconds: e.target.checked || undefined })} />
              Mostra secondi
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
              <input type="checkbox" checked={obj.trend_dt_two_lines ?? true}
                onChange={(e) => onChange({ trend_dt_two_lines: e.target.checked })} />
              Data e ora su due righe
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
              <input type="checkbox" checked={obj.trend_dt_always_show_date ?? false}
                onChange={(e) => onChange({ trend_dt_always_show_date: e.target.checked || undefined })} />
              Mostra sempre la data
            </label>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 0" }}>
            Senza "Mostra sempre la data", la data compare solo quando la finestra visibile supera le 24h.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 8 }}>
            <div><div style={LABEL}>Y min</div><BindableInput obj={obj} propName="y_min" onChange={onChange}>{numInput("y_min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Y max</div><BindableInput obj={obj} propName="y_max" onChange={onChange}>{numInput("y_max", 100)}</BindableInput></div>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 0" }}>
            Lascia Y min/max a 0 per autofit.
          </p>

          {/* F5.2x: scala Y logaritmica (solo scala condivisa, dominio > 0). */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.trend_log_scale ?? false}
              onChange={(e) => onChange({ trend_log_scale: e.target.checked || undefined })}
            />
            Scala Y logaritmica
          </label>
          {/* Soglie warn/alarm come linee tratteggiate orizzontali (stesso
              pattern del bar chart). Valori sulla scala condivisa. */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.trend_show_thresholds ?? false}
              onChange={(e) => onChange({ trend_show_thresholds: e.target.checked || undefined })}
            />
            Mostra soglie (linee tratteggiate)
          </label>
          {obj.trend_show_thresholds && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                <div><div style={LABEL}>Warn min</div>{numInput("warn_low", 0)}</div>
                <div><div style={LABEL}>Warn max</div>{numInput("warn_high", 0)}</div>
                <div><div style={LABEL}>Alarm min</div>{numInput("alarm_low", 0)}</div>
                <div><div style={LABEL}>Alarm max</div>{numInput("alarm_high", 0)}</div>
              </div>
              <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 0" }}>
                Le soglie sono valori sulla scala condivisa — non compaiono se ogni traccia ha la propria scala. Lascia vuoto per omettere una soglia.
              </p>
            </>
          )}

          {/* Marker verticali agli eventi di allarme nella finestra visibile */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.trend_show_alarm_markers ?? false}
              onChange={(e) => onChange({ trend_show_alarm_markers: e.target.checked || undefined })}
            />
            Mostra eventi allarme sulla timeline
          </label>

          {field(t("props.axisColor"), <BindableInput obj={obj} propName="axis_color" onChange={onChange}>{colorInput("axis_color", "#64748b")}</BindableInput>)}
          {field(t("props.gridColor"), <BindableInput obj={obj} propName="grid_color" onChange={onChange}>{colorInput("grid_color", "#1e293b")}</BindableInput>)}
          {/* OPC-UA historian backfill */}
          <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.opcua_backfill ?? false}
              onChange={(e) => onChange({ opcua_backfill: e.target.checked || undefined })}
            />
            Backfill da storico OPC-UA al caricamento
          </label>
        </>
        );
      })()}

      {/* XY plot */}
      {obj.type === "xy_plot" && (
        <>
          {field(t("props.xTag"), tagInput("es. gantry.pos_x"))}
          {field(t("props.yTag"),
            <TagInput
              style={INPUT}
              placeholder="es. gantry.pos_y"
              value={obj.y_tag ?? ""}
              onChange={(v) => onChange({ y_tag: v || undefined })}
            />
          )}
          {field(t("props.trailS"), <BindableInput obj={obj} propName="xy_trail_s" onChange={onChange}>{numInput("xy_trail_s", 30)}</BindableInput>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>X min</div><BindableInput obj={obj} propName="xy_x_min" onChange={onChange}>{numInput("xy_x_min", 0)}</BindableInput></div>
            <div><div style={LABEL}>X max</div><BindableInput obj={obj} propName="xy_x_max" onChange={onChange}>{numInput("xy_x_max", 100)}</BindableInput></div>
            <div><div style={LABEL}>Y min</div><BindableInput obj={obj} propName="xy_y_min" onChange={onChange}>{numInput("xy_y_min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Y max</div><BindableInput obj={obj} propName="xy_y_max" onChange={onChange}>{numInput("xy_y_max", 100)}</BindableInput></div>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 0" }}>
            Lascia min/max vuoti per autofit sui campioni osservati.
          </p>
          {field(t("props.colorMainLine"), <BindableInput obj={obj} propName="line_color" onChange={onChange}>{colorInput("line_color", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
        </>
      )}

      {/* Image (external URL) */}
      {obj.type === "image" && (
        <>
          {field(t("props.imageUrl"),
            <div style={{ display: "flex", gap: 4 }}>
              <BindableInput obj={obj} propName="src" onChange={onChange}>
                <input
                  style={{ ...INPUT, flex: 1, minWidth: 0 }}
                  placeholder="https://… o /images/…"
                  value={obj.src ?? ""}
                  onChange={(e) => onChange({ src: e.target.value || undefined })}
                />
              </BindableInput>
              <button
                style={{
                  flexShrink: 0, background: "#1e3a5f", border: "1px solid #1e40af",
                  borderRadius: 4, color: "#93c5fd", cursor: "pointer",
                  padding: "0 8px", fontSize: 12,
                }}
                onClick={() => setImgBrowserOpen(true)}
                title={t("props.browseImages")}
              >
                ⋯
              </button>
            </div>
          )}
          {obj.src && (
            <div style={{ marginTop: 4, textAlign: "center" }}>
              <img
                src={obj.src}
                alt=""
                style={{
                  maxWidth: "100%", maxHeight: 80, objectFit: "contain",
                  filter: "invert(1) brightness(0.85)", borderRadius: 4,
                  border: "1px solid var(--brand-surface, #1e293b)",
                }}
              />
            </div>
          )}
          {imgBrowserOpen && (
            <ImageBrowser
              onSelect={(path) => { onChange({ src: path }); }}
              onClose={() => setImgBrowserOpen(false)}
            />
          )}
        </>
      )}

      {/* Grid layout */}
      {obj.type === "grid" && (
        <>
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            GRIGLIA
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
            <div>
              <div style={LABEL}>Righe</div>
              <input
                type="number" min={1} max={20} style={INPUT}
                value={obj.grid_rows ?? 2}
                onChange={(e) => onChange({ grid_rows: Math.max(1, Number(e.target.value)) })}
              />
            </div>
            <div>
              <div style={LABEL}>{t("props.columns")}</div>
              <input
                type="number" min={1} max={20} style={INPUT}
                value={obj.grid_cols ?? 2}
                onChange={(e) => onChange({ grid_cols: Math.max(1, Number(e.target.value)) })}
              />
            </div>
          </div>
          {/* F7.6 — spazio tra celle e margine interno. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px", marginTop: 4 }}>
            <div><div style={LABEL}>{t("props.gap")}</div>{numInput("grid_gap", 0)}</div>
            <div><div style={LABEL}>{t("props.padding")}</div>{numInput("grid_padding", 0)}</div>
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginTop: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={obj.grid_show_borders !== false}
              onChange={(e) => onChange({ grid_show_borders: e.target.checked })}
              style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
            />
            Mostra bordi
          </label>
          {obj.grid_show_borders !== false && (
            <div style={{ marginTop: 4 }}>
              <div style={LABEL}>{t("props.colorBorders")}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  type="color"
                  style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
                  value={obj.grid_border_color ?? "var(--brand-text-subtle, #64748b)"}
                  onChange={(e) => onChange({ grid_border_color: e.target.value })}
                />
                <input
                  type="text" style={INPUT}
                  value={obj.grid_border_color ?? "var(--brand-text-subtle, #64748b)"}
                  onChange={(e) => onChange({ grid_border_color: e.target.value })}
                />
              </div>
            </div>
          )}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "6px 0 0" }}>
            Clicca su una cella nel canvas per modificarne le proprietà.
          </p>
        </>
      )}

      {/* Text List */}
      {obj.type === "text_list" && (
        <>
          {field(t("props.tag"), tagInput("es. valvola.stato"))}
          {textListEntriesField()}
          {field(t("props.textDefault"), <input style={INPUT} value={obj.text_list_default ?? ""} onChange={(e) => onChange({ text_list_default: e.target.value })} />)}
          {field(t("props.colorDefault"), <input type="color" value={obj.text_list_default_color ?? "var(--brand-text-muted, #94a3b8)"} onChange={(e) => onChange({ text_list_default_color: e.target.value })} style={{ width: 40, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />)}
          {field(t("props.fontSize"), numInput("font_size", 16))}
          {field(t("props.alignment"), (
            <select style={INPUT} value={obj.text_anchor ?? "middle"} onChange={(e) => onChange({ text_anchor: e.target.value as any })}>
              <option value="start">{t("props.left")}</option>
              <option value="middle">{t("props.center")}</option>
              <option value="end">{t("props.right")}</option>
            </select>
          ))}
        </>
      )}

      {/* State Lamp — same data model as text_list (value→label→color), shape instead of text */}
      {obj.type === "state_lamp" && (
        <>
          {field(t("props.tag"), tagInput("es. valvola.stato"))}
          {textListEntriesField()}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
            {t("props.stateLampHint")}
          </p>
        </>
      )}

      {/* Bar Chart */}
      {obj.type === "bar_chart" && (
        <>
          {field(t("props.orientation"), (
            <select style={INPUT} value={obj.bar_orientation ?? "vertical"} onChange={(e) => onChange({ bar_orientation: e.target.value as any })}>
              <option value="vertical">{t("props.vertical")}</option>
              <option value="horizontal">{t("props.horizontal")}</option>
            </select>
          ))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
            {t("props.barRangeHint")}
          </p>
          {field(t("props.unit"), textInput("unit", ""))}
          {field(t("props.decimals"), numInput("decimals", 1))}
          {field(t("props.yAxisLabel"), textInput("bar_y_label", ""))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.barGap")}</div>{numInput("bar_gap", 0.2)}</div>
            <div><div style={LABEL}>{t("props.ticks")}</div>{numInput("bar_ticks", 0)}</div>
          </div>
          {/* F7.2 — barre affiancate (storico) o impilate in una sola barra. */}
          {field(t("props.barMode"), (
            <select style={{ ...INPUT, cursor: "pointer" }} value={obj.bar_mode ?? "grouped"}
              onChange={(e) => onChange({ bar_mode: e.target.value === "grouped" ? undefined : "stacked" })}>
              <option value="grouped">{t("props.barGrouped")}</option>
              <option value="stacked">{t("props.barStacked")}</option>
            </select>
          ))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["bar_show_values", t("props.values")], ["bar_show_labels", t("props.labels")],
              ["bar_show_thresholds", t("props.thresholdsShort")], ["bar_show_legend", t("props.legend")]].map(([k,l]) => (
              <label key={k} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!(obj as any)[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />{l}
              </label>
            ))}
          </div>
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700 }}>SERIE</div>
          {(obj.bar_series ?? []).map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
              <TagInput style={{ ...INPUT, flex: 1 }} placeholder="tag" value={s.tag}
                onChange={(v) => { const next = [...(obj.bar_series ?? [])]; next[i] = { ...s, tag: v }; onChange({ bar_series: next }); }} />
              <input style={{ ...INPUT, width: 60 }} placeholder="label" value={s.label}
                onChange={(e) => { const next = [...(obj.bar_series ?? [])]; next[i] = { ...s, label: e.target.value }; onChange({ bar_series: next }); }} />
              <input type="color" value={s.color ?? PALETTE[i % PALETTE.length]} onChange={(e) => { const next = [...(obj.bar_series ?? [])]; next[i] = { ...s, color: e.target.value }; onChange({ bar_series: next }); }}
                style={{ width: 28, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />
              <button style={{ ...INPUT, width: "auto", padding: "0 6px", cursor: "pointer" }}
                onClick={() => onChange({ bar_series: (obj.bar_series ?? []).filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button style={{ ...INPUT, width: "100%", cursor: "pointer", marginBottom: 4 }}
            onClick={() => onChange({ bar_series: [...(obj.bar_series ?? []), { tag: "", label: `Serie ${(obj.bar_series?.length ?? 0) + 1}` }] })}>
            + Aggiungi serie
          </button>
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 2, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.warnHigh")}</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>{t("props.alarmHigh")}</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
          </div>
        </>
      )}

      {/* Pie / Donut Chart */}
      {obj.type === "pie_chart" && (
        <>
          {field(t("props.mode"), (
            <select style={INPUT} value={obj.pie_mode ?? "pie"} onChange={(e) => onChange({ pie_mode: e.target.value as any })}>
              <option value="pie">{t("props.pieFull")}</option>
              <option value="donut">{t("props.donut")}</option>
            </select>
          ))}
          {(obj.pie_mode ?? "pie") === "donut" && (
            <>
              {field(t("props.innerRadius"), <BindableInput obj={obj} propName="pie_inner_ratio" onChange={onChange}>{numInput("pie_inner_ratio", 0.5)}</BindableInput>)}
              {/* F7.3 — il foro era fisso #0f172a: su sfondo chiaro un disco nero. */}
              {field(t("props.holeColor"), colorInput("pie_hole_color", "#0f172a"))}
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["pie_show_labels", t("props.labels")], ["pie_show_legend", t("props.legend")]].map(([k,l]) => (
              <label key={k} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!(obj as any)[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />{l}
              </label>
            ))}
          </div>
          {/* F7.3 — contenuto delle etichette, unità e decimali del valore. */}
          {obj.pie_show_labels !== false && (
            <>
              {field(t("props.labelContent"), (
                <select style={{ ...INPUT, cursor: "pointer" }} value={obj.pie_label_mode ?? "percent"}
                  onChange={(e) => onChange({ pie_label_mode: e.target.value === "percent" ? undefined : (e.target.value as "value" | "value_percent" | "label_percent") })}>
                  <option value="percent">{t("props.labelPercent")}</option>
                  <option value="value">{t("props.labelValue")}</option>
                  <option value="value_percent">{t("props.labelValuePercent")}</option>
                  <option value="label_percent">{t("props.labelNamePercent")}</option>
                </select>
              ))}
              {(obj.pie_label_mode ?? "percent") !== "percent" && (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <div><div style={LABEL}>{t("props.unit")}</div>{textInput("unit", "")}</div>
                  <div><div style={LABEL}>{t("props.decimals")}</div>{numInput("decimals", 1)}</div>
                </div>
              )}
            </>
          )}
          {/* F7.3 — raggruppamento delle fette piccole e fetta staccata. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>{t("props.groupBelowPct")}</div>{numInput("pie_group_below_pct", 0)}</div>
            <div><div style={LABEL}>{t("props.explodePx")}</div>{numInput("pie_explode_px", 0)}</div>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "-2px 0 4px" }}>
            {t("props.pieGroupHint")}
          </p>
          {!!obj.pie_group_below_pct && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div><div style={LABEL}>{t("props.groupLabel")}</div>{textInput("pie_group_label", "altro")}</div>
              <div><div style={LABEL}>{t("props.color")}</div>{colorInput("pie_group_color", "#64748b")}</div>
            </div>
          )}
          {(obj.pie_mode ?? "pie") === "donut" && field(t("props.textCenter"), <BindableInput obj={obj} propName="pie_center_text" onChange={onChange}>{textInput("pie_center_text", "")}</BindableInput>)}
          {(obj.pie_mode ?? "pie") === "donut" && field(t("props.tagCenter"),
            <TagInput
              style={INPUT} placeholder="es. totale.kw"
              value={obj.pie_center_tag ?? ""}
              onChange={(v) => onChange({ pie_center_tag: v || undefined })}
            />
          )}
          {(obj.pie_mode ?? "pie") === "donut" && obj.pie_center_tag && field(t("props.format"), textInput("pie_center_format", "{value}"))}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700 }}>SLICE</div>
          {(obj.pie_slices ?? []).map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
              <TagInput style={{ ...INPUT, flex: 1 }} placeholder="tag" value={s.tag}
                onChange={(v) => { const next = [...(obj.pie_slices ?? [])]; next[i] = { ...s, tag: v }; onChange({ pie_slices: next }); }} />
              <input style={{ ...INPUT, width: 60 }} placeholder="label" value={s.label}
                onChange={(e) => { const next = [...(obj.pie_slices ?? [])]; next[i] = { ...s, label: e.target.value }; onChange({ pie_slices: next }); }} />
              <input type="color" value={s.color ?? PALETTE[i % PALETTE.length]} onChange={(e) => { const next = [...(obj.pie_slices ?? [])]; next[i] = { ...s, color: e.target.value }; onChange({ pie_slices: next }); }}
                style={{ width: 28, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />
              <button style={{ ...INPUT, width: "auto", padding: "0 6px", cursor: "pointer" }}
                onClick={() => onChange({ pie_slices: (obj.pie_slices ?? []).filter((_, j) => j !== i) })}>✕</button>
            </div>
          ))}
          <button style={{ ...INPUT, width: "100%", cursor: "pointer" }}
            onClick={() => onChange({ pie_slices: [...(obj.pie_slices ?? []), { tag: "", label: `Slice ${(obj.pie_slices?.length ?? 0) + 1}` }] })}>
            + Aggiungi slice
          </button>
        </>
      )}

      {/* Sparkline */}
      {obj.type === "kpi_tile" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "KPI")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. plant.power"))}
          {field(t("props.unit"), <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          {field(t("props.decimals"), <BindableInput obj={obj} propName="decimals" onChange={onChange}>{numInput("decimals", 1)}</BindableInput>)}
          {field(t("props.kpiWindow"), numInput("spark_window_s", 3600))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Warn high</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>Alarm high</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
          </div>
        </>
      )}

      {obj.type === "data_log" && (
        <>
          {field(t("props.label"), <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Data log")}</BindableInput>)}
          {field(t("props.tag"), tagInput("es. plant.power"))}
          {field(t("props.windowS"), numInput("window_s", 3600))}
          {field(t("props.pageSize"), numInput("datalog_page_size", 25))}
          {field(t("props.decimals"), <BindableInput obj={obj} propName="decimals" onChange={onChange}>{numInput("decimals", 1)}</BindableInput>)}
        </>
      )}

      {obj.type === "sparkline" && (
        <>
          {field(t("props.tag"), tagInput("es. flow.rate"))}
          {field(t("props.windowS"), <BindableInput obj={obj} propName="spark_window_s" onChange={onChange}>{numInput("spark_window_s", 60)}</BindableInput>)}
          {field(t("props.colorLine"), <input type="color" value={obj.spark_color ?? "var(--brand-primary, #3b82f6)"} onChange={(e) => onChange({ spark_color: e.target.value })} style={{ width: 40, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />)}
          {field(t("props.thicknessPx"), numInput("spark_stroke_width", 1.5))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Y min</div><BindableInput obj={obj} propName="y_min" onChange={onChange}>{numInput("y_min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Y max</div><BindableInput obj={obj} propName="y_max" onChange={onChange}>{numInput("y_max", 0)}</BindableInput></div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["spark_fill","Fill area"], ["spark_show_last","Mostra ultimo"]].map(([k,l]) => (
              <label key={k} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!(obj as any)[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />{l}
              </label>
            ))}
          </div>
          {obj.spark_fill && field(t("props.opacityFill"), numInput("spark_fill_opacity", 0.2))}
        </>
      )}

      {/* Alarm Viewer */}
      {obj.type === "alarm_viewer" && (
        <>
          {field(t("props.mode"), (
            <select style={INPUT} value={obj.alarm_viewer_mode ?? "list"} onChange={(e) => onChange({ alarm_viewer_mode: e.target.value as any })}>
              <option value="list">{t("props.list")}</option>
              <option value="banner">{t("props.scrollingBanner")}</option>
              <option value="table">{t("props.table")}</option>
            </select>
          ))}
          {field(t("props.maxRows"), <BindableInput obj={obj} propName="alarm_viewer_max_rows" onChange={onChange}>{numInput("alarm_viewer_max_rows", 5)}</BindableInput>)}
          {field(t("props.alarmIdPrefix"), <input style={INPUT} placeholder={t("props.exZone")} value={obj.alarm_viewer_id_prefix ?? ""} onChange={(e) => onChange({ alarm_viewer_id_prefix: e.target.value })} />)}
          {field(t("props.severity"), severityFilterField("alarm_viewer_severities"))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["alarm_viewer_show_ack","Mostra ACK"], ["alarm_viewer_show_ts","Timestamp"], ["alarm_viewer_show_empty","Mostra vuoto"]].map(([k,l]) => (
              <label key={k} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!(obj as any)[k] || (obj as any)[k] === undefined} onChange={(e) => onChange({ [k]: e.target.checked })} />{l}
              </label>
            ))}
          </div>
          {field(t("props.emptyBackground"), <input type="color" value={obj.alarm_viewer_bg_color ?? "var(--brand-bg, #0f172a)"} onChange={(e) => onChange({ alarm_viewer_bg_color: e.target.value })} style={{ width: 40, height: 24, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />)}
          {/* F7.5 — ACK massivo e messa in silenzio, solo in modalità tabella
              (in "list"/"banner" non c'è spazio per i comandi). */}
          {(obj.alarm_viewer_mode ?? "list") === "table" && (
            <>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={!!obj.alarm_viewer_show_ack_all}
                    onChange={(e) => onChange({ alarm_viewer_show_ack_all: e.target.checked || undefined })} />
                  {t("props.ackAll")}
                </label>
                <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={!!obj.alarm_viewer_show_shelve}
                    onChange={(e) => onChange({ alarm_viewer_show_shelve: e.target.checked || undefined })} />
                  {t("props.shelveBtn")}
                </label>
              </div>
              {obj.alarm_viewer_show_shelve && field(t("props.shelveMinutes"), numInput("alarm_shelve_minutes", 15))}
              <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "2px 0 4px" }}>
                {t("props.ackAllHint")}
              </p>
            </>
          )}
        </>
      )}

      {/* Storico allarmi piazzabile (F7.5) */}
      {obj.type === "alarm_history" && (
        <>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>
            {t("props.alarmHistoryHint")}
          </div>
          {field(t("props.alarmIdFilter"),
            <input style={INPUT} placeholder={t("props.allAlarms")}
              value={obj.alarm_history_id ?? ""}
              onChange={(e) => onChange({ alarm_history_id: e.target.value || undefined })} />
          )}
        </>
      )}

      {/* Alarm Bell — click apre sempre il dropdown allarmi, nessuna azione configurabile */}
      {obj.type === "alarm_bell" && (
        <>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>
            {t("props.alarmBellHint")}
          </div>
          {field(t("props.alarmIdPrefix"), <input style={INPUT} placeholder={t("props.exZone")} value={obj.alarm_bell_id_prefix ?? ""} onChange={(e) => onChange({ alarm_bell_id_prefix: e.target.value })} />)}
          {field(t("props.severity"), severityFilterField("alarm_bell_severities"))}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[["alarm_bell_show_history", t("props.showHistory")], ["alarm_bell_show_shelve", t("props.showShelve")]].map(([k, l]) => (
              <label key={k} style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "flex", gap: 3, alignItems: "center" }}>
                <input type="checkbox" checked={!!(obj as any)[k] || (obj as any)[k] === undefined} onChange={(e) => onChange({ [k]: e.target.checked } as Partial<SynopticObject>)} />{l}
              </label>
            ))}
          </div>
          {field(t("props.color"), <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "var(--brand-surface, #1e293b)")}</BindableInput>)}
        </>
      )}

      {/* Alarm Banner */}
      {obj.type === "alarm_banner" && (
        <>
          {field(t("props.alarmIdPrefix"), <input style={INPUT} placeholder={t("props.exZone")} value={obj.alarm_banner_id_prefix ?? ""} onChange={(e) => onChange({ alarm_banner_id_prefix: e.target.value })} />)}
          {field(t("props.severity"), severityFilterField("alarm_banner_severities"))}
        </>
      )}

      {/* Recipe panel — lista ricette + applica, promosso dal modale fisso di RuntimeView.tsx */}
      {obj.type === "recipe_panel" && (
        <>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>
            {t("props.recipePanelHint")}
          </div>
          {field(t("props.recipeIdPrefix"), <input style={INPUT} placeholder="es. linea1-" value={obj.recipe_panel_id_prefix ?? ""} onChange={(e) => onChange({ recipe_panel_id_prefix: e.target.value })} />)}
        </>
      )}

      {/* Symbol (built-in SCADA library + custom project symbols) */}
      {obj.type === "symbol" && (
        <>
          {field(t("props.symbol"),
            <SymbolGallery value={obj.symbol_id ?? "pump"} onChange={(v) => onChange({ symbol_id: v as any })} />
          )}
          {field(t("props.tagState"),
            <TagInput
              style={INPUT} placeholder={t("props.exRunning")}
              value={obj.state_tag ?? ""}
              onChange={(v) => onChange({ state_tag: v || undefined })}
            />
          )}
          {field(t("props.tagAlarm"),
            <TagInput
              style={INPUT} placeholder={t("props.exFault")}
              value={obj.alarm_tag ?? ""}
              onChange={(v) => onChange({ alarm_tag: v || undefined })}
            />
          )}
          <div style={(obj.symbol_states?.length ?? 0) > 0 ? { opacity: 0.45 } : undefined}>
            {(obj.symbol_states?.length ?? 0) > 0 && (
              <p style={{ fontSize: 10, color: "var(--brand-warning, #f59e0b)", margin: "0 0 4px" }}>
                {t("props.statesPrecedence")}
              </p>
            )}
            {field(t("props.colorOff"),   <BindableInput obj={obj} propName="state_off_color"   onChange={onChange}>{colorInput("state_off_color",   "var(--brand-text-subtle, #64748b)")}</BindableInput>)}
            {field(t("props.colorOn"),    <BindableInput obj={obj} propName="state_on_color"    onChange={onChange}>{colorInput("state_on_color",    "var(--brand-success, #22c55e)")}</BindableInput>)}
            {field(t("props.colorAlarm"), <BindableInput obj={obj} propName="state_alarm_color" onChange={onChange}>{colorInput("state_alarm_color", "var(--brand-danger, #ef4444)")}</BindableInput>)}
          </div>
          {/* F6.6: stati N — mappa valore→colore/lampeggio/label sul valore di
              state_tag (valore esatto o range, come le VOCI di text_list). */}
          <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 8, marginBottom: 2, fontWeight: 700 }}>
            {t("props.symbolStates")}
          </div>
          {(obj.symbol_states ?? []).map((e, i) => {
            const upd = (patch: Partial<TextListEntry>) => {
              const next = [...(obj.symbol_states ?? [])];
              next[i] = { ...e, ...patch };
              onChange({ symbol_states: next });
            };
            return (
              <div key={i} style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 4, padding: 4, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input style={{ ...INPUT, width: 48 }} placeholder="val" value={String(e.value)}
                    onChange={(ev) => upd({ value: ev.target.value })} />
                  <input style={{ ...INPUT, width: 44 }} type="number" placeholder="min" value={e.value_min ?? ""}
                    onChange={(ev) => upd({ value_min: ev.target.value === "" ? undefined : Number(ev.target.value) })} />
                  <input style={{ ...INPUT, width: 44 }} type="number" placeholder="max" value={e.value_max ?? ""}
                    onChange={(ev) => upd({ value_max: ev.target.value === "" ? undefined : Number(ev.target.value) })} />
                  <input type="color" value={e.color ?? "#22c55e"}
                    onChange={(ev) => upd({ color: ev.target.value })}
                    style={{ width: 26, height: 22, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />
                  <button style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer" }}
                    onClick={() => onChange({ symbol_states: (obj.symbol_states ?? []).filter((_, j) => j !== i) })}>✕</button>
                </div>
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input style={{ ...INPUT, flex: 1 }} placeholder="label" value={e.label}
                    onChange={(ev) => upd({ label: ev.target.value })} />
                  <label style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", display: "flex", gap: 3, alignItems: "center" }}>
                    <input type="checkbox" checked={!!e.blink} onChange={(ev) => upd({ blink: ev.target.checked || undefined })} />
                    blink
                  </label>
                </div>
              </div>
            );
          })}
          <button style={{ ...INPUT, width: "100%", cursor: "pointer", marginBottom: 4 }}
            onClick={() => onChange({ symbol_states: [...(obj.symbol_states ?? []), { value: "", label: "", color: "#22c55e" }] })}>
            + {t("props.addState")}
          </button>
          {/* F6.10: rotazione continua */}
          {field(t("props.symbolSpin"), (
            <select style={{ ...INPUT, cursor: "pointer" }} value={obj.symbol_spin ?? ""}
              onChange={(e) => onChange({ symbol_spin: (e.target.value || undefined) as SynopticObject["symbol_spin"] })}>
              <option value="">{t("props.blinkOff")}</option>
              <option value="on_state">{t("props.spinOnState")}</option>
              <option value="tag">{t("props.blinkTag")}</option>
              <option value="always">{t("props.blinkAlways")}</option>
            </select>
          ))}
          {obj.symbol_spin === "tag" && field(t("props.blinkTagField"),
            <TagInput style={INPUT} placeholder="es. fan1.running" value={obj.symbol_spin_tag ?? ""}
              onChange={(v) => onChange({ symbol_spin_tag: v || undefined })} />
          )}
          {obj.symbol_spin && field(t("props.spinPeriod"), numInput("symbol_spin_s", 2))}
          {/* F6.7: livello continuo (tank) */}
          {field(t("props.levelTag"),
            <TagInput style={INPUT} placeholder="es. tank1.level" value={obj.fill_level_tag ?? ""}
              onChange={(v) => onChange({ fill_level_tag: v || undefined })} />
          )}
        </>
      )}

      {/* Faceplate instance (parametric reusable component, defined in Config → Faceplates) */}
      {obj.type === "faceplate" && (() => {
        const defn = faceplates.find((f) => f.id === obj.faceplate_id);
        return (
          <>
            {field(t("props.faceplate"), (
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.faceplate_id ?? ""}
                onChange={(e) => onChange({ faceplate_id: e.target.value || undefined, faceplate_params: {} })}
              >
                <option value="">{t("props.faceplateChoose")}</option>
                {faceplates.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
              </select>
            ))}
            {!defn && obj.faceplate_id && (
              <p style={{ fontSize: 10, color: "var(--brand-warning, #f59e0b)", margin: "2px 0 4px" }}>
                {t("props.faceplateMissing")}
              </p>
            )}
            {defn && defn.params.length > 0 && (
              <>
                <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 6, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
                  {t("props.faceplateParams")}
                </div>
                {normalizeFaceplateParams(defn).map((p) => {
                  const val = obj.faceplate_params?.[p.name] ?? "";
                  const missing = !!p.required && val.trim() === "" && (p.default === undefined || p.default === "");
                  const setVal = (v: string) => onChange({ faceplate_params: { ...(obj.faceplate_params ?? {}), [p.name]: v } });
                  const style = { ...INPUT, borderColor: missing ? "var(--brand-danger, #ef4444)" : undefined };
                  return (
                    <div key={p.name}>
                      <div style={LABEL}>
                        {p.name}{p.required ? " *" : ""}{p.type ? ` (${p.type})` : ""}
                      </div>
                      {p.type === "tag" ? (
                        <TagInput style={style} placeholder={p.default ?? ""} value={val} onChange={setVal} />
                      ) : p.type === "color" ? (
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <input type="color" value={val || p.default || "#3b82f6"}
                            onChange={(e) => setVal(e.target.value)}
                            style={{ width: 40, height: 26, padding: 1, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3 }} />
                          <input type="text" style={{ ...style, flex: 1 }} placeholder={p.default ?? ""} value={val}
                            onChange={(e) => setVal(e.target.value)} />
                        </div>
                      ) : (
                        <input type={p.type === "number" ? "number" : "text"} style={style}
                          placeholder={p.default ?? ""} value={val}
                          onChange={(e) => setVal(e.target.value)} />
                      )}
                      {missing && (
                        <div style={{ fontSize: 10, color: "var(--brand-danger-soft, #fca5a5)" }}>{t("props.paramRequired")}</div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
            {/* F6.4: scaling dei figli al box dell'istanza (opt-in) */}
            {defn && field(t("props.faceplateScale"),
              <input type="checkbox" checked={!!obj.faceplate_scale}
                onChange={(e) => onChange({ faceplate_scale: e.target.checked || undefined })} />
            )}
          </>
        );
      })()}

      {/* ── Pipe / connector ────────────────────────────────────────────────── */}
      {obj.type === "pipe" && (
        <>
          {/* Routing + style */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={LABEL}>{t("props.path")}</div>
              <select style={{ ...INPUT, cursor: "pointer" }}
                value={obj.routing ?? "straight"}
                onChange={(e) => onChange({ routing: e.target.value as "straight" | "orthogonal" | "diagonal" | "bezier" })}>
                <option value="straight">{t("props.straightLines")}</option>
                <option value="bezier">{t("props.curved")}</option>
                <option value="orthogonal">{t("props.ortho90")}</option>
                <option value="diagonal">{t("props.diag45")}</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Stile</div>
              <select style={{ ...INPUT, cursor: "pointer" }}
                value={obj.pipe_style ?? "flat"}
                onChange={(e) => onChange({ pipe_style: e.target.value as "flat" | "tube" | "wire" })}>
                <option value="flat">{t("props.flat")}</option>
                <option value="tube">{t("props.pipe3d")}</option>
                <option value="wire">{t("props.wire")}</option>
              </select>
            </div>
          </div>

          {/* Stroke */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              {field(t("props.colorPipe"), <BindableInput obj={obj} propName="stroke" onChange={onChange}>{colorInput("stroke", "var(--brand-text-subtle, #64748b)")}</BindableInput>)}
            </div>
            <div>
              {field(t("props.thicknessPx"), numInput("stroke_width", 8))}
            </div>
          </div>

          {/* Tratteggio */}
          {field(t("props.dashArray"), textInput("stroke_dasharray", "6,3"))}

          {/* Gradiente (tube style) */}
          {(obj.pipe_style === "tube" || obj.pipe_gradient) && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <div>{field(t("props.colorLight"), <BindableInput obj={obj} propName="gradient_light_color" onChange={onChange}>{colorInput("gradient_light_color", "var(--brand-text-muted, #94a3b8)")}</BindableInput>)}</div>
                <div>{field(t("props.colorDark"),  <BindableInput obj={obj} propName="gradient_dark_color" onChange={onChange}>{colorInput("gradient_dark_color",  "var(--brand-surface-2, #334155)")}</BindableInput>)}</div>
              </div>
            </>
          )}

          {/* Fill level */}
          <CollapsibleSection title={t("props.fluidFill")} storageKey="pipe-fill">
            {field(t("props.tagLevel"),
              <TagInput
                style={INPUT} placeholder={t("props.exLevel")}
                value={obj.fill_level_tag ?? ""}
                onChange={(v) => onChange({ fill_level_tag: v || undefined })}
              />
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={LABEL}>{t("props.tagScale")}</div>
                <select style={{ ...INPUT, cursor: "pointer" }}
                  value={obj.fill_level_scale ?? "0-100"}
                  onChange={(e) => onChange({ fill_level_scale: e.target.value as "0-1" | "0-100" })}>
                  <option value="0-100">0 – 100</option>
                  <option value="0-1">0.0 – 1.0</option>
                </select>
              </div>
              <div>
                <div style={LABEL}>{t("props.direction")}</div>
                <select style={{ ...INPUT, cursor: "pointer" }}
                  value={obj.fill_direction ?? "start-to-end"}
                  onChange={(e) => onChange({ fill_direction: e.target.value as "start-to-end" | "end-to-start" })}>
                  <option value="start-to-end">{t("props.startToEnd")}</option>
                  <option value="end-to-start">{t("props.endToStart")}</option>
                </select>
              </div>
            </div>
            {field(t("props.staticLevel"), numInput("fill_level", 0))}
            {field(t("props.colorFluid"), <BindableInput obj={obj} propName="fill_color" onChange={onChange}>{colorInput("fill_color", "var(--brand-primary, #3b82f6)")}</BindableInput>)}
          </CollapsibleSection>

          {/* Markers */}
          <CollapsibleSection title={t("props.endMarker")} storageKey="pipe-markers">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div>
                <div style={LABEL}>{t("props.markerStart")}</div>
                <select style={{ ...INPUT, cursor: "pointer" }}
                  value={obj.start_marker ?? "none"}
                  onChange={(e) => onChange({ start_marker: e.target.value as "none" | "arrow" | "dot" | "flange" })}>
                  <option value="none">{t("props.noneM")}</option>
                  <option value="arrow">{t("props.arrow")}</option>
                  <option value="dot">{t("props.dot")}</option>
                  <option value="flange">{t("props.flange")}</option>
                </select>
              </div>
              <div>
                <div style={LABEL}>{t("props.markerEnd")}</div>
                <select style={{ ...INPUT, cursor: "pointer" }}
                  value={obj.end_marker ?? "none"}
                  onChange={(e) => onChange({ end_marker: e.target.value as "none" | "arrow" | "dot" | "flange" })}>
                  <option value="none">{t("props.noneM")}</option>
                  <option value="arrow">{t("props.arrow")}</option>
                  <option value="dot">{t("props.dot")}</option>
                  <option value="flange">{t("props.flange")}</option>
                </select>
              </div>
            </div>
            {field(t("props.markerSize"), <BindableInput obj={obj} propName="marker_size" onChange={onChange}>{numInput("marker_size", 1)}</BindableInput>)}
          </CollapsibleSection>

          {/* State coloring */}
          <CollapsibleSection title={t("props.stateAndAlarm")} storageKey="pipe-state">
            {field(t("props.tagState"),
              <TagInput style={INPUT} placeholder={t("props.exRunning")}
                value={obj.state_tag ?? ""}
                onChange={(v) => onChange({ state_tag: v || undefined })} />
            )}
            {field(t("props.tagAlarm"),
              <TagInput style={INPUT} placeholder={t("props.exFault")}
                value={obj.alarm_tag ?? ""}
                onChange={(v) => onChange({ alarm_tag: v || undefined })} />
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              <div>{field(t("props.off"),   <BindableInput obj={obj} propName="state_off_color"   onChange={onChange}>{colorInput("state_off_color",   "var(--brand-text-subtle, #64748b)")}</BindableInput>)}</div>
              <div>{field(t("props.on"),    <BindableInput obj={obj} propName="state_on_color"    onChange={onChange}>{colorInput("state_on_color",    "var(--brand-success, #22c55e)")}</BindableInput>)}</div>
              <div>{field(t("props.alarmWord"), <BindableInput obj={obj} propName="state_alarm_color" onChange={onChange}>{colorInput("state_alarm_color", "var(--brand-danger, #ef4444)")}</BindableInput>)}</div>
            </div>
          </CollapsibleSection>

          {/* Label */}
          <CollapsibleSection title={t("props.label")} storageKey="pipe-label">
            {field(t("props.text"), textInput("pipe_label", "es. P-101"))}
            {field(t("props.tagValue"),
              <TagInput style={INPUT} placeholder={t("props.exFlow")}
                value={obj.pipe_label_tag ?? ""}
                onChange={(v) => onChange({ pipe_label_tag: v || undefined })} />
            )}
            {field(t("props.format"), textInput("pipe_label_format", "{value:.1f}"))}
            {field(t("props.offsetPx"), numInput("pipe_label_offset", 10))}
            {field(t("props.labelColor"), <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "#e2e8f0")}</BindableInput>)}
            {field(t("props.fontSize"), <BindableInput obj={obj} propName="font_size" onChange={onChange}>{numInput("font_size", 12)}</BindableInput>)}
            {/* F6.10: flusso animato */}
            {field(t("props.pipeFlow"),
              <input type="checkbox" checked={!!obj.pipe_flow}
                onChange={(e) => onChange({ pipe_flow: e.target.checked || undefined })} />
            )}
            {obj.pipe_flow && field(t("props.pipeFlowTag"),
              <TagInput style={INPUT} placeholder="es. pump1.flow (segno = direzione)" value={obj.pipe_flow_tag ?? ""}
                onChange={(v) => onChange({ pipe_flow_tag: v || undefined })} />
            )}
          </CollapsibleSection>

          {/* Connection anchoring */}
          <CollapsibleSection title={t("props.snapObjects")} storageKey="pipe-anchor">
            <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 6px" }}>
              Quando impostato, il primo / ultimo waypoint segue l'oggetto collegato.
            </p>
            {field(t("props.sourceObjId"), textInput("from_obj_id", "es. pump-1"))}
            <div style={LABEL}>{t("props.sourcePort")}</div>
            <select style={{ ...INPUT, cursor: "pointer" }}
              value={obj.from_port ?? "center"}
              onChange={(e) => onChange({ from_port: e.target.value as "top" | "bottom" | "left" | "right" | "center" })}>
              <option value="center">{t("props.center")}</option>
              <option value="top">{t("props.above")}</option>
              <option value="bottom">{t("props.below")}</option>
              <option value="left">{t("props.left")}</option>
              <option value="right">{t("props.right")}</option>
            </select>
            {field(t("props.targetObjId"), textInput("to_obj_id", "es. tank-1"))}
            <div style={LABEL}>{t("props.targetPort")}</div>
            <select style={{ ...INPUT, cursor: "pointer" }}
              value={obj.to_port ?? "center"}
              onChange={(e) => onChange({ to_port: e.target.value as "top" | "bottom" | "left" | "right" | "center" })}>
              <option value="center">{t("props.center")}</option>
              <option value="top">{t("props.above")}</option>
              <option value="bottom">{t("props.below")}</option>
              <option value="left">{t("props.left")}</option>
              <option value="right">{t("props.right")}</option>
            </select>
          </CollapsibleSection>

          {/* Waypoints editor */}
          <CollapsibleSection title={t("props.waypoint")} storageKey="pipe-points">
            <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
              Trascina i punti gialli sul canvas. Usa ± per aggiungere/rimuovere.
            </p>
            {(obj.points ?? []).map((pt, i) => (
              <div key={i} style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 3 }}>
                <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", width: 18, flexShrink: 0 }}>{i}</span>
                <input type="number" style={{ ...INPUT, width: 58 }} value={pt.x}
                  onChange={(e) => {
                    const pts = [...(obj.points ?? [])];
                    pts[i] = { ...pts[i], x: Number(e.target.value) };
                    onChange({ points: pts });
                  }} />
                <input type="number" style={{ ...INPUT, width: 58 }} value={pt.y}
                  onChange={(e) => {
                    const pts = [...(obj.points ?? [])];
                    pts[i] = { ...pts[i], y: Number(e.target.value) };
                    onChange({ points: pts });
                  }} />
                {(obj.points ?? []).length > 2 && (
                  <button style={{ ...INPUT, cursor: "pointer", padding: "2px 6px", width: 22 }}
                    title={t("props.removeWaypoint")}
                    onClick={() => {
                      const pts = (obj.points ?? []).filter((_, idx) => idx !== i);
                      onChange({ points: pts });
                    }}>−</button>
                )}
              </div>
            ))}
            <button
              style={{ ...INPUT, cursor: "pointer", width: "100%", marginTop: 2 }}
              onClick={() => {
                const pts = [...(obj.points ?? [])];
                const last = pts[pts.length - 1] ?? { x: obj.x, y: obj.y };
                pts.push({ x: last.x + 40, y: last.y });
                onChange({ points: pts });
              }}>
              + Aggiungi waypoint
            </button>
          </CollapsibleSection>
        </>
      )}

      {/* ── Cross-cutting: rotation / flip / opacity (advanced, collapsed) */}
      {SUPPORTS_TRANSFORM.has(obj.type) && (
        <CollapsibleSection title={t("props.transform")} storageKey="transform">
          {field(t("props.rotationDeg"),
            <BindableInput obj={obj} propName="rotation" onChange={onChange}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="number"
                  value={obj.rotation ?? 0}
                  onChange={(e) => onChange({ rotation: Number(e.target.value) || 0 })}
                  style={{ ...INPUT, flex: 1 }}
                />
                <button
                  title={t("props.resetTo0deg")}
                  onClick={() => onChange({ rotation: undefined })}
                  style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
                >↺</button>
              </div>
            </BindableInput>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!obj.flip_h}
                onChange={(e) => onChange({ flip_h: e.target.checked || undefined })}
                style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
              />
              Flip orizzontale
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!obj.flip_v}
                onChange={(e) => onChange({ flip_v: e.target.checked || undefined })}
                style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
              />
              Flip verticale
            </label>
          </div>
          {field(t("props.opacityRange"),
            <BindableInput obj={obj} propName="opacity" onChange={onChange}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="number"
                  min={0} max={1} step={0.05}
                  value={obj.opacity ?? 1}
                  onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                  style={{ ...INPUT, flex: 1 }}
                />
                <button
                  title={t("props.resetTo1")}
                  onClick={() => onChange({ opacity: undefined })}
                  style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
                >↺</button>
              </div>
            </BindableInput>
          )}
          {field(t("props.transitionMs"),
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="number"
                min={0} max={5000} step={50}
                value={obj.transition_duration_ms ?? 0}
                onChange={(e) => onChange({ transition_duration_ms: Number(e.target.value) || undefined })}
                style={{ ...INPUT, flex: 1 }}
              />
              <button
                title={t("props.disableAnim")}
                onClick={() => onChange({ transition_duration_ms: undefined })}
                style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
              >↺</button>
            </div>
          )}
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
            0 = nessuna animazione. Anima fill/stroke/opacity/rotazione bindati. Testo, font-size, src e geometrie restano discreti.
          </p>
        </CollapsibleSection>
      )}

      {/* ── Cross-cutting: layer & visibility (advanced, collapsed) ─── */}
      <CollapsibleSection title={t("props.layerVisibility")} storageKey="layer">
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 4, alignItems: "end" }}>
          <div><div style={LABEL}>z-index</div><BindableInput obj={obj} propName="z_index" onChange={onChange}>{numInput("z_index", 0)}</BindableInput></div>
          <button
            title={t("props.sendBackward")}
            onClick={() => onChange({ z_index: (obj.z_index ?? 0) - 1 })}
            style={{ ...INPUT, cursor: "pointer", padding: "3px 8px", height: 26 }}
          >▼</button>
          <button
            title={t("props.bringForward")}
            onClick={() => onChange({ z_index: (obj.z_index ?? 0) + 1 })}
            style={{ ...INPUT, cursor: "pointer", padding: "3px 8px", height: 26 }}
          >▲</button>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginTop: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={obj.visible !== false}
            onChange={(e) => onChange({ visible: e.target.checked })}
            style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
          />
          Visibile (statico)
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginTop: 4, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={obj.locked === true}
            onChange={(e) => onChange({ locked: e.target.checked ? true : undefined })}
            style={{ accentColor: "var(--brand-warning, #f59e0b)" }}
          />
          Bloccato (non selezionabile nell'editor)
        </label>
        <div>
          <div style={LABEL}>{t("props.tagVisOverride")}</div>
          <TagInput
            style={INPUT}
            placeholder={t("props.exValve")}
            value={obj.visible_tag ?? ""}
            onChange={(v) => onChange({ visible_tag: v || undefined })}
          />
        </div>
      </CollapsibleSection>

      {/* ── Quality dot — always present; hint when no tag bound ──────── */}
      <CollapsibleSection
        title={t("props.qualityIndicator")}
        storageKey="quality"
        hint={!obj.tag ? "Imposta un tag (sezione Tag) per personalizzare i colori." : undefined}
      >
        {/* 2026-08-23: per i tipi dove obj.tag non è il dato primario, il tag
            che alimenta allarme/stale/qualità si imposta QUI (il campo Tag
            generico in alto per loro non esiste più). */}
        {["bar_chart","pie_chart","table","symbol",
          "alarm_viewer","alarm_bell","alarm_banner","alarm_history","recipe_panel","grid","faceplate",
          "image","lang_button","lang_selector"].includes(obj.type) &&
          field(t("props.stateTag"),
            <TagInput style={INPUT} placeholder={t("props.stateTagPh")}
              value={obj.tag ?? ""}
              onChange={(v) => onChange({ tag: v || undefined })} />
          )}
        {!obj.tag ? (
          <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "0 0 4px" }}>
            Questo oggetto non ha un tag bound. L'indicatore di qualità verrà
            mostrato automaticamente quando colleghi un tag.
          </p>
        ) : (
          <>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={QDOT_BUILTIN_TYPES.has(obj.type) ? obj.quality_dot !== false : obj.quality_dot === true}
                onChange={(e) => onChange({
                  // F4.3: sui tipi col QDot integrato il default resta ON
                  // (undefined=on, false=off); sugli altri è opt-in esplicito
                  // (true=on, undefined=off) — così le pagine esistenti non
                  // si riempiono di pallini a sorpresa.
                  quality_dot: QDOT_BUILTIN_TYPES.has(obj.type)
                    ? (e.target.checked ? undefined : false)
                    : (e.target.checked ? true : undefined),
                })}
                style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
              />
              Mostra indicatore qualità
            </label>
            {obj.quality_dot !== false && (
              <>
                {field(t("props.colorGood"),    colorInput("quality_dot_good_color",      "var(--brand-success, #22c55e)"))}
                {field(t("props.colorUncertain"), colorInput("quality_dot_uncertain_color", "var(--brand-warning, #eab308)"))}
                {field(t("props.colorBad"),    colorInput("quality_dot_bad_color",       "var(--brand-danger, #ef4444)"))}
              </>
            )}
            {/* F4.2/F4.3: consapevolezza allarme, Bad-gray, stale (opt-in) */}
            {field(t("props.showAlarmState"),
              <input type="checkbox" checked={!!obj.show_alarm_state}
                onChange={(e) => onChange({ show_alarm_state: e.target.checked || undefined })} />
            )}
            {field(t("props.badValueGray"),
              <input type="checkbox" checked={obj.bad_value_style === "gray"}
                onChange={(e) => onChange({ bad_value_style: e.target.checked ? "gray" : undefined })} />
            )}
            {field(t("props.staleAfterS"), numInput("stale_after_s", 0))}
          </>
        )}
        {/* F4.1: lampeggio universale — anche senza tag (modalità fissa/tag) */}
        {field(t("props.blinkMode"), (
          <select style={{ ...INPUT, cursor: "pointer" }} value={obj.blink_mode ?? ""}
            onChange={(e) => onChange({ blink_mode: (e.target.value || undefined) as SynopticObject["blink_mode"] })}>
            <option value="">{t("props.blinkOff")}</option>
            <option value="always">{t("props.blinkAlways")}</option>
            <option value="tag">{t("props.blinkTag")}</option>
            <option value="alarm">{t("props.blinkAlarm")}</option>
          </select>
        ))}
        {obj.blink_mode === "tag" && field(t("props.blinkTagField"),
          <TagInput style={INPUT} placeholder="es. plant.warning" value={obj.blink_tag ?? ""}
            onChange={(v) => onChange({ blink_tag: v || undefined })} />
        )}
        {obj.blink_mode && field(t("props.blinkRate"), numInput("blink_rate_ms", 800))}
      </CollapsibleSection>

      {/* ── Event scripts (advanced, collapsed) ─────────────────────── */}
      {/* Not for `grid`: it dispatches on_press_fn/on_release_fn per-cell
       *  (GridCell, edited in that object's own panel below), not at the
       *  object level — SvgCanvas.tsx's press/release dispatcher explicitly
       *  skips grid objects, so obj.on_press_fn/on_release_fn here would be
       *  dead config a user could set but that would never fire. */}
      {/* F3 — SICUREZZA: gating per ruolo + conferma comando, universali. */}
      <CollapsibleSection
        title={t("props.security")}
        storageKey="security"
        headerExtra={
          (obj.min_role || obj.require_confirm)
            ? <span style={{ fontSize: 10, color: "var(--brand-warning, #f59e0b)", fontWeight: 700 }}>●</span>
            : undefined
        }
      >
        {field(t("props.minRole"), (
          <select style={{ ...INPUT, cursor: "pointer" }} value={obj.min_role ?? ""}
            onChange={(e) => onChange({ min_role: (e.target.value || undefined) as SynopticObject["min_role"] })}>
            <option value="">{t("props.minRoleNone")}</option>
            <option value="Viewer">Viewer</option>
            <option value="Operator">Operator</option>
            <option value="Supervisor">Supervisor</option>
            <option value="Admin">Admin</option>
          </select>
        ))}
        {obj.min_role && field(t("props.minRoleEffect"), (
          <select style={{ ...INPUT, cursor: "pointer" }} value={obj.min_role_effect ?? "disable"}
            onChange={(e) => onChange({ min_role_effect: e.target.value === "disable" ? undefined : "hide" })}>
            <option value="disable">{t("props.effectDisable")}</option>
            <option value="hide">{t("props.effectHide")}</option>
          </select>
        ))}
        {field(t("props.requireConfirm"),
          <input type="checkbox" checked={!!obj.require_confirm}
            onChange={(e) => onChange({ require_confirm: e.target.checked || undefined })} />
        )}
        {obj.require_confirm && field(t("props.confirmMessage"),
          textInput("confirm_message", t("props.confirmMessagePh"))
        )}
        {field(t("props.critical"),
          <input type="checkbox" checked={!!obj.critical}
            onChange={(e) => onChange({ critical: e.target.checked || undefined })} />
        )}
        {obj.critical && field(t("props.requireReason"),
          <input type="checkbox" checked={!!obj.require_reason}
            onChange={(e) => onChange({ require_reason: e.target.checked || undefined })} />
        )}
      </CollapsibleSection>

      {/* F6.10 — MOVIMENTO su percorso (universale) */}
      <CollapsibleSection
        title={t("props.motion")}
        storageKey="motion"
        headerExtra={obj.motion_tag ? <span style={{ fontSize: 10, color: "var(--brand-primary, #3b82f6)", fontWeight: 700 }}>●</span> : undefined}
      >
        {field(t("props.motionTag"),
          <TagInput style={INPUT} placeholder="es. carrello.posizione" value={obj.motion_tag ?? ""}
            onChange={(v) => onChange({ motion_tag: v || undefined })} />
        )}
        {obj.motion_tag && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <div><div style={LABEL}>Min</div>{numInput("motion_min", 0)}</div>
              <div><div style={LABEL}>Max</div>{numInput("motion_max", 100)}</div>
            </div>
            {field(t("props.motionAnchor"), (
              <select style={{ ...INPUT, cursor: "pointer" }} value={obj.motion_anchor ?? "center"}
                onChange={(e) => onChange({ motion_anchor: e.target.value === "center" ? undefined : "top_left" })}>
                <option value="center">{t("props.anchorCenter")}</option>
                <option value="top_left">{t("props.anchorTopLeft")}</option>
              </select>
            ))}
            {(() => {
              // 2026-08-23: waypoint come TABELLA (x/y editabili, ✕) +
              // pulsante di cattura ＋ che prende le coordinate cliccando
              // sul canvas (Esc o ri-click per uscire).
              const pts = obj.motion_path ?? [];
              const setPts = (next: { x: number; y: number }[]) =>
                onChange({ motion_path: next.length > 0 ? next : undefined });
              const capturing = capturePathTarget === obj.id;
              return (
                <div style={{ marginBottom: 4 }}>
                  <div style={{ ...LABEL, display: "flex", alignItems: "center", gap: 6 }}>
                    {t("props.motionPathTable")}
                    <button
                      title={t("props.motionCapture")}
                      onClick={() => setCapturePathTarget(capturing ? null : obj.id)}
                      style={{
                        marginLeft: "auto", cursor: "pointer", borderRadius: 4, fontSize: 12,
                        padding: "1px 8px", border: "1px solid",
                        borderColor: capturing ? "var(--brand-warning, #f59e0b)" : "var(--brand-surface-2, #334155)",
                        background: capturing ? "#3f2d10" : "var(--brand-bg, #0f172a)",
                        color: capturing ? "var(--brand-warning-soft, #fbbf24)" : "var(--brand-text-muted, #94a3b8)",
                      }}
                    >＋ {capturing ? t("props.motionCapturing") : t("props.motionCaptureBtn")}</button>
                  </div>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead>
                      <tr style={{ color: "var(--brand-text-subtle, #64748b)" }}>
                        <th style={{ textAlign: "left", fontWeight: 600, padding: "1px 4px", width: 22 }}>#</th>
                        <th style={{ textAlign: "left", fontWeight: 600, padding: "1px 4px" }}>X</th>
                        <th style={{ textAlign: "left", fontWeight: 600, padding: "1px 4px" }}>Y</th>
                        <th style={{ width: 22 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {pts.map((p, i) => (
                        <tr key={i}>
                          <td style={{ padding: "1px 4px", color: "var(--brand-text-subtle, #64748b)" }}>{i + 1}</td>
                          <td style={{ padding: "1px 2px" }}>
                            <input type="number" style={{ ...INPUT, padding: "1px 4px", fontSize: 11 }} value={p.x}
                              onFocus={() => setMotionMarker(p)}
                              onBlur={() => setMotionMarker(null)}
                              onChange={(e) => {
                                const x = Number(e.target.value);
                                setMotionMarker({ x, y: p.y });
                                setPts(pts.map((q, j) => (j === i ? { ...q, x } : q)));
                              }} />
                          </td>
                          <td style={{ padding: "1px 2px" }}>
                            <input type="number" style={{ ...INPUT, padding: "1px 4px", fontSize: 11 }} value={p.y}
                              onFocus={() => setMotionMarker(p)}
                              onBlur={() => setMotionMarker(null)}
                              onChange={(e) => {
                                const y = Number(e.target.value);
                                setMotionMarker({ x: p.x, y });
                                setPts(pts.map((q, j) => (j === i ? { ...q, y } : q)));
                              }} />
                          </td>
                          <td style={{ textAlign: "center" }}>
                            <button style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer" }}
                              onClick={() => setPts(pts.filter((_, j) => j !== i))}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <button
                    style={{ ...INPUT, cursor: "pointer", width: "100%", marginTop: 2, fontSize: 11, color: "var(--brand-text-subtle, #64748b)", borderStyle: "dashed" }}
                    onClick={() => setPts([...pts, { x: (pts[pts.length - 1]?.x ?? obj.x) + 50, y: pts[pts.length - 1]?.y ?? obj.y }])}
                  >+ {t("props.motionAddRow")}</button>
                </div>
              );
            })()}
            <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
              {t("props.motionHint")}
            </p>
          </>
        )}
      </CollapsibleSection>

      {obj.type !== "grid" && (
        <CollapsibleSection
          title={t("props.events")}
          storageKey="events"
          headerExtra={
            (obj.on_press_fn || obj.on_release_fn)
              ? <span style={{ fontSize: 10, color: "var(--brand-primary, #3b82f6)", fontWeight: 700 }}>
                  ({(obj.on_press_fn ? 1 : 0) + (obj.on_release_fn ? 1 : 0)})
                </span>
              : null
          }
        >
          <EventFunctionPicker
            label="On press"
            fnName={obj.on_press_fn}
            args={obj.on_press_args}
            functions={functions}
            onChange={(fn, args) => onChange({ on_press_fn: fn, on_press_args: args })}
          />
          <EventFunctionPicker
            label="On release"
            fnName={obj.on_release_fn}
            args={obj.on_release_args}
            functions={functions}
            onChange={(fn, args) => onChange({ on_release_fn: fn, on_release_args: args })}
          />
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
            Definisci le funzioni nel pannello laterale (sezione FUNZIONI). I valori
            dei parametri sono sostituiti per binding; lascia vuoto per usare il default.
          </p>
        </CollapsibleSection>
      )}

      {/* ── Binding attivi (audit) — always shown with count ──────────── */}
      <CollapsibleSection
        title={t("props.activeBindings")}
        storageKey="bindings"
        headerExtra={
          <span style={{ fontSize: 10, color: obj.bindings && Object.keys(obj.bindings).length > 0 ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)", fontWeight: 700 }}>
            ({obj.bindings ? Object.keys(obj.bindings).length : 0})
          </span>
        }
        hint={!obj.bindings || Object.keys(obj.bindings).length === 0
          ? "Usa il toggle 🔗 accanto a un campo per creare un binding."
          : undefined}
      >
        {obj.bindings && Object.keys(obj.bindings).length > 0 ? (
          Object.entries(obj.bindings).map(([prop, spec]) => (
            <div key={prop} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, marginBottom: 2 }}>
              <span style={{ color: "var(--brand-text-subtle, #64748b)", flex: "0 0 auto" }}>{prop}</span>
              <span style={{ color: "var(--brand-border, #475569)" }}>→</span>
              <span style={{ color: "var(--brand-primary, #3b82f6)", flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>
                {typeof spec === "string"
                  ? (spec || "(nessun tag)")
                  : spec.expr !== undefined
                    ? `ƒ ${spec.expr || "(vuota)"}`
                    : `${spec.tag || "(nessun tag)"}${spec.in_min !== undefined ? ` [${spec.in_min}..${spec.in_max}→${spec.out_min}..${spec.out_max}]` : ""}`}
              </span>
              <button
                title={t("props.removeBinding")}
                onClick={() => {
                  const next = { ...obj.bindings! };
                  delete next[prop];
                  onChange({ bindings: Object.keys(next).length > 0 ? next : undefined });
                }}
                style={{ ...LABEL, cursor: "pointer", background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", padding: "0 4px" }}
              >×</button>
            </div>
          ))
        ) : (
          <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "0 0 4px" }}>
            Nessun binding attivo su questo oggetto.
          </p>
        )}
      </CollapsibleSection>

      <button
        onClick={onDelete}
        style={{
          marginTop: 4,
          background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)",
          border: "1px solid #991b1b", borderRadius: 4,
          padding: "5px 10px", cursor: "pointer", fontSize: 13,
        }}
      >
        Elimina oggetto
      </button>
    </>
  );
}

// ── RadioOptionsEditor ────────────────────────────────────────────────────────

function RadioOptionsEditor({
  options,
  onChange,
}: {
  options: RadioOption[];
  onChange: (opts: RadioOption[]) => void;
}) {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<RadioOption>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const parseVal = (raw: string): string | number | boolean =>
    raw === "true" ? true : raw === "false" ? false
      : raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 4, fontWeight: 700 }}>
        OPZIONI RADIO
      </div>
      {options.map((opt, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <input
            type="text"
            placeholder={t("props.label")}
            style={{ ...INPUT, flex: 1 }}
            value={opt.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input
            type="text"
            placeholder={t("props.value")}
            style={{ ...INPUT, flex: 1 }}
            value={String(opt.value)}
            onChange={(e) => update(i, { value: parseVal(e.target.value) })}
          />
          <button
            style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        style={{ ...INPUT, cursor: "pointer", color: "var(--brand-text-subtle, #64748b)", borderStyle: "dashed", width: "100%" }}
        onClick={() => onChange([...options, { label: `Opzione ${options.length + 1}`, value: String(options.length + 1) }])}
      >
        + Aggiungi opzione
      </button>
    </div>
  );
}

// ── TableRowsEditor ───────────────────────────────────────────────────────────

function TableRowsEditor({
  rows,
  onChange,
}: {
  rows: TableRow[];
  onChange: (rows: TableRow[]) => void;
}) {
  const { t } = useTranslation();
  const update = (i: number, patch: Partial<TableRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", marginTop: 4, marginBottom: 4, fontWeight: 700 }}>
        RIGHE TABELLA
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ background: "var(--brand-bg, #0f172a)", borderRadius: 4, padding: "6px 8px", marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>Riga {i + 1}</span>
            <button
              style={{ background: "transparent", border: "none", color: "var(--brand-danger, #ef4444)", cursor: "pointer", fontSize: 13 }}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
          <div style={LABEL}>{t("props.label")}</div>
          <input type="text" style={{ ...INPUT, marginBottom: 4 }} value={row.label}
            onChange={(e) => update(i, { label: e.target.value })} />
          <div style={LABEL}>Tag</div>
          <div style={{ marginBottom: 4 }}>
            <TagInput
              style={INPUT}
              placeholder={t("props.exSpeed")}
              value={row.tag}
              onChange={(v) => update(i, { tag: v })}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 4 }}>
            <div>
              <div style={LABEL}>{t("props.format")}</div>
              <input type="text" style={INPUT} placeholder="{value:.1f}" value={row.format ?? ""}
                onChange={(e) => update(i, { format: e.target.value || undefined })} />
            </div>
            {/* F7.1 — unità e decimali per riga (senza scrivere un format). */}
            <div>
              <div style={LABEL}>{t("props.unit")}</div>
              <input type="text" style={INPUT} value={row.unit ?? ""}
                onChange={(e) => update(i, { unit: e.target.value || undefined })} />
            </div>
            <div>
              <div style={LABEL}>{t("props.decimals")}</div>
              <input type="number" style={INPUT} value={row.decimals ?? ""}
                onChange={(e) => update(i, { decimals: e.target.value === "" ? undefined : Number(e.target.value) })} />
            </div>
          </div>
          {/* F7.1 — soglie della riga: colorano il valore, indipendenti dal tag. */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 4, marginTop: 4 }}>
            {([["alarm_low", t("props.alarmLow")], ["warn_low", t("props.warnLow")],
               ["warn_high", t("props.warnHigh")], ["alarm_high", t("props.alarmHigh")]] as const).map(([k, lbl]) => (
              <div key={k}>
                <div style={LABEL}>{lbl}</div>
                <input type="number" style={INPUT} value={(row[k] as number | undefined) ?? ""}
                  onChange={(e) => update(i, { [k]: e.target.value === "" ? undefined : Number(e.target.value) })} />
              </div>
            ))}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--brand-text-2, #cbd5e1)", marginTop: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={!!row.writable}
              onChange={(e) => update(i, { writable: e.target.checked || undefined })}
              style={{ accentColor: "var(--brand-primary, #3b82f6)" }} />
            {t("props.writableCell")}
          </label>
        </div>
      ))}
      <button
        style={{ ...INPUT, cursor: "pointer", color: "var(--brand-text-subtle, #64748b)", borderStyle: "dashed", width: "100%" }}
        onClick={() => onChange([...rows, { label: `Tag ${rows.length + 1}`, tag: "", format: "{value:.1f}" }])}
      >
        + Aggiungi riga
      </button>
    </div>
  );
}

// ── EventFunctionPicker ───────────────────────────────────────────────────────
// Per-event row in ObjectProps: a select for the function name + one input
// row per declared parameter, bound to the on_*_args record on the object.

function EventFunctionPicker({
  label,
  fnName,
  args,
  functions,
  onChange,
}: {
  label: string;
  fnName: string | undefined;
  args: Record<string, string | number | boolean> | undefined;
  functions: FunctionDef[];
  onChange: (
    fn: string | undefined,
    args: Record<string, string | number | boolean> | undefined,
  ) => void;
}) {
  const { t } = useTranslation();
  const fn = functions.find((f) => f.name === fnName);

  const setArg = (paramName: string, raw: string) => {
    const v: string | number | boolean =
      raw === "true"  ? true :
      raw === "false" ? false :
      raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) :
      raw;
    const next = { ...(args ?? {}), [paramName]: v };
    onChange(fnName, next);
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={LABEL}>{label}</div>
      <select
        style={{ ...INPUT, cursor: "pointer" }}
        value={fnName ?? ""}
        onChange={(e) => {
          const v = e.target.value || undefined;
          // Clear args when the function changes — old keys probably don't apply.
          onChange(v, v ? undefined : undefined);
        }}
      >
        <option value="">{t("props.dashNone")}</option>
        {functions.map((f) => (
          <option key={f.id} value={f.name}>{f.name}</option>
        ))}
      </select>
      {fn && fn.params.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 6, borderLeft: "2px solid var(--brand-surface-2, #334155)" }}>
          {fn.params.map((p) => {
            const v = (args ?? {})[p.name];
            return (
              <div key={p.name} style={{ marginTop: 2 }}>
                <div style={{ ...LABEL, fontSize: 10 }}>
                  {p.name}
                  {p.default !== undefined && (
                    <span style={{ color: "var(--brand-border, #475569)" }}> (default: {String(p.default)})</span>
                  )}
                </div>
                <input
                  type="text"
                  style={{ ...INPUT, fontSize: 12 }}
                  placeholder={p.default !== undefined ? String(p.default) : ""}
                  value={v === undefined ? "" : String(v)}
                  onChange={(e) => setArg(p.name, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── GridCellEditor ────────────────────────────────────────────────────────────
// Properties panel for a selected grid cell.

const CELL_CHILD_TYPES: { value: string; label: string }[] = [
  { value: "rect",          label: "Rettangolo" },
  { value: "ellipse",       label: "Ellisse" },
  { value: "text",          label: "Testo" },
  { value: "button",        label: "Pulsante" },
  { value: "led",           label: "LED" },
  { value: "progress_bar",  label: "Barra progresso" },
  { value: "gauge",         label: "Gauge" },
  { value: "symbol",        label: "Simbolo" },
  { value: "image",         label: "Immagine" },
];

function makeDefaultChild(type: string): SynopticObject {
  const id = genId();
  const base: SynopticObject = { id, type: type as SynopticObject["type"], x: 0, y: 0 };
  switch (type) {
    case "rect":         return { ...base, width: 80, height: 60, fill: "var(--brand-surface-2, #334155)" };
    case "ellipse":      return { ...base, width: 60, height: 60, fill: "var(--brand-surface-2, #334155)" };
    case "text":         return { ...base, width: 80, height: 30, label: "Testo" };
    case "button":       return { ...base, width: 80, height: 32, label: "Pulsante" };
    case "led":          return { ...base, width: 40, height: 40 };
    case "progress_bar": return { ...base, width: 100, height: 20, min: 0, max: 100 };
    case "gauge":        return { ...base, width: 100, height: 100, min: 0, max: 100 };
    case "symbol":       return { ...base, width: 60, height: 60, symbol_id: "pump" };
    case "image":        return { ...base, width: 80, height: 60 };
    default:             return { ...base, width: 80, height: 60 };
  }
}

function GridCellEditor({
  cell,
  functions,
  onChange,
}: {
  cell: GridCell;
  functions: FunctionDef[];
  onChange: (patch: Partial<GridCell>) => void;
}) {
  const { t } = useTranslation();
  const [newChildType, setNewChildType] = useState("rect");
  return (
    <div style={{ marginTop: 8, borderTop: "1px solid var(--brand-surface-2, #334155)", paddingTop: 8 }}>
      <div style={{ fontSize: 10, color: "var(--brand-primary, #3b82f6)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 6 }}>
        CELLA {cell.row + 1},{cell.col + 1}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px", marginBottom: 6 }}>
        <div>
          <div style={LABEL}>{t("props.rowspan")}</div>
          <input
            type="number" min={1} max={10} style={INPUT}
            value={cell.rowspan ?? 1}
            onChange={(e) => onChange({ rowspan: Math.max(1, Number(e.target.value)) })}
          />
        </div>
        <div>
          <div style={LABEL}>{t("props.colspan")}</div>
          <input
            type="number" min={1} max={10} style={INPUT}
            value={cell.colspan ?? 1}
            onChange={(e) => onChange({ colspan: Math.max(1, Number(e.target.value)) })}
          />
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div style={LABEL}>{t("props.colBg")}</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
            value={cell.bg_color ?? "var(--brand-surface, #1e293b)"}
            onChange={(e) => onChange({ bg_color: e.target.value })}
          />
          <input
            type="text" style={INPUT}
            value={cell.bg_color ?? ""}
            placeholder="nessuno"
            onChange={(e) => onChange({ bg_color: e.target.value || undefined })}
          />
        </div>
      </div>

      <div style={{ marginBottom: 6 }}>
        <div style={LABEL}>{t("props.bgImageUrl")}</div>
        <input
          type="text" style={INPUT}
          placeholder="https://…"
          value={cell.bg_image ?? ""}
          onChange={(e) => onChange({ bg_image: e.target.value || undefined })}
        />
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 6, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={cell.visible !== false}
          onChange={(e) => onChange({ visible: e.target.checked || undefined })}
          style={{ accentColor: "var(--brand-primary, #3b82f6)" }}
        />
        Visibile (statico)
      </label>

      <div style={{ marginBottom: 6 }}>
        <div style={LABEL}>{t("props.tagVisibility")}</div>
        <TagInput
          style={INPUT}
          placeholder={t("props.exValve")}
          value={cell.visible_tag ?? ""}
          onChange={(v) => onChange({ visible_tag: v || undefined })}
        />
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
        EVENTI CELLA
      </div>
      <div style={{ marginBottom: 4 }}>
        <div style={LABEL}>{t("props.onPress")}</div>
        <select
          style={{ ...INPUT, cursor: "pointer" }}
          value={cell.on_press_fn ?? ""}
          onChange={(e) => onChange({ on_press_fn: e.target.value || undefined })}
        >
          <option value="">{t("props.dashNone")}</option>
          {functions.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
        </select>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={LABEL}>{t("props.onRelease")}</div>
        <select
          style={{ ...INPUT, cursor: "pointer" }}
          value={cell.on_release_fn ?? ""}
          onChange={(e) => onChange({ on_release_fn: e.target.value || undefined })}
        >
          <option value="">{t("props.dashNone")}</option>
          {functions.map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 10, color: "var(--brand-border, #475569)", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4 }}>
        OGGETTO FIGLIO
      </div>
      {cell.child ? (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 6, marginBottom: 8,
            padding: "4px 8px", background: "var(--brand-bg, #0f172a)", border: "1px solid #1e3a5f", borderRadius: 4,
          }}>
            <span style={{ flex: 1, fontSize: 11, color: "#93c5fd" }}>
              {cell.child.type}{cell.child.name ? ` — ${cell.child.name}` : ""}
            </span>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 8px" }}>
            Clicca il figlio nel canvas per modificarne le proprietà.
          </p>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              title={t("props.cutChild")}
              onClick={() => {
                const state = useAppStore.getState();
                state.setClipboard([cell.child!], state.currentPageId);
                onChange({ child: undefined });
              }}
              style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-muted, #94a3b8)", borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "2px 8px" }}
            >
              ✂ Taglia
            </button>
            <button
              title={t("props.removeChild")}
              onClick={() => onChange({ child: undefined })}
              style={{ background: "var(--brand-danger-bg, #7f1d1d)", border: "1px solid #991b1b", color: "var(--brand-danger-soft, #fca5a5)", borderRadius: 4, cursor: "pointer", fontSize: 11, padding: "2px 8px" }}
            >
              ✕ Rimuovi
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
            <select
              style={{ ...INPUT, flex: 1, cursor: "pointer" }}
              value={newChildType}
              onChange={(e) => setNewChildType(e.target.value)}
            >
              {CELL_CHILD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button
              onClick={() => onChange({ child: makeDefaultChild(newChildType) })}
              style={{ background: "#1d4ed8", border: "1px solid var(--brand-primary-hover, #2563eb)", color: "#bfdbfe", borderRadius: 4, cursor: "pointer", fontSize: 12, padding: "2px 10px", flexShrink: 0 }}
            >
              + Aggiungi
            </button>
          </div>
          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "0 0 4px" }}>
            Oppure: copia un oggetto dalla pagina (Ctrl+C) e premi Ctrl+V con questa cella selezionata.
          </p>
        </>
      )}
    </div>
  );
}

// FunctionEditor moved out to its own file. Imported at the top of this file.
