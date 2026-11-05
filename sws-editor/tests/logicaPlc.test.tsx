/** La logica PLC del progetto dall'IDE (03-11-2026): scaricarla come zip e
 *  rimandarla su, con conferma perché sostituisce la cartella. */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { LogicaPlcDelProgetto } from "../src/boot/OpenplcSulPannello";
import { rispondi } from "../src/finestraAvviso/finestraAvviso";

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
    // Il primo «no», il secondo «sì».
    const r = rispondi(() => r.chiamate.length > 1);
    try {
      render(<LogicaPlcDelProgetto />);
      const input = screen.getByTestId("logica-plc-file") as HTMLInputElement;
      const zip = new File([new Uint8Array([0x50, 0x4b])], "mio-plc.zip", { type: "application/zip" });
      fireEvent.change(input, { target: { files: [zip] } });
      await waitFor(() => expect(r.chiamate).toHaveLength(1));
      expect(r.chiamate[0]).toMatchObject({ tipo: "conferma", pericolo: true, testo: i18n.t("logicaPlc.conferma", { nome: "mio-plc.zip" }) });
      expect(carica).not.toHaveBeenCalled();
      fireEvent.change(input, { target: { files: [zip] } });
      await waitFor(() => expect(carica).toHaveBeenCalledWith(zip));
      expect(carica).toHaveBeenCalledTimes(1);
      expect(await screen.findByText(i18n.t("logicaPlc.caricata"))).toBeTruthy();
    } finally {
      r.ferma();
    }
  });

  it("un rifiuto del server si legge", async () => {
    vi.spyOn(api, "caricaLogicaPlc").mockRejectedValue(new Error("percorso non ammesso: ../x"));
    const r = rispondi(true);
    try {
      render(<LogicaPlcDelProgetto />);
      fireEvent.change(screen.getByTestId("logica-plc-file"), {
        target: { files: [new File(["x"], "x.zip")] },
      });
      expect(await screen.findByText(i18n.t("logicaPlc.nonCaricata", { motivo: "percorso non ammesso: ../x" }))).toBeTruthy();
    } finally {
      r.ferma();
    }
  });
});
