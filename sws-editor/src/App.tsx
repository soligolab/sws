import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlarmBanner } from "@/components/AlarmBanner";
import { EditorShell } from "@/editor/EditorShell";
import { RuntimeView } from "@/runtime-view/RuntimeView";

type Mode = "edit" | "view";

export function App() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("edit");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        fontFamily: "system-ui, sans-serif",
        color: "#e2e8f0",
        background: "#0f172a",
      }}
    >
      {/* Header */}
      <header
        style={{
          height: 48,
          background: "#1e293b",
          borderBottom: "1px solid #334155",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          gap: 16,
          flexShrink: 0,
        }}
      >
        <strong style={{ letterSpacing: 1, fontSize: 15 }}>SWS</strong>
        <span style={{ color: "#475569", flex: 1 }}>{t("app.project")}: —</span>
        <div style={{ display: "flex", gap: 4 }}>
          {(["edit", "view"] as Mode[]).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "4px 12px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: mode === m ? "#3b82f6" : "#334155",
                color: "#fff",
                fontWeight: mode === m ? 600 : 400,
              }}
            >
              {t(`app.mode.${m}`)}
            </button>
          ))}
        </div>
        <span style={{ color: "#475569", fontSize: 13 }}>{t("app.user")}: admin</span>
      </header>

      {/* Alarm banner */}
      <AlarmBanner />

      {/* Main area */}
      <main style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {mode === "edit" ? <EditorShell /> : <RuntimeView />}
      </main>
    </div>
  );
}
