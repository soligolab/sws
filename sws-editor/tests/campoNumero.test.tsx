/** Il «-» da tastiera nei campi numerici (31-10-2026, piano
 *  docs/plans/2026-10-31-campi-numerici.md): il testo a metà resta nel campo e
 *  non arriva al gestore. In jsdom `validity.badInput` non nasce da solo, e lo
 *  si imposta a mano com'è nel browser per «-». */
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "../src/i18n";
import { CampoNumero } from "../src/components/CampoNumero";
import { GRUPPI_PROPRIETA, GruppoAttivo, ObjectProps } from "../src/editor/EditorShell";
import type { SynopticObject } from "../src/types";

/** Quello che fa il browser con «-» in un campo numerico: valore vuoto,
 *  `badInput` vero. */
function scriviAMeta(campo: HTMLInputElement) {
  Object.defineProperty(campo, "validity", { configurable: true, value: { badInput: true } });
  fireEvent.change(campo, { target: { value: "" } });
  Object.defineProperty(campo, "validity", { configurable: true, value: { badInput: false } });
}

describe("CampoNumero", () => {
  it("«-» non arriva al gestore e non torna lo 0, nemmeno a un ridisegno", () => {
    const onTesto = vi.fn();
    const { container, rerender } = render(<CampoNumero value={0} onTesto={onTesto} />);
    const campo = container.querySelector("input")!;
    scriviAMeta(campo);
    expect(onTesto).not.toHaveBeenCalled();
    rerender(<CampoNumero value={0} onTesto={onTesto} />);
    expect(campo.value).toBe("");
    fireEvent.change(campo, { target: { value: "-5" } });
    expect(onTesto).toHaveBeenCalledWith("-5");
  });

  it("svuotato davvero arriva vuoto, resta vuoto mentre si scrive, e all'uscita torna il valore", () => {
    const onTesto = vi.fn();
    const { container, rerender } = render(<CampoNumero value={7} onTesto={onTesto} />);
    const campo = container.querySelector("input")!;
    fireEvent.change(campo, { target: { value: "" } });
    expect(onTesto).toHaveBeenCalledWith("");
    rerender(<CampoNumero value={0} onTesto={onTesto} />);
    expect(campo.value).toBe("");
    fireEvent.blur(campo);
    expect(campo.value).toBe("0");
  });

  it("il Min dello slider accetta -50 da tastiera", () => {
    const obj = { id: "s", type: "slider", x: 0, y: 0, width: 300, height: 60 } as SynopticObject;
    const onChange = vi.fn();
    let trovato = false;
    for (const gruppo of GRUPPI_PROPRIETA) {
      const { unmount } = render(
        <GruppoAttivo.Provider value={gruppo.id}>
          <ObjectProps obj={obj} pages={[]} functions={[]} onChange={onChange} onDelete={() => {}} />
        </GruppoAttivo.Provider>,
      );
      for (let giro = 0; giro < 8; giro++) {
        const chiuse = screen.queryAllByRole("button", { expanded: false });
        if (chiuse.length === 0) break;
        for (const b of chiuse) fireEvent.click(b);
      }
      const etichetta = screen.queryAllByText("Min", { exact: true })[0];
      const campo = etichetta?.parentElement?.querySelector("input");
      if (campo) {
        trovato = true;
        scriviAMeta(campo);
        expect(onChange).not.toHaveBeenCalled();
        fireEvent.change(campo, { target: { value: "-50" } });
        expect(onChange).toHaveBeenCalledWith({ min: -50 });
      }
      unmount();
      if (trovato) break;
    }
    expect(trovato).toBe(true);
  });
});
