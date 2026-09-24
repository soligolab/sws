/** Le due azioni che il pannello sinistro chiede all'editor.
 *
 *  Fino al 24-09-2026 `LeftPanel` viveva dentro `EditorShell` e le riceveva
 *  come props. Da quando il pannello sta in `App.tsx`, visibile anche in
 *  Configurazione (vista ⚙), `EditorShell` è un fratello e non un genitore: le
 *  props non arrivano più. Un registro di un solo posto, perché l'aggiunta di
 *  un oggetto usa stato locale dell'editor (la posizione in attesa per
 *  immagine e simbolo, che aprono un selettore prima di creare) che non ha
 *  motivo di finire nello store.
 */
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import type { SynopticObject } from "@/types";

type Aggiungi = (type: SynopticObject["type"]) => void;
let aggiungi: Aggiungi | null = null;

/** Lo chiama `EditorShell` a ogni disegno, e con `null` quando si smonta. */
export function registraAggiunta(f: Aggiungi | null): void {
  aggiungi = f;
}

/** La palette: senza editor montato (in Configurazione) non fa niente, ma lì
 *  la palette non si vede. */
export function aggiungiOggetto(type: SynopticObject["type"]): void {
  aggiungi?.(type);
}

/** Salva l'intera `project.functions`. La chiamano i verbi della vista
 *  Funzioni (aggiungi, rinomina, cancella), così il run endpoint vede subito il
 *  cambio senza ricaricare. */
export function persistiFunzioni(): void {
  const list = useAppStore.getState().project?.functions ?? [];
  api.updateFunctions(list).catch(console.error);
}
