// Le finestre staccate (chat, log) si idratano da `localStorage sws.auth`, che
// in modalità **senza utenti** — la normalità sul PC di sviluppo — è vuoto.
// Senza questa sonda direbbero «accedi» su quasi ogni istanza di sviluppo.
//
// Stesso giro che fa `App.tsx`: se `whoami()` risponde, il runtime non ha utenti
// e si mette il token sentinella; se rifiuta, gli utenti esistono e serve un
// login vero — che va fatto nella finestra dell'editor, non qui (un secondo
// login aprirebbe una seconda sessione).
//
// Era copiato identico in ChatWindow e LogWindow (revisione 2026-09-09).

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { useAppStore } from "@/store";

export function useAccessoSenzaUtenti(): { sondaggio: boolean; authRole: string | null } {
  const authRole  = useAppStore((s) => s.authRole);
  const authToken = useAppStore((s) => s.authToken);
  const setAuth   = useAppStore((s) => s.setAuth);
  const [sondaggio, setSondaggio] = useState(true);

  useEffect(() => {
    if (authToken) { setSondaggio(false); return; }
    let vivo = true;
    api.whoami()
      .then((me) => { if (vivo) setAuth("no-auth", me.username, me.role, me.must_change_password); })
      .catch(() => { /* ci sono utenti: il chiamante mostra la schermata di accesso */ })
      .finally(() => { if (vivo) setSondaggio(false); });
    return () => { vivo = false; };
  }, [authToken, setAuth]);

  return { sondaggio, authRole: authRole ?? null };
}
