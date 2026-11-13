import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { PannelloConfig } from "@/types";

/** Salva `pannello` cambiando solo `modifica`: la PUT sostituisce tutta la
 *  sezione, quindi gli altri campi si rimandano com'erano. Fino al 13-11-2026
 *  il campo dei fotogrammi mandava `{ fps }` e basta, e avrebbe cancellato luce
 *  e riposo. Un campo `undefined` si toglie; una sezione vuota diventa `null`. */
export async function salvaPannello(modifica: Partial<PannelloConfig>) {
  const nuovo: PannelloConfig = { ...(useAppStore.getState().project?.pannello ?? {}), ...modifica };
  for (const k of Object.keys(nuovo) as (keyof PannelloConfig)[]) if (nuovo[k] === undefined) delete nuovo[k];
  const corpo = Object.keys(nuovo).length > 0 ? nuovo : null;
  await api.updatePannello(corpo);
  useAppStore.setState((s) => (s.project ? { project: { ...s.project, pannello: corpo ?? undefined } } : {}));
}
