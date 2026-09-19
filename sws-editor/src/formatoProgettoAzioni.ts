import { api } from "@/api/client";
import { patchDaPredefinito, primaImpostazione, type FormatoPagina } from "@/formatoProgetto";
import { useAppStore } from "@/store";
import type { PageLayoutConfig, SynopticPage } from "@/types";

/** Scrive `page_layout` sul server e nello store. Una modifica nostra a
 *  `project.yaml` fuori da «Salva»: l'evento rifissa la baseline del watcher, o
 *  comparirebbe «il progetto sul runtime è cambiato». */
export async function salvaLayout(cfg: PageLayoutConfig): Promise<void> {
  await api.updatePageLayout(cfg);
  useAppStore.getState().updateProjectPageLayout(cfg);
  try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ }
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
  const cfg = nuovo as PageLayoutConfig;
  st.updateProjectPageLayout(cfg);
  api.updatePageLayout(cfg)
    .then(() => { try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ } })
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
