import type { SystemStatus } from "@/api/client";

/**
 * Chi è questa pagina, e se è più vecchia di quella sul server.
 *
 * **Perché esiste.** Gli artefatti sono due — il binario del runtime e il
 * bundle della SPA — e fino al 09-10-2026 ogni versione mostrata era quella
 * del runtime: nessuna descriveva il JavaScript in esecuzione. Il caso che
 * conta è proprio quello in cui divergono, perché `index-admin.html` esce
 * senza `Cache-Control` e il browser può servirne una copia vecchia mentre il
 * server è aggiornato.
 *
 * **Il confronto è sulle date, non sulle revisioni.** In sviluppo il bundle si
 * ricostruisce molte volte sullo stesso commit: due revisioni uguali non
 * dicono niente, mentre «la pagina è stata costruita prima del bundle che sta
 * sul disco» è esatto. La data del bundle sul disco la dà il server
 * (`spa_build_ms`, la mtime di `index-admin.html`).
 */
export type Identita = {
  versione: string;
  git: string;
  /** `null` quando il valore non è stato inciso — una build vecchia. */
  costruitoMs: number | null;
};

export function identitaPagina(): Identita {
  // `typeof` e non un accesso diretto: una pagina costruita prima di questa
  // modifica non ha le costanti, e un `ReferenceError` all'avvio sarebbe un
  // guasto peggiore del problema che si sta risolvendo.
  return {
    versione: typeof __SWS_VERSIONE__ === "string" ? __SWS_VERSIONE__ : "—",
    git: typeof __SWS_GIT__ === "string" ? __SWS_GIT__ : "sconosciuta",
    costruitoMs: typeof __SWS_BUILD_MS__ === "number" ? __SWS_BUILD_MS__ : null,
  };
}

/**
 * Vero quando il bundle sul disco è **più recente** di questa pagina: quello
 * che stai guardando non è quello che il server servirebbe adesso.
 *
 * Un minuto di tolleranza: fra la scrittura dei file e il caricamento della
 * pagina passa del tempo, e un avviso che scatta per pochi secondi di scarto
 * si impara a ignorare — che è il modo in cui un avviso smette di servire.
 */
export function paginaVecchia(stato: SystemStatus | null): boolean {
  const mia = identitaPagina().costruitoMs;
  const disco = stato?.spa_build_ms ?? null;
  if (mia === null || disco === null) return false;
  return disco - mia > 60_000;
}
