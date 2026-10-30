/** Entrare con un PIN per posta, in aggiunta alla password (30-10-2026, ramo C
 *  di `docs/plans/2026-10-26-aprire-sws-soligo-net.md`).
 *
 *  Due passi: l'indirizzo, poi il PIN. Il server risponde allo stesso modo per
 *  qualunque indirizzo, e questa schermata fa lo stesso: «se l'indirizzo è
 *  iscritto, ti è arrivato un PIN» — mai «ti abbiamo mandato un PIN». */
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

export function AccessoPin({
  emailIniziale,
  onEntrato,
  onIndietro,
  riautentica = false,
}: {
  emailIniziale: string;
  onEntrato: (r: LoginOk) => void;
  onIndietro: () => void;
  /** Dal modale «Sessione scaduta»: vedi `api.login`. */
  riautentica?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState(emailIniziale);
  const [inviato, setInviato] = useState(false);
  const [pin, setPin] = useState("");
  const [ricordami, setRicordami] = useState(false);
  const [occupato, setOccupato] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  const manda = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrore(null);
    setOccupato(true);
    try {
      await api.chiediPin(email.trim(), i18n.language);
      setInviato(true);
    } catch (err) {
      setErrore(err instanceof RuntimeUnavailableError ? t("auth.runtimeUnreachable") : String(err));
    } finally {
      setOccupato(false);
    }
  };

  const entra = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrore(null);
    setOccupato(true);
    try {
      onEntrato(await api.accediConPin(email.trim(), pin, ricordami, riautentica));
    } catch (err) {
      if (err instanceof RateLimitedError) setErrore(t("login.troppiTentativi", { s: err.retryAfterSecs }));
      else if (err instanceof RuntimeUnavailableError) setErrore(t("auth.runtimeUnreachable"));
      else setErrore(t("accesso.pinSbagliato"));
    } finally {
      setOccupato(false);
    }
  };

  if (!inviato) {
    return (
      <form onSubmit={manda} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{t("accesso.conPin")}</div>
        <div style={avvisoAccesso}>{t("accesso.pinSpiegazione")}</div>
        <div>
          <label style={etichettaAccesso}>{t("auth.email")}</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" autoFocus style={campoAccesso} />
        </div>
        {errore && <div style={erroreAccesso}>{errore}</div>}
        <button type="submit" disabled={occupato || !email.includes("@")}
          style={pulsanteAccesso(occupato || !email.includes("@"))}>
          {t("accesso.mandaPin")}
        </button>
        <button type="button" onClick={onIndietro} style={collegamentoAccesso}>{t("accesso.conPassword")}</button>
      </form>
    );
  }

  return (
    <form onSubmit={entra} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{t("accesso.conPin")}</div>
      <div style={avvisoAccesso}>{t("accesso.pinInviato", { email: email.trim() })}</div>
      <div>
        <label style={etichettaAccesso}>{t("accesso.pin")}</label>
        <input value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="one-time-code"
          placeholder="XXXX-XXXX" autoFocus spellCheck={false}
          style={{ ...campoAccesso, fontFamily: "ui-monospace, monospace", letterSpacing: 2, textTransform: "uppercase" }} />
      </div>
      <label style={casellaAccesso}>
        <input type="checkbox" checked={ricordami} onChange={(e) => setRicordami(e.target.checked)} />
        {t("accesso.ricordami")}
      </label>
      {errore && <div style={erroreAccesso}>{errore}</div>}
      <button type="submit" disabled={occupato || pin.replace(/[\s-]/g, "").length !== 8}
        style={pulsanteAccesso(occupato || pin.replace(/[\s-]/g, "").length !== 8)}>
        {t("auth.login")}
      </button>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <button type="button" onClick={() => void manda()} disabled={occupato} style={collegamentoAccesso}>
          {t("accesso.mandaneUnAltro")}
        </button>
        <button type="button" onClick={onIndietro} style={collegamentoAccesso}>{t("accesso.conPassword")}</button>
      </div>
    </form>
  );
}
