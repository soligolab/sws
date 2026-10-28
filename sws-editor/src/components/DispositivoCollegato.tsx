import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { HDR_BTN } from "@/components/headerStyles";
import { usaPannelloCollegato } from "@/pannelloCollegato";

/** Il nome del pannello collegato, in barra accanto a «Deploy» (28-10-2026).
 *
 *  Fino a oggi lo stato del collegamento si leggeva in due posti dove si va
 *  *apposta*: `RuntimeCtrl` e Configurazione → Istanza → Device → Connessione.
 *  In barra c'era il pallino verde, che dice «collegato» e non dice **a chi**.
 *  Il 28-10-2026 è costato un'ora: l'IDE era collegato al pannello di casa e il
 *  maintainer cercava il broker dell'ufficio.
 *
 *  Due scelte, prese qui:
 *  - **Si vede solo il pannello collegato**, non quelli abbinati. Quelli sono
 *    un elenco e vivono nella scheda Connessione; qui serve l'unico nome che
 *    cambia il risultato di quello che si sta per fare.
 *  - **È cliccabile** e porta a quella scheda. Non sta *dentro* il pulsante
 *    Deploy perché quel clic scollega, e un bottone dentro un bottone non è
 *    HTML valido: è una pastiglia sua, prima.
 *
 *  **Diventa rossa quando la sessione col pannello non vale più** (stesso
 *  giorno, seconda parte). Il collegamento c'è, il nome è giusto, e niente
 *  funziona: fino a oggi quel caso si leggeva solo nella scheda Connessione,
 *  mentre in barra il pallino restava verde. Il lato server prova a rientrare
 *  da solo (`remote_relay.rs`); questa pastiglia è ciò che resta da dire
 *  quando non ci riesce. */
export function DispositivoCollegato() {
  const { t } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const autenticato = useAppStore((s) => s.remoteAutenticato);
  const nome = usaPannelloCollegato();
  if (!nome) return null;
  const colori = autenticato
    ? {
        background: "var(--brand-success-bg, #14532d)",
        color: "var(--brand-success-soft, #4ade80)",
        border: "1px solid #16a34a",
      }
    : {
        background: "var(--brand-danger-bg, #450a0a)",
        color: "var(--brand-danger-soft, #fca5a5)",
        border: "1px solid var(--brand-danger, #ef4444)",
      };
  return (
    <button
      data-testid="dispositivo-collegato"
      data-autenticato={autenticato ? "1" : "0"}
      onClick={() => navigateToConfig("runtime")}
      title={autenticato
        ? t("header.dispositivoCollegatoTitle", { dispositivo: nome })
        : t("header.dispositivoScadutoTitle", { dispositivo: nome })}
      style={{
        ...HDR_BTN,
        ...colori,
        maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >{autenticato ? "🖳" : "\u26a0"} {nome}</button>
  );
}
