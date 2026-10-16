import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { PageLayoutConfig } from "@/types";

/** La cornice predefinita del progetto (o, con `undefined`, nessuna): scrive
 *  `page_layout.cornice_predefinita` subito sul server, come l'immagine di boot
 *  abilitata (`boot/abilitata.ts`), e poi nello store. */
export async function impostaCornicePredefinita(id: string | undefined): Promise<void> {
  const { project, updateProjectPageLayout } = useAppStore.getState();
  const attuale: PageLayoutConfig = project?.page_layout ?? { size_mode: "fixed" };
  const cfg: PageLayoutConfig = { ...attuale, cornice_predefinita: id };
  await api.updatePageLayout(cfg);
  updateProjectPageLayout(cfg);
  // Una modifica nostra a `project.yaml` fuori da «Salva»: il watcher non deve
  // scambiarla per un deploy esterno.
  try { window.dispatchEvent(new CustomEvent("sws:project-switched")); } catch { /* test */ }
}
