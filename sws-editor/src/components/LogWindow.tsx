// I log dell'IDE in una finestra propria.
//
// # Perché non serve nessun ponte fra le finestre
//
// `LogPanel` dipende da tre cose sole (`authRole`, `logs`, `clearLogs`) ed è
// **sola lettura verso il progetto**: non tocca `project`, `pages`,
// `pendingSections` né la history. Quindi una finestra separata non ha niente
// da chiedere alla finestra dell'editor: apre i propri stream, riempie il
// proprio buffer, e vive per conto suo.
//
// È l'opposto della chat, che deve applicare le proposte allo store
// dell'editor e per quello ha bisogno di un canale.
//
// # Cosa cambia rispetto al cassetto
//
// Due cose, entrambe conseguenze del fatto che una finestra nuova è un realm
// JavaScript nuovo, con il suo store e i suoi singleton dei socket:
//
//   1. gli stream vanno registrati qui — nell'IDE lo fa `App` una volta sola;
//   2. `remoteConnected` è `false` in questo store, quindi
//      `useRemoteLogStream` non aggancia niente e le righe del runtime remoto
//      **non compaiono**. Non lo si aggiusta con un canale: lo si **dice**, che
//      per un PoC è la scelta giusta — un avviso che si legge batte una
//      sincronizzazione che si dimentica.

import { useTranslation } from "react-i18next";
import { LogPanel } from "@/components/LogPanel";
import { useAccessoSenzaUtenti } from "@/auth/useAccessoSenzaUtenti";
import { SchermataSenzaAccesso, avviso, vuoto } from "@/components/finestraStaccata";
import { useLogStream } from "@/ws/logStream";

export function LogWindow() {
  const { t } = useTranslation();
  const { sondaggio, authRole } = useAccessoSenzaUtenti();

  // Lo stream locale, che nell'IDE è registrato in `App`.
  useLogStream();

  if (sondaggio) {
    return <div style={vuoto}>{t("logWindow.checking")}</div>;
  }

  // Qui il ruolo manca per davvero: gli utenti esistono e nessuno ha fatto
  // login in questo browser. Un secondo login aprirebbe una seconda sessione,
  // che è peggio del problema.
  if (!authRole) {
    return <SchermataSenzaAccesso titolo={t("logWindow.noAuth")} suggerimento={t("logWindow.noAuthHint")} ricarica={t("logWindow.reload")} />;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={avviso}>{t("logWindow.localOnly")}</div>
      {/* `onClose` chiude la finestra: qui non c'è un cassetto da richiudere. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogPanel open variant="window" onClose={() => window.close()} />
      </div>
    </div>
  );
}



