/** The symbol gallery of the properties panel offers only the symbols of the same kind (plan
 *  docs/plans/2026-11-19-galleria-simboli-stesso-tipo.md): a pump offers pumps, the project's own
 *  first; a library symbol with a project variant is drawn as the variant. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import "../src/i18n/index";
import { SymbolGallery } from "../src/editor/EditorShell";
import { CategorySelect } from "../src/symbols/editor/SymbolEditor";
import { impostaLibreriaPerTest, impostaSimboliProgetto, symbolKind } from "../src/symbols/lib/libreria";
import type { ManifestLib, SimboloLib } from "../src/symbols/lib/manifest";

const LIB = resolve(__dirname, "../public/symbols/lib");
const manifesto = JSON.parse(readFileSync(resolve(LIB, "manifest.json"), "utf8")) as ManifestLib;
const file = Object.fromEntries(manifesto.symbols.map((s) => [s.file, readFileSync(resolve(LIB, s.file), "utf8")]));
const pompa = manifesto.symbols.find((s) => s.id === "lib:process/centrifugal-pump")!;
const pumps = manifesto.symbols.filter((s) => s.kind === "pumps").map((s) => s.id);

const project = (id: string, kind: string, extra: Partial<SimboloLib> = {}): SimboloLib => ({
  ...pompa, id, file: `prj/${id.slice(4)}.svg`, family: "project", kind, label: id,
  labels: { it: id, en: id }, replaces: undefined, ...extra,
});
const variant = project("prj:pompa-modificata", "pumps", { overrides: "lib:process/centrifugal-pump" });
const copy = project("prj:pompa-dosatrice", "pumps");
const fresh = project("prj:nuovo", "project");

beforeEach(() => {
  act(() => {
    impostaLibreriaPerTest(manifesto, file);
    impostaSimboliProgetto([variant, copy, fresh].map((voce) => ({ voce, svg: file["process/centrifugal-pump.svg"] })));
  });
});
afterEach(cleanup);

const tiles = () => screen.queryAllByTestId(/^symbol-tile-/).map((e) => e.getAttribute("data-testid")!.slice("symbol-tile-".length));

describe("the kind of a symbol", () => {
  it("library ids, old aliases, variants, copies, new symbols, imported SVGs", () => {
    expect(symbolKind(manifesto, "lib:process/centrifugal-pump")).toBe("pumps");
    expect(symbolKind(manifesto, "pump")).toBe("pumps");
    expect(symbolKind(manifesto, "lib:process/ball-valve")).toBe("valves");
    expect(symbolKind(manifesto, "prj:pompa-modificata")).toBe("pumps");
    expect(symbolKind(manifesto, "prj:pompa-dosatrice")).toBe("pumps");
    expect(symbolKind(manifesto, "prj:nuovo")).toBe("project");
    expect(symbolKind(manifesto, "custom:logo")).toBe("custom");
    expect(symbolKind(manifesto, "prj:sparito")).toBeNull();
    expect(symbolKind(manifesto, "zzz")).toBeNull();
  });
});

describe("the gallery of the properties panel", () => {
  it("a pump offers the pumps only: the project's copy first, then the library's", () => {
    render(<SymbolGallery value="lib:process/centrifugal-pump" onlyKindOf="lib:process/centrifugal-pump" onChange={() => {}} />);
    expect(tiles()).toEqual(["prj:pompa-dosatrice", ...pumps]);
  });

  it("the library pump with a variant is drawn as the variant, marked, and stays selected", () => {
    render(<SymbolGallery value="lib:process/centrifugal-pump" onlyKindOf="lib:process/centrifugal-pump" onChange={() => {}} />);
    const tile = screen.getByTestId("symbol-tile-lib:process/centrifugal-pump");
    expect(tile.getAttribute("title")).toMatch(/modificato nel progetto|changed in the project/);
    expect(screen.getByTestId("symbol-tile-lib:process/gear-pump").getAttribute("title")).not.toMatch(/progetto|project/);
  });

  it("an old alias and a copy find the same pumps", () => {
    render(<SymbolGallery value="pump" onlyKindOf="pump" onChange={() => {}} />);
    expect(tiles()).toEqual(["prj:pompa-dosatrice", ...pumps]);
    cleanup();
    render(<SymbolGallery value="prj:pompa-dosatrice" onlyKindOf="prj:pompa-dosatrice" onChange={() => {}} />);
    expect(tiles()).toEqual(["prj:pompa-dosatrice", ...pumps]);
  });

  it("a new project symbol offers the project symbols of its kind", () => {
    render(<SymbolGallery value="prj:nuovo" onlyKindOf="prj:nuovo" onChange={() => {}} />);
    expect(tiles()).toEqual(["prj:nuovo"]);
  });

  it("a click writes the id; the search stays inside the kind", () => {
    const onChange = vi.fn();
    render(<SymbolGallery value="lib:process/centrifugal-pump" onlyKindOf="lib:process/centrifugal-pump" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("symbol-tile-lib:process/gear-pump"));
    expect(onChange).toHaveBeenCalledWith("lib:process/gear-pump");
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "valve" } });
    expect(tiles()).toEqual([]);
  });

  it("without a kind (the picker at insertion) the whole library", () => {
    render(<SymbolGallery value="lib:process/centrifugal-pump" onChange={() => {}} />);
    expect(tiles().length).toBe(manifesto.symbols.length);
  });
});

describe("the category of the symbol editor", () => {
  it("lists the library's kinds and writes the one chosen", () => {
    const onChange = vi.fn();
    render(<CategorySelect value="project" onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const values = [...select.options].map((o) => o.value);
    expect(values[0]).toBe("project");
    expect(values).toContain("pumps");
    expect(values).toContain("valves");
    expect(values[values.length - 1]).toBe("__other");
    fireEvent.change(select, { target: { value: "pumps" } });
    expect(onChange).toHaveBeenCalledWith("pumps");
  });

  it("a kind that isn't in the list reads as «Other» with its text", () => {
    const onChange = vi.fn();
    render(<CategorySelect value="lighting" onChange={onChange} />);
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("__other");
    const text = screen.getByRole("textbox") as HTMLInputElement;
    expect(text.value).toBe("lighting");
    fireEvent.change(text, { target: { value: "Luci Esterne" } });
    expect(onChange).toHaveBeenCalledWith("luci-esterne");
  });
});
