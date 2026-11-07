import { afterEach, describe, expect, it } from "vitest";
import "@/i18n";
import { avviso, chiedi, conferma, registraNelLog, rispondi, type Richiesta, type RigaRegistro } from "./finestraAvviso";

describe("i messaggi della Finestra di avviso nel registro (07-11-2026)", () => {
  afterEach(() => { registraNelLog(null); });

  it("l'avviso quando compare, la conferma con la risposta, la password mai", async () => {
    const righe: RigaRegistro[] = [];
    registraNelLog((r) => righe.push(r));
    const r = rispondi((q: Richiesta) => (q.tipo === "conferma" ? false : q.tipo === "chiedi" ? "segreto" : undefined));
    await avviso({ titolo: "Accesso", testo: "Serve\nl'accesso", livello: "errore" });
    await conferma("Inviare il progetto?");
    await chiedi({ testo: "Password", password: true });
    r.ferma();
    await Promise.resolve();
    expect(righe).toEqual([
      { livello: "errore", testo: "Accesso — Serve · l'accesso", dove: "avviso" },
      { livello: "info", testo: "Inviare il progetto? → no", dove: "conferma" },
    ]);
  });
});
