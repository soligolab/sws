// La foto di una pagina di un progetto **web**, chiesta dall'assistente
// (decisione del maintainer, 10-11-2026).
//
// `istantanea_pagina` fotografa col motore del progetto. Per un progetto web
// il motore è il browser, e la foto la fa l'IDE con lo stesso `SvgCanvas`
// dell'editor (`boot/rasterizza.ts`). Il server manda nel frame `fotografa`
// quello che il modello vede — la pagina intera, le bozze `prj:` compilate,
// gli sfondi del banco, i faceplate — e qui lo si disegna così com'è, senza
// guardare il disco: la pagina può non essere ancora proposta, le bozze e gli
// sfondi non sono ancora nel progetto.
//
// Il server lato Rust è `sws-web/src/ai/foto_ide.rs`.

import { rasterizzaPagina } from "@/boot/rasterizza";
import { immagineInSospeso, mettiInSospeso, togliDaSospeso } from "@/canvas/immaginiInSospeso";
import { corniceDellAnteprima } from "@/progetto/anteprima";
import { useAppStore } from "@/store";
import { precaricaSimboli, sovrapponiSimboli } from "@/symbols/lib/libreria";
import type { SimboloLib } from "@/symbols/lib/manifest";
import type { FaceplateDef, SynopticPage } from "@/types";

/** Il frame `fotografa` del server, senza `t` e `id`. */
export interface RichiestaFoto {
  pagina: SynopticPage;
  /** Le bozze di simbolo della conversazione, già compilate dal server. */
  simboli?: { voce: SimboloLib; svg: string }[];
  /** Gli sfondi del banco che la pagina usa: `src` è l'href con cui la pagina
   *  li nomina, `jpg` il JPEG in base64. */
  sfondi?: { src: string; jpg: string }[];
  faceplates?: FaceplateDef[];
  /** La misura della pagina secondo il server (quando la pagina non la dice). */
  misura?: { larghezza: number; altezza: number };
}

export interface Foto {
  png: Blob;
  avvisi: string[];
}

/** Tutti i `symbol_id` di una pagina e dei faceplate, a qualunque profondità
 *  (celle di griglia, figli di gruppo). */
export function simboliUsati(...dove: unknown[]): string[] {
  const out = new Set<string>();
  const visita = (v: unknown) => {
    if (Array.isArray(v)) { v.forEach(visita); return; }
    if (!v || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v)) {
      if (k === "symbol_id" && typeof x === "string") out.add(x);
      else visita(x);
    }
  };
  dove.forEach(visita);
  return [...out];
}

/** Disegna la pagina della richiesta e restituisce il PNG. */
export async function fotografa(r: RichiestaFoto): Promise<Foto> {
  if (!r.pagina || !Array.isArray(r.pagina.objects)) throw new Error("la richiesta non ha una pagina da disegnare");
  const st = useAppStore.getState();
  const pagina: SynopticPage = {
    ...r.pagina,
    width: r.pagina.width ?? r.misura?.larghezza,
    height: r.pagina.height ?? r.misura?.altezza,
  };
  // Gli sfondi del banco, da disegnare come le foto di una proposta applicata
  // e non salvata: la stessa mappa. Si tolgono dopo, ma solo quelli messi qui.
  const messi: string[] = [];
  for (const f of r.sfondi ?? []) {
    if (immagineInSospeso(f.src)) continue;
    mettiInSospeso(f.src, `data:image/jpeg;base64,${f.jpg}`);
    messi.push(f.src);
  }
  const togliSimboli = sovrapponiSimboli(r.simboli ?? []);
  try {
    await precaricaSimboli(simboliUsati(pagina, r.faceplates));
    const cornice = corniceDellAnteprima(pagina, st.pages, st.project?.page_layout?.cornice_predefinita);
    return await rasterizzaPagina(pagina, st.customSymbols, {
      cornice,
      valori: st.tagValues,
      faceplates: r.faceplates,
    });
  } finally {
    togliSimboli();
    for (const h of messi) togliDaSospeso(h);
  }
}

/** Un `Blob` in base64, senza l'intestazione `data:`. */
export function blobInBase64(b: Blob): Promise<string> {
  return new Promise((ok, ko) => {
    const lettore = new FileReader();
    lettore.onload = () => ok(String(lettore.result).replace(/^data:[^,]*,/, ""));
    lettore.onerror = () => ko(lettore.error);
    lettore.readAsDataURL(b);
  });
}
