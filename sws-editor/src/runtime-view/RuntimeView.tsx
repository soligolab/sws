import { useState } from "react";
import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { useAppStore } from "@/store";
import { useTagStream } from "@/ws/tagStream";

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
  background: "#1e293b",
  border: `1px solid ${hasError ? "#991b1b" : "#334155"}`,
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
              <span style={{ color: "#94a3b8", fontWeight: 700, fontSize: 11 }}>
                ⚡ {t.fn}
              </span>
              <button
                onClick={() => onClose(t.id)}
                style={{ background: "none", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0, marginLeft: 10 }}
              >
                ✕
              </button>
            </div>
            {t.stdout && <pre style={{ ...PRE, color: "#e2e8f0" }}>{t.stdout.trimEnd()}</pre>}
            {t.stderr && <pre style={{ ...PRE, color: "#fbbf24", marginTop: t.stdout ? 4 : 0 }}>{t.stderr.trimEnd()}</pre>}
            {t.error  && <pre style={{ ...PRE, color: "#fca5a5", marginTop: (t.stdout || t.stderr) ? 4 : 0 }}>{t.error.trimEnd()}</pre>}
          </div>
        );
      })}
    </div>
  );
}

// ── RuntimeView ───────────────────────────────────────────────────────────────

export function RuntimeView() {
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const tagValues      = useAppStore((s) => s.tagValues);
  const customSymbols  = useAppStore((s) => s.customSymbols);

  const [toasts, setToasts] = useState<ScriptToast[]>([]);

  useTagStream();

  const addToast = (toast: ScriptToast, ttlMs: number) => {
    setToasts((ts) => [...ts, toast]);
    setTimeout(() => setToasts((ts) => ts.filter((t) => t.id !== toast.id)), ttlMs);
  };

  const closeToast = (id: string) => setToasts((ts) => ts.filter((t) => t.id !== id));

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];

  const handleWriteTag = (tagId: string, value: string | number | boolean) => {
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

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      {/* Page navigation bar */}
      {pages.length > 1 && (
        <nav style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "0 8px",
          background: "#0f172a",
          borderBottom: "1px solid #334155",
          height: 36,
          flexShrink: 0,
          overflowX: "auto",
        }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentPage(p.id)}
              style={{
                padding: "4px 14px",
                border: "none",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 13,
                fontWeight: p.id === currentPageId ? 700 : 400,
                background: p.id === currentPageId ? "#3b82f6" : "transparent",
                color: p.id === currentPageId ? "#fff" : "#64748b",
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
        </nav>
      )}

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          customSymbols={customSymbols}
          pageWidth={currentPage?.width}
          pageHeight={currentPage?.height}
          onWriteTag={handleWriteTag}
          onScript={handleScript}
          onNavigate={setCurrentPage}
        />
      </div>

      {/* Script output toasts (bottom-right, auto-dismiss) */}
      <ScriptToasts toasts={toasts} onClose={closeToast} />
    </div>
  );
}
