import type { TFunction } from "i18next";
import type { OpzioneChiedi, OpzioniChiedi } from "@/finestraAvviso/finestraAvviso";

/** The two answers of «Save as» (27-11-2026, plan
 *  `docs/archive/2026-11-27-cambio-di-nome-del-progetto.md`). `same_plant` is the
 *  default: a working or archive copy of the plant, whose deploy keeps history
 *  and users on the panel. `new_plant`: another plant, with its own identity,
 *  and without the history and the backups of the original. */
export type SceltaSalvaCome = "same_plant" | "new_plant";

/** The name dialog of «Save as», with the two choices. Pure, for the tests. */
export function opzioniSalvaCome(
  currentName: string,
  t: TFunction | ((k: string) => string),
): OpzioniChiedi & { opzioni: OpzioneChiedi[] } {
  const tr = t as (k: string) => string;
  return {
    testo: tr("menu.salvaComePrompt"),
    iniziale: `${currentName} ${tr("common.copiaSuffisso")}`,
    ok: tr("common.save"),
    opzioni: [
      { valore: "same_plant", etichetta: tr("menu.salvaComeStessoImpianto"), spiegazione: tr("menu.salvaComeStessoImpiantoAiuto") },
      { valore: "new_plant", etichetta: tr("menu.salvaComeNuovoImpianto"), spiegazione: tr("menu.salvaComeNuovoImpiantoAiuto") },
    ],
  };
}
