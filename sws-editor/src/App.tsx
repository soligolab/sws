import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, AuthError, getRuntimeBaseUrl, NoProjectError, PasswordChangeRequiredError, RuntimeUnavailableError, setRuntimeBaseUrl } from "@/api/client";
import { AlarmBanner } from "@/components/AlarmBanner";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { LogPanel } from "@/components/LogPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { ReAuthModal } from "@/components/ReAuthModal";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ConfigView } from "@/config/ConfigView";
import { EditorShell } from "@/editor/EditorShell";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { useAppStore } from "@/store";
import { useLogStream } from "@/ws/logStream";

type Mode = "edit" | "view" | "config";

// ── Shared header-button style ────────────────────────────────────────────────

const HDR_BTN: React.CSSProperties = {
  padding: "4px 10px",
  background: "#334155",
  color: "#cbd5e1",
  border: "1px solid #475569",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const DROP_PANEL: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 6,
  padding: "4px 0",
  minWidth: 180,
  zIndex: 100,
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};

const DROP_ITEM: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "#cbd5e1",
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
};

const DROP_SEP: React.CSSProperties = {
  height: 1,
  background: "#334155",
  margin: "4px 0",
};

// ── GridDropdown (edit mode only) ─────────────────────────────────────────────

function GridDropdown() {
  const [open, setOpen] = useState(false);
  const ref             = useRef<HTMLDivElement>(null);
  const gridSize        = useAppStore((s) => s.gridSize);
  const snapEnabled     = useAppStore((s) => s.snapEnabled);
  const setGridSize     = useAppStore((s) => s.setGridSize);
  const setSnap         = useAppStore((s) => s.setSnapEnabled);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const label = gridSize === 0 ? "Griglia: Off" : `Griglia: ${gridSize}px`;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button style={HDR_BTN} onClick={() => setOpen((v) => !v)}>
        {label} ▾
      </button>
      {open && (
        <div style={DROP_PANEL}>
          <div style={{ padding: "6px 14px 2px", fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5 }}>
            GRIGLIA
          </div>
          <div style={{ padding: "4px 14px 6px", display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: "#94a3b8", flex: 1 }}>Dimensione</span>
              <select
                value={gridSize}
                onChange={(e) => setGridSize(Number(e.target.value))}
                style={{ background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "2px 6px", fontSize: 12, cursor: "pointer" }}
              >
                {[0, 5, 10, 20, 40].map((n) => (
                  <option key={n} value={n}>{n === 0 ? "Off" : `${n}px`}</option>
                ))}
              </select>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={snapEnabled}
                onChange={(e) => setSnap(e.target.checked)}
                style={{ accentColor: "#3b82f6" }}
              />
              <span style={{ fontSize: 12, color: "#94a3b8" }}>Snap alla griglia</span>
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

// ── MainMenu (always visible) ─────────────────────────────────────────────────

function MainMenu({ mode, onLogout, onCloseProject }: { mode: Mode; onLogout: () => void; onCloseProject: () => void }) {
  const [open, setOpen]       = useState(false);
  const ref                   = useRef<HTMLDivElement>(null);
  const authRole              = useAppStore((s) => s.authRole);
  const saveStatus            = useAppStore((s) => s.saveStatus);
  const saveError             = useAppStore((s) => s.saveError);
  const incSaveSerial         = useAppStore((s) => s.incSaveSerial);
  const setProject            = useAppStore((s) => s.setProject);
  const setPages              = useAppStore((s) => s.setPages);
  const fileInputRef          = useRef<HTMLInputElement>(null);
  const [ioBusy, setIoBusy]   = useState<"export" | "import" | null>(null);
  const [ioStatus, setIoStat] = useState<string | null>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleExport = async () => {
    setIoBusy("export"); setIoStat(null);
    try {
      const res      = await api.exportProjectZip();
      const cd       = res.headers.get("content-disposition");
      const filename = (/filename="([^"]+)"/.exec(cd ?? "") ?? [])[1]
        ?? (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2,"0"); return `sws-project-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.zip`; })();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIoStat(`✓ ${filename}`);
    } catch (e: any) { setIoStat(`Errore: ${e?.message ?? e}`); }
    finally { setIoBusy(null); setTimeout(() => setIoStat(null), 5000); }
  };

  const handleImport = async (file: File) => {
    if (!confirm(
      "Sostituire l'intero progetto corrente?\n" +
      "I synoptic non inclusi nel bundle saranno eliminati.\n" +
      "Le password MQTT non sono incluse: dovrai re-immetterle dopo l'import."
    )) return;
    setIoBusy("import"); setIoStat(null);
    try {
      await api.importProjectZip(file);
      const project = await api.getProject();
      setProject(project);
      const names = await api.listSynoptics();
      if (names.length > 0) {
        const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
        setPages(pages, pages[0].id);
      }
      setIoStat(`✓ Importato ${file.name}`);
    } catch (e: any) { setIoStat(`Errore: ${e?.message ?? e}`); }
    finally { setIoBusy(null); setTimeout(() => setIoStat(null), 6000); }
  };

  const saveBtnLabel =
    saveStatus === "saving" ? "Salvataggio…" :
    saveStatus === "ok"     ? "✓ Salvato"   :
    saveStatus === "error"  ? "❌ Errore salvataggio" :
                              "Salva tutto";

  const saveBtnColor =
    saveStatus === "error" ? "#fca5a5" :
    saveStatus === "ok"    ? "#86efac" :
    saveStatus === "saving"? "#94a3b8" :
                             "#cbd5e1";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        style={{
          ...HDR_BTN,
          background: saveStatus === "saving" ? "#374151" : saveStatus === "ok" ? "#166534" : saveStatus === "error" ? "#7f1d1d" : "#334155",
          color: saveBtnColor,
          borderColor: saveStatus === "error" ? "#991b1b" : saveStatus === "ok" ? "#15803d" : "#475569",
          minWidth: 90,
        }}
        onClick={() => setOpen((v) => !v)}
        title={saveStatus === "error" ? (saveError ?? "Errore") : "Menu principale"}
      >
        ☰ Menu {saveStatus === "saving" ? "⟳" : saveStatus === "ok" ? "✓" : saveStatus === "error" ? "⚠" : ""}
      </button>
      {open && (
        <div style={DROP_PANEL}>
          {mode === "edit" && (
            <>
              <button
                style={{ ...DROP_ITEM, color: saveStatus === "error" ? "#fca5a5" : saveStatus === "ok" ? "#86efac" : "#cbd5e1" }}
                disabled={saveStatus === "saving"}
                onClick={() => { incSaveSerial(); setOpen(false); }}
              >
                {saveBtnLabel}
              </button>
              {saveStatus === "error" && saveError && (
                <div style={{ padding: "2px 14px 6px", fontSize: 11, color: "#fca5a5", wordBreak: "break-word" }}>
                  {saveError}
                </div>
              )}
              <div style={DROP_SEP} />
            </>
          )}
          {authRole === "Admin" && (
            <>
              <button
                style={{ ...DROP_ITEM, color: ioBusy === "export" ? "#94a3b8" : "#cbd5e1" }}
                disabled={ioBusy !== null}
                onClick={() => { handleExport(); setOpen(false); }}
              >
                {ioBusy === "export" ? "Esporto…" : "Esporta progetto"}
              </button>
              <button
                style={{ ...DROP_ITEM, color: ioBusy === "import" ? "#94a3b8" : "#cbd5e1" }}
                disabled={ioBusy !== null}
                onClick={() => { fileInputRef.current?.click(); setOpen(false); }}
              >
                {ioBusy === "import" ? "Importo…" : "Importa progetto"}
              </button>
              <div style={DROP_SEP} />
            </>
          )}
          <button
            style={DROP_ITEM}
            onClick={() => { onCloseProject(); setOpen(false); }}
          >
            Chiudi progetto
          </button>
          <div style={DROP_SEP} />
          <button
            style={DROP_ITEM}
            onClick={() => { onLogout(); setOpen(false); }}
          >
            Esci
          </button>
          {ioStatus && (
            <div style={{ padding: "4px 14px", fontSize: 11, color: ioStatus.startsWith("✓") ? "#86efac" : "#fca5a5" }}>
              {ioStatus}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleImport(f); }}
          />
        </div>
      )}
    </div>
  );
}

