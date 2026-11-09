/** L'occhio sui campi password (09-11-2026, piano
 *  docs/plans/2026-11-09-occhio-sulle-password.md): il componente da solo.
 *
 *  Le regole del maintainer, una per prova: parte nascosta; l'occhio mostra e
 *  il secondo tocco nasconde, senza rubare il fuoco; Invio invia ancora il
 *  modulo e l'occhio non è un submit; smontato riparte nascosto; un valore
 *  mascherato dal server tiene l'occhio spento; il bersaglio è da dito. Dalla
 *  revisione (09-11-2026): lo stato lo dice solo l'etichetta, niente
 *  `aria-pressed`; nei moduli che restano montati l'occhio si richiude
 *  all'invio e quando il valore si svuota. */
import { render, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import "../src/i18n";
import i18n from "../src/i18n";
import { CampoPassword, MASCHERA_SERVER, OCCHIO_PX, dividiStile } from "../src/components/CampoPassword";
import { MASKED } from "../src/config/comuni";

afterEach(cleanup);

const MOSTRA = () => i18n.t("campoPassword.mostra");
const NASCONDI = () => i18n.t("campoPassword.nascondi");

function monta(props: Parameters<typeof CampoPassword>[0] = {}) {
  const r = render(<CampoPassword {...props} />);
  const campo = r.container.querySelector("input") as HTMLInputElement;
  const occhio = r.getByTestId("occhio-password") as HTMLButtonElement;
  return { ...r, campo, occhio };
}

describe("CampoPassword", () => {
  it("parte nascosto, e l'occhio dice che cosa farà", () => {
    const { campo, occhio } = monta({ value: "segreta", onChange: () => {} });
    expect(campo.type).toBe("password");
    expect(occhio.getAttribute("aria-label")).toBe(MOSTRA());
    expect(occhio.getAttribute("title")).toBe(MOSTRA());
  });

  it("l'occhio mostra, il secondo tocco nasconde, e il fuoco resta nel campo", async () => {
    const user = userEvent.setup();
    const { campo, occhio } = monta({ value: "segreta", onChange: () => {} });
    campo.focus();
    await user.click(occhio);
    expect(campo.type).toBe("text");
    expect(occhio.getAttribute("aria-label")).toBe(NASCONDI());
    expect(document.activeElement).toBe(campo);
    await user.click(occhio);
    expect(campo.type).toBe("password");
    expect(occhio.getAttribute("aria-label")).toBe(MOSTRA());
    expect(document.activeElement).toBe(campo);
  });

  it("Invio nel campo invia il modulo; l'occhio non è un submit", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { container, getByTestId } = render(
      <form onSubmit={onSubmit}>
        <CampoPassword defaultValue="" />
        <button type="submit">Entra</button>
      </form>,
    );
    const campo = container.querySelector("input") as HTMLInputElement;
    const occhio = getByTestId("occhio-password") as HTMLButtonElement;
    expect(occhio.type).toBe("button");
    await user.type(campo, "segreta{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    await user.click(occhio);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(campo.value).toBe("segreta");
  });

  it("Invio invia anche senza bottone di submit: l'occhio non conta come secondo campo", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { container } = render(<form onSubmit={onSubmit}><CampoPassword defaultValue="" /></form>);
    await user.type(container.querySelector("input")!, "x{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("le prop di un input passano al campo: onKeyDown, autoComplete, testid, ref", () => {
    const onKeyDown = vi.fn();
    const ref = createRef<HTMLInputElement>();
    const { container } = render(
      <CampoPassword value="" onChange={() => {}} onKeyDown={onKeyDown} autoComplete="current-password"
        data-testid="pw" ref={ref} placeholder="••••" />,
    );
    const campo = container.querySelector("input") as HTMLInputElement;
    expect(campo.getAttribute("data-testid")).toBe("pw");
    expect(campo.getAttribute("autocomplete")).toBe("current-password");
    expect(campo.getAttribute("placeholder")).toBe("••••");
    expect(ref.current).toBe(campo);
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });

  it("smontato e rimontato riparte nascosto", async () => {
    const user = userEvent.setup();
    const primo = monta({ value: "segreta", onChange: () => {} });
    await user.click(primo.occhio);
    expect(primo.campo.type).toBe("text");
    primo.unmount();
    const secondo = monta({ value: "segreta", onChange: () => {} });
    expect(secondo.campo.type).toBe("password");
    expect(secondo.occhio.getAttribute("aria-label")).toBe(MOSTRA());
  });

  it("un valore mascherato dal server tiene l'occhio spento; quello che si scrive dopo si può mostrare", async () => {
    const user = userEvent.setup();
    expect(MASKED).toBe(MASCHERA_SERVER);
    const { campo, occhio, rerender } = monta({ value: MASKED, onChange: () => {} });
    expect(campo.type).toBe("password");
    expect(occhio.disabled).toBe(true);
    await user.click(occhio);
    expect(campo.type).toBe("password");
    expect(occhio.getAttribute("aria-label")).toBe(MOSTRA());
    rerender(<CampoPassword value="nuova" onChange={() => {}} />);
    expect(occhio.disabled).toBe(false);
    await user.click(occhio);
    expect(campo.type).toBe("text");
  });

  it("se il valore torna mascherato mentre è in chiaro, si richiude e resta chiuso", async () => {
    const user = userEvent.setup();
    const { campo, occhio, rerender } = monta({ value: "nuova", onChange: () => {} });
    await user.click(occhio);
    expect(campo.type).toBe("text");
    rerender(<CampoPassword value={MASKED} onChange={() => {}} />);
    expect(campo.type).toBe("password");
    rerender(<CampoPassword value="altra" onChange={() => {}} />);
    expect(campo.type).toBe("password");
  });

  it("lo stato lo dice l'etichetta, non aria-pressed: una cosa sola per il lettore di schermo", async () => {
    const user = userEvent.setup();
    const { occhio } = monta({ value: "segreta", onChange: () => {} });
    expect(occhio.hasAttribute("aria-pressed")).toBe(false);
    await user.click(occhio);
    expect(occhio.hasAttribute("aria-pressed")).toBe(false);
    expect(occhio.getAttribute("aria-label")).toBe(NASCONDI());
  });

  it("inviato il modulo, la password torna nascosta anche se il campo resta montato", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    const { container, getByTestId } = render(
      <form onSubmit={onSubmit}><CampoPassword value="segreta" onChange={() => {}} /></form>,
    );
    const campo = container.querySelector("input") as HTMLInputElement;
    const occhio = getByTestId("occhio-password") as HTMLButtonElement;
    await user.click(occhio);
    expect(campo.type).toBe("text");
    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(campo.type).toBe("password");
    expect(occhio.getAttribute("aria-label")).toBe(MOSTRA());
  });

  it("svuotato il valore dal modulo (utente creato col bottone), la password torna nascosta", async () => {
    const user = userEvent.setup();
    const { campo, occhio, rerender } = monta({ value: "segreta", onChange: () => {} });
    await user.click(occhio);
    expect(campo.type).toBe("text");
    rerender(<CampoPassword value="" onChange={() => {}} />);
    expect(campo.type).toBe("password");
    // Quello che si scrive dopo parte nascosto, come la prima volta.
    rerender(<CampoPassword value="n" onChange={() => {}} />);
    expect(campo.type).toBe("password");
  });

  it("col campo disabilitato anche l'occhio lo è", () => {
    const { occhio } = monta({ value: "x", onChange: () => {}, disabled: true });
    expect(occhio.disabled).toBe(true);
  });

  it("il bersaglio è da dito: 40×40 anche se il campo è più basso", () => {
    const { occhio } = monta({ value: "x", onChange: () => {} });
    expect(OCCHIO_PX).toBeGreaterThanOrEqual(40);
    expect(occhio.style.width).toBe(`${OCCHIO_PX}px`);
    expect(occhio.style.minHeight).toBe(`${OCCHIO_PX}px`);
    expect(occhio.style.position).toBe("absolute");
  });

  it("lo stile si divide: il posto al contenitore, l'aspetto al campo, che lascia spazio all'occhio", () => {
    const stile = { background: "#000", padding: "4px 8px", width: 120, flex: 1, marginTop: 4, gridColumn: "1 / -1" };
    const { posto, campo } = dividiStile(stile);
    expect(posto).toEqual({ width: 120, flex: 1, marginTop: 4, gridColumn: "1 / -1" });
    expect(campo).toEqual({ background: "#000", padding: "4px 8px" });

    const r = monta({ value: "x", onChange: () => {}, style: stile });
    const contenitore = r.campo.parentElement as HTMLElement;
    expect(contenitore.style.width).toBe("120px");
    expect(contenitore.style.position).toBe("relative");
    expect(r.campo.style.width).toBe("100%");
    expect(r.campo.style.paddingRight).toBe(`${OCCHIO_PX}px`);
    expect(r.campo.style.boxSizing).toBe("border-box");
    // Il padding dell'autore resta, salvo il lato destro, che è dell'occhio.
    expect(r.campo.style.padding).toBe(`4px ${OCCHIO_PX}px 4px 8px`);
  });
});
