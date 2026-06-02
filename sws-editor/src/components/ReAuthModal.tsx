import { useRef, useState } from "react";
import { api, NoProjectError, RateLimitedError, RuntimeUnavailableError } from "@/api/client";
import { useAppStore } from "@/store";

const OVERLAY: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.65)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 9000,
};

const CARD: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
  borderRadius: 10,
  padding: "28px 32px",
  width: 320,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};

const LABEL: React.CSSProperties = { fontSize: 12, color: "#94a3b8", marginBottom: 4 };

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "#0f172a",
  border: "1px solid #475569",
  borderRadius: 5,
  color: "#e2e8f0",
  padding: "7px 10px",
  fontSize: 13,
  boxSizing: "border-box",
};

const BTN_PRIMARY: React.CSSProperties = {
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 5,
  padding: "8px 0",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
  width: "100%",
};

const BTN_GHOST: React.CSSProperties = {
  background: "transparent",
  color: "#64748b",
  border: "none",
  fontSize: 12,
  cursor: "pointer",
  padding: "2px 0",
  textAlign: "center" as const,
};

export function ReAuthModal() {
  const authUser           = useAppStore((s) => s.authUser);
  const setAuth            = useAppStore((s) => s.setAuth);
  const setReAuthNeeded    = useAppStore((s) => s.setReAuthNeeded);
  const clearAuth          = useAppStore((s) => s.clearAuth);
  const setNoActiveProject = useAppStore((s) => s.setNoActiveProject);

  const [password, setPassword]       = useState("");
  const [error, setError]             = useState<string | null>(null);
  const [noProject, setNoProject]     = useState(false);
  const [busy, setBusy]               = useState(false);
  const inputRef                      = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(authUser, password);
      setAuth(res.token, res.username, res.role, res.must_change_password);
      setReAuthNeeded(false);
    } catch (e: any) {
      if (e instanceof NoProjectError) {
        // Runtime restarted without an active project (e.g. after reboot
        // before .last-opened was consumed). Go to WelcomeScreen.
        setNoProject(true);
      } else {
        setError(
          e instanceof RuntimeUnavailableError
            ? "Runtime non raggiungibile."
            : e instanceof RateLimitedError
            ? `Troppi tentativi. Riprova tra ${e.retryAfterSecs}s.`
            : "Password errata. Riprova."
        );
        setPassword("");
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    // Fully log out — falls through to LoginScreen.
    setReAuthNeeded(false);
    clearAuth();
  };

  const handleGoToWelcome = () => {
    setReAuthNeeded(false);
    clearAuth();
    setNoActiveProject(true);
  };

  if (noProject) {
    return (
      <div style={OVERLAY}>
        <div style={CARD}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
              Nessun progetto attivo
            </div>
            <div style={{ fontSize: 12, color: "#64748b" }}>
              Il runtime si è riavviato senza un progetto aperto. Torna alla schermata di benvenuto per selezionare un progetto.
            </div>
          </div>
          <button style={BTN_PRIMARY} onClick={handleGoToWelcome}>
            Vai alla schermata di benvenuto
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#e2e8f0", marginBottom: 4 }}>
            Sessione scaduta
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>
            Inserisci la password per continuare come <strong style={{ color: "#94a3b8" }}>{authUser}</strong>.
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={LABEL}>Password</div>
            <input
              ref={inputRef}
              type="password"
              autoFocus
              style={INPUT}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: "#fca5a5" }}>{error}</div>
          )}

          <button type="submit" style={BTN_PRIMARY} disabled={busy || !password}>
            {busy ? "Accesso in corso…" : "Riautentica"}
          </button>
        </form>

        <button style={BTN_GHOST} onClick={handleDismiss}>
          Esci e torna al login
        </button>
      </div>
    </div>
  );
}
