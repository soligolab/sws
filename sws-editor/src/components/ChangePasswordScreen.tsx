import { CampoPassword } from "@/components/CampoPassword";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, AuthError } from "@/api/client";
import { lasciaAvvisoAccesso } from "@/auth/avvisoAccesso";
import { useAppStore } from "@/store";
import { conferma } from "@/finestraAvviso/finestraAvviso";
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

export function ChangePasswordScreen({ onAnnulla, rimandabile }: {
  onAnnulla?: () => void;
  /** Il cambio obbligatorio si può rimandare (07-11-2026): «Più tardi» per
   *  tutti, «Non chiedere più» solo per un Admin. Sul pannello sì; nell'IDE
   *  dell'installazione la password va cambiata. */
  rimandabile?: boolean;
} = {}) {
  const { t } = useTranslation();
  const authUser              = useAppStore((s) => s.authUser);
  const authRole              = useAppStore((s) => s.authRole);
  const setMustChangePassword = useAppStore((s) => s.setMustChangePassword);
  const clearAuth             = useAppStore((s) => s.clearAuth);

  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm,     setConfirm]     = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);
  // Just in with a PIN from the mail: the mail box is the proof, and a new
  // user may never have known a current password (22-11-2026).
  const [pinRecente, setPinRecente] = useState(false);
  useEffect(() => {
    let alive = true;
    api.whoami().then((me) => { if (alive) setPinRecente(!!me.recent_pin_login); }).catch(() => { /* ask as before */ });
    return () => { alive = false; };
  }, []);

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
    if (!pinRecente && newPassword === oldPassword) {
      setError(t("auth.pwSameAsOld"));
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(pinRecente ? "" : oldPassword, newPassword);
      setMustChangePassword(false);
      // Il cambio VOLONTARIO non ha nessuna schermata dietro a cui tornare da
      // se: `mustChangePassword` era gia falso, quindi spegnerlo non cambia
      // niente e senza questo si resterebbe sul modulo appena inviato.
      onAnnulla?.();
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      if (e instanceof AuthError || msg.includes("401")) {
        // The session is gone — for instance an administrator reset the
        // password, which closes every session of the user (22-11-2026: the
        // page stayed on «Error changing password» whatever was typed). Back
        // to the sign-in, saying why.
        clearAuth();
        lasciaAvvisoAccesso(t("auth.sessionClosed"));
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

  const rimanda = async (perSempre: boolean) => {
    if (perSempre && !(await conferma({ testo: t("auth.nonChiederePiuConferma"), pericolo: true }))) return;
    setError(null);
    setBusy(true);
    try {
      await api.rimandaCambioPassword(perSempre);
      setMustChangePassword(false);
    } catch (e: any) {
      const msg = String(e?.message ?? "");
      // admin/admin is not postponed (CRA D18): it says so in the UI's language.
      setError(msg.includes("factory_password") ? t("auth.factoryPassword") : dettaglio(msg) ?? t("auth.pwChangeError"));
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

        {pinRecente ? (
          <p style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, margin: 0 }} data-testid="cambio-pin-recente">
            {t("auth.pinNoCurrent")}
          </p>
        ) : (
          <div>
            <label style={label}>{t("auth.currentPassword")}</label>
            <CampoPassword value={oldPassword}
                   onChange={(e) => setOldPassword(e.target.value)}
                   autoComplete="current-password" autoFocus style={input} />
          </div>
        )}
        <div>
          <label style={label}>{t("auth.newPassword")}</label>
          <CampoPassword value={newPassword}
                 onChange={(e) => setNewPassword(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>
        <div>
          <label style={label}>{t("auth.confirmNewPassword")}</label>
          <CampoPassword value={confirm}
                 onChange={(e) => setConfirm(e.target.value)}
                 autoComplete="new-password" style={input} />
        </div>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, background: "var(--sws-danger-bg, #7f1d1d33)", padding: "6px 10px", borderRadius: 4 }}>
            {error}
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" disabled={busy || (!pinRecente && !oldPassword) || !newPassword}
                  style={{
                    flex: 1,
                    background: busy ? "var(--sws-select-bg, #1e3a8a)" : "var(--brand-primary, #3b82f6)",
                    // Busy, the background is the selection tint, close to the
                    // page: the ink, not the text made for the full accent.
                    color: busy ? "var(--sws-text, #fff)" : "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4,
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
        {rimandabile && !onAnnulla && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" data-testid="cambio-piu-tardi" disabled={busy}
                    onClick={() => void rimanda(false)} style={secondario}>
              {t("auth.piuTardi")}
            </button>
            {authRole === "Admin" && (
              <button type="button" data-testid="cambio-non-chiedere-piu" disabled={busy}
                      onClick={() => void rimanda(true)} style={secondario}>
                {t("auth.nonChiederePiu")}
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

const secondario: React.CSSProperties = {
  background: "transparent", color: "var(--brand-text-muted, #94a3b8)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4,
  padding: "6px 10px", cursor: "pointer", fontSize: 12,
};

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
