import { useTranslation } from "react-i18next";
import type { CanvasViewApi } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";

/**
 * Contextual toolbar for the editor: drawing tools only, no project-level
 * commands (those live in the app header / ☰ menu).
 *
 * Undo/redo were previously reachable only from the keyboard or the history
 * list in the left panel; the zoom controls did not exist at all.
 */

/** Discrete zoom steps, 10% → 400%. The slider moves over the *index*. */
const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

/** Index of the step closest to `z` — the wheel produces values in between. */
function nearestStepIndex(z: number): number {
  let best = 0;
  for (let i = 1; i < ZOOM_STEPS.length; i++) {
    if (Math.abs(ZOOM_STEPS[i] - z) < Math.abs(ZOOM_STEPS[best] - z)) best = i;
  }
  return best;
}

const BAR: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  height: 32,
  flexShrink: 0,
  padding: "0 8px",
  background: "var(--brand-surface, #1e293b)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

const BTN: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  padding: "2px 8px",
  background: "transparent",
  color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid transparent",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const SEP: React.CSSProperties = {
  width: 1,
  height: 18,
  background: "var(--brand-surface-2, #334155)",
};

const SELECT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "1px 4px",
  fontSize: 12,
  cursor: "pointer",
};

function toggled(active: boolean): React.CSSProperties {
  return active
    ? { background: "var(--brand-surface-2, #334155)", borderColor: "var(--brand-border, #475569)" }
    : {};
}

export function EditorToolbar({
  viewApi,
  zoom,
  canFitPage,
}: {
  viewApi: React.RefObject<CanvasViewApi | null>;
  /** Live zoom factor reported by the canvas. */
  zoom: number;
  /** False in fluid mode, where there is no page size to fit. */
  canFitPage: boolean;
}) {
  const { t } = useTranslation();
  const past         = useAppStore((s) => s.past.length);
  const previewEffects    = useAppStore((s) => s.previewEffects);
  const setPreviewEffects = useAppStore((s) => s.setPreviewEffects);
  // F8.2 — copia stile (pennello): copia dall'oggetto selezionato, poi applica
  // alla selezione successiva. Il pulsante di applicazione appare solo quando
  // c'è uno stile in memoria, così non c'è un comando che "non fa niente".
  const selectedIds     = useAppStore((s) => s.selectedObjectIds);
  const styleClipboard  = useAppStore((s) => s.styleClipboard);
  const copyStyle       = useAppStore((s) => s.copyStyle);
  const applyStyle      = useAppStore((s) => s.applyStyle);
  const future       = useAppStore((s) => s.future.length);
  const undo         = useAppStore((s) => s.undo);
  const redo         = useAppStore((s) => s.redo);
  const gridSize     = useAppStore((s) => s.gridSize);
  const snapEnabled  = useAppStore((s) => s.snapEnabled);
  const setGridSize  = useAppStore((s) => s.setGridSize);
  const setSnap      = useAppStore((s) => s.setSnapEnabled);
  const gridColor    = useAppStore((s) => s.gridColor);
  const setGridColor = useAppStore((s) => s.setGridColor);
  const showRulers   = useAppStore((s) => s.showRulers);
  const toggleRulers = useAppStore((s) => s.toggleRulers);

  const dim = (disabled: boolean): React.CSSProperties =>
    disabled ? { opacity: 0.35, cursor: "default" } : {};

  return (
    <div style={BAR}>
      <button style={{ ...BTN, ...dim(past === 0) }} disabled={past === 0}
        onClick={undo} title={t("toolbar.undoTitle")}>↶</button>
      <button style={{ ...BTN, ...dim(future === 0) }} disabled={future === 0}
        onClick={redo} title={t("toolbar.redoTitle")}>↷</button>

      <div style={SEP} />

      <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("header.grid")}</span>
      <select value={gridSize} onChange={(e) => setGridSize(Number(e.target.value))}
        style={SELECT} title={t("header.gridSize")}>
        {[0, 5, 10, 20, 40].map((n) => (
          <option key={n} value={n}>{n === 0 ? "Off" : `${n}px`}</option>
        ))}
        {/* i18n: "Off" è invariato tra le lingue */}
      </select>
      <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
        <input type="checkbox" checked={snapEnabled} onChange={(e) => setSnap(e.target.checked)}
          style={{ accentColor: "var(--brand-primary, #3b82f6)" }} />
        {t("header.gridSnap")}
      </label>
      <input type="color" value={gridColor} onChange={(e) => setGridColor(e.target.value)}
        style={{ width: 22, height: 22, padding: 0, border: "none", background: "none", cursor: "pointer" }}
        title={t("header.gridColor")} />

      <div style={SEP} />

      <button style={{ ...BTN, ...toggled(showRulers) }} onClick={toggleRulers}
        title={showRulers ? t("canvas.rulersHide") : t("canvas.rulersShow")}>⟂</button>

      <div style={SEP} />

      <button style={{ ...BTN, ...dim(!canFitPage) }} disabled={!canFitPage}
        onClick={() => viewApi.current?.fitPage()}
        title={canFitPage ? t("toolbar.fitPageTitle") : t("toolbar.fitPageUnavailable")}>
        ⊡ {t("toolbar.fitPage")}
      </button>
      <button style={BTN} onClick={() => viewApi.current?.fitObjects()}
        title={t("toolbar.fitObjectsTitle")}>⊞</button>
      <button
        style={{ ...BTN, ...(previewEffects ? { background: "#3f2d10", color: "#fbbf24", borderColor: "#f59e0b" } : {}) }}
        onClick={() => setPreviewEffects(!previewEffects)}
        title={t("toolbar.previewEffectsTitle")}>
        {previewEffects ? "⏸" : "▶"} {t("toolbar.previewEffects")}
      </button>
      <button
        style={{ ...BTN, ...(selectedIds.length === 0 ? { opacity: 0.45, cursor: "default" } : {}) }}
        disabled={selectedIds.length === 0}
        onClick={() => copyStyle()}
        title={t("toolbar.copyStyleTitle")}>
        🖌 {t("toolbar.copyStyle")}
      </button>
      {styleClipboard && (
        <button
          style={{ ...BTN, background: "#1e3a8a", color: "#bfdbfe", borderColor: "#2563eb",
                   ...(selectedIds.length === 0 ? { opacity: 0.45, cursor: "default" } : {}) }}
          disabled={selectedIds.length === 0}
          onClick={() => applyStyle()}
          title={t("toolbar.applyStyleTitle")}>
          ⤵ {t("toolbar.applyStyle")}
        </button>
      )}
      <input
        type="range"
        min={0}
        max={ZOOM_STEPS.length - 1}
        step={1}
        value={nearestStepIndex(zoom)}
        onChange={(e) => viewApi.current?.setZoom(ZOOM_STEPS[Number(e.target.value)])}
        title={t("toolbar.zoomLevel")}
        style={{ width: 110, accentColor: "var(--brand-primary, #3b82f6)", cursor: "pointer" }}
      />
      {/* Shows the TRUE factor, not the nearest step: Ctrl+wheel lands in
          between and the readout must stay honest. Click = back to 100%. */}
      <button
        onClick={() => viewApi.current?.resetView()}
        title={t("toolbar.zoomResetTitle")}
        style={{ ...BTN, width: 52, justifyContent: "flex-end", fontFamily: "monospace" }}
      >
        {Math.round(zoom * 100)}%
      </button>
    </div>
  );
}
