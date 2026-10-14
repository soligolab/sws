/** I simboli di libreria sul canvas web (Fase 2 del piano
 *  docs/plans/2026-10-14-motore-simboli-lib.md): strati con id unici per istanza,
 *  corpo del colore di stato solo se lo stato è legato, livello ritagliato dal
 *  tag, rotore che gira sul centro del manifesto, clic che seleziona anche sopra
 *  le forme dei builtin. */
import { render, fireEvent, act } from "@testing-library/react";
import { describe, it, expect, beforeAll, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SvgObject } from "../src/canvas/SvgCanvas";
import { impostaLibreriaPerTest, preparaSimbolo, prefissaId, stileDelDisegno } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import type { SynopticObject } from "../src/types";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
const file = Object.fromEntries(manifesto.symbols.map((s) => [s.file, readFileSync(resolve(LIB, s.file), "utf8")]));

beforeAll(() => { act(() => impostaLibreriaPerTest(manifesto, file)); });

function simbolo(id: string, extra: Partial<SynopticObject> = {}): SynopticObject {
  return { id: "s1", type: "symbol", x: 10, y: 20, width: 80, height: 80, symbol_id: id, ...extra } as SynopticObject;
}

function disegna(obj: SynopticObject, tagValues: Record<string, { value: unknown }> = {}, extra: Record<string, unknown> = {}) {
  return render(
    <svg>
      <SvgObject obj={obj} objects={[obj]} tagValues={tagValues as never} selected={false} isEditMode={false}
        customSymbols={[]} faceplates={[]} {...extra} />
    </svg>,
  );
}

describe("preparazione", () => {
  it("gli id diventano unici per istanza, riferimenti compresi", () => {
    expect(prefissaId('<use href="#a-g1" fill="url(#a-paint-r)"/><g id="body">', "sl-x"))
      .toBe('<use href="#sl-x-a-g1" fill="url(#sl-x-a-paint-r)"/><g id="sl-x-body">');
  });

  it("la pompa si divide nei suoi strati, nell'ordine del disegno", () => {
    const p = preparaSimbolo(file["process/centrifugal-pump.svg"], "sl-p", stileDelDisegno(manifesto, null));
    expect(p.strati.map((s) => s.id)).toEqual(["layer-0", "body", "layer-1", "rotor"]);
    expect(p.strati.find((s) => s.id === "rotor")!.parte).toBe(true);
    expect(p.viewBox).toBe("0 0 80 80");
    expect(p.defs).toContain('id="sl-p-centrifugal-pump-paint-r"');
  });

  it("il colore del corpo vince sul materiale solo nello strato body", () => {
    const p = preparaSimbolo(file["process/centrifugal-pump.svg"], "sl-p", stileDelDisegno(manifesto, "#22c55e"));
    expect(p.strati.find((s) => s.id === "body")!.markup).toContain('fill="#22c55e"');
    expect(p.strati.find((s) => s.id === "layer-0")!.markup).not.toContain("#22c55e");
  });
});

