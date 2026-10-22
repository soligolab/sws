/** La seconda conferma, quella che elenca gli avvisi di compatibilità, deve
 *  trovare la sua chiave (21-10-2026).
 *
 *  Stava in `rinomina` invece che in `aggiornamento` dal `ff9ea6d9`
 *  (2.12.0-rc.9): i18next, senza `parseMissingKeyHandler`, restituisce la
 *  chiave stessa, quindi per nove versioni la finestra ha chiesto conferma
 *  mostrando scritto «aggiornamento.confermaCompat» e **senza elencare gli
 *  avvisi** — cioè senza la sola cosa per cui esiste. Un difetto che nessun
 *  test vedeva perché nessuno guarda una stringa mancante.
 */
import { describe, expect, it } from "vitest";
import it_ from "@/i18n/it.json";
import en from "@/i18n/en.json";

describe("la conferma degli avvisi di compatibilità", () => {
  it("ha la sua chiave sotto «aggiornamento», nelle due lingue", () => {
    for (const [lingua, d] of [["it", it_], ["en", en]] as const) {
      const t = (d as unknown as Record<string, Record<string, string>>).aggiornamento?.confermaCompat;
      expect(t, `${lingua}: manca aggiornamento.confermaCompat`).toBeTruthy();
      expect(t, `${lingua}: deve interpolare gli avvisi`).toContain("{{avvisi}}");
    }
  });

  it("non è rimasta anche dove stava per sbaglio", () => {
    for (const d of [it_, en]) {
      expect((d as unknown as Record<string, Record<string, string>>).rinomina?.confermaCompat).toBeUndefined();
    }
  });
});
