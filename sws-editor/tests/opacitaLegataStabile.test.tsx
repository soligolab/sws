/** Un oggetto con l'opacità legata a un tag non si rifà da capo quando il
 *  valore passa per 1: prima il `<g>` dell'opacità compariva e spariva, React
 *  rimontava il corpo e la foto del lago lampeggiava a ogni giro dello slider
 *  (collaudo della 2.25.1, 05-11-2026). */
import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import type { SynopticObject, TagState } from "../src/types";

const foto = {
  id: "lago_giorno", type: "image", x: 0, y: 0, width: 1280, height: 684,
  src: "/api/project/images/lago-giorno.jpg", opacity: 0,
  bindings: { opacity: { tag: "c.giorno_notte", in_min: 0, in_max: 100, out_min: 0, out_max: 1, clamp: true } },
} as unknown as SynopticObject;

const valore = (v: number) => ({ "c.giorno_notte": { value: v, quality: "Good", timestamp_ms: 1 } as unknown as TagState });

const disegna = (obj: SynopticObject, v: number) => (
  <svg>
    <SvgObject obj={obj} objects={[obj]} tagValues={valore(v)} selected={false} isEditMode={false}
      customSymbols={[]} faceplates={[]} />
  </svg>
);

describe("l'opacità legata a un tag", () => {
  it("passando da 1 a meno di 1 e ritorno, l'immagine resta la stessa", () => {
    const r = render(disegna(foto, 100));
    const prima = r.container.querySelector("image");
    expect(prima).not.toBeNull();
    r.rerender(disegna(foto, 40));
    expect(r.container.querySelector("image")).toBe(prima);
    expect(prima!.closest("g[opacity]")!.getAttribute("opacity")).toBe("0.4");
    r.rerender(disegna(foto, 100));
    expect(r.container.querySelector("image")).toBe(prima);
  });

  it("il <g> dell'opacità legata ha uno strato suo (will-change)", () => {
    const { container } = render(disegna(foto, 40));
    expect((container.querySelector("g[opacity]") as SVGGElement).style.willChange).toBe("opacity");
  });

  it("un oggetto senza legami non porta un <g> in più", () => {
    const fisso = { ...foto, bindings: undefined, opacity: undefined } as unknown as SynopticObject;
    const { container } = render(disegna(fisso, 100));
    expect(container.querySelector("svg > g[opacity]")).toBeNull();
  });
});
