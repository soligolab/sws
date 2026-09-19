// Lo store non parla una lingua: registra chiavi del catalogo, e chi le mostra le traduce.
import { beforeEach, describe, expect, it } from "vitest";
import { useAppStore } from "@/store";

describe("lo store restituisce chiavi, non frasi", () => {
  beforeEach(() => {
    useAppStore.setState({ pages: [], past: [], future: [] } as never);
  });

  it("mergeCellRange su una cella sola ritorna la chiave dell'errore", () => {
    const err = useAppStore.getState().mergeCellRange("p", "o", 0, 0, 0, 0);
    expect(err).toEqual({ key: "storeErr.selectTwoCells" });
  });

  it("le etichette della history sono chiavi history.*", () => {
    useAppStore.getState().addPage();
    const { past } = useAppStore.getState();
    expect(past.length).toBeGreaterThan(0);
    for (const e of past) expect(e.label).toMatch(/^history\./);
  });
});
