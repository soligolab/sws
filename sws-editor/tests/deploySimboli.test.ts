/** M9: deploy verso un pannello che non conosce dei simboli di libreria. */
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n/index";
import { testoSimboliMancanti } from "../src/store";
import { api } from "../src/api/client";

afterEach(() => vi.restoreAllMocks());

describe("avviso dei simboli mancanti", () => {
  it("elenca i simboli e dice cosa succede", () => {
    const t = testoSimboliMancanti(["lib:process/centrifugal-pump", "lib:process/vertical-tank"], false);
    expect(t).toContain("• lib:process/centrifugal-pump");
    expect(t).toContain("• lib:process/vertical-tank");
    expect(t).toContain("2");
  });

  // 02-11-2026: il testo diceva «senza la libreria di simboli», ed era falso.
  it("un pannello che non dice quali simboli ha: il suo testo, con la versione", () => {
    const t = testoSimboliMancanti(["lib:x/y"], true, "2.23.7");
    expect(t).not.toBe(testoSimboliMancanti(["lib:x/y"], false));
    expect(t).toContain("2.23.7");
  });

  it("la conferma arriva al server come confirm_missing_symbols", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    await api.deployToRuntime({ replaceUsers: true, confirmMissingSymbols: true });
    const corpo = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(corpo.confirm_missing_symbols).toBe(true);
  });
});
