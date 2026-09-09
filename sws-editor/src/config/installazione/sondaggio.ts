// Le parti pure di «Installa su dispositivo» (Q52): niente React, niente rete,
// così si provano in vitest e ConfigView.tsx non cresce di altre cento righe.
import type { ControlloDispositivo, EsitoControllo, SondaggioDispositivo, VarianteImmagine } from "../../api/client";

export const REGISTRY_IMMAGINE = "ghcr.io/soligolab/sws-runtime";

/** L'hostname dell'URL a cui l'editor è collegato, da proporre come Host SSH.
 *  "" se l'URL non si legge: meglio un campo vuoto che un valore inventato. */
export function hostDaUrl(target: string): string {
  try { return new URL(target).hostname; } catch { return ""; }
}

/** `ghcr.io/soligolab/sws-runtime:<variante>`; con null si lascia vuoto e il
 *  dispositivo decide da `uname -m` (comportamento dell'installer). */
export function imageRefDaVariante(v: VarianteImmagine | null): string {
  return v ? `${REGISTRY_IMMAGINE}:${v}` : "";
}

/** La variante immagine dalla sola architettura, quando l'editor è collegato a
 *  un runtime che la dichiara (`/api/system`). Su aarch64 si propone
 *  `latest-arm64`, che è ciò che l'installer sceglie da solo con un riferimento
 *  vuoto; la verifica via ssh, che vede anche il sistema operativo, può poi
 *  correggerla in `-generic`. Architetture senza immagine → null. */
export function varianteDaArch(arch: string | undefined | null): VarianteImmagine | null {
  switch ((arch ?? "").trim()) {
    case "aarch64": case "arm64": return "latest-arm64";
    case "x86_64": case "amd64": return "latest-amd64";
    default: return null;
  }
}

/** Il sondaggio può sovrascrivere il riferimento solo se è vuoto o è uno dei
 *  nostri tag: un riferimento scritto a mano verso un altro registry è una
 *  scelta dell'utente e non si tocca. */
export function imageRefAutomatico(ref: string): boolean {
  const r = ref.trim();
  return r === "" || r.startsWith(`${REGISTRY_IMMAGINE}:`);
}

/** Il peggiore fra i controlli: errore > avviso > ok. Solo grafica (colore del
 *  bordo, riepilogo); a dire se si può installare pensa il server con `pronto`. */
export function esitoComplessivo(c: ControlloDispositivo[]): EsitoControllo {
  if (c.some((x) => x.esito === "errore")) return "errore";
  if (c.some((x) => x.esito === "avviso")) return "avviso";
  return "ok";
}

/** «wp630 · aarch64 · Pixsys OS 2.1 · user (uid 1000)», saltando i pezzi vuoti. */
export function etichettaDispositivo(d: NonNullable<SondaggioDispositivo["dispositivo"]>): string {
  const os = [d.os.name, d.os.version].filter(Boolean).join(" ");
  const utente = d.utente ? (d.uid === null ? d.utente : `${d.utente} (uid ${d.uid})`) : "";
  return [d.hostname, d.arch, os, utente].filter(Boolean).join(" · ");
}

/** Installa è consentito se il sondaggio non è stato fatto (come prima di Q52)
 *  oppure se dice pronto. Si spegne solo quando ha guardato e ha trovato
 *  errori — e la lista dice quali. Nessun «installa comunque»: il caso di
 *  sviluppo passa dal ramo Binario, visibile solo con il repo. */
export function installazioneConsentita(s: SondaggioDispositivo | null): boolean {
  return s === null || (s.ok_ssh && s.pronto);
}
