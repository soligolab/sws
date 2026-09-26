// Dove porta il clic su un rilievo del validatore (26-09-2026). Con 28 rilievi
// in elenco e solo il `path` testuale per ritrovarli, sistemarli voleva dire
// cercare a mano ogni sorgente, tag o oggetto. Il `path` lo scrive
// `validate::semantic` (Rust) e ha poche forme: si leggono qui, e ciò che non
// si riconosce resta semplicemente non cliccabile.

import type { AppConfigTab } from "@/config/schede";

export type Destinazione =
  | { kind: "config"; tab: AppConfigTab; focus: string | null }
  | { kind: "page"; pageId: string; objectId: string | null };

/** Sezione di `project.yaml` → scheda della Configurazione, e se l'id fra
 *  parentesi è un elemento che quella scheda sa aprire (foglia dell'albero). */
const SEZIONI: Record<string, { tab: AppConfigTab; conElemento: boolean }> = {
  tags: { tab: "tags", conElemento: true },
  types: { tab: "types", conElemento: false },
  sources: { tab: "protocols", conElemento: true },
  alarms: { tab: "alarms", conElemento: false },
  global_scripts: { tab: "scripts", conElemento: true },
  datastores: { tab: "datastores", conElemento: true },
  notifications: { tab: "notifications", conElemento: false },
  languages: { tab: "languages", conElemento: false },
};

export function destinazioneRilievo(
  path: string,
  pages: readonly { id: string; name: string }[],
): Destinazione | null {
  // Gli id stanno fra parentesi quadre e possono contenere punti
  // (`sandokan.power`): si legge fino alla prima `]`, non fino al punto.
  const p = /^project\.(\w+)(?:\[([^\]]*)\])?/.exec(path);
  if (p) {
    const sez = SEZIONI[p[1]];
    if (!sez) return null;
    const id = p[2] ?? "";
    return { kind: "config", tab: sez.tab, focus: sez.conElemento && id ? id : null };
  }
  const g = /^pages\[([^\]]*)\](?:\.objects\[([^\]]*)\])?/.exec(path);
  if (g) {
    // Il validatore nomina le pagine per **nome**, l'editor le apre per id.
    const pagina = pages.find((x) => x.name === g[1]) ?? pages.find((x) => x.id === g[1]);
    if (!pagina) return null;
    return { kind: "page", pageId: pagina.id, objectId: g[2] || null };
  }
  return null;
}

/** Quanti rilievi ci sono, e quanti sono errori, dietro una destinazione. */
export interface ConteggioRilievi { n: number; errori: number }

/** La chiave del conteggio: la scheda, o la scheda + l'elemento. */
export const chiaveRilievi = (tab: string, focus: string | null = null) =>
  focus === null ? tab : `${tab}\u0000${focus}`;

/** I rilievi raggruppati per scheda e per elemento, per segnarli nell'albero
 *  della Configurazione (26-09-2026): un «⚠ 3» accanto ad Allarmi dice dove
 *  guardare prima di aprire la tendina dei rilievi. Un rilievo su un elemento
 *  conta **anche** per la sua scheda. I rilievi delle pagine restano fuori:
 *  non hanno una foglia qui. */
export function contaRilievi(
  rilievi: readonly { severity: string; path: string }[],
  pages: readonly { id: string; name: string }[],
): Map<string, ConteggioRilievi> {
  const out = new Map<string, ConteggioRilievi>();
  const somma = (k: string, errore: boolean) => {
    const c = out.get(k) ?? { n: 0, errori: 0 };
    out.set(k, { n: c.n + 1, errori: c.errori + (errore ? 1 : 0) });
  };
  for (const r of rilievi) {
    const d = destinazioneRilievo(r.path, pages);
    if (d?.kind !== "config") continue;
    const errore = r.severity === "error";
    somma(chiaveRilievi(d.tab), errore);
    if (d.focus !== null) somma(chiaveRilievi(d.tab, d.focus), errore);
  }
  return out;
}
