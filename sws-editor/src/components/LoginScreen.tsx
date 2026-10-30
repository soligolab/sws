import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { BrandLogo } from "@/components/BrandLogo";
import { getBrand } from "@/branding";
import { api, DaConfermareError, RateLimitedError, RuntimeUnavailableError, type LoginOk } from "@/api/client";
import { useAppStore } from "@/store";
import {
  campoAccesso,
  casellaAccesso,
  collegamentoAccesso,
  erroreAccesso,
  etichettaAccesso,
  paginaCentrata,
  pulsanteAccesso,
  schedaModulo,
} from "@/components/schermataAccesso";
import { AccessoPin } from "@/components/accesso/AccessoPin";
import { Registrazione } from "@/components/accesso/Registrazione";

/**
 * Minimal login screen shown when the store has no auth token.
 * Calls POST /api/auth/login, stores the returned token, and the App
 * unmounts/remounts to render the authenticated UI.
 *
 * Dal 30-10-2026 (ramo C di `docs/plans/2026-10-26-aprire-sws-soligo-net.md`)
 * le strade per entrare, sugli utenti dell'installazione, sono tre: password
 * (con «ricordami» 30 giorni), PIN per posta, registrazione con il codice di
 * conferma. Le ultime due compaiono solo se `/api/identita/stato` le offre.
 * Su un pannello resta il login di sempre, con le sessioni in memoria.
 */
