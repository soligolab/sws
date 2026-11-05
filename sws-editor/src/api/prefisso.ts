// Il prefisso del gateway.
//
// Nel cloud l'IDE non sta più alla radice del sito: ogni progetto è servito
// sotto `/p/<azienda>/<progetto>/`, e dietro quel percorso c'è un container
// diverso. Il gateway toglie il prefisso prima di passare la richiesta al
// container, quindi il runtime dentro non sa di stare sotto un prefisso e non
// deve saperlo.
//
// Chi deve saperlo è il browser: una chiamata a `/api/project` finirebbe sul
// gateway invece che sul progetto. Il punto unico dove rimediare è
// `getBaseUrl()`, perché ci passano tutte le chiamate HTTP, e il WebSocket ne
// dipende (`ws/wsUrl.ts`).
//
// Si legge da `window.location` e non da una variabile di build: la stessa
// immagine serve tutti i progetti di tutte le aziende, e l'unica cosa che
// distingue una scheda dall'altra è il suo indirizzo.

/** `/p/<azienda>/<progetto>` se la pagina è servita dal gateway, `""` altrove. */
export function prefissoGateway(percorso?: string): string {
  const p = percorso ?? (typeof window !== "undefined" ? window.location.pathname : "");
  const m = /^\/p\/([^/]+)\/([^/]+)(?:\/|$)/.exec(p);
  return m ? `/p/${m[1]}/${m[2]}` : "";
}

/** L'indirizzo di una finestra dell'IDE (`/index-chat.html`, `/index-log.html`)
 *  **dello stesso progetto**: nel cloud sotto `/p/<azienda>/<progetto>`.
 *
 *  Collaudo della 2.25.0 (04-11-2026): la chat staccata si apriva alla radice,
 *  cioè sul gateway, e diceva «nessuna chiave» — le chiavi stanno nel container
 *  del progetto. Il registro staccato mostrava i log del gateway. */
export function percorsoFinestra(percorso: string, pagina?: string): string {
  return prefissoGateway(pagina) + percorso;
}

/** `/schermo/<pannello>` se questa pagina è **lo schermo di un pannello**
 *  aperto dal cloud (29-10-2026, `docs/archive/2026-10-29-schermo-remoto.md`),
 *  `""` altrove.
 *
 *  Lì la pagina operatore è quella del pannello, servita attraverso il tunnel:
 *  tutto quello che chiede — API, websocket, immagini, file pubblici — deve
 *  passare dallo stesso prefisso, o finirebbe alla radice del sito, cioè al
 *  gateway. Non è `prefissoGateway`: quello vale anche per le rotte che nel
 *  cloud vanno **al** gateway (login, elenco dei progetti), e sullo schermo il
 *  login è quello del pannello. */
export function prefissoSchermo(percorso?: string): string {
  const p = percorso ?? (typeof window !== "undefined" ? window.location.pathname : "");
  const m = /^\/schermo\/([^/]+)(?:\/|$)/.exec(p);
  return m ? `/schermo/${m[1]}` : "";
}

/** Un file pubblico della stessa origine (`/symbols/…`, `/branding/…`): sullo
 *  schermo di un pannello viene dal pannello, altrove dalla radice. */
export function percorsoPubblico(percorso: string): string {
  return prefissoSchermo() + percorso;
}

/** `{azienda, progetto}` del progetto aperto, o `null` se non siamo nel cloud. */
export function progettoDalPercorso(
  percorso?: string,
): { azienda: string; progetto: string } | null {
  const pre = prefissoGateway(percorso);
  if (!pre) return null;
  const [, , azienda, progetto] = pre.split("/");
  return { azienda: decodeURIComponent(azienda), progetto: decodeURIComponent(progetto) };
}
