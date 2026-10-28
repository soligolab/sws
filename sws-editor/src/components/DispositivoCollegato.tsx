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
 *    HTML valido: è una pastiglia sua, prima. */
export function DispositivoCollegato() {
  const { t } = useTranslation();
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const nome = usaPannelloCollegato();
  if (!nome) return null;
  return (
    <button
      data-testid="dispositivo-collegato"
      onClick={() => navigateToConfig("runtime")}
      title={t("header.dispositivoCollegatoTitle", { dispositivo: nome })}
      style={{
        ...HDR_BTN,
        background: "var(--brand-success-bg, #14532d)",
        color: "var(--brand-success-soft, #4ade80)",
        border: "1px solid #16a34a",
        maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}
    >🖳 {nome}</button>
  );
}
