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
//   2. `remoteConnected` nasce `false` in questo store: lo si chiede al server
//      (`/api/remote/status`), che sa se c'è un pannello collegato, e da lì
//      `useRemoteLogStream` apre il suo canale come nell'editor. Fino al
//      07-11-2026 la finestra lo diceva soltanto, con un avviso in testa che nel
//      collaudo sul TC620 nessuno ha letto: le righe del pannello mancavano e
//      basta.

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { LogPanel } from "@/components/LogPanel";
import { useAccessoSenzaUtenti } from "@/auth/useAccessoSenzaUtenti";
import { SchermataSenzaAccesso, vuoto } from "@/components/finestraStaccata";
import { useLogStream } from "@/ws/logStream";
import { useRemoteLogStream } from "@/ws/remoteLogStream";

export function LogWindow() {
  const { t } = useTranslation();
  const { sondaggio, authRole } = useAccessoSenzaUtenti();

  // Gli stream, che nell'IDE sono registrati in `App`: quello locale, e quello
  // del pannello collegato se c'è.
  useLogStream();
  useRemoteLogStream();
  const setRemoteConnected = useAppStore((s) => s.setRemoteConnected);
  useEffect(() => {
    if (!authRole) return;
    api.remoteStatus()
      .then((st) => { if (st.connected) setRemoteConnected(true, st.url ?? null); })
      .catch(() => { /* nessun pannello: restano le righe locali */ });
  }, [authRole, setRemoteConnected]);

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
      {/* `onClose` chiude la finestra: qui non c'è un cassetto da richiudere. */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <LogPanel open variant="window" onClose={() => window.close()} />
      </div>
    </div>
  );
}



