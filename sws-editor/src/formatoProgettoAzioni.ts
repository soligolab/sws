import { api } from "@/api/client";
import { inCodaLayout } from "@/layoutInCoda";
import { patchDaPredefinito, patchSovrascrittura, primaImpostazione, type FormatoPagina, type GenerePagina } from "@/formatoProgetto";
import { eBoot } from "@/boot/tipi";
import { eCornice } from "@/cornici/modello";
import { eFaceplateDef } from "@/faceplate/modello";
import { useAppStore } from "@/store";
import type { PageLayoutConfig, SynopticPage } from "@/types";

/** Scrive `page_layout` sul server e nello store. Una modifica nostra a
 *  `project.yaml` fuori da «Salva»: l'evento rifissa la baseline del watcher, o
 *  comparirebbe «il progetto sul runtime è cambiato». Con una funzione, il
 *  `page_layout` si calcola quando tocca a lui, da quello lasciato dalla
 *  scrittura prima: il server lo sostituisce intero. Restituisce quello scritto. */
export function salvaLayout(
  cfg: PageLayoutConfig | ((attuale: PageLayoutConfig | undefined) => PageLayoutConfig),
): Promise<PageLayoutConfig> {
  return inCodaLayout(async () => {
    const nuovo = typeof cfg === "function" ? cfg(useAppStore.getState().project?.page_layout) : cfg;
    await api.updatePageLayout(nuovo);
    useAppStore.getState().updateProjectPageLayout(nuovo);
    try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ }
    return nuovo;
  });
}

/** Modifica le proprietà di una pagina applicando la regola «la prima pagina
 *  modificata definisce lo stile delle altre» (`formatoProgetto.ts`): se è la
 *  prima volta che si imposta misure o sfondo e il predefinito è vuoto, lo
 *  riempie e lo scrive sulle pagine che non hanno un valore proprio — in un
 *  solo passo di cronologia. */
export function aggiornaPagina(id: string, patch: Partial<SynopticPage>): void {
  const st = useAppStore.getState();
  const layout = st.project?.page_layout;
  const formato: FormatoPagina = {
    width: patch.width, height: patch.height, background: patch.background, background_dark: patch.background_dark,
  };
  const nuovo = primaImpostazione(layout, formato);
  if (!nuovo) { st.updatePageProps(id, patch); return; }
  // La pagina modificata prende il suo patch; le altre, il predefinito appena nato.
  const altre = patchDaPredefinito(st.pages.filter((p) => p.id !== id), nuovo);
  st.updatePagesProps([{ id, patch }, ...altre]);
  // Subito nello store (una seconda modifica prima della risposta del server non
  // deve rifare la «prima impostazione»), poi sul server.
  // Sul server si scrive quello che c'è nello store quando tocca a lui: una
  // scrittura in coda prima di questa non va persa.
  st.updateProjectPageLayout(nuovo as PageLayoutConfig);
  salvaLayout((attuale) => attuale ?? (nuovo as PageLayoutConfig))
    .catch(() => { /* il predefinito si riprova alla prossima modifica */ });
}

/** «Applica alle pagine senza formato proprio»: riscrive il predefinito su ogni
 *  pagina che non ha un valore proprio. Restituisce quante ne ha toccate. */
export function applicaPredefinito(layout: PageLayoutConfig): number {
  const st = useAppStore.getState();
  const patches = patchDaPredefinito(st.pages, layout);
  st.updatePagesProps(patches);
  return patches.length;
}

/** Il genere di una pagina, per «Applica a tutte le pagine». */
export function generePagina(p: SynopticPage): GenerePagina {
  if (eBoot(p)) return "boot";
  if (eCornice(p)) return "cornice";
  if (eFaceplateDef(p)) return "faceplate";
  return p.finestra ? "finestra" : "pagina";
}

/** «Applica a tutte le pagine» (05-11-2026): il formato del progetto sopra
 *  quello delle pagine `ids`, in un passo solo di cronologia. Le pagine si
 *  salvano col Salva, come ogni modifica del canvas. Restituisce quante ne ha
 *  cambiate. */
export function applicaATutte(ids: readonly string[], scelta: { misura: boolean; sfondi: boolean }): number {
  const st = useAppStore.getState();
  const scelte = st.pages.filter((p) => ids.includes(p.id)).map((pagina) => ({ pagina, genere: generePagina(pagina) }));
  const patches = patchSovrascrittura(scelte, st.project?.page_layout, scelta);
  if (patches.length > 0) st.updatePagesProps(patches);
  return patches.length;
}
