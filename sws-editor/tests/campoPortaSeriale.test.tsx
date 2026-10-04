/** Il campo «Porta seriale» con le porte vere (04-10-2026): dal dispositivo
 *  connesso, o da questo PC; e cosa dice della porta scelta. */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach, vi } from "vitest";
import "../src/i18n";

const { porteSeriali, remotePorteSeriali } = vi.hoisted(() => ({ porteSeriali: vi.fn(), remotePorteSeriali: vi.fn() }));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return { ...actual, api: { ...actual.api, porteSeriali, remotePorteSeriali } };
});

import { CampoPortaSeriale } from "../src/config/sorgenti/CampoPortaSeriale";
import { useAppStore } from "../src/store";

const TC620 = { container: true, porte: [
  { percorso: "/dev/ttyCOM1", collegamento: "ttyS2", accesso: "ok" },
  { percorso: "/dev/ttyS0", accesso: "permesso" },
] };

describe("CampoPortaSeriale", () => {
  beforeEach(() => {
    porteSeriali.mockReset().mockResolvedValue({ container: false, porte: [{ percorso: "/dev/ttyUSB0", accesso: "ok" }] });
    remotePorteSeriali.mockReset().mockResolvedValue(TC620);
  });

  it("col dispositivo connesso: le sue porte, e la scelta raggiungibile con il collegamento", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620:8444" });
    const { container } = render(<CampoPortaSeriale value="/dev/ttyCOM1" onChange={() => {}} idLista="l" />);
    await waitFor(() => expect(screen.getByTestId("stato-porta-seriale").textContent).toContain("ttyS2"));
    const opzioni = [...container.querySelectorAll("select option")].map((o) => o.textContent);
    expect(opzioni[0]).toBe("/dev/ttyCOM1 → ttyS2");
    expect(opzioni[1]).toMatch(/^\/dev\/ttyS0 \(/); // senza permessi, detto nella tendina
    expect(opzioni.at(-1)).toMatch(/a mano|Type it in/);
    expect(porteSeriali).not.toHaveBeenCalled();
  });

  it("una porta che il container non vede, e una senza permessi, lo dicono", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620:8444" });
    const { rerender } = render(<CampoPortaSeriale value="/dev/ttyCOM2" onChange={() => {}} idLista="l" />);
    await waitFor(() => expect(screen.getByTestId("stato-porta-seriale").textContent).toMatch(/quadlet 2/));
    rerender(<CampoPortaSeriale value="/dev/ttyS0" onChange={() => {}} idLista="l" />);
    expect(screen.getByTestId("stato-porta-seriale").textContent).toMatch(/dialout/);
  });

  it("un runtime remoto vecchio: le porte di questo PC, e lo dice", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620:8444" });
    remotePorteSeriali.mockRejectedValue(new Error("404"));
    render(<CampoPortaSeriale value="/dev/ttyUSB0" onChange={() => {}} idLista="l" />);
    await waitFor(() => expect(screen.getByText(/rc\.22/)).toBeTruthy());
    // Le porte sono del PC: dire «il runtime non la vede» sarebbe falso per il pannello.
    expect(screen.queryByTestId("stato-porta-seriale")).toBeNull();
  });

  it("«Inserisci a mano» passa al testo, e si torna all'elenco", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620:8444" });
    const cambia = vi.fn();
    render(<CampoPortaSeriale value="/dev/ttyCOM1" onChange={cambia} />);
    const tendina = await screen.findByTestId("tendina-porta-seriale");
    const aMano = [...tendina.querySelectorAll("option")].at(-1)!.getAttribute("value")!;
    fireEvent.change(tendina, { target: { value: aMano } });
    expect(cambia).not.toHaveBeenCalled(); // l'opzione non è un valore
    fireEvent.change(screen.getByTestId("campo-porta-seriale"), { target: { value: "/dev/ttyCOM3" } });
    expect(cambia).toHaveBeenCalledWith("/dev/ttyCOM3");
    fireEvent.click(screen.getByTestId("torna-elenco-porte"));
    expect(screen.getByTestId("tendina-porta-seriale")).toBeTruthy();
  });

  it("dispositivo non raggiungibile e nessuna porta letta: il campo è testo libero", async () => {
    useAppStore.setState({ remoteConnected: false, remoteUrl: null });
    porteSeriali.mockRejectedValue(new Error("rete"));
    render(<CampoPortaSeriale value="/dev/ttyCOM1" onChange={() => {}} />);
    await waitFor(() => expect(porteSeriali).toHaveBeenCalled());
    expect(screen.getByTestId("campo-porta-seriale")).toBeTruthy();
    expect(screen.queryByTestId("tendina-porta-seriale")).toBeNull();
  });

  it("una porta scritta a mano che il dispositivo non elenca resta scelta, segnata «a mano»", async () => {
    useAppStore.setState({ remoteConnected: true, remoteUrl: "https://tc620:8444" });
    render(<CampoPortaSeriale value="/dev/ttyCOM3" onChange={() => {}} />);
    const tendina = (await screen.findByTestId("tendina-porta-seriale")) as HTMLSelectElement;
    expect(tendina.value).toBe("/dev/ttyCOM3");
    expect(tendina.selectedOptions[0].textContent).toMatch(/a mano|typed/);
  });
});
