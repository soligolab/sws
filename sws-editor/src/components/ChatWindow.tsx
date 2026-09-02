// La chat dell'assistente in una finestra propria.
//
// # Perché qui serve un ponte e per i log no
//
// `LogPanel` è sola lettura verso il progetto: la sua finestra apre i propri
// stream e vive per conto suo. La chat no — `applyAiProposal` deve girare nella
// finestra dell'editor, perché scrive lo store, la history e le
// `pendingSections`, che sono closure e non attraversano nessun canale. Quindi
// questa finestra tiene **socket, conversazione e rendering**, e per diff e
// applicazione chiede all'editor (`@/ai/ponte`, `@/ai/editor`).
//
// # Staccare è una consegna, non un duplicato
//
// La conversazione vive nel WebSocket lato runtime (`ai/mod.rs`: `messaggi` è
// locale alla sessione). Un secondo socket è una **seconda conversazione
// vuota**: non esiste un modo di trasferirla, e per questo non c'è nessun
// «riattacca». Quando la chat passa qui, nell'editor il pannello si chiude e la
// conversazione riparte da zero — cosa che va detta, non scoperta.
//
// # Cosa vede l'utente quando qualcosa manca
//
// | Caso | Qui |
// |---|---|
// | editor risponde, progetto aperto | nessun avviso, tutto abilitato |
// | editor risponde, **nessun progetto** | avviso **e compositore disabilitato**: gli strumenti leggerebbero il vuoto |
// | editor non risponde / chiuso | avviso; si legge, **Applica disabilitato** col motivo |
// | editor ricaricato | manda `editore-pronto`, questa finestra si ri-presenta e torna verde |

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { editorViaPonte } from "@/ai/editor";
import { nuovoId, Ponte } from "@/ai/ponte";
import { ChatPanel } from "@/components/ChatPanel";
import { useAppStore } from "@/store";

/** L'id dell'editor a cui questa finestra è legata, da `#e=<id>`.
 *
 *  Nell'URL e non in `localStorage` perché è **di questa finestra**: due chat
 *  staccate da due schede dell'IDE devono restare legate alle proprie. */
function idEditoreDaUrl(): string {
  const h = window.location.hash;
  const m = /(?:^#|&)e=([^&]+)/.exec(h);
  return m ? decodeURIComponent(m[1]) : "";
}

type Legame =
  | { s: "attendo" }
  | { s: "ok"; progetto: string | null }
  | { s: "assente" };

export function ChatWindow() {
  const { t } = useTranslation();
  const authRole  = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const setAuth   = useAppStore((s) => s.setAuth);
  const [sondaggio, setSondaggio] = useState(true);
  const [legame, setLegame] = useState<Legame>({ s: "attendo" });

  const bersaglio = useRef(idEditoreDaUrl());
  const ponte = useMemo(() => new Ponte(nuovoId()), []);
  const editor = useMemo(() => editorViaPonte(ponte, () => bersaglio.current), [ponte]);

  // Stessa sonda di `LogWindow`: la modalità **senza utenti** è la normalità sul
  // PC di sviluppo, e lo store di questa finestra si idrata da `localStorage
  // sws.auth`, che in quel caso è vuoto. Senza questa sonda la finestra direbbe
  // «accedi» su quasi ogni istanza di sviluppo.
  useEffect(() => {
    if (authToken) { setSondaggio(false); return; }
    let vivo = true;
    api.whoami()
      .then((me) => { if (vivo) setAuth("no-auth", me.username, me.role, me.must_change_password); })
      .catch(() => { /* ci sono utenti: si mostra la schermata sotto */ })
      .finally(() => { if (vivo) setSondaggio(false); });
    return () => { vivo = false; };
  }, [authToken, setAuth]);

  // Il ciclo di vita del legame con l'editor.
  useEffect(() => {
    if (!ponte.vivo) { setLegame({ s: "assente" }); return; }

    const presentati = () => ponte.manda({ t: "ciao", a: bersaglio.current });

    const stop = ponte.ascolta((m) => {
      switch (m.t) {
        case "editore-pronto":
          // L'editor è (ri)partito. Ci si ri-presenta **solo** se è il nostro:
          // seguire qualunque scheda che annuncia butterebbe via
          // l'indirizzamento, ed è la ragione per cui l'id dell'editor sta in
          // `sessionStorage` e sopravvive a un ricarico.
          if (m.da === bersaglio.current) presentati();
          break;
        case "stato":
          setLegame({ s: "ok", progetto: m.progetto });
          break;
        case "editore-chiuso":
          if (m.da === bersaglio.current) setLegame({ s: "assente" });
          break;
      }
    });

    presentati();
    // Se non risponde nessuno entro qualche secondo, lo si dice invece di
    // restare in «attendo» per sempre.
    const scadenza = setTimeout(() => {
      setLegame((l) => (l.s === "attendo" ? { s: "assente" } : l));
    }, 4000);

    // Chiudendo la finestra si avvisa l'editor, che riabilita il suo pannello:
    // senza, il cassetto resterebbe disabilitato per sempre e l'unico rimedio
    // sarebbe ricaricare l'IDE.
    const addio = () => ponte.manda({ t: "chat-chiusa", a: bersaglio.current });
    window.addEventListener("pagehide", addio);

    return () => {
      clearTimeout(scadenza);
      window.removeEventListener("pagehide", addio);
      stop();
    };
  }, [ponte]);

  if (sondaggio) return <div style={vuoto}>{t("chatWindow.checking")}</div>;

  // Qui il ruolo manca per davvero: gli utenti esistono e nessuno ha fatto login
  // in questo browser. Un secondo login aprirebbe una seconda sessione.
  if (!authRole) {
    return (
      <div style={vuoto}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("chatWindow.noAuth")}</div>
        <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 12 }}>{t("chatWindow.noAuthHint")}</div>
        <button style={bottone} onClick={() => window.location.reload()}>{t("chatWindow.reload")}</button>
      </div>
    );
  }

  if (!bersaglio.current) {
    // Aperta a mano senza `#e=…`: non c'è nessun editor da chiamare, e fingere
    // che ci sia farebbe scadere ogni «Applica» dopo otto secondi.
    return <div style={vuoto}>{t("chatWindow.noTarget")}</div>;
  }

  const avviso =
    legame.s === "assente" ? t("chatWindow.editorGone")
    : legame.s === "ok" && legame.progetto === null ? t("chatWindow.noProject")
    : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={striscia}>
        {legame.s === "ok" && legame.progetto
          ? t("chatWindow.boundTo", { progetto: legame.progetto })
          : legame.s === "attendo" ? t("chatWindow.binding")
          : t("chatWindow.unbound")}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        <ChatPanel
          open
          onClose={() => window.close()}
          editor={editor}
          avviso={avviso}
          bloccaInvio={legame.s === "ok" && legame.progetto === null}
          variant="window"
        />
      </div>
    </div>
  );
}

const vuoto: React.CSSProperties = {
  height: "100%", display: "flex", flexDirection: "column",
  alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center",
  color: "var(--brand-text, #e2e8f0)", background: "var(--brand-bg, #0b1220)",
};

const striscia: React.CSSProperties = {
  flexShrink: 0, padding: "4px 10px", fontSize: 11,
  color: "var(--brand-text-subtle, #64748b)",
  background: "var(--brand-surface, #131c2e)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

const bottone: React.CSSProperties = {
  padding: "6px 14px", fontSize: 13, cursor: "pointer",
  color: "var(--brand-text, #e2e8f0)", background: "var(--brand-surface-2, #334155)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6,
};
