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

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { LogPanel } from "@/components/LogPanel";
import { useAppStore } from "@/store";
import { useLogStream } from "@/ws/logStream";

export function LogWindow() {
  const { t } = useTranslation();
  const authRole = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const setAuth = useAppStore((s) => s.setAuth);
  const [sondaggio, setSondaggio] = useState(true);

  // La modalità **senza utenti** è la normalità sul PC di sviluppo: nessun
  // `users.yaml`, il runtime inietta un Admin sintetico, e l'IDE non mostra
  // nessun login. Lo store di questa finestra si idrata da `localStorage
  // sws.auth`, che in quel caso è vuoto — quindi senza questa sonda la finestra
  // direbbe «accedi» su ogni istanza di sviluppo, cioè quasi sempre.
  //
  // Stesso giro di `App.tsx:283-290`: se `whoami()` risponde, si è senza
  // utenti e si mette il token sentinella; se rifiuta, gli utenti esistono e
  // serve un login vero — che va fatto nella finestra dell'editor.
  useEffect(() => {
    if (authToken) { setSondaggio(false); return; }
    let vivo = true;
    api.whoami()
      .then((me) => { if (vivo) setAuth("no-auth", me.username, me.role, me.must_change_password); })
      .catch(() => { /* ci sono utenti: si mostra la schermata sotto */ })
      .finally(() => { if (vivo) setSondaggio(false); });
    return () => { vivo = false; };
  }, [authToken, setAuth]);

  // Lo stream locale, che nell'IDE è registrato in `App`.
  useLogStream();

  if (sondaggio) {
    return <div style={vuoto}>{t("logWindow.checking")}</div>;
  }

  // Qui il ruolo manca per davvero: gli utenti esistono e nessuno ha fatto
  // login in questo browser. Un secondo login aprirebbe una seconda sessione,
  // che è peggio del problema.
  if (!authRole) {
    return (
      <div style={vuoto}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("logWindow.noAuth")}</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>
          {t("logWindow.noAuthHint")}
        </div>
        <button style={bottone} onClick={() => window.location.reload()}>
          {t("logWindow.reload")}
        </button>
      </div>
    );
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

const vuoto: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
  color: "var(--brand-text, #e2e8f0)",
  background: "var(--brand-bg, #0b1220)",
};

const avviso: React.CSSProperties = {
  flexShrink: 0,
  padding: "4px 10px",
  fontSize: 11,
  color: "var(--brand-text-subtle, #64748b)",
  background: "var(--brand-surface, #131c2e)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

const bottone: React.CSSProperties = {
  padding: "6px 14px",
  fontSize: 13,
  cursor: "pointer",
  color: "var(--brand-text, #e2e8f0)",
  background: "var(--brand-surface-2, #334155)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
};
