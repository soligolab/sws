import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { AlarmBanner } from "@/components/AlarmBanner";
import { ConfigView } from "@/config/ConfigView";
import { EditorShell } from "@/editor/EditorShell";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { useAppStore } from "@/store";

type Mode = "edit" | "view" | "config";

const MODE_LABELS: Record<Mode, string> = {
  edit:   "Editor",
  view:   "Runtime",
  config: "Configurazione",
};

export function App() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("edit");

  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setPages       = useAppStore((s) => s.setPages);
  const project        = useAppStore((s) => s.project);

  useEffect(() => {
    api.listSynoptics()
      .then(async (names) => {
        if (names.length === 0) return;
        const loaded = await Promise.all(names.map((n) => api.getSynoptic(n)));
        setPages(loaded, loaded[0].id);
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", color: "#e2e8f0", background: "#0f172a" }}>
      {/* Header */}
      <header style={{
        height: 48,
        background: "#1e293b",
        borderBottom: "1px solid #334155",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        flexShrink: 0,
      }}>
        <strong style={{ letterSpacing: 1, fontSize: 15, color: "#e2e8f0" }}>SWS</strong>
        <span style={{ color: "#475569", flex: 1, fontSize: 13 }}>
          {t("app.project")}: {project?.meta.name ?? "—"}
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["edit", "view", "config"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "5px 14px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: mode === m ? "#3b82f6" : "#334155",
                color: "#fff",
                fontWeight: mode === m ? 600 : 400,
                fontSize: 13,
              }}
            >
              {MODE_LABELS[m]}
            </button>
          ))}
        </div>
        <span style={{ color: "#475569", fontSize: 13 }}>{t("app.user")}: admin</span>
      </header>

      {/* Alarm banner */}
      <AlarmBanner />

      {/* Page tabs (editor mode only) */}
      {mode === "edit" && (
        <div style={{
          display: "flex",
          alignItems: "center",
          background: "#0f172a",
          borderBottom: "1px solid #334155",
          padding: "0 8px",
          gap: 2,
          flexShrink: 0,
          height: 32,
          overflowX: "auto",
        }}>
          {pages.map((p) => (
            <button
              key={p.id}
              onClick={() => setCurrentPage(p.id)}
              style={{
                background: p.id === currentPageId ? "#1e293b" : "transparent",
                color: p.id === currentPageId ? "#e2e8f0" : "#64748b",
                border: p.id === currentPageId ? "1px solid #334155" : "1px solid transparent",
                borderBottom: p.id === currentPageId ? "1px solid #1e293b" : "1px solid transparent",
                borderRadius: "4px 4px 0 0",
                padding: "3px 12px",
                cursor: "pointer",
                fontSize: 13,
                whiteSpace: "nowrap",
              }}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {/* Main area */}
      <main style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {mode === "edit"   && <EditorShell />}
        {mode === "view"   && <RuntimeView />}
        {mode === "config" && <ConfigView />}
      </main>
    </div>
  );
}
