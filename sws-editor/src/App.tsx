import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, AuthError, getRuntimeBaseUrl, NoProjectError, PasswordChangeRequiredError, RuntimeUnavailableError, setRuntimeBaseUrl } from "@/api/client";
import { AlarmBanner } from "@/components/AlarmBanner";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { BrandLogo } from "@/components/BrandLogo";
import { DirtyIndicator } from "@/components/DirtyIndicator";
import { HDR_BTN } from "@/components/headerStyles";
import { MainMenu } from "@/components/MainMenu";
import { RuntimeCtrl } from "@/components/RuntimeCtrl";
import { ViewerLink } from "@/components/ViewerLink";
import { UserMenu } from "@/components/UserMenu";
import { LogPanel } from "@/components/LogPanel";
import { LoginScreen } from "@/components/LoginScreen";
import { ReAuthModal } from "@/components/ReAuthModal";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ConfigView } from "@/config/ConfigView";
import { EditorShell } from "@/editor/EditorShell";
import { getBrand } from "@/branding";
import { selectIsDirty, useAppStore } from "@/store";
import { pickInitialPageId } from "@/pageLayout";
import { useLogStream } from "@/ws/logStream";
import { useTagStream } from "@/ws/tagStream";
import { useProjectWatcher } from "@/ws/projectWatcher";
import { useBuildWatcher } from "@/ws/buildWatcher";
import { canEditProject, canConfigureProject } from "@/auth/permissions";

// Port 8444 — full IDE (canvas editor + ConfigView + project management).
// Served via admin-main.tsx which calls setForceLocalApi(true) before render.
type Mode = "edit" | "config";

// ── Role gate for admin port ──────────────────────────────────────────────────

const HDR_BTN_DENY: React.CSSProperties = {
  padding: "8px 20px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, cursor: "pointer", fontSize: 14,
};

function AccessDenied({ role, onLogout }: { role: string; onLogout: () => void }) {
  const { t } = useTranslation();
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh", background: "var(--brand-bg, #0f172a)",
      color: "var(--brand-text, #e2e8f0)", gap: 16, fontFamily: "system-ui",
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>{t("accessDenied.title")}</div>
      <div style={{ fontSize: 14, color: "var(--brand-text-muted, #94a3b8)", maxWidth: 400, textAlign: "center" }}>
        {t("accessDenied.requires")} {t("accessDenied.authenticatedAs", { role })}
      </div>
      <button style={HDR_BTN_DENY} onClick={onLogout}>{t("accessDenied.logout")}</button>
    </div>
  );
}

// ── Shared header-button style ────────────────────────────────────────────────

const LOG_PANEL_KEY = "sws.logPanel.open";

