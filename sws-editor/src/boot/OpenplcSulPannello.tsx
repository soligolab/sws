import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoOpenplc } from "@/api/client";

/** La casella «Installa anche OpenPLC» (30-10-2026), uguale nei due posti in cui
 *  si installa SWS via SSH: la scheda Installazione e la schermata di benvenuto.
 *  È un'opzione: «non è detto che a tutti i clienti serva». */
export function SceltaOpenplc({ valore, onChange }: { valore: boolean; onChange: (v: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" data-testid="scelta-openplc" checked={valore}
        onChange={(e) => onChange(e.target.checked)} />
      <span style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
        {t("openplc.scelta")}
        <span style={{ display: "block", fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>
          {t("openplc.sceltaAiuto")}
        </span>
      </span>
    </label>
  );
}

/** OpenPLC sul pannello collegato (30-10-2026): se c'è, e il bottone per
 *  installarlo su un pannello che ha già SWS. Lo installa il pannello da sé,
 *  con un servizio transitorio come «Configurazione del servizio»: niente SSH,
 *  e SWS non si riavvia. Il download è di circa 1 GB, quindi l'esito arriva
 *  dopo minuti: si rilegge più spesso finché è in corso. */
export function OpenplcSulPannello() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<StatoOpenplc | null | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);
  const [inviato, setInviato] = useState(false);

  const leggi = useCallback(() => api.remoteGetSystemStatus()
    .then((s) => setStato(s.openplc ?? null))
    .catch(() => setStato(null)), []);

  const inCorso = inviato || stato?.ultimo_esito?.esito === "in_corso";
  useEffect(() => {
    void leggi();
    const id = window.setInterval(() => void leggi(), inCorso ? 4000 : 15000);
    return () => window.clearInterval(id);
  }, [leggi, inCorso]);
  // Arrivato un esito definitivo, la richiesta inviata è finita.
  useEffect(() => {
    if (stato?.ultimo_esito && stato.ultimo_esito.esito !== "in_corso") setInviato(false);
  }, [stato?.ultimo_esito]);

  const installa = async () => {
    if (!window.confirm(t("openplc.conferma"))) return;
    setErrore(null);
    try {
      await api.remoteInstallaOpenplc();
      setInviato(true);
      void leggi();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    }
  };

  if (stato === null) return null;
  const esito = stato?.ultimo_esito;
  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  if (stato === undefined) riga = t("configurazioneServizio.carico");
  else if (inCorso) { riga = esito?.messaggio || t("openplc.inCorso"); tono = "var(--brand-warning, #f59e0b)"; }
  else if (stato.risponde) { riga = t("openplc.acceso"); tono = "var(--brand-success-soft, #4ade80)"; }
  else if (esito?.esito === "non_riuscito") {
    riga = t("openplc.nonRiuscito", { motivo: esito.messaggio });
    tono = "var(--brand-danger, #ef4444)";
  } else riga = t("openplc.assente");

  return (
    <section data-testid="openplc-sul-pannello">
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("openplc.titolo")}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: tono }}>{riga}</span>
        {stato && !stato.risponde && !inCorso && stato.si_puo_installare && (
          <button type="button" onClick={() => void installa()}>
            {esito?.esito === "non_riuscito" ? t("openplc.riprova") : t("openplc.installa")}
          </button>
        )}
      </div>
      {stato?.risponde && (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>{t("openplc.porte")}</div>
      )}
      {stato && !stato.risponde && !inCorso && !stato.si_puo_installare && (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>{t("openplc.nonDaQui")}</div>
      )}
      {errore && <div style={{ fontSize: 12, color: "var(--brand-danger, #ef4444)", marginTop: 4 }}>{errore}</div>}
    </section>
  );
}
