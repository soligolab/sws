// Gli avvisi mentre si scrive (10-11-2026, piano della logica unificata, L2).
// Due fonti in un linter solo:
//   - la sandbox: `POST /api/script/check` 600 ms dopo l'ultima battuta, lo
//     stesso controllo del bottone «Controlla» (compila, non esegue);
//   - l'IDE: un tag letto o scritto che il progetto non ha, o un tag calcolato
//     che il codice prova a scrivere. Il runtime non lo può dire — un tag che
//     non esiste dà `None` a esecuzione, senza errori — e l'IDE il catalogo ce
//     l'ha già. Stessa regex della ricerca degli usi (`EXPR_RE`).

import type { Diagnostic } from "@codemirror/lint";
import type { Text } from "@codemirror/state";
import i18n from "i18next";
import { EXPR_RE } from "@/search/tagUsage";
import { eSegnaposto } from "@/tag/riconciliaTag";

/** Il ritardo dopo l'ultima battuta (decisione L2.2 del piano). */
export const RITARDO_AVVISI_MS = 600;

export interface CheckRisposta {
  ok: boolean;
  sandbox_verificata: boolean;
  rilievi: { riga?: number; colonna?: number; messaggio: string; vietato: boolean }[];
}

/** Gli avvisi sui tag, dal solo testo. `conosciuto` dice se un id è un tag del
 *  progetto (dichiarato, foglia, da una sorgente, in attesa del Salva). */
export function avvisiTag(
  codice: string,
  conosciuto: (id: string) => boolean,
  nonScrivibili: ReadonlySet<string>,
): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const m of codice.matchAll(EXPR_RE)) {
    const id = m[2] ?? m[4];
    if (!id || eSegnaposto(id)) continue;
    const from = (m.index ?? 0) + m[0].lastIndexOf(id);
    const to = from + id.length;
    if (!conosciuto(id)) {
      out.push({ from, to, severity: "warning", source: "IDE", message: i18n.t("logica.avvisoTagNonDichiarato", { id }) });
    } else if (m[0].startsWith("tags.write") && nonScrivibili.has(id)) {
      out.push({ from, to, severity: "warning", source: "IDE", message: i18n.t("logica.avvisoTagNonScrivibile", { id }) });
    }
  }
  return out;
}

/** I rilievi di `/api/script/check` come diagnostica CodeMirror. Un esito `ok`
 *  non porta niente (l'unico rilievo con `ok` è «il codice è vuoto», che
 *  mentre si scrive sarebbe solo rumore). */
export function avvisiSandbox(doc: Text, r: CheckRisposta): Diagnostic[] {
  if (r.ok) return [];
  return r.rilievi.map((x) => {
    const riga = doc.line(Math.min(Math.max(1, x.riga ?? 1), doc.lines));
    const from = Math.min(riga.from + Math.max(0, (x.colonna ?? 1) - 1), riga.to);
    return {
      from: x.colonna ? from : riga.from,
      to: riga.to,
      severity: "error" as const,
      source: x.vietato ? "sandbox" : "Python",
      message: x.messaggio,
    };
  });
}
