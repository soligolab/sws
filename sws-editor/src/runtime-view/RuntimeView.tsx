import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { getBrand } from "@/branding";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { viewerFitScale, effectiveSizeMode } from "@/pageLayout";
import { resolvePageBackground } from "@/theme";
import { AlarmBellPanel } from "@/components/AlarmBellPanel";
import { RecipePanel } from "@/components/RecipePanel";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { useAppStore } from "@/store";
import { localizeObjects, effectiveProjectLang } from "@/i18n/projectI18n";
import { useTagStream, tryTagWriteWs, sendSubscribe } from "@/ws/tagStream";
import type { FunctionDef } from "@/types";

// ── Script output toast ───────────────────────────────────────────────────────

type ScriptToast = {
  id: string;
  fn: string;
  stdout?: string;
  stderr?: string;
  error?: string;
};

const TOAST_PANEL: React.CSSProperties = {
  position: "fixed",
  bottom: 16,
  right: 16,
  display: "flex",
  flexDirection: "column-reverse",
  gap: 8,
  zIndex: 8000,
  maxWidth: 380,
  pointerEvents: "none",
};

const TOAST_CARD = (hasError: boolean): React.CSSProperties => ({
  background: "var(--brand-surface, #1e293b)",
  border: `1px solid ${hasError ? "#991b1b" : "var(--brand-surface-2, #334155)"}`,
  borderRadius: 8,
  padding: "10px 14px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
  fontSize: 12,
  pointerEvents: "auto",
});

const PRE: React.CSSProperties = {
  margin: 0,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  maxHeight: 120,
  overflowY: "auto",
  fontFamily: "monospace",
  fontSize: 11,
};

function ScriptToasts({ toasts, onClose }: { toasts: ScriptToast[]; onClose: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div style={TOAST_PANEL}>
      {toasts.slice(-4).map((t) => {
        const hasError = !!(t.error || t.stderr);
        return (
          <div key={t.id} style={TOAST_CARD(hasError)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span style={{ color: "var(--brand-text-muted, #94a3b8)", fontWeight: 700, fontSize: 11 }}>
                ⚡ {t.fn}
              </span>
              <button
                onClick={() => onClose(t.id)}
                style={{ background: "none", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 10 }}
              >
                ✕
              </button>
            </div>
            {t.stdout && <pre style={{ ...PRE, color: "var(--brand-text, #e2e8f0)" }}>{t.stdout.trimEnd()}</pre>}
            {t.stderr && <pre style={{ ...PRE, color: "var(--brand-warning-soft, #fbbf24)", marginTop: t.stdout ? 4 : 0 }}>{t.stderr.trimEnd()}</pre>}
            {t.error  && <pre style={{ ...PRE, color: "var(--brand-danger-soft, #fca5a5)", marginTop: (t.stdout || t.stderr) ? 4 : 0 }}>{t.error.trimEnd()}</pre>}
          </div>
        );
      })}
    </div>
  );
}

// ── Alarm panel (operator ACK) ───────────────────────────────────────────────
//
// Floating top-right panel listing active alarms with per-row ACK. Logica
// completa in `AlarmBellPanel` (condivisa con l'oggetto SCADA piazzabile
// `alarm_bell`, T-42) — qui resta solo il posizionamento fisso storico.
//
// `bellTop`: offset verticale della campanella. Era 80 hardcoded, numero che
// assumeva l'esistenza di entrambe le fasce (allarmi 33 + nav 37 + margine).
// A schermo pieno quelle fasce non ci sono e la campanella deve salire.
function AlarmPanel({ bellTop = 80 }: { bellTop?: number }) {
  return (
    <div style={{ position: "fixed", top: bellTop, right: 16, zIndex: 7500, width: 130, height: 34, pointerEvents: "auto" }}>
      <AlarmBellPanel />
    </div>
  );
}

// ── RecipeModal ───────────────────────────────────────────────────────────────

function RecipeModal({ onClose }: { onClose: () => void }) {
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 2000,
      background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: 24, minWidth: 380, maxWidth: 520, maxHeight: "80vh",
        overflowY: "auto", color: "var(--brand-text, #e2e8f0)",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Applica Ricetta</div>
        <RecipePanel />
        <button onClick={onClose} style={{
          marginTop: 16, padding: "6px 16px", borderRadius: 4, border: "1px solid var(--brand-surface-2, #334155)",
          background: "transparent", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 12,
        }}>
          Chiudi
        </button>
      </div>
    </div>
  );
}

