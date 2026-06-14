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
import { useAppStore } from "@/store";
import { useLogStream } from "@/ws/logStream";
import { canEditProject, canConfigureProject } from "@/auth/permissions";

// Port 8444 — full IDE (canvas editor + ConfigView + project management).
// Served via admin-main.tsx which calls setForceLocalApi(true) before render.
type Mode = "edit" | "config";

// ── Role gate for admin port ──────────────────────────────────────────────────

const HDR_BTN_DENY: React.CSSProperties = {
  padding: "8px 20px", background: "#334155", color: "#cbd5e1",
  border: "1px solid #475569", borderRadius: 4, cursor: "pointer", fontSize: 14,
};

function AccessDenied({ role, onLogout }: { role: string; onLogout: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", background: "#0f172a",
      color: "#e2e8f0", gap: 16, fontFamily: "system-ui",
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>Accesso negato</div>
      <div style={{ fontSize: 14, color: "#94a3b8", maxWidth: 400, textAlign: "center" }}>
        Il pannello IDE richiede ruolo <strong>Supervisor</strong> o <strong>Admin</strong>.
        Sei autenticato come <strong>{role}</strong>.
      </div>
      <button style={HDR_BTN_DENY} onClick={onLogout}>Logout</button>
    </div>
  );
}

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

// ── RuntimeCtrl (admin/supervisor only) ──────────────────────────────────────

function RuntimeCtrl() {
  const authRole              = useAppStore((s) => s.authRole);
  const [running, setRunning] = useState<boolean | null>(null);
  const [busy, setBusy]       = useState(false);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const s = await api.getSystemStatus();
        if (alive) setRunning(s.sources_running);
      } catch { /* ignore — runtime may be restarting */ }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  if (!canConfigureProject(authRole)) return null;

  const handleToggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (running) await api.systemStop();
      else         await api.systemStart();
      const s = await api.getSystemStatus();
      setRunning(s.sources_running);
    } catch { /* ignore */ }
    finally { setBusy(false); }
  };

  const handleReboot = async () => {
    if (!confirm("Riavviare il runtime? Tutti i WebSocket si disconnetteranno per ~2s.")) return;
    setBusy(true);
    try { await api.systemReboot(); } catch { /* ignore */ }
    setTimeout(() => setBusy(false), 3000);
  };

  const dotColor = running === null ? "#64748b" : running ? "#22c55e" : "#ef4444";
  const dotTitle = running === null ? "Stato sconosciuto" : running ? "Acquisizione attiva" : "Acquisizione ferma";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span
        title={dotTitle}
        style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }}
      />
      <button
        style={{ ...HDR_BTN, opacity: busy ? 0.6 : 1 }}
        disabled={busy || running === null}
        onClick={handleToggle}
        title={running ? "Ferma acquisizione dati" : "Avvia acquisizione dati"}
      >
        {busy ? "…" : running ? "Stop" : "Start"}
      </button>
      <button
        style={{ ...HDR_BTN, opacity: busy ? 0.6 : 1 }}
        disabled={busy}
        onClick={handleReboot}
        title="Riavvia il processo runtime (exec-replace, ~2s di disconnessione)"
      >
        Reboot
      </button>
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
  config: "Configurazione",
};

const LOG_PANEL_KEY = "sws.logPanel.open";