const MODE_LABELS: Record<Mode, string> = {
  edit:   "Editor",
  view:   "Runtime",
  config: "Configurazione",
};

const LOG_PANEL_KEY = "sws.logPanel.open";

export function App() {
  const { t } = useTranslation();
  const mode    = useAppStore((s) => s.appMode);
  const setMode = useAppStore((s) => s.setAppMode);
  const [logOpen, setLogOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LOG_PANEL_KEY) === "1"; } catch { return false; }
  });

  // Stream runtime logs whenever the user is Operator+. The hook is a no-op
  // for Viewer / unauthenticated states.
  useLogStream();

  const authToken              = useAppStore((s) => s.authToken);
  const authUser               = useAppStore((s) => s.authUser);
  const authRole               = useAppStore((s) => s.authRole);
  const mustChangePassword     = useAppStore((s) => s.mustChangePassword);
  const setMustChangePassword  = useAppStore((s) => s.setMustChangePassword);
  const clearAuth              = useAppStore((s) => s.clearAuth);
  const noActiveProject        = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject     = useAppStore((s) => s.setNoActiveProject);
  const reAuthNeeded           = useAppStore((s) => s.reAuthNeeded);
  const setReAuthNeeded        = useAppStore((s) => s.setReAuthNeeded);
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setPages       = useAppStore((s) => s.setPages);
  const project        = useAppStore((s) => s.project);
  const setProject     = useAppStore((s) => s.setProject);

  // Listen for mid-session token expiry fired by api/client.ts
  useEffect(() => {
    const handler = () => { if (authToken) setReAuthNeeded(true); };
    window.addEventListener("sws:session-expired", handler);
    return () => window.removeEventListener("sws:session-expired", handler);
  }, [authToken, setReAuthNeeded]);

  // Mount flow:
  //   1. If no token → try GET /api/project to detect 503 (no project open).
  //      503 → WelcomeScreen.  Any other error → LoginScreen.
  //   2. If token present → same call. 200 → load project. 401 → clear auth.
  //      503 → WelcomeScreen (project was closed externally).
  useEffect(() => {
    if (mustChangePassword) return;

    api.getProject()
      .then((p) => {
        setNoActiveProject(false);
        setProject(p);
      })
      .catch((e) => {
        if (e instanceof NoProjectError) {
          setNoActiveProject(true);
          clearAuth();
        } else if (e instanceof RuntimeUnavailableError) {
          // Runtime non raggiungibile → WelcomeScreen; la WelcomeScreen
          // gestirà il retry/errore quando l'utente interagisce.
          setNoActiveProject(true);
          clearAuth();
        } else if (e instanceof AuthError) {
          clearAuth();
        } else if (e instanceof PasswordChangeRequiredError) {
          setMustChangePassword(true);
        }
      });

    if (!authToken) return;

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
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  const handleCloseProject = async () => {
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  // Show WelcomeScreen when runtime has no active project.
  if (noActiveProject) {
    return (
      <WelcomeScreen
        onProjectOpened={() => {
          // open_project invalidates all sessions → go to LoginScreen.
          setNoActiveProject(false);
          clearAuth();
        }}
      />
    );
  }

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
        {(() => {
          // ARCH-004: remote runtime indicator. Visible only when the SPA is
          // pointing at a non-default runtime origin. Click to disconnect →
          // strips localStorage + full reload back to same-origin / proxy.
          const remote = getRuntimeBaseUrl();
          if (!remote) return null;
          // Display only the host:port portion so the header stays compact.
          let host = remote;
          try { const u = new URL(remote); host = u.host; } catch { /* ignore */ }
          return (
            <button
              onClick={() => {
                if (window.confirm(`Disconnetti dal runtime remoto ${host}? Tornerai al runtime locale.`)) {
                  setRuntimeBaseUrl(null);
                  window.location.reload();
                }
              }}
              title={`Connesso a ${remote}. Clicca per tornare al runtime locale.`}
              style={{
                padding: "2px 8px",
                background: "#1e3a8a",
                color: "#bfdbfe",
                border: "1px solid #2563eb",
                borderRadius: 10,
                cursor: "pointer",
                fontSize: 11,
                fontWeight: 600,
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <span>📡</span>
              <span style={{ fontFamily: "monospace" }}>{host}</span>
            </button>
          );
        })()}
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
        {mode === "edit" && <GridDropdown />}
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
        <MainMenu mode={mode} onLogout={handleLogout} onCloseProject={handleCloseProject} />
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

      {/* Re-auth overlay — session expired mid-use */}
      {reAuthNeeded && <ReAuthModal />}
    </div>
  );
}
