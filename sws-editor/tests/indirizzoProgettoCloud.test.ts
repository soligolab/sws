import { describe, it, expect, afterEach } from "vitest";
import { progettoDalPercorso } from "@/api/prefisso";

/** La regola che il difetto del 16-10 ha reso esplicita: nel cloud l'indirizzo
 *  del progetto aperto lo dice l'URL, non il server.
 *
 *  Il container è avviato con `--project /progetto`, quindi il suo
 *  `active_project_riferimento` vale `-/progetto`: il nome della cartella
 *  montata, uguale per ogni progetto del cloud. Usarlo come indirizzo faceva
 *  chiedere `/api/projects/-/progetto/duplicate` — 404, qualunque progetto
 *  fosse aperto. */
describe("l'indirizzo del progetto aperto nel cloud", () => {
  afterEach(() => { /* niente da ripulire: progettoDalPercorso prende il percorso per argomento */ });

  it("viene dal prefisso, non dal nome della cartella montata", () => {
    const p = progettoDalPercorso("/p/-/CasaDomotica/#edit");
    expect(p).toEqual({ azienda: "-", progetto: "CasaDomotica" });
    expect(`${p!.azienda}/${p!.progetto}`).toBe("-/CasaDomotica");
  });

  it("vale anche per un progetto in una cartella d'azienda", () => {
    const p = progettoDalPercorso("/p/acme/linea1/");
    expect(`${p!.azienda}/${p!.progetto}`).toBe("acme/linea1");
  });

  it("fuori dal cloud non dice niente, e allora tocca al server", () => {
    expect(progettoDalPercorso("/")).toBeNull();
    expect(progettoDalPercorso("/index-admin.html")).toBeNull();
  });
});
