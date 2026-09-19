import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BootImageStato } from "@/api/client";

/** Cosa dice il dispositivo dell'immagine di boot (T-72 F5): il primo file che
 *  l'**host** scrive e il runtime legge. Sta nella scheda Runtime, dopo la
 *  connessione, perché è lì che si guarda cosa è successo dopo un deploy.
 *
 *  Il deploy risponde prima che l'host abbia agito: lo stato arriva dal file, non
 *  dalla risposta HTTP, quindi si rilegge ogni pochi secondi. */
export function StatoBootImage() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<BootImageStato | null | undefined>(undefined);
  const [errore, setErrore] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leggi = () => api.remoteGetSystemStatus()
      .then((s) => { if (vivo) { setStato(s.boot_image ?? null); setErrore(false); } })
      .catch(() => { if (vivo) setErrore(true); });
    leggi();
    const id = window.setInterval(leggi, 8000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);

  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  if (errore) riga = t("bootStatus.unreadable");
  else if (stato === undefined) riga = t("bootStatus.loading");
  else if (stato === null) riga = t("bootStatus.noData");
  else {
    const attesa = stato.richiesta && stato.richiesta !== "none" && stato.richiesta !== stato.sha256;
    switch (stato.esito) {
      case "installato":
        if (attesa) { riga = t("bootStatus.pending"); tono = "var(--brand-warning, #f59e0b)"; }
        else {
          riga = t("bootStatus.installed", { quando: stato.quando ?? "?" });
          if (stato.percorso === "assoluto") riga += " " + t("bootStatus.absolutePath");
          tono = "var(--brand-success-soft, #4ade80)";
        }
        break;
      case "non_supportato": riga = t("bootStatus.unsupported"); break;
      case "nessuna_immagine": riga = t("bootStatus.none"); break;
      case "errore":
        riga = t("bootStatus.error", { msg: stato.messaggio ?? "" });
        tono = "var(--brand-danger, #ef4444)";
        break;
      default: riga = stato.esito;
    }
  }

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("bootStatus.title")}
      </div>
      <span style={{ fontSize: 12, color: tono }}>{riga}</span>
    </section>
  );
}
