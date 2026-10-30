import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, NoProjectError, RateLimitedError, RuntimeUnavailableError, type LoginOk } from "@/api/client";
import { AccessoPin } from "@/components/accesso/AccessoPin";
import { casellaAccesso, collegamentoAccesso } from "@/components/schermataAccesso";
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
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 10,
  padding: "28px 32px",
  width: 320,
  display: "flex",
  flexDirection: "column",
  gap: 14,
  boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
};

const LABEL: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 4 };

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-border, #475569)",
  borderRadius: 5,
  color: "var(--brand-text, #e2e8f0)",
  padding: "7px 10px",
  fontSize: 13,
  boxSizing: "border-box",
};

const BTN_PRIMARY: React.CSSProperties = {
  background: "var(--brand-primary, #3b82f6)",
  color: "var(--brand-on-primary, #fff)",
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
  color: "var(--brand-text-subtle, #64748b)",
  border: "none",
  fontSize: 12,
  cursor: "pointer",
  padding: "2px 0",
  textAlign: "center" as const,
};

export function ReAuthModal() {
  const { t } = useTranslation();
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
  // Password o PIN (30-10-2026): chi entra col PIN di solito la password non
  // la scrive, e un modale che chiede solo quella lo rimandava al login.
  // `gestita` = utenti dell'installazione (IDE): solo lì esistono PIN e
  // «ricordami».
  const [offre, setOffre]             = useState<{ gestita: boolean; pin: boolean }>({ gestita: false, pin: false });
  const [vista, setVista]             = useState<"password" | "pin">("password");
  const [ricordami, setRicordami]     = useState(false);
  useEffect(() => {
    let vivo = true;
    api.identitaStato()
      .then((st) => { if (vivo) setOffre({ gestita: !!st.gestita, pin: !!st.pin }); })
      .catch(() => { /* resta la sola password, com'era */ });
    return () => { vivo = false; };
  }, []);

  /** Rientrati. Chi ha aperto il progetto lo ritrova (`riautentica`); se il
   *  server l'ha chiuso — rientra un'altra persona — si va all'elenco, invece
   *  di lasciare un editor senza progetto sotto. */
  const entrato = (res: LoginOk) => {
    setAuth(res.token, res.username, res.role, res.must_change_password, res.expires_at_ms);
    setReAuthNeeded(false);
    if (res.progetto_aperto === false) setNoActiveProject(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUser) return;
    setError(null);
    setBusy(true);
    try {
      entrato(await api.login(authUser, password, offre.gestita && ricordami, true));
    } catch (e: any) {
      if (e instanceof NoProjectError) {
        // Runtime restarted without an active project (e.g. after reboot
        // before .last-opened was consumed). Go to WelcomeScreen.
        setNoProject(true);
      } else {
        setError(
          e instanceof RuntimeUnavailableError
            ? t("auth.runtimeUnreachable")
            : e instanceof RateLimitedError
            ? t("reauth.troppiTentativi", { s: e.retryAfterSecs })
            : t("auth.wrongPassword")
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
            <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 4 }}>
              {t("reauth.noActiveProject")}
            </div>
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
              {t("reauth.theRuntimeRestartedWithoutAn")}
            </div>
          </div>
          <button style={BTN_PRIMARY} onClick={handleGoToWelcome}>
            {t("reauth.vaiAlBenvenuto")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={OVERLAY}>
      <div style={CARD}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 4 }}>
            {t("reauth.sessioneScaduta")}
          </div>
          {vista === "password" && (
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
              {t("reauth.enterPasswordAs")} <strong style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{authUser}</strong>.
            </div>
          )}
        </div>

        {vista === "pin" ? (
          <AccessoPin emailIniziale={authUser ?? ""} riautentica onEntrato={entrato} onIndietro={() => setVista("password")} />
        ) : (
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <div style={LABEL}>{t("auth.password")}</div>
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

          {offre.gestita && (
            <label style={casellaAccesso}>
              <input type="checkbox" checked={ricordami} onChange={(e) => setRicordami(e.target.checked)} />
              {t("accesso.ricordami")}
            </label>
          )}

          {error && (
            <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)" }}>{error}</div>
          )}

          <button type="submit" style={BTN_PRIMARY} disabled={busy || !password}>
            {busy ? t("auth.reauthInProgress") : t("auth.reauth")}
          </button>
          {offre.pin && (
            <button type="button" style={collegamentoAccesso} onClick={() => setVista("pin")}>
              {t("accesso.conPin")}
            </button>
          )}
        </form>
        )}

        <button style={BTN_GHOST} onClick={handleDismiss}>
          {t("reauth.esciAlLogin")}
        </button>
      </div>
    </div>
  );
}
