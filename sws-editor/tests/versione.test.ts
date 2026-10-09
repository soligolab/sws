import { describe, expect, it } from "vitest";
import { paginaVecchia } from "@/versione";

/**
 * Il confronto è sulle **date**, non sulle revisioni.
 *
 * In sviluppo il bundle si ricostruisce molte volte sullo stesso commit: due
 * revisioni uguali non direbbero niente, mentre «la pagina è stata costruita
 * prima del bundle che sta sul disco» è esatto. Nasce dal caso del
 * 09-10-2026: il server aggiornato e il browser che serviva una pagina
 * vecchia, perché `index-admin.html` esce senza `Cache-Control`.
 */
describe("paginaVecchia", () => {
  // `__SWS_BUILD_MS__` è iniettato da vite.config.ts anche nei test.
  const mia = typeof __SWS_BUILD_MS__ === "number" ? __SWS_BUILD_MS__ : null;
  const con = (spa: number | null) =>
    paginaVecchia({ spa_build_ms: spa } as never);

  it("tace quando il server non sa la data del bundle", () => {
    expect(con(null)).toBe(false);
  });

  it("tace quando la pagina è più recente del disco", () => {
    expect(con((mia ?? 0) - 600_000)).toBe(false);
  });

  it("tace per scarti piccoli: fra la scrittura dei file e il caricamento della pagina passa del tempo", () => {
    expect(con((mia ?? 0) + 30_000)).toBe(false);
  });

  it("avvisa quando il disco è molto più recente: il browser serve una copia vecchia", () => {
    expect(con((mia ?? 0) + 3_600_000)).toBe(true);
  });
});
