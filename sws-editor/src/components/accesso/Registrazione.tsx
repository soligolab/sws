/** Registrarsi da soli, con la conferma dell'indirizzo per posta (30-10-2026,
 *  ramo C di `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
 *
 *  Due passi: il modulo, poi il codice. Il secondo passo si raggiunge anche dal
 *  login, quando la password è giusta ma l'indirizzo non è ancora confermato
 *  (`passo="codice"`).
 *
 *  **Le due caselle sono due di proposito**: accettare le condizioni e approvare
 *  in modo specifico le clausole che la legge vuole approvate a parte (artt.
 *  1341-1342 c.c.) — `docs/legale/LEGGIMI.md`, punto 2 da verificare. */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api, RateLimitedError, RuntimeUnavailableError, type LoginOk } from "@/api/client";
import {
  avvisoAccesso,
  campoAccesso,
  casellaAccesso,
  collegamentoAccesso,
  erroreAccesso,
  etichettaAccesso,
  pulsanteAccesso,
} from "@/components/schermataAccesso";

/** Come in `crea_utente` e nel server: almeno 8 caratteri. */
export const PASSWORD_MINIMA = 8;

export function Registrazione({
  emailIniziale,
  passo: passoIniziale = "modulo",
  onEntrato,
  onIndietro,
}: {
  emailIniziale: string;
  passo?: "modulo" | "codice";
  onEntrato: (r: LoginOk) => void;
  onIndietro: () => void;
}) {
  const { t, i18n } = useTranslation();
  const [passo, setPasso] = useState(passoIniziale);
  const [email, setEmail] = useState(emailIniziale);
  const [password, setPassword] = useState("");
  const [ripetuta, setRipetuta] = useState("");
  const [condizioni, setCondizioni] = useState(false);
  const [clausole, setClausole] = useState(false);
  const [codice, setCodice] = useState("");
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const problema =
    !email.includes("@") ? "" :
    password.length < PASSWORD_MINIMA ? t("accesso.passwordCorta", { n: PASSWORD_MINIMA }) :
    ripetuta !== password ? t("accesso.passwordDiverse") :
    null;
  const pronto = problema === null && condizioni && clausole;

  const registrati = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pronto) return;
    setErrore(null);
    setOccupato(true);
    try {
      await api.registrati(email.trim(), password, condizioni, clausole, i18n.language);
      setPasso("codice");
    } catch (err) {
      setErrore(err instanceof RuntimeUnavailableError ? t("auth.runtimeUnreachable") : t("accesso.registrazioneRifiutata"));
    } finally {
      setOccupato(false);
    }
  };

  const conferma = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setOccupato(true);
    try {
      onEntrato(await api.confermaRegistrazione(email.trim(), codice));
    } catch (err) {
      if (err instanceof RateLimitedError) setErrore(t("login.troppiTentativi", { s: err.retryAfterSecs }));
      else if (err instanceof RuntimeUnavailableError) setErrore(t("auth.runtimeUnreachable"));
      else setErrore(t("accesso.codiceSbagliato"));
    } finally {
      setOccupato(false);
    }
  };

  if (passo === "codice") {
    const completo = codice.replace(/[\s-]/g, "").length === 8;
    return (
      <form onSubmit={conferma} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t("accesso.confermaIndirizzo")}</div>
        <div style={avvisoAccesso}>{t("accesso.codiceInviato", { email: email.trim() })}</div>
        {!emailIniziale && passoIniziale === "codice" && (
          <div>
            <label style={etichettaAccesso}>{t("auth.email")}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={campoAccesso} />
          </div>
        )}
        <div>
          <label style={etichettaAccesso}>{t("accesso.codice")}</label>
          <input value={codice} onChange={(e) => setCodice(e.target.value)} autoComplete="one-time-code"
            placeholder="XXXX-XXXX" autoFocus spellCheck={false}
            style={{ ...campoAccesso, fontFamily: "ui-monospace, monospace", letterSpacing: 2, textTransform: "uppercase" }} />
        </div>
        {errore && <div style={erroreAccesso}>{errore}</div>}
        <button type="submit" disabled={occupato || !completo} style={pulsanteAccesso(occupato || !completo)}>
          {t("accesso.conferma")}
        </button>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <button type="button" onClick={() => { setErrore(null); setPasso("modulo"); }} style={collegamentoAccesso}>
            {t("accesso.nonArrivato")}
          </button>
          <button type="button" onClick={onIndietro} style={collegamentoAccesso}>{t("accesso.conPassword")}</button>
        </div>
      </form>
    );
  }

  return (
    <form onSubmit={registrati} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t("accesso.creaAccount")}</div>
      <div style={avvisoAccesso}>{t("accesso.registrazioneSpiegazione")}</div>
      <div>
        <label style={etichettaAccesso}>{t("auth.email")}</label>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
          autoComplete="email" autoFocus style={campoAccesso} />
      </div>
      <div>
        <label style={etichettaAccesso}>{t("auth.password")}</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password" style={campoAccesso} />
      </div>
      <div>
        <label style={etichettaAccesso}>{t("accesso.ripetiPassword")}</label>
        <input type="password" value={ripetuta} onChange={(e) => setRipetuta(e.target.value)}
          autoComplete="new-password" style={campoAccesso} />
      </div>
      {problema && (password || ripetuta) && <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{problema}</div>}
      <label style={casellaAccesso}>
        <input type="checkbox" checked={condizioni} onChange={(e) => setCondizioni(e.target.checked)} />
        <span>
          {t("accesso.accettoPrima")}{" "}
          <a href="/condizioni" target="_blank" rel="noreferrer" style={{ color: "var(--brand-primary-testo, #60a5fa)" }}>{t("accesso.condizioni")}</a>{" "}
          {t("accesso.accettoE")}{" "}
          <a href="/privacy" target="_blank" rel="noreferrer" style={{ color: "var(--brand-primary-testo, #60a5fa)" }}>{t("accesso.informativa")}</a>
        </span>
      </label>
      <label style={casellaAccesso}>
        <input type="checkbox" checked={clausole} onChange={(e) => setClausole(e.target.checked)} />
        <span>{t("accesso.approvoClausole")}</span>
      </label>
      {errore && <div style={erroreAccesso}>{errore}</div>}
      <button type="submit" disabled={occupato || !pronto} style={pulsanteAccesso(occupato || !pronto)}>
        {t("accesso.registrati")}
      </button>
      <button type="button" onClick={onIndietro} style={collegamentoAccesso}>{t("accesso.hoGiaUnAccount")}</button>
    </form>
  );
}
