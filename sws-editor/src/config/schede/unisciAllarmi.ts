// Unire gli allarmi che osservano lo stesso tag (26-09-2026). Dal 23-09 un tag
// vuole un allarme solo, con più livelli dentro, e il salvataggio è bloccato
// finché due allarmi condividono un tag: in CasaDomotica `sandokan_power_on` e
// `sandokan_power_off` andavano fusi a mano. Qui la fusione è meccanica — le
// soglie dell'altro diventano livelli di questo, ognuna con il suo messaggio,
// la sua severità e la sua isteresi — e l'utente la chiede con un bottone.

import type { AlarmDef, AlarmLevel } from "@/types";

/** I livelli di un allarme, anche se è ancora nel formato vecchio. */
export const livelliDi = (a: AlarmDef): AlarmLevel[] =>
  a.levels?.length
    ? a.levels
    : [{
        condition: a.condition ?? { kind: "bool_true" },
        severity: a.severity,
        message: a.message,
        dead_band: a.dead_band,
      }];

/** Le impostazioni dell'allarme intero (non dei livelli), che nella fusione
 *  restano quelle dell'allarme che resta. */
const DELL_ALLARME = [
  "on_delay_s", "off_delay_s", "inhibit_tag", "inhibit_condition", "notify_url",
  "notify_email", "email_mode", "escalate_after_s", "escalate_to", "telegram_mode", "telegram_chat_ids",
] as const;

export interface Fusione {
  /** L'allarme che resta, nel formato nuovo, con tutti i livelli. */
  unito: AlarmDef;
  /** Per ogni allarme tolto, le impostazioni sue che erano diverse da quelle
   *  di quello che resta — e che quindi si perdono. Vuoto = niente da perdere. */
  perse: { id: string; campi: string[] }[];
}

export function unisciAllarmi(resta: AlarmDef, altri: AlarmDef[]): Fusione {
  const unito: AlarmDef = {
    ...resta,
    levels: [...livelliDi(resta), ...altri.flatMap(livelliDi)],
    condition: undefined, message: undefined, severity: undefined, dead_band: undefined,
  };
  const uguali = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const perse = altri
    .map((a) => ({ id: a.id, campi: DELL_ALLARME.filter((k) => !uguali(a[k], resta[k])) as string[] }))
    .filter((p) => p.campi.length > 0);
  return { unito, perse };
}
