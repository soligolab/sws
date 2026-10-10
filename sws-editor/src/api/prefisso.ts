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

/** `{azienda, progetto}` del progetto aperto, o `null` se non siamo nel cloud. */
export function progettoDalPercorso(
  percorso?: string,
): { azienda: string; progetto: string } | null {
  const pre = prefissoGateway(percorso);
  if (!pre) return null;
  const [, , azienda, progetto] = pre.split("/");
  return { azienda: decodeURIComponent(azienda), progetto: decodeURIComponent(progetto) };
}
