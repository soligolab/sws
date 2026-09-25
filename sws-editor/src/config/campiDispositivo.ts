/** I campi «quale dispositivo» delle schede Installazione e Container, e la
 *  loro memoria.
 *
 *  ## Perché una memoria
 *
 *  Le schede del ramo Device non portano bozza (`portaBozza: false`) e si
 *  **smontano** appena si cambia foglia: senza memoria, host e utente si
 *  riscriverebbero a ogni giro. Si ricordano host, porta, utente e percorso
 *  dati; **la password no**, mai (regola del 2026-09-09).
 *
 *  ## Perché due insiemi di chiavi e non uno
 *
 *  Decisione del maintainer (25-09-2026): Installazione e Container hanno
 *  campi **indipendenti**, così le due schede possono guardare dispositivi
 *  diversi. Su un dispositivo nuovo si digita due volte, e va bene.
 *
 *  L'unica scrittura incrociata è voluta ed è una sola: scegliendo un runtime
 *  dalla ricerca in rete (scheda Connessione) si propone quell'host anche
 *  all'Installazione, perché lì il dispositivo è lo stesso e ridigitarlo
 *  sarebbe solo fastidio.
 */

export const INSTALL_HOST = "sws.install.host";
export const INSTALL_PORT = "sws.install.port";
export const INSTALL_USER = "sws.install.user";
export const INSTALL_DATA = "sws.install.dataPath";

export const CONTAINER_HOST = "sws.container.host";
export const CONTAINER_PORT = "sws.container.port";
export const CONTAINER_USER = "sws.container.user";
export const CONTAINER_DATA = "sws.container.dataPath";

/** Un valore ricordato, o il suo default. In una finestra privata o con lo
 *  storage negato la lettura lancia: si riparte dal default, non si rompe. */
export function ricordato(chiave: string, difetto: string): string {
  try { return localStorage.getItem(chiave) ?? difetto; } catch { return difetto; }
}

export function ricorda(chiave: string, valore: string): void {
  try { localStorage.setItem(chiave, valore); } catch { /* storage negato */ }
}