describe("sul canvas", () => {
  it("due pompe nella stessa pagina non condividono gradienti", () => {
    const a = simbolo("lib:process/centrifugal-pump", { id: "p1" });
    const b = simbolo("lib:process/centrifugal-pump", { id: "p2" });
    const { container } = render(
      <svg>
        <SvgObject obj={a} objects={[a, b]} tagValues={{}} selected={false} isEditMode={false} customSymbols={[]} faceplates={[]} />
        <SvgObject obj={b} objects={[a, b]} tagValues={{}} selected={false} isEditMode={false} customSymbols={[]} faceplates={[]} />
      </svg>,
    );
    const ids = [...container.querySelectorAll("[id]")].map((e) => e.id);
    expect(ids.length).toBeGreaterThan(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("senza stato legato il corpo resta del suo materiale; con lo stato prende il colore", () => {
    const libero = disegna(simbolo("lib:process/centrifugal-pump"));
    expect(libero.container.querySelector('[id$="-body"]')!.getAttribute("fill")).toBe(manifesto.materials["body-pump"]);
    libero.unmount();
    const legato = disegna(simbolo("lib:process/centrifugal-pump", { state_tag: "marcia", state_on_color: "#22c55e" }), { marcia: { value: true } });
    expect(legato.container.querySelector('[id$="-body"]')!.getAttribute("fill")).toBe("#22c55e");
  });

  it("il livello ritaglia la finestra del manifesto dal basso", () => {
    const { container } = disegna(simbolo("lib:process/vertical-tank", { fill_level_tag: "liv" }), { liv: { value: 25 } });
    const parte = manifesto.symbols.find((s) => s.id === "lib:process/vertical-tank")!.parts.find((p) => p.kind === "level")!;
    if (parte.kind !== "level") throw new Error("parte");
    const rect = container.querySelector("clipPath rect")!;
    expect(Number(rect.getAttribute("height"))).toBeCloseTo(parte.h * 0.25);
    expect(Number(rect.getAttribute("y"))).toBeCloseTo(parte.y + parte.h * 0.75);
    expect(container.querySelector('[data-strato="level"]')!.getAttribute("clip-path")).toMatch(/^url\(#sl-s1-clip-level\)$/);
  });

  it("il rotore gira attorno al centro del manifesto, il resto sta fermo", () => {
    const { container } = disegna(simbolo("lib:process/centrifugal-pump", { symbol_spin: "always", symbol_spin_s: 3 }));
    const rotore = container.querySelector('[data-strato="rotor"]') as SVGGElement;
    expect(rotore.style.animation).toContain("sws-spin 3s");
    expect(rotore.style.transformOrigin).toBe("40px 50px");
    expect((container.querySelector('[data-strato="body"]') as SVGGElement).style.animation).toBe("");
  });

  it("un id lib: che il manifesto non conosce mostra il segnaposto", () => {
    const { container } = disegna(simbolo("lib:process/non-esiste"));
    expect(container.textContent).toContain("simbolo?");
  });
});

describe("in edit, il clic seleziona anche sopra le forme del disegno (M10)", () => {
  it.each(["pump", "lib:process/centrifugal-pump"])("%s", (id) => {
    const onSelect = vi.fn();
    const obj = simbolo(id);
    const { container } = render(
      <svg>
        <SvgObject obj={obj} objects={[obj]} tagValues={{}} selected={false} isEditMode={true}
          customSymbols={[]} faceplates={[]} onSelect={onSelect} onStartDrag={() => {}} />
      </svg>,
    );
    // L'ultimo figlio disegnato in quel punto è quello che prende il clic: deve
    // essere il rettangolo trasparente, dopo il contenuto.
    const rettangoli = [...container.querySelectorAll('rect[fill="transparent"]')];
    const ultimo = rettangoli[rettangoli.length - 1];
    const contenuto = container.querySelector("svg svg")!;
    expect(contenuto.compareDocumentPosition(ultimo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.mouseDown(ultimo);
    expect(onSelect).toHaveBeenCalledWith("s1", false);
  });
});

describe("alias dei builtin (Fase 6, M3)", () => {
  it("un oggetto con symbol_id pump si disegna col disegno della libreria", () => {
    const { container } = disegna(simbolo("pump"));
    expect(container.querySelector("[data-simbolo-lib]")!.getAttribute("data-simbolo-lib")).toBe("lib:process/centrifugal-pump");
  });

  it("il disegno nuovo è contenuto e centrato nel riquadro vecchio (M4)", () => {
    const { container } = disegna(simbolo("tank", { width: 80, height: 80 }));
    const svg = container.querySelector("[data-simbolo-lib]")!;
    expect(svg.getAttribute("preserveAspectRatio")).toBe("xMidYMid meet");
    expect(svg.getAttribute("width")).toBe("80");
  });
});

describe("parti vive sul canvas (Fase 3)", () => {
  it("la lancetta ruota col tag fra a0 e a1, sul perno del manifesto", () => {
    const { container } = disegna(
      simbolo("lib:process/pressure-gauge", { symbol_parts: { needle: { tag: "p", min: 0, max: 10 } } }),
      { p: { value: 10 } },
    );
    const g = container.querySelector('[data-strato="needle"]') as SVGGElement;
    expect(g.style.transform).toBe("rotate(135deg)");
    expect(g.style.transformOrigin).toBe("30px 26px");
  });

  it("la leva va in chiusa quando il tag è falso", () => {
    const { container } = disegna(simbolo("lib:process/ball-valve", { symbol_parts: { lever: { tag: "v" } } }), { v: { value: false } });
    expect((container.querySelector('[data-strato="lever"]') as SVGGElement).style.transform).toBe("rotate(-90deg)");
  });

  it("una spia col tag falso si spegne, le altre restano come disegnate", () => {
    const { container } = disegna(
      simbolo("lib:machines/stack-light", { symbol_parts: { "lamp-red": { tag: "a" } } }),
      { a: { value: false } },
    );
    expect(container.querySelector('[data-strato="lamp-red"]')!.getAttribute("opacity")).toBe("0");
    expect(container.querySelector('[data-strato="lamp-green"]')!.getAttribute("opacity")).toBeNull();
  });
});
