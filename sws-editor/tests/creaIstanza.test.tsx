/** «Crea istanza» nella scheda Tipi (03-10-2026). Il maintainer aveva un tipo
 *  `hosts` e nessun modo, dalla scheda, di farne una variabile: le parti di un
 *  tipo esistono solo in un'istanza. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";

const { updateTags, updateTypes } = vi.hoisted(() => ({
  updateTags: vi.fn().mockResolvedValue({}),
  updateTypes: vi.fn().mockResolvedValue({}),
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, updateTags, updateTypes } };
});

import { TipiTab } from "../src/config/schede/TipiTab";
import { useAppStore } from "../src/store";

const TIPO = { id: "hosts", description: "", members: [{ name: "cpu", data_type: "f32" }] };

describe("Crea istanza", () => {
  beforeEach(() => {
    updateTags.mockClear();
    updateTypes.mockClear();
    useAppStore.setState({
      project: {
        meta: { name: "p", version: "0.1.0" },
        tags: [{ id: "hosts", description: "", data_type: "f64" }], types: [TIPO], sources: [], alarms: [], functions: [],
      } as never,
    });
  });

  it("senza istanze lo dice, propone un nome unico e crea la variabile col type_ref", async () => {
    const creata = vi.fn();
    render(<TipiTab incorporata onIstanzaCreata={creata} />);
    expect(screen.getByText(/non ha ancora istanze|no instances yet/i)).toBeTruthy();
    const campo = screen.getByDisplayValue("hosts2") as HTMLInputElement; // `hosts` è già un tag
    expect(campo).toBeTruthy();
    fireEvent.click(screen.getByText(/crea istanza|create instance/i));
    await waitFor(() => expect(creata).toHaveBeenCalledWith("hosts2"));
    const scritti = updateTags.mock.calls[0][0] as { id: string; type_ref?: string }[];
    expect(scritti.find((x) => x.id === "hosts2")?.type_ref).toBe("hosts");
    expect(useAppStore.getState().project?.tags?.some((x) => x.id === "hosts2")).toBe(true);
  });

  it("con la bozza delle Variabili toccata il pulsante è spento e dice perché", () => {
    render(<TipiTab incorporata variabiliToccate />);
    const b = screen.getByText(/crea istanza|create instance/i) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    expect(screen.getAllByText(/salva prima le modifiche|save the changes to tags first/i).length).toBeGreaterThan(0);
  });
});