export function LoginScreen({
  onCancel,
  motivo,
}: {
  onCancel?: () => void;
  /** Chiave i18n del motivo per cui si è finiti qui, quando non è ovvio —
   *  per esempio perché l'autenticazione si è **accesa adesso**, definendo il
   *  primo utente del progetto. Un login comparso dal nulla senza una riga di
   *  spiegazione è già di per sé il difetto. */
  motivo?: string | null;
} = {}) {
  const { t } = useTranslation();
  const setAuth = useAppStore((s) => s.setAuth);
  // Su un'istanza IDE le credenziali sono quelle dell'INSTALLAZIONE e
  // l'identità è l'email; su un pannello sono quelle del progetto, dove
  // l'utente si chiama davvero `admin` (lo crea il seme di recupero) e
  // precompilarlo aiuta. Dal 06-10-2026 lo si chiede invece di indovinarlo:
  // proporre «admin» su un IDE che vuole un indirizzo è un suggerimento
  // sbagliato, ed è stato segnalato appena creato il primo amministratore.
  const [perInstallazione, setPerInstallazione] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [offre, setOffre] = useState<{ pin: boolean; registrazione: boolean }>({ pin: false, registrazione: false });
  const [vista, setVista] = useState<"password" | "pin" | "registrazione" | "conferma">("password");
  const [ricordami, setRicordami] = useState(false);
  useEffect(() => {
    let vivo = true;
    api.identitaStato()
      .then((st) => {
        if (!vivo) return;
        setPerInstallazione(!!st.gestita);
        setOffre({ pin: !!st.pin, registrazione: !!st.registrazione });
        if (!st.gestita) setUsername("admin");
      })
      .catch(() => { if (vivo) { setPerInstallazione(false); setUsername("admin"); } });
    return () => { vivo = false; };
  }, []);
  const [password, setPassword] = useState("");
  const [error, setError]       = useState<string | null>(null);
  const [busy, setBusy]         = useState(false);

  // Lockout countdown: millisecond epoch when the lockout expires.
  const [lockedUntilMs, setLockedUntilMs] = useState<number | null>(null);
  const [countdown, setCountdown]         = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (lockedUntilMs === null) {
      if (timerRef.current !== null) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    const tick = () => {
      const remaining = Math.ceil((lockedUntilMs - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntilMs(null);
        setCountdown(0);
        setError(null);
      } else {
        setCountdown(remaining);
      }
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => {
      if (timerRef.current !== null) clearInterval(timerRef.current);
    };
  }, [lockedUntilMs]);

  const isLocked = lockedUntilMs !== null && countdown > 0;

  const entrato = (res: LoginOk) =>
    setAuth(res.token, res.username, res.role, res.must_change_password, res.expires_at_ms);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    setError(null);
    setBusy(true);
    try {
      entrato(await api.login(username, password, perInstallazione === true && ricordami));
    } catch (e: unknown) {
      if (e instanceof DaConfermareError) {
        setVista("conferma");
      } else if (e instanceof RateLimitedError) {
        setLockedUntilMs(Date.now() + e.retryAfterSecs * 1000);
        setCountdown(e.retryAfterSecs);
        setError(t("login.troppiTentativi", { s: e.retryAfterSecs }));
      } else if (e instanceof RuntimeUnavailableError) {
        setError(t("auth.runtimeUnreachable"));
      } else {
        setError(t("auth.invalidCredentials"));
      }
      console.warn("login failed:", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={paginaCentrata}>
      <div style={schedaModulo(vista === "registrazione" ? 380 : 320)}>
        {/* Il marchio, non «SWS» cablato (28-10-2026): su un'istanza con un
            marchio proprio la schermata d'accesso era l'unico posto che
            diceva ancora «SWS». Il nome lungo viene dal brand, e non è più
            «Soligo Web SCADA» — quello è un nome che il prodotto non usa più.
            **La versione del runtime qui NON si mette**, ed è una scelta del
            maintainer: dirla prima del login la dice anche a chi non è
            entrato. Vedi `versioneRuntime.ts`. */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
          <BrandLogo />
          <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>{getBrand().name}</span>
        </div>
        {vista === "pin" && (
          <AccessoPin emailIniziale={username} onEntrato={entrato} onIndietro={() => setVista("password")} />
        )}
        {(vista === "registrazione" || vista === "conferma") && (
          <Registrazione emailIniziale={vista === "conferma" ? username : ""}
            passo={vista === "conferma" ? "codice" : "modulo"}
            onEntrato={entrato} onIndietro={() => setVista("password")} />
        )}
        {vista === "password" && (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {motivo && (
          <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #fbbf24)", background: "#78350f33", padding: "6px 10px", borderRadius: 4, lineHeight: 1.4 }}>
            {t(motivo)}
          </div>
        )}
        <div>
          <label style={etichettaAccesso}>
            {perInstallazione ? t("auth.email") : t("auth.user")}
          </label>
          <input
            type={perInstallazione ? "email" : "text"}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete={perInstallazione ? "email" : "username"}
            disabled={isLocked}
            style={campoAccesso}
          />
        </div>
        <div>
          <label style={etichettaAccesso}>{t("auth.password")}</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            autoFocus
            disabled={isLocked}
            style={campoAccesso}
          />
        </div>
        {/* Solo per gli utenti dell'installazione: le sessioni del progetto
            stanno in memoria, e 30 giorni non li reggerebbero comunque. */}
        {perInstallazione && (
          <label style={casellaAccesso}>
            <input type="checkbox" checked={ricordami} onChange={(e) => setRicordami(e.target.checked)} />
            {t("accesso.ricordami")}
          </label>
        )}
        {error && (
          <div style={erroreAccesso}>
            {isLocked ? t("login.accountBloccato", { s: countdown }) : error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !password || !username || isLocked}
          style={pulsanteAccesso(busy || isLocked || !password || !username)}
        >
          {isLocked ? `${t("auth.locked", { s: countdown })}` : busy ? t("auth.loggingIn") : t("auth.login")}
        </button>
        {(offre.pin || offre.registrazione) && (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            {offre.pin && (
              <button type="button" onClick={() => setVista("pin")} style={collegamentoAccesso}>{t("accesso.conPin")}</button>
            )}
            {offre.registrazione && (
              <button type="button" onClick={() => setVista("registrazione")} style={collegamentoAccesso}>{t("accesso.creaAccount")}</button>
            )}
          </div>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            style={{
              background: "transparent",
              color: "var(--brand-text-subtle, #64748b)",
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              padding: 0,
              textAlign: "left",
            }}
          >
            {t("login.backToTheProjectList")}
          </button>
        )}
        {perInstallazione === false && (
          <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>
            {t("login.inMemorySessionsARuntime")}
          </p>
        )}
        </form>
        )}
      </div>
    </div>
  );
}
