import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { HDR_BTN } from "@/components/headerStyles";

/** La spia degli errori nel log, accanto al fulmine (28-10-2026).
 *
 *  Fino a oggi `App.tsx` diceva del cassetto dei log: «the toggle moved into
 *  the ☰ menu — it is a diagnostic, not a per-minute control». **Questa spia
 *  rovescia quella frase per una parte sola**: un errore non è una diagnostica
 *  che si va a cercare, è una cosa che deve venirti incontro. Il cassetto
 *  resta nel menu; quello che esce è il *numero*.
 *
 *  Non si fonde con la pastiglia `⚡` di `RuntimeCtrl`, che è un'altra
 *  famiglia: lì ci sono gli **avvisi di stato** del runtime (uno script che non
 *  partirà, l'acquisizione ferma), con un rimedio scritto accanto; qui ci sono
 *  **righe di log**, che non hanno rimedio e si contano. Fonderle darebbe un
 *  numero che non vuol dire niente.
 *
 *  Si conta da quando si è guardato il log l'ultima volta, e il clic porta
 *  **sulla riga**, non in cima. */
export function SpiaLog({ onApri }: { onApri: (ts: number | null) => void }) {
  const { t } = useTranslation();
  const { errori, avvisi, primoErroreTs, primoAvvisoTs } = useAppStore((s) => s.logNonVisti);
  const totale = errori + avvisi;
  if (totale === 0) return null;
  const grave = errori > 0;
  return (
    <button
      data-testid="spia-log"
      onClick={() => onApri(grave ? primoErroreTs : primoAvvisoTs)}
      title={grave ? t("header.spiaLogErroriTitle", { errori, avvisi }) : t("header.spiaLogAvvisiTitle", { avvisi })}
      style={{
        ...HDR_BTN,
        background: grave ? "var(--brand-danger, #dc2626)" : "var(--brand-warning-bg, #78350f)",
        border: `1px solid ${grave ? "var(--brand-danger, #ef4444)" : "var(--brand-warning, #f59e0b)"}`,
        color: grave ? "var(--brand-on-danger, #fff)" : "var(--brand-warning-soft, #facc15)",
        fontWeight: 600,
      }}
    >
      {"≡"} {totale}
    </button>
  );
}
