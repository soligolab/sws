import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type BootImageStato } from "@/api/client";

/** Cosa dice il dispositivo dell'immagine di boot (T-72 F5): l'esito della
 *  chiamata D-Bus al launcher, fatta dal runtime nel container. Sta nella scheda
 *  Runtime, dopo la connessione, perché è lì che si guarda cosa è successo dopo
 *  un deploy. Qui anche il ripristino dell'immagine di fabbrica (27-09-2026): è
 *  un comando sul dispositivo, non un'impostazione del progetto. */
export function StatoBootImage() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<BootImageStato | null | undefined>(undefined);
  const [errore, setErrore] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [erroreReset, setErroreReset] = useState<string | null>(null);

  const ripristina = async () => {
    if (!window.confirm(t("bootStatus.resetConfirm"))) return;
    setInCorso(true);
    setErroreReset(null);
    try {
      setStato(await api.ripristinaImmagineFabbrica());
    } catch (e) {
      setErroreReset(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

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
  let nota: string | null = null;
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
          // Il percorso assoluto si appoggia a un comportamento non
          // documentato del launcher. È una cosa che chi sviluppa deve sapere,
          // ma appesa alla riga diceva a un utente finale solo che qualcosa
          // può rompersi, senza dirgli cosa farci: dal 28-09-2026 è un ⓘ da
          // sfiorare (scelta del maintainer).
          nota = stato.percorso === "assoluto" ? t("bootStatus.absolutePath") : null;
          tono = "var(--brand-success-soft, #4ade80)";
        }
        break;
      case "non_supportato": riga = t("bootStatus.unsupported"); break;
      case "nessuna_immagine": riga = t("bootStatus.none"); break;
      case "fabbrica": riga = t("bootStatus.factory", { quando: stato.quando ?? "?" }); break;
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
      <span style={{ fontSize: 12, color: tono }}>
        {riga}
        {nota && (
          <span
            title={nota}
            aria-label={nota}
            style={{ marginLeft: 4, color: "var(--brand-text-subtle, #64748b)", cursor: "help" }}
          >
            ⓘ
          </span>
        )}
      </span>
      {stato && stato.esito !== "non_supportato" && stato.esito !== "fabbrica" && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={ripristina} disabled={inCorso}>
            {inCorso ? t("bootStatus.resetBusy") : t("bootStatus.resetBtn")}
          </button>
        </div>
      )}
      {erroreReset && (
        <div style={{ fontSize: 12, marginTop: 6, color: "var(--brand-danger, #ef4444)" }}>
          {t("bootStatus.resetError", { msg: erroreReset })}
        </div>
      )}
    </section>
  );
}
