import { salvaLayout } from "@/formatoProgettoAzioni";

/** Abilita una pagina di boot (o, con `undefined`, nessuna): scrive
 *  `page_layout.boot_page_id`, che è **uno solo** per costruzione. Va sul
 *  server subito, come le altre impostazioni di pagina, e poi nello store; dalla
 *  coda delle scritture di `page_layout` (08-11-2026, `layoutInCoda.ts`). */
export async function impostaBootAbilitata(id: string | undefined): Promise<void> {
  await salvaLayout((attuale) => ({ size_mode: "fixed", ...attuale, boot_page_id: id }));
}
