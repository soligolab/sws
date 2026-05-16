import { useState } from "react";
import { api, RuntimeUnavailableError } from "@/api/client";
import { useAppStore } from "@/store";

/**
 * Minimal login screen shown when the store has no auth token.
 * Calls POST /api/auth/login, stores the returned token, and the App
 * unmounts/remounts to render the authenticated UI.
 *
 * PoC scope: no "remember me" toggle, no rate-limit hint, no captcha.
 * The runtime's session map is in-memory, so a runtime restart logs
 * everyone out automatically.
 */
export function LoginScreen() {
  const setAuth = useAppStore((s) => s.setAuth);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(username, password);
      setAuth(res.token, res.username, res.role, res.must_change_password);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (e instanceof RuntimeUnavailableError) {
        setError("Runtime non raggiungibile. Avvia ./scripts/dev.sh e riprova.");
      } else if (msg.includes("429")) {
        setError("Troppi tentativi. Riprova fra un minuto.");
      } else {
        setError("Credenziali non valide.");
      }
      console.warn("login failed:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      height: "100vh",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "#0f172a",
      color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
    }}>
      <form onSubmit={submit} style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 10,
        padding: "32px 36px",
        width: 320,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: 20, letterSpacing: 1 }}>SWS</strong>
          <span style={{ color: "#64748b", fontSize: 13 }}>Soligo Web SCADA</span>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Utente</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            style={input}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            style={input}
          />
        </div>
        {error && (
          <div style={{ color: "#fca5a5", fontSize: 12, background: "#7f1d1d33", padding: "6px 10px", borderRadius: 4 }}>
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !password}
          style={{
            background: busy ? "#1e3a8a" : "#3b82f6",
            color: "#fff", border: "none", borderRadius: 4,
            padding: "8px 12px", cursor: busy ? "default" : "pointer",
            fontSize: 14, fontWeight: 600,
          }}
        >
          {busy ? "Accesso…" : "Accedi"}
        </button>
        <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>
          Sessioni in-memory: un riavvio del runtime ti disconnette automaticamente.
        </p>
      </form>
    </div>
  );
}

const input: React.CSSProperties = {
  width: "100%",
  background: "#0f172a",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "7px 10px",
  color: "#e2e8f0",
  fontSize: 14,
  boxSizing: "border-box",
};
