/** «Save as» with the two choices (27-11-2026, plan
 *  2026-11-27-cambio-di-nome-del-progetto): a copy of the same plant (the
 *  default) or a new project, another plant. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import i18n from "../src/i18n/index";
import { FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { chiediConOpzione, svuotaCoda } from "../src/finestraAvviso/finestraAvviso";
import { opzioniSalvaCome } from "../src/components/salvaCome";
import { api } from "../src/api/client";

afterEach(async () => {
  await act(async () => { svuotaCoda(); });
  fireEvent.keyUp(window, { key: "Enter" });
  cleanup();
  vi.restoreAllMocks();
});

async function apri<T>(p: () => Promise<T>): Promise<{ esito: Promise<T> }> {
  render(<FinestraAvviso />);
  let esito!: Promise<T>;
  await act(async () => { esito = p(); });
  return { esito };
}

describe("«Save as»: same plant or another plant", () => {
  it("the name dialog has the two choices, each with its explanation; the same plant first", () => {
    const o = opzioniSalvaCome("Casa", i18n.t.bind(i18n));
    expect(o.iniziale).toContain("Casa");
    expect(o.opzioni.map((x) => x.valore)).toEqual(["same_plant", "new_plant"]);
    expect(o.opzioni.every((x) => x.etichetta && x.spiegazione)).toBe(true);
  });

  it("the default answer is the same plant", async () => {
    const { esito } = await apri(() => chiediConOpzione(opzioniSalvaCome("Casa", i18n.t.bind(i18n))));
    const campo = screen.getByTestId("finestra-avviso-campo") as HTMLInputElement;
    fireEvent.change(campo, { target: { value: "Casa prova" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await expect(esito).resolves.toEqual({ testo: "Casa prova", opzione: "same_plant" });
  });

  it("«new project» is the other answer, and cancel gives null", async () => {
    const { esito } = await apri(() => chiediConOpzione(opzioniSalvaCome("Casa", i18n.t.bind(i18n))));
    fireEvent.click(screen.getByTestId("finestra-avviso-opzione-1").querySelector("input")!);
    fireEvent.click(screen.getByTestId("finestra-avviso-ok"));
    await expect(esito).resolves.toMatchObject({ opzione: "new_plant" });
    let annullata!: Promise<unknown>;
    await act(async () => { annullata = chiediConOpzione(opzioniSalvaCome("Casa", i18n.t.bind(i18n))); });
    fireEvent.click(screen.getByTestId("finestra-avviso-annulla"));
    await expect(annullata).resolves.toBeNull();
  });

  it("the duplicate request says new_plant only for another plant", async () => {
    const corpi: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_u, init) => {
      corpi.push(JSON.parse(String((init as RequestInit).body)));
      return new Response(JSON.stringify({ name: "x" }), { status: 201, headers: { "Content-Type": "application/json" } });
    });
    await api.duplicateProject("-/Casa", "Casa prova");
    await api.duplicateProject("-/Casa", "Casa nuova", undefined, true);
    expect(corpi).toEqual([{ new_name: "Casa prova" }, { new_name: "Casa nuova", new_plant: true }]);
  });
});