// ── RuntimeView ───────────────────────────────────────────────────────────────

export function RuntimeView() {
  const { t } = useTranslation();
  const pages               = useAppStore((s) => s.pages);
  const currentPageId       = useAppStore((s) => s.currentPageId);
  const setCurrentPage      = useAppStore((s) => s.setCurrentPage);
  const tagValues           = useAppStore((s) => s.tagValues);
  const project             = useAppStore((s) => s.project);
  const themeMode           = useAppStore((s) => s.themeMode);
  const languageTable       = useAppStore((s) => s.project?.languages);
  const projectLang         = useAppStore((s) => s.projectLang);
  const customSymbols       = useAppStore((s) => s.customSymbols);
  const faceplates          = useAppStore((s) => s.faceplates);
  const autoRotate          = useAppStore((s) => s.autoRotate);
  const autoRotateIntervalS = useAppStore((s) => s.autoRotateIntervalS);
  const setAutoRotate       = useAppStore((s) => s.setAutoRotate);
  const setAutoRotateIntervalS = useAppStore((s) => s.setAutoRotateIntervalS);

  const [toasts, setToasts]         = useState<ScriptToast[]>([]);
  const [recipeOpen, setRecipeOpen] = useState(false);

  // Kiosk auto-rotate: advance to the next non-skipped page on a fixed interval.
  useEffect(() => {
    if (!autoRotate) return;
    const rotatablePages = pages.filter((p) => !p.auto_rotate_skip);
    if (rotatablePages.length < 2) return;
    const id = setInterval(() => {
      const idx = rotatablePages.findIndex((p) => p.id === currentPageId);
      const wrapping = idx + 1 >= rotatablePages.length;
      // When the cycle wraps back to the start, restart from the home page
      // (if set and not skipped) instead of the literal first rotatable page.
      const homeId = project?.page_layout?.home_page_id;
      const home = wrapping && homeId ? rotatablePages.find((p) => p.id === homeId) : undefined;
      const next = home ?? rotatablePages[(idx + 1) % rotatablePages.length];
      setCurrentPage(next.id);
    }, autoRotateIntervalS * 1000);
    return () => clearInterval(id);
  }, [autoRotate, autoRotateIntervalS, pages, currentPageId, setCurrentPage, project]);

  useTagStream();

  // T-17: per-page subscription — tell the server which tags this page uses
  // so it sends delta frames only for those tags (bandwidth optimization).
  // When the page changes, re-subscribe to the new page's tags.
  const currentPage = pages.find((p) => p.id === currentPageId);
  const sizeMode = effectiveSizeMode(project?.page_layout);
  const hideChrome = project?.page_layout?.hide_viewer_chrome === true;

  // Misura del contenitore del canvas per la modalità "fisso": la pagina va
  // rimpicciolita quando non entra, invece di far comparire scrollbar. Serve
  // la dimensione reale, quindi ResizeObserver e non una media query.
  const canvasBoxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = canvasBoxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      setBox({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Cap a 1: si rimpicciolisce, non si ingrandisce. La modalità "fisso" esiste
  // per targetizzare un dispositivo noto — se le misure combaciano lo scale è
  // esattamente 1 e i pixel restano 1:1; ingrandire sfocherebbe il disegno.
  const fitScale = useMemo(() => {
    if (sizeMode !== "fixed") return 1;
    return viewerFitScale(box?.w, box?.h, currentPage?.width, currentPage?.height);
  }, [sizeMode, box, currentPage?.width, currentPage?.height]);
  const pageTagIds = useMemo(() => {
    const ids = new Set<string>();
    for (const obj of currentPage?.objects ?? []) {
      const o = obj as unknown as Record<string, unknown>;
      if (typeof o.tag === "string")       ids.add(o.tag);
      if (typeof o.value_tag === "string") ids.add(o.value_tag);
      if (typeof o.min_tag === "string")   ids.add(o.min_tag);
      if (typeof o.max_tag === "string")   ids.add(o.max_tag);
      // trend pens
      if (Array.isArray(o.pens)) {
        for (const pen of o.pens as unknown[]) {
          if (pen && typeof pen === "object" && "tag" in pen) ids.add(String((pen as Record<string, unknown>).tag));
        }
      }
    }
    return [...ids];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPageId, pages]);

  useEffect(() => {
    // Send subscribe. Empty array = all tags (no restriction).
    sendSubscribe(pageTagIds.length > 0 ? pageTagIds : []);
  }, [pageTagIds]);

  const addToast = (toast: ScriptToast, ttlMs: number) => {
    setToasts((ts) => [...ts, toast]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), ttlMs);
  };

  const closeToast = (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id));

  // Localizza i messaggi {{token}} nella lingua contenuti corrente (T-40).
  const effLang = effectiveProjectLang(languageTable) || projectLang;
  const objects = useMemo(
    () => localizeObjects(currentPage?.objects ?? [], effLang, languageTable),
    [currentPage?.objects, effLang, languageTable],
  );

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
    // Prefer the bidirectional WS path (zero HTTP round-trip + token reuse).
    // The HTTP PUT remains as the fallback when the socket isn't open
    // yet — first paint can race the upgrade handshake.
    if (tryTagWriteWs(tagId, value)) return;
    api.writeTag(tagId, value).catch(console.error);
  };

  const handleScript = (fn: string, args: Record<string, string | number | boolean>) => {
    api.runFunction(fn, args).then((r) => {
      if (r.stdout) console.log(`[${fn} stdout]`, r.stdout.trimEnd());
      if (r.stderr) console.warn(`[${fn} stderr]`, r.stderr.trimEnd());
      if (!r.ok && r.error) console.warn(`[${fn}]`, r.error);

      const hasOutput = r.stdout || r.stderr || (!r.ok && r.error);
      if (hasOutput) {
        addToast(
          {
            id: `${Date.now()}-${Math.random()}`,
            fn,
            stdout: r.stdout || undefined,
            stderr: r.stderr || undefined,
            error: !r.ok ? (r.error || undefined) : undefined,
          },
          r.ok ? 5000 : 10_000,
        );
      }
    }).catch((e: any) => {
      console.error(`[${fn}]`, e);
      addToast({ id: `${Date.now()}-${Math.random()}`, fn, error: String(e?.message ?? e) }, 10_000);
    });
  };

  // T-19: touch swipe navigation between pages.
  const touchStartX = useRef<number | null>(null);
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? 0) - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 50) return; // threshold 50px
    const idx = pages.findIndex((p) => p.id === currentPageId);
    if (dx < 0 && idx < pages.length - 1) setCurrentPage(pages[idx + 1].id);
    if (dx > 0 && idx > 0) setCurrentPage(pages[idx - 1].id);
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Page navigation bar — assente in modalità "viewer a schermo pieno"
          (impostazione di progetto hide_viewer_chrome): sul pannello si
          renderizza solo l'area della pagina. boxSizing perché senza, i 36px
          dichiarati diventano 37 col bordo e la pagina non torna. */}
      {pages.length > 1 && !hideChrome && (
        <nav style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: "var(--brand-bg, #0f172a)",
          borderBottom: "1px solid var(--brand-surface-2, #334155)",
          height: 36,
          boxSizing: "border-box",
          flexShrink: 0,
          overflowX: "auto",
        }}>
          {getBrand().logoUrl && (
            <img
              src={getBrand().logoUrl!}
              alt={getBrand().name}
              title={getBrand().name}
              style={{ height: 20, width: "auto", marginRight: 8, flexShrink: 0 }}
            />
          )}
          <div style={{ flex: 1, display: "flex", gap: 2 }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => { setAutoRotate(false); setCurrentPage(p.id); }}
              style={{
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                opacity: p.auto_rotate_skip ? 0.5 : 1,
                fontSize: 13,
                fontWeight: p.id === currentPageId ? 700 : 400,
                background: p.id === currentPageId ? "var(--brand-primary, #3b82f6)" : "transparent",
                color: p.id === currentPageId ? "var(--brand-on-primary, #fff)" : "var(--brand-text-subtle, #64748b)",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
          </div>
          {/* Auto-rotate controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8, flexShrink: 0 }}>
            <button
              onClick={() => setAutoRotate(!autoRotate)}
              title={autoRotate ? t("viewer.stopRotation") : t("viewer.startRotation")}
              style={{
                padding: "2px 8px",
                border: `1px solid ${autoRotate ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)"}`,
                borderRadius: 4,
                background: autoRotate ? "#1d4ed8" : "transparent",
                color: autoRotate ? "#fff" : "var(--brand-text-subtle, #64748b)",
                cursor: "pointer",
                fontSize: 12,
                whiteSpace: "nowrap",
              }}
            >
              {autoRotate ? "⏹ Stop" : "▶ Ciclo"}
            </button>
            <input
              type="number"
              min={5}
              max={3600}
              value={autoRotateIntervalS}
              onChange={(e) => setAutoRotateIntervalS(Math.max(5, parseInt(e.target.value) || 30))}
              title={t("viewer.rotationInterval")}
              style={{
                width: 44,
                padding: "2px 4px",
                background: "var(--brand-surface, #1e293b)",
                border: "1px solid var(--brand-surface-2, #334155)",
                borderRadius: 4,
                color: "var(--brand-text-muted, #94a3b8)",
                fontSize: 12,
                textAlign: "center",
              }}
            />
            <span style={{ color: "var(--brand-border, #475569)", fontSize: 11 }}>s</span>
          </div>
          {/* Recipe apply button */}
          <button
            onClick={() => setRecipeOpen(true)}
            title={t("viewer.applyRecipe")}
            style={{
              marginLeft: 8,
              padding: "2px 8px",
              border: "1px solid var(--brand-surface-2, #334155)",
              borderRadius: 4,
              background: "transparent",
              color: "var(--brand-text-subtle, #64748b)",
              cursor: "pointer",
              fontSize: 12,
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            ⚗ Ricette
          </button>
          <span style={{ marginLeft: 8, flexShrink: 0 }}><UiLangSelect compact /></span>
          <span style={{ marginLeft: 6, flexShrink: 0 }}><ThemeToggle compact /></span>
        </nav>
      )}

      {/* Canvas. overflow hidden anche in "fixed": la pagina che non entra
          viene rimpicciolita (fitScale) invece di far comparire scrollbar. */}
      <div ref={canvasBoxRef} style={{ flex: 1, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={resolvePageBackground(currentPage?.background, currentPage?.background_dark, themeMode)}
          customSymbols={customSymbols}
          faceplates={faceplates}
          pageWidth={currentPage?.width}
          pageHeight={currentPage?.height}
          sizeMode={sizeMode}
          fitScale={fitScale}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>

      {/* Alarm panel (top-right floating, dropdown with per-row ACK) */}
      {/* A schermo pieno non c'è chrome sopra: la campanella sale in alto. */}
      <AlarmPanel bellTop={hideChrome ? 12 : 80} />

      {/* Function test panel (bottom-left floating — operator picks a
          project function, edits parameter overrides, runs ad-hoc). */}
      <FunctionTestPanel onRun={handleScript} />

      {/* Script output toasts (bottom-right, auto-dismiss) */}
      <ScriptToasts toasts={toasts} onClose={closeToast} />

      {/* Recipe apply modal */}
      {recipeOpen && (
        <RecipeModal onClose={() => setRecipeOpen(false)} />
      )}
    </div>
  );
}

// ── Function test panel ──────────────────────────────────────────────────────
//
// Floating button at the bottom-left expands into a small dialog listing every
// project function. The operator picks one, optionally overrides its
// declared parameter defaults, and clicks Run. The same `onRun` handler used
// by canvas `on_press_fn` dispatches the call, so output appears in the
// existing toast surface and the runtime metrics counter increments.

function FunctionTestPanel({
  onRun,
}: {
  onRun: (fn: string, args: Record<string, string | number | boolean>) => void;
}) {
  const project = useAppStore((s) => s.project);
  const functions: FunctionDef[] = project?.functions ?? [];
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Per-function arg overrides, keyed by function id. Persists across opens
  // within the same session so the operator can iterate without retyping.
  const [overrides, setOverrides] = useState<Record<string, Record<string, string>>>({});

  if (functions.length === 0) return null; // nothing to test

  const selected = functions.find((f) => f.id === selectedId) ?? functions[0];
  const currentOverrides = overrides[selected.id] ?? {};

  const setArg = (paramName: string, raw: string) => {
    setOverrides((prev) => ({
      ...prev,
      [selected.id]: { ...(prev[selected.id] ?? {}), [paramName]: raw },
    }));
  };

  // Coerce string overrides back to the declared types via the param default
  // (bool/number/string). Empty string falls back to the declared default.
  const coerce = (raw: string, def: string | number | boolean | undefined): string | number | boolean => {
    if (raw === "" && def !== undefined) return def;
    if (typeof def === "boolean") return raw === "true" || raw === "1" || raw === "on";
    if (typeof def === "number")  {
      const n = Number(raw);
      return Number.isFinite(n) ? n : def;
    }
    return raw;
  };

  const handleRun = () => {
    const args: Record<string, string | number | boolean> = {};
    for (const p of selected.params) {
      const raw = currentOverrides[p.name] ?? "";
      args[p.name] = coerce(raw, p.default);
    }
    onRun(selected.name, args);
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        title={`Test funzioni (${functions.length} disponibili)`}
        style={{
          position: "fixed", bottom: 16, left: 16, zIndex: 8000,
          width: 40, height: 40, borderRadius: "50%",
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
          color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
        }}
      >
        🧪
      </button>
    );
  }

  return (
    <div
      style={{
        position: "fixed", bottom: 16, left: 16, zIndex: 8000,
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8,
        padding: "12px 14px", minWidth: 320, maxWidth: 420,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>🧪 Test funzioni</span>
        <button
          onClick={() => setOpen(false)}
          style={{ background: "none", border: "none", color: "var(--brand-text-subtle, #64748b)", cursor: "pointer", fontSize: 14 }}
        >×</button>
      </div>
      <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
        Funzione
      </label>
      <select
        value={selected.id}
        onChange={(e) => setSelectedId(e.target.value)}
        style={{
          width: "100%", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
          border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "4px 6px",
          fontSize: 12, marginBottom: 8,
        }}
      >
        {functions.map((f) => (
          <option key={f.id} value={f.id}>{f.name}</option>
        ))}
      </select>
      {selected.description && (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic", marginBottom: 8 }}>
          {selected.description}
        </div>
      )}
      {selected.params.length === 0 ? (
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", padding: "4px 0", fontStyle: "italic" }}>
          Nessun parametro definito.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
          {selected.params.map((p) => {
            const raw = currentOverrides[p.name] ?? "";
            const placeholder = p.default !== undefined ? String(p.default) : "(nessun default)";
            return (
              <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", minWidth: 90,
                  fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}
                </span>
                <input
                  type="text"
                  value={raw}
                  placeholder={placeholder}
                  onChange={(e) => setArg(p.name, e.target.value)}
                  style={{
                    flex: 1, background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
                    border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "2px 6px",
                    fontSize: 11, fontFamily: "monospace",
                  }}
                />
              </div>
            );
          })}
        </div>
      )}
      <button
        onClick={handleRun}
        style={{
          width: "100%", background: "#16a34a", color: "#f0fdf4",
          border: "none", borderRadius: 4, padding: "6px 0",
          cursor: "pointer", fontSize: 12, fontWeight: 600,
        }}
      >
        ▶ Esegui {selected.name}
      </button>
    </div>
  );
}
