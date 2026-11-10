/** Le fasce della cornice si vedono in modifica (10-11-2026): testata e piede
 *  sono riservati alla cornice. Su una pagina con cornice, in modifica, le due
 *  fasce hanno un bordo tratteggiato e un velo, e l'oggetto della pagina che ci
 *  entra si colora di arancio; nel viewer niente. La geometria è quella del
 *  validatore (`oggetti_nelle_fasce` in `cornici.rs`). */
import { render, act } from "@testing-library/react";
import { describe, it, expect, beforeEach } from "vitest";
import "../src/i18n/index";
import { SvgCanvas } from "../src/canvas/SvgCanvas";
import { oggettiNelleFasce } from "../src/cornici/fasce";
import { useAppStore } from "../src/store";
import type { Cornice, SynopticObject } from "../src/types";

const CORNICE: Cornice = {
  id: "base", nome: "Base", larghezza: 1280, altezza: 800,
  testata: { altezza: 56, sfondo: "#1e293b" },
  piede: { altezza: 60 },
  oggetti: [
    { id: "titolo", type: "text", x: 20, y: 8, width: 200, height: 40, text: "{{pagina.nome}}" },
    { id: "nav", type: "page_navigator", x: 10, y: 748, width: 1260, height: 44 },
  ] as SynopticObject[],
};

const rett = (id: string, y: number, h = 30, x = 600) =>
  ({ id, type: "rect", x, y, width: 200, height: h }) as SynopticObject;

const OGGETTI: SynopticObject[] = [
  rett("sottotitolo", 10),      // tutto dentro lo spazio vuoto della testata
  rett("contenuto", 100, 200),  // nell'area libera
  rett("scende", 700, 60),      // a cavallo del bordo del piede
  { id: "tubo", type: "pipe", x: 0, y: 0, points: [{ x: 0, y: 0 }, { x: 10, y: 790 }] } as SynopticObject,
];

const arancio = (c: HTMLElement) =>
  [...c.querySelectorAll("[data-in-fascia]")].map((e) => e.getAttribute("data-in-fascia")).sort();

beforeEach(() => {
  act(() => useAppStore.setState({ project: { tags: [], types: [] } as never, authRole: null }));
});

describe("la geometria delle fasce, gemella del validatore", () => {
  it("anche un oggetto tutto dentro lo spazio vuoto della testata invade; i tubi no", () => {
    const inv = oggettiNelleFasce(OGGETTI, CORNICE);
    expect(inv.map((i) => i.id)).toEqual(["sottotitolo", "scende"]);
    expect(inv[0]).toMatchObject({ testata: true, piede: false, copre: false });
    expect(inv[1]).toMatchObject({ testata: false, piede: true, copre: true });
  });

  it("un testo senza riquadro ha y sulla linea di base", () => {
    const t = { id: "t", type: "text", x: 600, y: 70, text: "Ciao", font_size: 20 } as SynopticObject;
    expect(oggettiNelleFasce([t], CORNICE).map((i) => i.id)).toEqual(["t"]);
    expect(oggettiNelleFasce([{ ...t, y: 80 }], CORNICE)).toEqual([]);
  });
});

describe("le fasce in modifica", () => {
  it("la pagina con cornice ha testata e piede tratteggiati, col velo", () => {
    const { container } = render(
      <SvgCanvas objects={OGGETTI} onMove={() => {}} pageWidth={1280} pageHeight={800} corniceDellaPagina={CORNICE} />,
    );
    const testata = container.querySelector("[data-testid='fascia-testata']")!;
    const piede = container.querySelector("[data-testid='fascia-piede']")!;
    expect(testata.getAttribute("height")).toBe("56");
    expect(piede.getAttribute("y")).toBe("740");
    expect(piede.getAttribute("height")).toBe("60");
    for (const f of [testata, piede]) {
      expect(f.getAttribute("stroke-dasharray")).toBeTruthy();
      expect(Number(f.getAttribute("fill-opacity"))).toBeGreaterThan(0);
    }
  });

  it("l'oggetto nella fascia è arancio, quello nell'area libera no", () => {
    const { container } = render(
      <SvgCanvas objects={OGGETTI} onMove={() => {}} pageWidth={1280} pageHeight={800} corniceDellaPagina={CORNICE} />,
    );
    expect(arancio(container)).toEqual(["scende", "sottotitolo"]);
    const r = container.querySelector("[data-in-fascia='sottotitolo']")!;
    expect(r.getAttribute("class")).toBe("sws-in-fascia");
    expect(r.getAttribute("stroke")).toContain("--brand-warning");
  });

  it("nel viewer niente: né fasce né arancio", () => {
    const { container } = render(
      <SvgCanvas objects={OGGETTI} pageWidth={1280} pageHeight={800} corniceDellaPagina={CORNICE} />,
    );
    expect(container.querySelector("[data-testid='fasce-pagina']")).toBeNull();
    expect(arancio(container)).toEqual([]);
  });

  it("senza cornice niente, anche in modifica", () => {
    const { container } = render(
      <SvgCanvas objects={OGGETTI} onMove={() => {}} pageWidth={1280} pageHeight={800} />,
    );
    expect(container.querySelector("[data-testid='fasce-pagina']")).toBeNull();
    expect(arancio(container)).toEqual([]);
  });
});
