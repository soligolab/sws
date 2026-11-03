/** La logica PLC del progetto dall'IDE (03-11-2026): scaricarla come zip e
 *  rimandarla su, con conferma perché sostituisce la cartella. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { LogicaPlcDelProgetto } from "../src/boot/OpenplcSulPannello";

afterEach(() => { vi.restoreAllMocks(); });

describe("Logica PLC del progetto", () => {
  it("un progetto senza logica lo dice, invece di scaricare uno zip vuoto", async () => {
    const scarica = vi.spyOn(api, "scaricaLogicaPlc").mockResolvedValue(null);
    render(<LogicaPlcDelProgetto />);
    fireEvent.click(screen.getByText(i18n.t("logicaPlc.scarica")));
    await waitFor(() => expect(scarica).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(i18n.t("logicaPlc.nessuna"))).toBeTruthy();
  });

  it("lo zip scelto si carica solo dopo la conferma", async () => {
    const carica = vi.spyOn(api, "caricaLogicaPlc").mockResolvedValue();
    const conferma = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<LogicaPlcDelProgetto />);
    const input = screen.getByTestId("logica-plc-file") as HTMLInputElement;
    const zip = new File([new Uint8Array([0x50, 0x4b])], "mio-plc.zip", { type: "application/zip" });
    fireEvent.change(input, { target: { files: [zip] } });
    expect(conferma).toHaveBeenCalledTimes(1);
    expect(carica).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [zip] } });
    await waitFor(() => expect(carica).toHaveBeenCalledWith(zip));
    expect(await screen.findByText(i18n.t("logicaPlc.caricata"))).toBeTruthy();
  });

  it("un rifiuto del server si legge", async () => {
    vi.spyOn(api, "caricaLogicaPlc").mockRejectedValue(new Error("percorso non ammesso: ../x"));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<LogicaPlcDelProgetto />);
    fireEvent.change(screen.getByTestId("logica-plc-file"), {
      target: { files: [new File(["x"], "x.zip")] },
    });
    expect(await screen.findByText(i18n.t("logicaPlc.nonCaricata", { motivo: "percorso non ammesso: ../x" }))).toBeTruthy();
  });
});
