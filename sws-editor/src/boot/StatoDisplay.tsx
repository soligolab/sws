import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoDisplay as Stato } from "@/api/client";

/** Cosa c'è sullo schermo del pannello collegato, e perché (Fase 4 del piano
 *  dell'aggiornamento, decisione 61): la commutazione web/LVGL la fa il runtime
 *  via D-Bus, e lo stato si legge qui invece che nel file `display-target`. */
export function StatoDisplay() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<Stato | null | undefined>(undefined);

  useEffect(() => {
    let vivo = true;
    const leggi = () => api.remoteGetSystemStatus()
      .then((s) => { if (vivo) setStato(s.display ?? null); })
      .catch(() => { if (vivo) setStato(null); });
    leggi();
    const id = window.setInterval(leggi, 8000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);

  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  if (stato === undefined) riga = t("statoDisplay.carico");
  else if (stato === null) riga = t("statoDisplay.nessuno");
  else {
    const chiave = ["web", "lvgl", "ripiego_lvgl", "configurazione", "indeciso", "non_supportato", "errore"].includes(stato.esito)
      ? stato.esito : "altro";
    riga = t(`statoDisplay.esito.${chiave}`, { voluto: stato.voluto, esito: stato.esito });
    if (stato.esito === "web" || stato.esito === "lvgl") tono = "var(--brand-success-soft, #4ade80)";
    else if (stato.esito === "ripiego_lvgl" || stato.esito === "errore") tono = "var(--brand-danger, #ef4444)";
    else if (stato.esito === "configurazione" || stato.esito === "indeciso") tono = "var(--brand-warning, #f59e0b)";
  }

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("statoDisplay.titolo")}
      </div>
      <span style={{ fontSize: 12, color: tono }}>{riga}</span>
      {stato?.messaggio && (
        <div style={{ fontSize: 11, marginTop: 4, color: "var(--brand-text-muted, #94a3b8)" }}>{stato.messaggio}</div>
      )}
      {stato?.codesys_url_override && (
        <div style={{ fontSize: 11, marginTop: 4, color: "var(--brand-warning, #f59e0b)" }}>{t("statoDisplay.codesys")}</div>
      )}
    </section>
  );
}
