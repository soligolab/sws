// La lista dei dispositivi registrati (Q50): le parti pure, senza React e
// senza rete, così si provano in vitest.
//
// Dal 2026-09-10 la lista vive sul server (`GET`/`PUT /api/devices`, file
// `<cartella progetti>/.ambiente/dispositivi.yaml`) e non più in
// `localStorage`. Qui: come si unisce un dispositivo alla lista, come se ne
// ricava uno da ciò che il discovery mDNS ha trovato, e come si legge una
// volta sola la vecchia lista del browser per portarla sul server.
import type { DiscoveredRuntime, DispositivoRete } from "../api/client";
import type { SavedDevice } from "../types";

/** La chiave con cui la lista viveva nel browser fino al 2026-09-10. Si legge
 *  solo per la migrazione, poi si toglie. */
export const CHIAVE_LEGACY = "sws.saved-devices";

/** Due URL sono lo stesso dispositivo a meno di maiuscole e slash finale:
 *  è la stessa regola del server. */
export function chiaveUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/** Aggiunge o sostituisce (stesso URL) un dispositivo, senza toccare l'ordine
 *  degli altri. */
export function unisciDispositivo(lista: SavedDevice[], nuovo: SavedDevice): SavedDevice[] {
  const k = chiaveUrl(nuovo.url);
  const pulito: SavedDevice = { label: nuovo.label.trim() || nuovo.url.trim(), url: nuovo.url.trim().replace(/\/+$/, ""), user: nuovo.user.trim() };
  const i = lista.findIndex((d) => chiaveUrl(d.url) === k);
  if (i < 0) return [...lista, pulito];
  const copia = lista.slice();
  copia[i] = pulito;
  return copia;
}

export function eGiaInLista(lista: SavedDevice[], url: string): boolean {
  const k = chiaveUrl(url);
  return lista.some((d) => chiaveUrl(d.url) === k);
}

/** Da una riga della tabella mDNS (Q52) a un dispositivo da registrare: se SWS
 *  c'è già, l'URL è quello che annuncia; altrimenti si propone la porta di
 *  gestione standard sull'indirizzo visto. Utente vuoto: lo compila chi sa
 *  com'è configurato quel pannello. */
export function dispositivoDaRete(d: DispositivoRete): SavedDevice {
  const label = d.hostname.replace(/\.local$/i, "") || d.indirizzo;
  const url = d.sws.admin_url ?? `https://${d.indirizzo}:8444`;
  return { label, url, user: "" };
}

/** Da un runtime trovato da «Cerca runtime» (sezione connessione). */
export function dispositivoDaRuntime(r: DiscoveredRuntime, adminUrl: string): SavedDevice {
  const label = (r.hostname || r.name).replace(/\.local$/i, "");
  return { label, url: adminUrl, user: "" };
}

/** La vecchia lista del browser, se c'è, senza il campo `pass` che le versioni
 *  fino alla 2.6.6 salvavano. Qualunque cosa non sia una lista valida → vuota. */
export function leggiListaLegacy(grezzo: string | null): SavedDevice[] {
  if (!grezzo) return [];
  try {
    const v = JSON.parse(grezzo);
    if (!Array.isArray(v)) return [];
    return v
      .filter((d) => d && typeof d === "object" && typeof d.url === "string" && d.url.trim())
      .map((d) => ({ label: String(d.label ?? d.url), url: String(d.url), user: String(d.user ?? "") }));
  } catch {
    return [];
  }
}
