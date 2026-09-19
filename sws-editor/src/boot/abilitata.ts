import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { PageLayoutConfig } from "@/types";

/** Abilita una pagina di boot (o, con `undefined`, nessuna): scrive
 *  `page_layout.boot_page_id`, che è **uno solo** per costruzione. Va sul
 *  server subito, come le altre impostazioni di pagina, e poi nello store. */
export async function impostaBootAbilitata(id: string | undefined): Promise<void> {
  const { project, updateProjectPageLayout } = useAppStore.getState();
  const attuale: PageLayoutConfig = project?.page_layout ?? { size_mode: "fixed" };
  const cfg: PageLayoutConfig = { ...attuale, boot_page_id: id };
  await api.updatePageLayout(cfg);
  updateProjectPageLayout(cfg);
  // Una modifica nostra a `project.yaml` fuori da «Salva»: senza questo il
  // watcher del progetto la leggerebbe come un deploy esterno e mostrerebbe
  // «il progetto sul runtime è cambiato». L'evento rifissa la baseline.
  try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ }
}