export function App() {
  const { t } = useTranslation();
  const mode             = useAppStore((s) => s.appMode);
  const setMode          = useAppStore((s) => s.setAppMode);
  const configTab        = useAppStore((s) => s.configTab);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  // Log drawer: state stays here (App owns <LogPanel>), the toggle moved into
  // the ☰ menu — it is a diagnostic, not a per-minute control.
  const [logOpen, setLogOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(LOG_PANEL_KEY) === "1"; } catch { return false; }
  });
  const toggleLog = () => {
    setLogOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(LOG_PANEL_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  // Stream runtime logs and tag values whenever the user is authenticated.
  useLogStream();
  useTagStream();

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
  const setPages       = useAppStore((s) => s.setPages);
  const setFaceplates  = useAppStore((s) => s.setFaceplates);
  const resetProjectState = useAppStore((s) => s.resetProjectState);
  const project             = useAppStore((s) => s.project);
  const setProject          = useAppStore((s) => s.setProject);
  const setProjectLoadError = useAppStore((s) => s.setProjectLoadError);
  const isDirty             = useAppStore(selectIsDirty);
  const saveAll             = useAppStore((s) => s.saveAll);
  const resetDirty          = useAppStore((s) => s.resetDirty);
  const saveStatus          = useAppStore((s) => s.saveStatus);
  const remoteDeployStatus  = useAppStore((s) => s.remoteDeployStatus);

  // Role-gated UI surfaces. Supervisor + Admin get editor and config;
  // Viewer/Operator should use the runtime SPA (port 8443) instead.
  const canEdit = canEditProject(authRole);

  // True while the initial getProject()+whoami() bootstrap is in flight.
  // Prevents LoginScreen from flashing before we know the auth state.
  const [bootstrapping, setBootstrapping] = useState(true);

  const [confirmPending, setConfirmPending] = useState<"close" | "logout" | null>(null);
  // Il progetto sul runtime è cambiato sotto di noi (deploy da un altro IDE,
  // pull GitOps, modifica dei file sul dispositivo). NON si ricarica da soli:
  // in editor ci può essere lavoro non salvato, e sovrascriverlo senza chiedere
  // sarebbe peggio del mostrare dati vecchi. Il viewer invece si aggiorna da sé.
  const [projectChangedOutside, setProjectChangedOutside] = useState(false);
  // Frontend nuovo servito dal runtime. Mai automatico qui: un reload
  // butterebbe via le modifiche non salvate.
  const [newBuildAvailable, setNewBuildAvailable] = useState(false);
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
        // Progetto senza synoptic (es. appena creato vuoto): azzera le pagine,
        // altrimenti resterebbe in memoria il contenuto del progetto precedente.
        if (names.length === 0) { setPages([], ""); return; }
        const loaded = await Promise.all(names.map((n) => api.getSynoptic(n)));
        // Letto imperativamente dallo store (non da una chiusura locale): questo
        // effetto lancia getProject() e listSynoptics() come due catene .then
        // indipendenti, quindi project potrebbe non essere ancora stato settato
        // quando arriviamo qui — in quel caso home_page_id è undefined e
        // pickInitialPageId degrada al comportamento di oggi (prima pagina).
        const homePageId = useAppStore.getState().project?.page_layout?.home_page_id;
        setPages(loaded, pickInitialPageId(loaded, homePageId));
      })
      .catch((e) => {
        if (e instanceof AuthError) clearAuth();
        else if (e instanceof PasswordChangeRequiredError) setMustChangePassword(true);
      });

    api.listFaceplates()
      .then(async (ids) => {
        if (ids.length === 0) { setFaceplates([]); return; }
        const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
        setFaceplates(loaded);
      })
      .catch(() => { /* non-critical — no faceplates configured */ });
  }, [authToken, mustChangePassword]);

  // resetDirty() before leaving: after a "close without saving" the store
  // still holds the modified pages, and a later F5 on the WelcomeScreen
  // would raise the beforeunload prompt for a project that is no longer open.
  const executeClose = async () => {
    resetDirty();
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    resetProjectState();
    setNoActiveProject(true);
  };

  const executeLogout = async () => {
    resetDirty();
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

  // After triggering saveAll(), wait for saveStatus "ok" (save succeeded) or
  // "error" (save failed) before closing. Keyed on saveStatus rather than on
  // isDirty: a section that stays dirty would otherwise hang here forever.
  useEffect(() => {
    if (!waitingForSave) return;
    if (saveStatus === "ok") {
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
  }, [waitingForSave, saveStatus]);

  // I salvataggi dell'autore cambiano il fingerprint tanto quanto un deploy
  // esterno: senza questa guardia l'avviso comparirebbe dopo ogni Ctrl+S.
  // Il polling è a 10 s e un salvataggio dura meno di 1 s, quindi 20 s di
  // finestra bastano per attribuire il cambio a noi.
  const lastLocalSaveAt = useRef(0);
  useEffect(() => {
    if (saveStatus === "ok") lastLocalSaveAt.current = Date.now();
  }, [saveStatus]);

  useBuildWatcher(() => setNewBuildAvailable(true));

  useProjectWatcher(() => {
    if (Date.now() - lastLocalSaveAt.current < 20_000) return; // è stato un nostro salvataggio
    setProjectChangedOutside(true);
  });

  // Ctrl+S / Cmd+S — global, so it works in Configuration mode too (where
  // EditorShell is unmounted). preventDefault unconditionally, otherwise the
  // browser's own "Save page" dialog leaks through when nothing is dirty.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      void useAppStore.getState().saveAll();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Warn before the tab is closed/reloaded with unsaved changes. Attached
  // only while dirty, so it costs nothing the rest of the time. Closing the
  // project and logging out don't unload the document (they re-render the
  // WelcomeScreen in place) and are guarded by their own dialog.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Tab title: "● Project — Brand" while dirty. Layers on top of the title
  // set once at boot by applyBranding().
  useEffect(() => {
    const brand = getBrand();
    const base  = project?.meta.name ? `${project.meta.name} — ${brand.shortName}` : brand.name;
    document.title = isDirty ? `● ${base}` : base;
  }, [isDirty, project?.meta.name]);

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
            // Clear any leftover project/pages from before this screen was
            // shown, so EditorShell remounts empty instead of flashing the
            // previous project's canvas while the real data is still in
            // flight (fetched by the effect below, keyed on authToken).
            resetProjectState();
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0f172a)" }}>
      {/* Header */}
      <header style={{
        height: 48,
        background: "var(--brand-surface, #1e293b)",
        borderBottom: "1px solid var(--brand-surface-2, #334155)",
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 16,
        flexShrink: 0,
      }}>
        <BrandLogo />
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
                if (window.confirm(t("header.remoteDisconnectConfirm", { host }))) {
                  setRuntimeBaseUrl(null);
                  window.location.reload();
                }
              }}
              title={t("header.remoteConnected", { url: remote })}
              style={{
                padding: "2px 8px",
                background: "#1e3a8a",
                color: "#bfdbfe",
                border: "1px solid var(--brand-primary-hover, #2563eb)",
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
        <span style={{ color: "var(--brand-border, #475569)", fontSize: 13 }}>
          {t("app.project")}: {project?.meta.name ?? "—"}
        </span>
        <DirtyIndicator />
        <span style={{ flex: 1 }} />
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
                background: effectiveMode === m ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)",
                color: effectiveMode === m ? "var(--brand-on-primary, #fff)" : "var(--brand-text, #e2e8f0)",
                fontWeight: effectiveMode === m ? 600 : 400,
                fontSize: 13,
              }}
            >
              {t(m === "edit" ? "header.mode.editor" : "header.mode.config")}
            </button>
          ))}
        </div>
        <RuntimeCtrl />
        {/* Apre la pagina operatore del runtime — quello connesso se c'è,
            altrimenti il locale. Sta accanto a Deploy di proposito: la domanda
            "ha funzionato?" arriva subito dopo averlo premuto. */}
        <ViewerLink />
        {/* Remote deploy target indicator — shows sync status when connected */}
        {(() => {
          const syncLabel =
            remoteDeployStatus === "syncing" ? t("header.syncing") :
            remoteDeployStatus === "ok"      ? t("header.synced") :
            remoteDeployStatus === "error"   ? t("header.syncError") :
            t("header.deploy");
          const dotColor =
            remoteDeployStatus === "syncing" ? "var(--brand-warning, #f59e0b)" :
            remoteDeployStatus === "ok"      ? "var(--brand-success-soft, #4ade80)" :
            remoteDeployStatus === "error"   ? "var(--brand-danger, #ef4444)" :
            rtConnected ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger, #ef4444)";
          const btnExtra = rtConnected
            ? { background: "#14532d", color: "var(--brand-success-soft, #4ade80)", border: "1px solid #16a34a" }
            : {};
          const titleStr = rtConnected
            ? t("header.deployConnectedTitle")
            : t("header.deployConfigTitle");
          return (
            <button
              onClick={() => {
                if (rtConnected) {
                  if (window.confirm(t("header.deployDisconnectConfirm"))) {
                    localStorage.removeItem("sws.runtime.connected");
                    setRtConnected(false);
                    window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
                  }
                } else {
                  navigateToConfig("runtime");
                }
              }}
              title={titleStr}
              style={{ ...HDR_BTN, ...btnExtra, display: "flex", alignItems: "center", gap: 5 }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: dotColor, display: "inline-block", flexShrink: 0 }} />
              {syncLabel}
            </button>
          );
        })()}
        <UserMenu onLogout={handleLogout} />
        <MainMenu
          onLogout={handleLogout}
          onCloseProject={handleCloseProject}
          logOpen={logOpen}
          onToggleLog={toggleLog}
        />
      </header>

      {/* Alarm banner */}
      {newBuildAvailable && (
        <div style={{
          background: "var(--brand-primary, #3b82f6)", borderBottom: "1px solid var(--brand-primary-hover, #2563eb)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
          fontSize: 12, color: "#fff", flexShrink: 0,
        }}>
          <span>⬆</span>
          <span style={{ flex: 1 }}>{t("app.newBuildAvailable")}</span>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", borderColor: "#fff" }}
            onClick={() => window.location.reload()}
          >
            {t("app.reloadNow")}
          </button>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fff", border: "none" }}
            onClick={() => setNewBuildAvailable(false)}
            title={t("app.dismiss")}
          >
            ✕
          </button>
        </div>
      )}
      {projectChangedOutside && (
        <div style={{
          background: "var(--brand-warning-bg, #78350f)", borderBottom: "1px solid var(--brand-warning, #f59e0b)",
          padding: "6px 16px", display: "flex", alignItems: "center", gap: 12,
          fontSize: 12, color: "#fde68a", flexShrink: 0,
        }}>
          <span>⟳</span>
          <span style={{ flex: 1 }}>{t("app.projectChangedOutside")}</span>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fde68a", borderColor: "var(--brand-warning, #f59e0b)" }}
            onClick={() => window.location.reload()}
          >
            {t("app.reloadNow")}
          </button>
          <button
            style={{ ...HDR_BTN, background: "transparent", color: "#fde68a", border: "none" }}
            onClick={() => setProjectChangedOutside(false)}
            title={t("app.dismiss")}
          >
            ✕
          </button>
        </div>
      )}
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
            {t("header.ttlBanner", { min: Math.round(devTtlBanner.ttlSecs / 60) })}
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
            {ttlBusy ? "…" : t("header.deactivate")}
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
          <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: "24px 28px", maxWidth: 360, width: "90%", display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("unsaved.title")}</div>
            <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>{t("unsaved.body")}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                style={{ ...HDR_BTN, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", padding: "8px 16px", fontSize: 13 }}
                disabled={waitingForSave}
                onClick={() => { void saveAll(); setWaitingForSave(true); }}
              >
                {waitingForSave ? t("header.saving") : t("unsaved.saveClose")}
              </button>
              <button
                style={{ ...HDR_BTN, background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid #991b1b", padding: "8px 16px", fontSize: 13 }}
                onClick={() => {
                  const pending = confirmPending;
                  setConfirmPending(null);
                  if (pending === "close") executeClose();
                  else executeLogout();
                }}
              >
                {t("unsaved.discard")}
              </button>
              <button
                style={{ ...HDR_BTN, padding: "8px 16px", fontSize: 13 }}
                onClick={() => { setConfirmPending(null); setWaitingForSave(false); }}
              >
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
