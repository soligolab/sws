import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoQuadlet } from "@/api/client";

/** La configurazione del servizio del pannello collegato (02-10-2026, il quadlet
 *  che viaggia): `podman auto-update` cambia l'immagine ma non i quadlet, e da
 *  oggi il pannello sa dire se i suoi sono più vecchi di quelli della versione
 *  che gira — e li sa riscrivere, con un servizio transitorio sul bus utente.
 *  Il pannello si riavvia: per questo si chiede conferma. */
export function ConfigurazioneServizio() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<StatoQuadlet | null | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);
  const [avviato, setAvviato] = useState(false);
  const [inCorso, setInCorso] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leggi = () => api.remoteGetSystemStatus()
      .then((s) => { if (vivo) setStato(s.quadlet ?? null); })
      .catch(() => { if (vivo) setStato(null); });
    leggi();
    const id = window.setInterval(leggi, 15000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);

  const aggiorna = async () => {
    if (!stato) return;
    if (!window.confirm(t("configurazioneServizio.conferma", { da: stato.installata ?? "?", a: stato.attesa ?? "?" }))) return;
    setInCorso(true);
    setErrore(null);
    try {
      await api.remoteAggiornaQuadlet();
      setAvviato(true);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  if (errore) { riga = errore; tono = "var(--brand-danger, #ef4444)"; }
  else if (stato === undefined) riga = t("configurazioneServizio.carico");
  else if (stato === null || stato.attesa === null) riga = t("configurazioneServizio.nonApplicabile");
  else if (avviato) { riga = t("configurazioneServizio.avviato"); tono = "var(--brand-warning, #f59e0b)"; }
  else if (stato.da_aggiornare) {
    riga = t("configurazioneServizio.daAggiornare", { da: stato.installata ?? "?", a: stato.attesa });
    tono = "var(--brand-warning, #f59e0b)";
  } else {
    riga = t("configurazioneServizio.aggiornata", { v: stato.installata ?? stato.attesa });
    tono = "var(--brand-success-soft, #4ade80)";
  }
  const esito = stato?.ultimo_esito;

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("configurazioneServizio.titolo")}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: tono }}>{riga}</span>
        {stato?.da_aggiornare && stato.si_puo_aggiornare && !avviato && (
          <button type="button" onClick={() => void aggiorna()} disabled={inCorso}>
            {t("configurazioneServizio.aggiorna")}
          </button>
        )}
      </div>
      {stato?.da_aggiornare && !stato.si_puo_aggiornare && stato.motivo && (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>{stato.motivo}</div>
      )}
      {esito && (
        <div style={{
          fontSize: 12, marginTop: 4,
          color: esito.esito === "non_riuscito" ? "var(--brand-danger, #ef4444)" : "var(--brand-text-subtle, #64748b)",
        }}>
          {t(`configurazioneServizio.esito.${esito.esito}`, { da: esito.da, a: esito.a })}
        </div>
      )}
    </section>
  );
}
