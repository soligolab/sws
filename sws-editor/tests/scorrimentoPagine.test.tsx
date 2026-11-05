/** Il cambio di pagina col dito (scorrimentoPagine.ts): non scatta quando il
 *  dito parte su uno slider — trascinarlo verso destra tornava alla pagina
 *  precedente (collaudo della 2.25.1, 05-11-2026). */
import { render, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import {
  paginaDopoScorrimento, partitoSuUnGestoProprio, useScorrimentoPagine,
} from "../src/runtime-view/scorrimentoPagine";
import type { SynopticObject } from "../src/types";

const pagine = [{ id: "p1" }, { id: "p2" }, { id: "p3" }];

describe("paginaDopoScorrimento", () => {
  it("verso sinistra la pagina dopo, verso destra quella prima", () => {
    expect(paginaDopoScorrimento(pagine, "p2", -80)).toBe("p3");
    expect(paginaDopoScorrimento(pagine, "p2", 80)).toBe("p1");
  });

  it("sotto i 50 px, ai bordi e su una pagina fuori elenco resta dov'è", () => {
    expect(paginaDopoScorrimento(pagine, "p2", 49)).toBeNull();
    expect(paginaDopoScorrimento(pagine, "p1", 80)).toBeNull();
    expect(paginaDopoScorrimento(pagine, "p3", -80)).toBeNull();
    expect(paginaDopoScorrimento(pagine, "boot", -80)).toBeNull();
  });
});

describe("partitoSuUnGestoProprio", () => {
  it("vale dentro un elemento con data-gesto-proprio, e solo lì", () => {
    const fuori = document.createElement("div");
    const dentro = document.createElement("span");
    const area = document.createElement("div");
    area.setAttribute("data-gesto-proprio", "");
    area.appendChild(dentro);
    expect(partitoSuUnGestoProprio(dentro)).toBe(true);
    expect(partitoSuUnGestoProprio(fuori)).toBe(false);
    expect(partitoSuUnGestoProprio(null)).toBe(false);
  });
});

const slider = { id: "s1", type: "slider", x: 0, y: 0, width: 200, height: 50, tag: "t", min: 0, max: 1 } as SynopticObject;

function Pagina({ vai }: { vai: (id: string) => void }) {
  const scorrimento = useScorrimentoPagine(pagine, "p2", vai);
  return (
    <div data-testid="pagina" onTouchStart={scorrimento.onTouchStart} onTouchEnd={scorrimento.onTouchEnd}>
      <svg>
        <SvgObject obj={slider} objects={[slider]} tagValues={{}} selected={false} isEditMode={false}
          customSymbols={[]} faceplates={[]} onWriteTag={vi.fn()} />
      </svg>
    </div>
  );
}

const scorri = (el: Element, da: number, a: number) => {
  fireEvent.touchStart(el, { touches: [{ clientX: da, clientY: 10 }] });
  fireEvent.touchEnd(el, { changedTouches: [{ clientX: a, clientY: 10 }] });
};

describe("lo scorrimento sulla pagina", () => {
  it("trascinare lo slider verso destra non cambia pagina", () => {
    const vai = vi.fn();
    const { container } = render(<Pagina vai={vai} />);
    const area = container.querySelector("[data-slider-area]")!;
    expect(area.hasAttribute("data-gesto-proprio")).toBe(true);
    scorri(area, 20, 180);
    scorri(area, 180, 20);
    expect(vai).not.toHaveBeenCalled();
  });

  it("fuori dallo slider lo scorrimento cambia pagina come prima", () => {
    const vai = vi.fn();
    const { getByTestId } = render(<Pagina vai={vai} />);
    scorri(getByTestId("pagina"), 20, 180);
    expect(vai).toHaveBeenCalledWith("p1");
  });
});

describe("il dito resta allo slider", () => {
  it("un touchmove sull'area dello slider non diventa uno scorrimento", () => {
    const { container } = render(<Pagina vai={vi.fn()} />);
    const area = container.querySelector("[data-slider-area]")!;
    const mossa = new Event("touchmove", { bubbles: true, cancelable: true });
    area.dispatchEvent(mossa);
    expect(mossa.defaultPrevented).toBe(true);
  });

  it("fuori dallo slider il touchmove resta del browser", () => {
    const { getByTestId } = render(<Pagina vai={vi.fn()} />);
    const mossa = new Event("touchmove", { bubbles: true, cancelable: true });
    getByTestId("pagina").dispatchEvent(mossa);
    expect(mossa.defaultPrevented).toBe(false);
  });
});
