/** L'anteprima dell'immagine nel pannello proprietà (10-11-2026): una foto del
 *  progetto non si inverte più (era un negativo), un'icona del catalogo sì, e
 *  un clic apre l'immagine intera in una scheda nuova. */
import { render, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { AnteprimaImmagine, eIconaDelCatalogo } from "../src/canvas/ImmagineSvg";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("AnteprimaImmagine", () => {
  it("le icone del catalogo sono quelle sotto /images/, le foto del progetto no", () => {
    expect(eIconaDelCatalogo("/images/hvac/fan.svg")).toBe(true);
    expect(eIconaDelCatalogo("/api/project/images/ai-sfondo-notte.jpg")).toBe(false);
    expect(eIconaDelCatalogo(undefined)).toBe(false);
  });

  it("un'icona del catalogo si inverte, e un clic la apre in una scheda nuova", () => {
    const apri = vi.spyOn(window, "open").mockReturnValue(null);
    const r = render(<AnteprimaImmagine src="/images/hvac/fan.svg" titolo="Apri" />);
    const img = r.container.querySelector("img") as HTMLImageElement;
    expect(img.style.filter).toContain("invert");
    fireEvent.click(r.getByTestId("anteprima-immagine"));
    expect(apri).toHaveBeenCalledWith("/images/hvac/fan.svg", "_blank", "noopener");
  });
});
