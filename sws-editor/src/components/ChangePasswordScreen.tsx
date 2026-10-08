import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { paginaCentrata, schedaModulo } from "@/components/schermataAccesso";

/**
 * Shown when the session user still has `must_change_password = true`.
 * The runtime gates every non-self-service endpoint with HTTP 403 +
 * `{ error: "password_change_required" }`, so the only thing this screen
 * can do is post a new password. On success, the flag flips and the App
 * remounts into the normal UI.
 */
/**
 * Il motivo leggibile dentro il messaggio d'errore, quando c'è.
 *
 * Le risposte d'errore del runtime portano un `detail` scritto per essere
 * letto. Mostrarlo è meglio di una frase fissa che a volte combacia e a volte
 * mente — e qui mentiva: qualunque rifiuto diventava «la vecchia password non
 * è corretta», anche quando il problema era un altro.
 */
function dettaglio(msg: string): string | null {
  const i = msg.indexOf("{");
  if (i < 0) return null;
  try {
    const o = JSON.parse(msg.slice(i)) as { detail?: string };
    return o.detail && o.detail.trim() ? o.detail : null;
  } catch {
    return null;
  }
}

export function ChangePasswordScreen({ onAnnulla }: { onAnnulla?: () => void } = {}) {
  const { t } = useTranslation();
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
      setError(t("auth.pwTooShort"));
      return;
    }
    if (newPassword !== confirm) {
      setError(t("auth.pwMismatch"));
      return;
    }
    if (newPassword === oldPassword) {
      setError(t("auth.pwSameAsOld"));
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMustChangePassword(false);
      // Il cambio VOLONTARIO non ha nessuna schermata dietro a cui tornare da
      // se: `mustChangePassword` era gia falso, quindi spegnerlo non cambia
      // niente e senza questo si resterebbe sul modulo appena inviato.
      onAnnulla?.();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (msg.includes("401")) {
        // Token rejected: drop the session and bounce back to login.
        clearAuth();
      } else if (msg.includes("400") || msg.includes("invalid_password")) {
        // Il server manda il motivo vero in `detail`: «la password attuale non
        // è corretta» e «è uguale a quella di prima» sono cose diverse, e chi
        // le legge sa cosa fare. Prima si mostrava sempre «la vecchia password
        // non è corretta», che su un rifiuto diverso era **falso**.
        setError(dettaglio(msg) ?? t("auth.pwOldWrong"));
      } else {
        setError(dettaglio(msg) ?? t("auth.pwChangeError"));
        console.warn("change-password failed:", e);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={paginaCentrata}>
      <form onSubmit={submit} style={schedaModulo(360)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <strong style={{ fontSize: 18, letterSpacing: 1 }}>{t("auth.changeTitle")}</strong>
        </div>
        <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, margin: 0 }}>
          {t("auth.welcomeUser")} <strong>{authUser}</strong>
          {onAnnulla ? "" : t("auth.mustSetNewPassword")}
        </p>

        <div>
          <label style={label}>{t("auth.currentPassword")}</label>
          <input type="password" value={oldPassword}
                 onChange={(e) => setOldPassword(e.target.value)}
                 autoComplete="current-password" autoFocus style={input} />
        </div>
        <div>
          <label style={label}>{t("auth.newPassword")}</label>
          <input type="password" value={newPassword}
                 onChange={(e) => setNewPassword(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>
        <div>
          <label style={label}>{t("auth.confirmNewPassword")}</label>
          <input type="password" value={confirm}
                 onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, background: "#7f1d1d33", padding: "6px 10px", borderRadius: 4 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || !oldPassword || !newPassword}
                  style={{
                    flex: 1,
                    background: busy ? "#1e3a8a" : "var(--brand-primary, #3b82f6)",
                    color: busy ? "#fff" : "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4,
                    padding: "8px 12px", cursor: busy ? "default" : "pointer",
                    fontSize: 14, fontWeight: 600,
                  }}>
            {busy ? t("auth.changing") : t("auth.changeBtn")}
          </button>
          {/* Uscire e l'unica via d'uscita quando il cambio e OBBLIGATO; se
              invece si e arrivati qui dal menu, la via d'uscita e tornare
              indietro, e buttare fuori chi ha cambiato idea sarebbe una
              punizione per aver aperto una voce di menu. */}
          <button type="button"
                  onClick={onAnnulla ?? (() => { void api.logout().catch(() => {}); clearAuth(); })}
                  style={{
                    background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
                    border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
                    padding: "8px 12px", cursor: "pointer", fontSize: 13,
                  }}>
            {onAnnulla ? t("auth.annulla") : t("auth.logout")}
          </button>
        </div>
      </form>
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4,
};

const input: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "7px 10px",
  color: "var(--brand-text, #e2e8f0)",
  fontSize: 14,
  boxSizing: "border-box",
};
