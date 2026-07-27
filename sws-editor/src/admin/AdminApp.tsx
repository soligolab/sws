import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  api,
  AuthError,
  getRuntimeBaseUrl,
  NoProjectError,
  PasswordChangeRequiredError,
  RuntimeUnavailableError,
  setForceLocalApi,
  setRuntimeBaseUrl,
} from "@/api/client";
import { AlarmBanner } from "@/components/AlarmBanner";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";
import { LoginScreen } from "@/components/LoginScreen";
import { ReAuthModal } from "@/components/ReAuthModal";
import { WelcomeScreen } from "@/components/WelcomeScreen";
import { ConfigView } from "@/config/ConfigView";
import { useAppStore } from "@/store";
import { canConfigureProject } from "@/auth/permissions";

// Admin SPA — served on port 8444.
// Only shows WelcomeScreen, LoginScreen, and ConfigView.
// Canvas editor (EditorShell) is not included.
// Operator / Viewer users see a 403 message after login.

const HDR_BTN: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--brand-surface-2, #334155)",
  color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
};


function AccessDenied({ role, onLogout }: { role: string; onLogout: () => void }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      height: "100vh", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)", gap: 16, fontFamily: "system-ui",
    }}>
      <div style={{ fontSize: 48 }}>🔒</div>
      <div style={{ fontSize: 20, fontWeight: 600 }}>Accesso negato</div>
      <div style={{ fontSize: 14, color: "var(--brand-text-muted, #94a3b8)", maxWidth: 400, textAlign: "center" }}>
        Il pannello admin richiede ruolo <strong>Supervisor</strong> o <strong>Admin</strong>.
        Sei autenticato come <strong>{role}</strong>.
      </div>
      <button style={{ ...HDR_BTN, padding: "8px 20px", fontSize: 14 }} onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}

