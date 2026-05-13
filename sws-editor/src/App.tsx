import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, AuthError, PasswordChangeRequiredError } from "@/api/client";
import { AlarmBanner } from "@/components/AlarmBanner";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { LogPanel } from "@/components/LogPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { ProjectIO } from "@/components/ProjectIO";
import { ConfigView } from "@/config/ConfigView";
import { EditorShell } from "@/editor/EditorShell";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { useAppStore } from "@/store";
import { useLogStream } from "@/ws/logStream";

type Mode = "edit" | "view" | "config";

const MODE_LABELS: Record<Mode, string> = {
  edit:   "Editor",
  view:   "Runtime",
  config: "Configurazione",
};

const LOG_PANEL_KEY = "sws.logPanel.open";

export function App() {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>("edit");
  const [logOpen, setLogOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LOG_PANEL_KEY) === "1"; } catch { return false; }
  });

  // Stream runtime logs whenever the user is Operator+. The hook is a no-op
  // for Viewer / unauthenticated states.
  useLogStream();

  const authToken             = useAppStore((s) => s.authToken);
  const authUser              = useAppStore((s) => s.authUser);
  const authRole              = useAppStore((s) => s.authRole);
  const mustChangePassword    = useAppStore((s) => s.mustChangePassword);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);
  const clearAuth             = useAppStore((s) => s.clearAuth);
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setPages       = useAppStore((s) => s.setPages);
  const project        = useAppStore((s) => s.project);
  const setProject     = useAppStore((s) => s.setProject);

  // Only fetch project data once authenticated AND past the must-change-pwd
  // gate; otherwise every call would 401/403 and the user would land in a
  // fail loop. Project is loaded here (not in LeftPanel) so it's available
  // in Configurazione mode too — without this, ProtocolsTab/TagsTab/
  // AlarmsTab would render empty inputs and a save would overwrite real
  // on-disk state with blanks.
  useEffect(() => {
    if (!authToken || mustChangePassword) return;

    api.getProject()
      .then(setProject)
      .catch((e) => {
        if (e instanceof AuthError) clearAuth();
        else if (e instanceof PasswordChangeRequiredError) setMustChangePassword(true);
      });

    api.listSynoptics()
      .then(async (names) => {
        if (names.length === 0) return;
        const loaded = await Promise.all(names.map((n) => api.getSynoptic(n)));
        setPages(loaded, loaded[0].id);
      })
      .catch((e) => {
        if (e instanceof AuthError) clearAuth();
        else if (e instanceof PasswordChangeRequiredError) setMustChangePassword(true);
      });
  }, [authToken, mustChangePassword]);

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearAuth();
  };

  if (!authToken) {
    return <LoginScreen />;
  }

  if (mustChangePassword) {
    return <ChangePasswordScreen />;
  }

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
        <span style={{ color: "#475569", fontSize: 13 }}>
          {t("app.user")}: {authUser ?? "—"}
          {authRole && (
            <span style={{
              marginLeft: 6,
              padding: "1px 6px",
              borderRadius: 3,
              background: authRole === "Admin" ? "#7c2d12"
                : authRole === "Supervisor" ? "#7e22ce"
                : authRole === "Operator" ? "#1e3a8a" : "#334155",
              color: "#e2e8f0",
              fontSize: 11,
              fontWeight: 600,
            }}>
              {authRole}
            </span>
          )}
        </span>
        <ProjectIO />
        <button
          onClick={() => {
            const next = !logOpen;
            setLogOpen(next);
            try { localStorage.setItem(LOG_PANEL_KEY, next ? "1" : "0"); } catch { /* ignore */ }
          }}
          title={logOpen ? "Nascondi pannello log" : "Mostra pannello log"}
          style={{
            padding: "4px 10px",
            background: logOpen ? "#1e3a8a" : "#334155",
            color: "#cbd5e1",
            border: "1px solid #475569",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Log
        </button>
        <button
          onClick={handleLogout}
          title="Esci dalla sessione"
          style={{
            padding: "4px 10px",
            background: "#334155",
            color: "#cbd5e1",
            border: "1px solid #475569",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 12,
          }}
        >
          Esci
        </button>
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

      {/* Log drawer (bottom) */}
      <LogPanel open={logOpen} onClose={() => {
        setLogOpen(false);
        try { localStorage.setItem(LOG_PANEL_KEY, "0"); } catch { /* ignore */ }
      }} />
    </div>
  );
}
