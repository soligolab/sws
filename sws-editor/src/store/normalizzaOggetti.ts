// La normalizzazione che una pagina riceve quando entra nell'editor, in un
// posto solo (10-11-2026).
//
// Era scritta dentro `setPages`, e una proposta dell'assistente — pagine lette
// dal disco dal server — non ci passava: il diff confrontava la pagina
// normalizzata dello store con quella grezza della proposta e dichiarava
// «modificati» gli oggetti che avevano solo i predefiniti scritti (14 su 40 di
// «Indicatori», visto riparando `e2e/chat-ai.spec.ts`). È il difetto del diff
// rumoroso del 2026-08-31, tornato da un'altra porta.

import { normalizeTrendObjects } from "@/canvas/trendModel";
import { normalizeXyObjects } from "@/canvas/xyModel";
import { normalizzaColoriOggetti, togliColoriDiProgetto } from "@/coloriPredefiniti";
import { normalizzaFontOggetti } from "@/font/famiglie";
import { riempiPredefinitiOggetti } from "@/predefinitiCampi";
import type { SynopticObject } from "@/types";

/** Trend e xy legacy → formato nuovo, colori `var(…)` → hex o automatico, i
 *  predefiniti fissi scritti, i colori di stato uguali al predefinito tolti, i
 *  `font_family` scritti a mano → id dell'elenco. Restituisce lo stesso array
 *  se non cambia niente. */
export function normalizzaOggetti(objects: SynopticObject[]): SynopticObject[] {
  return normalizzaFontOggetti(riempiPredefinitiOggetti(
    togliColoriDiProgetto(normalizzaColoriOggetti(normalizeXyObjects(normalizeTrendObjects(objects)))),
  ));
}