export function AdminApp() {
  const { t } = useTranslation();

  const authToken             = useAppStore((s) => s.authToken);
  const authUser              = useAppStore((s) => s.authUser);
  const authRole              = useAppStore((s) => s.authRole);
  const expiresAtMs           = useAppStore((s) => s.expiresAtMs);
  const setExpiresAtMs        = useAppStore((s) => s.setExpiresAtMs);
  const mustChangePassword    = useAppStore((s) => s.mustChangePassword);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);
  const clearAuth             = useAppStore((s) => s.clearAuth);
  const noActiveProject       = useAppStore((s) => s.noActiveProject);
  const setNoActiveProject    = useAppStore((s) => s.setNoActiveProject);
  const reAuthNeeded          = useAppStore((s) => s.reAuthNeeded);
  const setReAuthNeeded       = useAppStore((s) => s.setReAuthNeeded);
  const setProject            = useAppStore((s) => s.setProject);
  const setProjectLoadError   = useAppStore((s) => s.setProjectLoadError);

  const canAdmin = canConfigureProject(authRole);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);

  // Admin IDE always talks to the local server — project management must
  // never be routed through a remote runtime URL stored in localStorage.
  useEffect(() => {
    setForceLocalApi(true);
    return () => setForceLocalApi(false);
  }, []);

  // Runtime connection status — persisted in localStorage by RuntimeConnectionTab.
  const [rtConnected, setRtConnected] = useState(
    () => localStorage.getItem("sws.runtime.connected") === "1"
  );

  // Listen for connect/disconnect events emitted by RuntimeConnectionTab.
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

  const handleRuntimeStatusClick = () => {
    if (rtConnected) {
      if (window.confirm(t("admin.disconnectConfirm"))) {
        localStorage.removeItem("sws.runtime.connected");
        setRtConnected(false);
        window.dispatchEvent(new CustomEvent("sws:runtime-disconnected"));
      }
    } else {
      navigateToConfig("runtime");
    }
  };

  const RTN_BTN: React.CSSProperties = rtConnected
    ? { ...HDR_BTN, background: "#14532d", color: "var(--brand-success-soft, #4ade80)", border: "1px solid #16a34a" }
    : HDR_BTN;

  // Proactive token refresh
  useEffect(() => {
    if (!authToken || !expiresAtMs) return;
    const delay = Math.max(expiresAtMs - Date.now() - 5 * 60_000, 30_000);
    const timer = setTimeout(async () => {
      try { const r = await api.refresh(); setExpiresAtMs(r.expires_at_ms); } catch { /* handled by session-expired event */ }
    }, delay);
    return () => clearTimeout(timer);
  }, [authToken, expiresAtMs, setExpiresAtMs]);

  // Session-expired event
  useEffect(() => {
    const handler = () => { if (authToken) setReAuthNeeded(true); };
    window.addEventListener("sws:session-expired", handler);
    return () => window.removeEventListener("sws:session-expired", handler);
  }, [authToken, setReAuthNeeded]);

  // Mount flow: detect active project and auth state
  useEffect(() => {
    if (mustChangePassword) return;
    api.getProject()
      .then((p) => { setNoActiveProject(false); setProject(p); })
      .catch((e) => {
        if (e instanceof NoProjectError || e instanceof RuntimeUnavailableError) {
          setNoActiveProject(true); clearAuth();
        } else if (e instanceof AuthError) {
          clearAuth();
        } else if (e instanceof PasswordChangeRequiredError) {
          setMustChangePassword(true);
        } else {
          setProjectLoadError(e?.message ?? String(e));
        }
      });
  }, [authToken, mustChangePassword]);

  const handleLogout = async () => {
    try { await api.logout(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  const handleCloseProject = async () => {
    try { await api.closeProject(); } catch { /* ignore */ }
    clearAuth();
    setNoActiveProject(true);
  };

  if (noActiveProject) {
    return (
      <WelcomeScreen
        onProjectOpened={() => { setNoActiveProject(false); clearAuth(); }}
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

  if (mustChangePassword) return <ChangePasswordScreen />;

  // Role gate: Operator/Viewer cannot use admin panel
  if (!canAdmin) return <AccessDenied role={authRole ?? "Viewer"} onLogout={handleLogout} />;

  const remote = getRuntimeBaseUrl();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", fontFamily: "system-ui, sans-serif", color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0f172a)" }}>
      <header style={{
        height: 48, background: "var(--brand-surface, #1e293b)", borderBottom: "1px solid var(--brand-surface-2, #334155)",
        display: "flex", alignItems: "center", padding: "0 16px", gap: 16, flexShrink: 0,
      }}>
        <strong style={{ letterSpacing: 1, fontSize: 15, color: "var(--brand-text, #e2e8f0)" }}>SWS Admin</strong>
        {remote && (
          <button
            onClick={() => {
              if (window.confirm(`Disconnetti dal runtime remoto? Tornerai al runtime locale.`)) {
                setRuntimeBaseUrl(null);
                window.location.reload();
              }
            }}
            style={{
              padding: "2px 8px", background: "#1e3a8a", color: "#bfdbfe",
              border: "1px solid var(--brand-primary-hover, #2563eb)", borderRadius: 10, cursor: "pointer",
              fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 4,
            }}
          >
            <span>📡</span>
            <span style={{ fontFamily: "monospace" }}>{(() => { try { return new URL(remote).host; } catch { return remote; } })()}</span>
          </button>
        )}
        <span style={{ color: "var(--brand-border, #475569)", flex: 1, fontSize: 13 }}>
          {t("app.user")}: {authUser ?? "—"}
          {authRole && (
            <span style={{
              marginLeft: 6, padding: "1px 6px", borderRadius: 3, fontSize: 11, fontWeight: 600, color: "var(--brand-text, #e2e8f0)",
              background: authRole === "Admin" ? "#7c2d12" : authRole === "Supervisor" ? "#7e22ce" : "var(--brand-surface-2, #334155)",
            }}>
              {authRole}
            </span>
          )}
        </span>
        <button style={RTN_BTN} onClick={handleRuntimeStatusClick} title={rtConnected ? t("admin.runtimeConnectedTitle") : t("admin.runtimeConfigTitle")}>
          {rtConnected ? "● Connesso" : t("admin.connectRuntime")}
        </button>
        <button style={HDR_BTN} onClick={handleCloseProject}>Chiudi progetto</button>
        <button style={HDR_BTN} onClick={handleLogout}>Esci</button>
      </header>

      <AlarmBanner />

      <main style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <ConfigView />
      </main>

      {reAuthNeeded && <ReAuthModal />}
    </div>
  );
}
