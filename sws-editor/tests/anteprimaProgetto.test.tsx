/** La miniatura nell'elenco dei progetti (29-10-2026): con una data la si
 *  scarica e la si mostra; senza, resta l'icona nello stesso riquadro. */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

const { scaricaAnteprima } = vi.hoisted(() => ({ scaricaAnteprima: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, scaricaAnteprima } };
});
import { AnteprimaProgetto } from "../src/components/benvenuto/AnteprimaProgetto";

beforeAll(() => {
  // jsdom non ha gli URL dei blob.
  URL.createObjectURL = vi.fn(() => "blob:miniatura");
  URL.revokeObjectURL = vi.fn();
});

describe("la miniatura di un progetto", () => {
  it("senza data non chiede niente e mostra l'icona", () => {
    render(<AnteprimaProgetto riferimento="-/casa" />);
    expect(scaricaAnteprima).not.toHaveBeenCalled();
    expect(screen.getByTestId("anteprima-progetto").getAttribute("data-con-miniatura")).toBe("no");
  });

  it("con la data la scarica, per quel progetto e quella versione", async () => {
    scaricaAnteprima.mockResolvedValue(new Blob([new Uint8Array(10)], { type: "image/png" }));
    render(<AnteprimaProgetto riferimento="acme/linea" ms={123} riga />);
    await waitFor(() => expect(screen.getByTestId("anteprima-progetto").getAttribute("data-con-miniatura")).toBe("si"));
    expect(scaricaAnteprima).toHaveBeenCalledWith("acme/linea", 123);
    expect(screen.getByTestId("anteprima-progetto").querySelector("img")?.getAttribute("src")).toBe("blob:miniatura");
  });

  it("se il runtime non ce l'ha, resta l'icona", async () => {
    scaricaAnteprima.mockResolvedValue(null);
    render(<AnteprimaProgetto riferimento="-/vecchio" ms={5} />);
    await waitFor(() => expect(scaricaAnteprima).toHaveBeenCalled());
    expect(screen.getByTestId("anteprima-progetto").getAttribute("data-con-miniatura")).toBe("no");
  });
});
