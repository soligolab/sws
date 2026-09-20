import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/api/client";

// Il 20-09-2026 il pannello proprietà di pagina salvò `page_layout` senza
// avvisare il sorvegliante del progetto: comparve «il progetto è cambiato» e
// «Ricarica» buttò una pagina non salvata. Ora ogni scrittura riuscita sul
// progetto **fatta da questo client** rifissa la baseline, da un posto solo.

function risposta(status = 204): Response {
  return new Response(null, { status, headers: { "content-length": "0" } });
}

function conFetch(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(risposta(status)));
  const visti: string[] = [];
  const ascolta = () => { visti.push("evento"); };
  window.addEventListener("sws:project-switched", ascolta);
  return { visti, stop: () => window.removeEventListener("sws:project-switched", ascolta) };
}

describe("scritture nostre sul progetto", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("un salvataggio del layout di pagina rifissa la baseline", async () => {
    const { visti, stop } = conFetch(204);
    await api.updatePageLayout({ size_mode: "fixed" });
    stop();
    expect(visti).toHaveLength(1);
  });

  it("anche il salvataggio di una pagina, di un faceplate e di una sezione", async () => {
    const { visti, stop } = conFetch(204);
    await api.updateAlarms([]);
    await api.saveFaceplate({ id: "f", label: "f", params: [], objects: [] });
    stop();
    expect(visti).toHaveLength(2);
  });

  it("una lettura non lo fa", async () => {
    const { visti, stop } = conFetch(200);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));
    await api.listFaceplates();
    stop();
    expect(visti).toHaveLength(0);
  });

  it("una scrittura rifiutata non lo fa: il progetto non è cambiato", async () => {
    const { visti, stop } = conFetch(500);
    await expect(api.updatePageLayout({ size_mode: "fixed" })).rejects.toThrow();
    stop();
    expect(visti).toHaveLength(0);
  });
});
