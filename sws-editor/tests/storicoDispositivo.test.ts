/** Lo storico del dispositivo in CSV (18-10-2026): l'elenco dei trend delle pagine, con le
 *  sole tracce che hanno un tag. */
import { describe, expect, it } from "vitest";
import { trendDelProgetto } from "../src/boot/StoricoDispositivo";

describe("trend del progetto per il CSV del dispositivo", () => {
  it("raccoglie i trend con almeno un tag, saltando le tracce vuote", () => {
    const pagine = [
      { name: "SystemInfo", objects: [
        { id: "a", type: "trend", trend_tags: [{ tag: "" }, { tag: "host.RAM" }, { tag: "host.totalCPU" }] },
        { id: "b", type: "gauge" },
        { id: "c", type: "trend", trend_tags: [{ tag: "" }] },
      ] },
      { name: "SystemInfo CPU", objects: [{ id: "d", type: "trend", trend_tags: [{ tag: "core.cpu0" }] }] },
    ];
    const t = trendDelProgetto(pagine);
    expect(t.map((x) => x.chiave)).toEqual(["SystemInfo/a", "SystemInfo CPU/d"]);
    expect(t[0].tags).toEqual(["host.RAM", "host.totalCPU"]);
  });
});