export function App() {
  const { t } = useTranslation();
  const mode             = useAppStore((s) => s.appMode);
  const setMode          = useAppStore((s) => s.setAppMode);
  const configTab        = useAppStore((s) => s.configTab);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const [logOpen, setLogOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LOG_PANEL_KEY) === "1"; } catch { return false; }
  });

  // Stream runtime logs whenever the user is Operator+. The hook is a no-op
  // for Viewer / unauthenticated states.
  useLogStream();

  const authToken              = useAppStore((s) => s.authToken);
  const authUser               = useAppStore((s) => s.authUser);
  const authRole               = useAppStore((s) => s.authRole);
  const expiresAtMs            = useAppStore((s) => s.expiresAtMs);
  const setExpiresAtMs         = useAppStore((s) => s.setExpiresAtMs);
  const mustChangePassword     = useAppStore((s) => s.mustChangePassword);
  const setMustChangePassword  = useAppStore((s) => s.setMustChangePassword);
  const setAuth                = useAppStore((s) => s.setAuth);
  const clearAuth              = useAppStore((s) => s.clearAuth);
  const noActiveProject        = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject     = useAppStore((s) => s.setNoActiveProject);
  const reAuthNeeded           = useAppStore((s) => s.reAuthNeeded);
  const setReAuthNeeded        = useAppStore((s) => s.setReAuthNeeded);
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const setPages       = useAppStore((s) => s.setPages);
  const setFaceplates  = useAppStore((s) => s.setFaceplates);
  const project             = useAppStore((s) => s.project);
  const setProject          = useAppStore((s) => s.setProject);
  const setProjectLoadError = useAppStore((s) => s.setProjectLoadError);
  const isDirty             = useAppStore((s) => s.isDirty);
  const incSaveSerial       = useAppStore((s) => s.incSaveSerial);
  const saveStatus          = useAppStore((s) => s.saveStatus);

  // Role-gated UI surfaces. Supervisor + Admin get editor and config;
  // Viewer/Operator should use the runtime SPA (port 8443) instead.
  const canEdit = canEditProject(authRole);

  // True while the initial getProject()+whoami() bootstrap is in flight.
  // Prevents LoginScreen from flashing before we know the auth state.
  const [bootstrapping, setBootstrapping] = useState(true);

  const [confirmPending, setConfirmPending] = useState<"close" | "logout" | null>(null);
  const [waitingForSave, setWaitingForSave] = useState(false);

  // Remote deploy target connection state — persisted in localStorage by RuntimeConnectionTab.
  const [rtConnected, setRtConnected] = useState(
    () => localStorage.getItem("sws.runtime.connected") === "1"
  );

  // Dev-mode TTL banner: shown to Admin/Supervisor when their session has an expiry.
  // Lets them quickly disable it for convenience during development.
  const [devTtlBanner, setDevTtlBanner] = useState<{ ttlSecs: number } | null>(null);
  const [ttlBusy, setTtlBusy] = useState(false);

  useEffect(() => {
    if (!authToken || !authUser || (authRole !== "Admin" && authRole !== "Supervisor")) {
      setDevTtlBanner(null);
      return;
    }
    api.listUsers()
      .then((users) => {
        const me = users.find((u) => u.username === authUser);
        if (me && me.session_ttl_secs !== null && me.session_ttl_secs !== 0) {
          setDevTtlBanner({ ttlSecs: me.session_ttl_secs });
        }
      })
      .catch(() => { /* non-critical */ });
  }, [authToken, authUser, authRole]);

  const handleDisableTtl = async () => {
    if (!authUser) return;
    setTtlBusy(true);
    try {
      await api.updateUser(authUser, { session_ttl_secs: 0 });
      setDevTtlBanner(null);
    } catch { /* ignore */ } finally {
      setTtlBusy(false);
    }
  };
  useEffect(() => {
    const onConn = () => setRtConnected(true);
    const onDisc = () => setRtConnected(false);
    window.addEventListener("sws:runtime-connected", onConn);
    window.addEventListener("sws:runtime-disconnected", onDisc);
    return () => {
      window.removeEventListener("sws:runtime-connected", onConn);
      window.removeEventListener("sws:runtime-disconnected", onDisc);
    };
  }, []);

  const effectiveMode: Mode =
    (mode === "edit"   && !canEdit)      ? "config" :
    mode;
  const allowedModes: Mode[] = canEdit
    ? (["edit", "config"] as Mode[])
    : (["config"] as Mode[]);

  // ── URL hash deep-linking (#edit | #view | #config | #config/<tab>) ─────────
  // Read once after the app becomes active (authenticated + project open).
  const deepLinkApplied = useRef(false);
  const VALID_TABS = ["tags","protocols","alarms","users","resources","system","backups"];
  useEffect(() => {
    if (!authToken || noActiveProject || deepLinkApplied.current) return;
    deepLinkApplied.current = true;
    const hash = window.location.hash.slice(1);
    if (hash.startsWith("config/")) {
      const tab = hash.slice("config/".length);
      if (VALID_TABS.includes(tab)) navigateToConfig(tab as Parameters<typeof navigateToConfig>[0]);
      else setMode("config");
    } else if (hash === "edit" || hash === "config") {
      setMode(hash as Mode);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authToken, noActiveProject]);

  // Keep hash in sync whenever mode or configTab changes (for bookmarking).
  useEffect(() => {
    if (!authToken || noActiveProject) return;
    const hash = effectiveMode === "config" ? `config/${configTab}` : effectiveMode;
    history.replaceState(null, "", `#${hash}`);
  }, [effectiveMode, configTab, authToken, noActiveProject]);

  // Listen for mid-session token expiry fired by api/client.ts
  useEffect(() => {
    const handler = () => { if (authToken) setReAuthNeeded(true); };
    window.addEventListener("sws:session-expired", handler);
    return () => window.removeEventListener("sws:session-expired", handler);
  }, [authToken, setReAuthNeeded]);

  // Proactive session refresh: fire 5 min before expiry so idle sessions
  // don't time out. Effect re-runs whenever expiresAtMs changes (i.e., after
  // each successful refresh), creating a self-rescheduling timer chain.
  useEffect(() => {
    if (!authToken || !expiresAtMs) return;
    const delay = Math.max(expiresAtMs - Date.now() - 5 * 60_000, 30_000);
    const timer = setTimeout(async () => {
      try {
        const r = await api.refresh();
        setExpiresAtMs(r.expires_at_ms);
      } catch {
        // Failure is handled by the existing session-expired event + ReAuthModal;
        // no duplicate action needed here.
      }
    }, delay);
    return () => clearTimeout(timer);
  }, [authToken, expiresAtMs, setExpiresAtMs]);

  // Mount flow:
  //   1. If no token → try GET /api/project to detect 503 (no project open).
  //      503 → WelcomeScreen.  Any other error → LoginScreen.
  //   2. If token present → same call. 200 → load project. 401 → clear auth.
  //      503 → WelcomeScreen (project was closed externally).
  useEffect(() => {
    if (mustChangePassword) return;

    api.getProject()
      .then(async (p) => {
        setNoActiveProject(false);
        setProject(p);
        // No token and project is open: we may be in no-auth mode.
        // Probe whoami; if it succeeds (synthetic admin), set a sentinel
        // token so the main app renders instead of LoginScreen.
        if (!authToken) {
          try {
            const me = await api.whoami();
            setAuth("no-auth", me.username, me.role, me.must_change_password);
          } catch { /* has users → LoginScreen will appear */ }
        }
        setBootstrapping(false);
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
        } else {
          setProjectLoadError(e?.message ?? String(e));
        }
        setBootstrapping(false);
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

    api.listFaceplates()
      .then(async (ids) => {
        if (ids.length === 0) return;
        const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
        setFaceplates(loaded);
      })
      .catch(() => { /* non-critical — no faceplates configured */ });
  }, [authToken, mustChangePassword]);

  const executeClose = async () => {
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  const executeLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  const handleLogout = () => {
    if (isDirty) { setConfirmPending("logout"); return; }
    executeLogout();
  };

  const handleCloseProject = () => {
    if (isDirty) { setConfirmPending("close"); return; }
    executeClose();
  };

  // After triggering a save via incSaveSerial(), wait for isDirty to clear
  // (save succeeded) or saveStatus "error" (save failed) before closing.
  useEffect(() => {
    if (!waitingForSave) return;
    if (!isDirty) {
      setWaitingForSave(false);
      const pending = confirmPending;
      setConfirmPending(null);
      if (pending === "close") executeClose();
      else if (pending === "logout") executeLogout();
    } else if (saveStatus === "error") {
      setWaitingForSave(false);
      setConfirmPending(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingForSave, isDirty, saveStatus]);

  // Blank while the first getProject()+whoami() round-trip is in flight.
  if (bootstrapping) return null;

  // No active project → show project picker (WelcomeScreen).
  if (noActiveProject) {
    return (
      <WelcomeScreen
        onProjectOpened={async () => {
            // whoami BEFORE setNoActiveProject so the WelcomeScreen stays
            // visible while we probe auth state — avoids a LoginScreen flash.
            // No-auth mode: server injects synthetic admin → 200.
            // Auth mode: swap_store invalidated old session → 401.
            try {
              const me = await api.whoami();
              clearAuth();
              setAuth("no-auth", me.username, me.role, me.must_change_password);
            } catch {
              clearAuth(); // has users → LoginScreen correct
            }
            setNoActiveProject(false);
          }}
      />
    );
  }

  if (!authToken) {
    const handleCancelLogin = async () => {
      try { await api.closeProject(); } catch { /* ignore */ }
      setNoActiveProject(true);
    };
    return <LoginScreen onCancel={handleCancelLogin} />;
  }

  if (mustChangePassword) {
    return <ChangePasswordScreen />;
  }

  // Role gate: Operator/Viewer cannot use the IDE on port 8444.
  if (!canConfigureProject(authRole)) {
    return <AccessDenied role={authRole ?? "Viewer"} onLogout={handleLogout} />;
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
          {allowedModes.map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                padding: "5px 14px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: effectiveMode === m ? "#3b82f6" : "#334155",
                color: "#fff",
                fontWeight: effectiveMode === m ? 600 : 400,
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
        {effectiveMode === "edit" && <GridDropdown />}
        <RuntimeCtrl />
        {/* Remote deploy target indicator — green when connected, click to go to Runtime tab */}
        <button
          onClick={() => {
            if (rtConnected) {
              if (window.confirm("Disconnettere dal runtime remoto?")) {
                localStorage.removeItem("sws.runtime.connected");
                setRtConnected(false);
                window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
              }
            } else {
              navigateToConfig("runtime");
            }
          }}
          title={rtConnected ? "Connesso al runtime remoto — clicca per disconnettere" : "Clicca per configurare la connessione al runtime remoto"}
          style={{
            ...HDR_BTN,
            ...(rtConnected ? { background: "#14532d", color: "#4ade80", border: "1px solid #16a34a" } : {}),
            display: "flex", alignItems: "center", gap: 5,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: rtConnected ? "#4ade80" : "#ef4444", display: "inline-block", flexShrink: 0 }} />
          Deploy
        </button>
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
        <MainMenu mode={effectiveMode} onLogout={handleLogout} onCloseProject={handleCloseProject} />
      </header>

      {/* Alarm banner */}
      <AlarmBanner />

      {/* Dev-mode TTL banner: suggests disabling session expiry during development */}
      {devTtlBanner && (
        <div style={{
          background: "#1c1917", borderBottom: "1px solid #44403c",
          padding: "5px 16px", display: "flex", alignItems: "center",
          gap: 12, fontSize: 12, color: "#d6d3d1", flexShrink: 0,
        }}>
          <span style={{ color: "#a8a29e" }}>⏱</span>
          <span>
            La sessione scade dopo {Math.round(devTtlBanner.ttlSecs / 60)} min.
            Disattivarla per lo sviluppo?
          </span>
          <button
            onClick={handleDisableTtl}
            disabled={ttlBusy}
            style={{
              background: "#292524", color: "#d6d3d1",
              border: "1px solid #44403c", borderRadius: 4,
              padding: "2px 10px", cursor: ttlBusy ? "default" : "pointer",
              fontSize: 11,
            }}
          >
            {ttlBusy ? "…" : "Disattiva"}
          </button>
          <button
            onClick={() => setDevTtlBanner(null)}
            style={{
              background: "transparent", color: "#78716c", border: "none",
              cursor: "pointer", fontSize: 13, padding: "0 4px", marginLeft: "auto",
            }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Page tabs (editor mode only) */}
      {effectiveMode === "edit" && (
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
        {effectiveMode === "edit"   && <EditorShell />}
        {effectiveMode === "config" && <ConfigView />}
      </main>

      {/* Log drawer (bottom) */}
      <LogPanel open={logOpen} onClose={() => {
        setLogOpen(false);
        try { localStorage.setItem(LOG_PANEL_KEY, "0"); } catch { /* ignore */ }
      }} />

      {/* Re-auth overlay — session expired mid-use */}
      {reAuthNeeded && <ReAuthModal />}

      {/* Unsaved-changes confirmation dialog */}
      {confirmPending && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }}>
          <div style={{ background: "#1e293b", border: "1px solid #334155", borderRadius: 8, padding: "24px 28px", maxWidth: 360, width: "90%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>Modifiche non salvate</div>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>Ci sono modifiche al sinottico non ancora salvate. Cosa vuoi fare?</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                style={{ ...HDR_BTN, background: "#1d4ed8", color: "#fff", border: "1px solid #2563eb", padding: "8px 16px", fontSize: 13 }}
                disabled={waitingForSave}
                onClick={() => { incSaveSerial(); setWaitingForSave(true); }}
              >
                {waitingForSave ? "Salvataggio…" : "Salva e chiudi"}
              </button>
              <button
                style={{ ...HDR_BTN, background: "#7f1d1d", color: "#fca5a5", border: "1px solid #991b1b", padding: "8px 16px", fontSize: 13 }}
                onClick={() => {
                  const pending = confirmPending;
                  setConfirmPending(null);
                  if (pending === "close") executeClose();
                  else executeLogout();
                }}
              >
                Chiudi senza salvare
              </button>
              <button
                style={{ ...HDR_BTN, padding: "8px 16px", fontSize: 13 }}
                onClick={() => { setConfirmPending(null); setWaitingForSave(false); }}
              >
                Annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
