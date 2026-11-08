import { salvaLayout } from "@/formatoProgettoAzioni";

/** La cornice predefinita del progetto (o, con `undefined`, nessuna): scrive
 *  `page_layout.cornice_predefinita` subito sul server e nello store. Passa da
 *  `salvaLayout` (08-11-2026), la coda delle scritture di `page_layout`: dalla
 *  finestra «Impostazioni progetto» parte insieme alle altre, e una `PUT`
 *  versionata scritta in parallelo prendeva un 409. */
export async function impostaCornicePredefinita(id: string | undefined): Promise<void> {
  await salvaLayout((attuale) => ({ size_mode: "fixed", ...attuale, cornice_predefinita: id }));
}
