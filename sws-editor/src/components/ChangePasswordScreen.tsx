import { useState } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

/**
 * Shown when the session user still has `must_change_password = true`.
 * The runtime gates every non-self-service endpoint with HTTP 403 +
 * `{ error: "password_change_required" }`, so the only thing this screen
 * can do is post a new password. On success, the flag flips and the App
 * remounts into the normal UI.
 */
export function ChangePasswordScreen() {
  const authUser              = useAppStore((s) => s.authUser);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);
  const clearAuth             = useAppStore((s) => s.clearAuth);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.length < 4) {
      setError("La nuova password deve avere almeno 4 caratteri.");
      return;
    }
    if (newPassword !== confirm) {
      setError("Le due password non coincidono.");
      return;
    }
    if (newPassword === oldPassword) {
      setError("La nuova password deve essere diversa dalla precedente.");
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMustChangePassword(false);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("401")) {
        // Token rejected: drop the session and bounce back to login.
        clearAuth();
      } else if (msg.includes("400") || msg.includes("invalid_password")) {
        setError("La vecchia password non è corretta.");
      } else {
        setError("Errore nel cambio password. Riprova.");
        console.warn("change-password failed:", e);
      }
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
        width: 360,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: 18, letterSpacing: 1 }}>Cambio password</strong>
        </div>
        <p style={{ color: "#94a3b8", fontSize: 12, margin: 0 }}>
          Benvenuto <strong>{authUser}</strong>. Per continuare devi impostare una nuova password.
        </p>

        <div>
          <label style={label}>Password attuale</label>
          <input type="password" value={oldPassword}
                 onChange={(e) => setOldPassword(e.target.value)}
                 autoComplete="current-password" autoFocus style={input} />
        </div>
        <div>
          <label style={label}>Nuova password</label>
          <input type="password" value={newPassword}
                 onChange={(e) => setNewPassword(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>
        <div>
          <label style={label}>Conferma nuova password</label>
          <input type="password" value={confirm}
                 onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>

        {error && (
          <div style={{ color: "#fca5a5", fontSize: 12, background: "#7f1d1d33", padding: "6px 10px", borderRadius: 4 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || !oldPassword || !newPassword}
                  style={{
                    flex: 1,
                    background: busy ? "#1e3a8a" : "#3b82f6",
                    color: "#fff", border: "none", borderRadius: 4,
                    padding: "8px 12px", cursor: busy ? "default" : "pointer",
                    fontSize: 14, fontWeight: 600,
                  }}>
            {busy ? "Aggiornamento…" : "Cambia password"}
          </button>
          <button type="button" onClick={() => { void api.logout().catch(() => {}); clearAuth(); }}
                  style={{
                    background: "#334155", color: "#cbd5e1",
                    border: "1px solid #475569", borderRadius: 4,
                    padding: "8px 12px", cursor: "pointer", fontSize: 13,
                  }}>
            Esci
          </button>
        </div>
      </form>
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4,
};

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
