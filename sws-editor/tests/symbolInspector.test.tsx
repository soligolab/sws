/** The symbol editor's right column follows the selection, and effects are
 *  properties of shapes (plan docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md,
 *  blocks C and D). */
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "../src/i18n/index";
import { api } from "../src/api/client";
import { useAppStore } from "../src/store";
import { rispondi, svuotaCoda, type Richiesta } from "../src/finestraAvviso/finestraAvviso";
import { impostaLibreriaPerTest } from "../src/symbols/lib/libreria";
import type { ManifestLib } from "../src/symbols/lib/manifest";
import { SymbolEditorHost } from "../src/symbols/editor/SymbolEditor";
import {
  addEffect, asPairs, clipPhoto, fillOf, groupOps, matrixOps, membersOf, newRect, normalizeOps, setFill, turnMatrix,
  ungroupOps, unclipPhoto, type Op,
} from "../src/symbols/editor/model";
import { readSymbolFile, SYMBOL_FILE_FORMAT } from "../src/symbols/editor/symbolFile";
import type { DescrizioneSimbolo } from "../src/types";

const manifest = JSON.parse(
  readFileSync(resolve(__dirname, "../public/symbols/lib/manifest.json"), "utf8"),
) as ManifestLib;

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
  <defs>
  </defs>
  <g id="body" data-layer="part" data-mat="body-pump" fill="#2f6fa8">
    <rect x="20" y="20" width="60" height="60" data-op="1"/>
  </g>
</svg>
`;

function compiled(d: DescrizioneSimbolo) {
  return {
    slug: d.slug, ok: true, errori: [], svg: SVG,
    voce: {
      id: `prj:${d.slug}`, file: `prj/${d.slug}.svg`, family: "project", kind: "project", label: d.it,
      viewBox: [d.w, d.h], body: d.body, materials: [], parts: [], labels: { it: d.it, en: d.en },
    },
  } as never;
}

const draft = (ops: Op[]): DescrizioneSimbolo => ({ slug: "stufa", w: 100, h: 100, body: "body-pump", it: "S", en: "S", ops } as DescrizioneSimbolo);

describe("the inspector of the symbol editor", () => {
  beforeEach(() => {
    impostaLibreriaPerTest(manifest, {});
    vi.spyOn(api, "compilaSimboli").mockImplementation(async (ds) => ds.map(compiled));
    vi.spyOn(api, "symbolCatalog").mockResolvedValue({ materials: [{ name: "steel", color: "#9aa5af" }], veils: [] });
    act(() => {
      useAppStore.getState().setProject({ name: "p", tags: [], simboli: [] } as never);
      useAppStore.getState().closeSymbolEditor();
    });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => { svuotaCoda(); });
    act(() => useAppStore.getState().closeSymbolEditor());
  });

  /** `answer` given to every question of `action`; the questions asked. */
  const answering = async (answer: unknown, action: () => void): Promise<Richiesta[]> => {
    const auto = rispondi(answer);
    try { await act(async () => { action(); }); } finally { auto.ferma(); }
    return auto.chiamate;
  };
  /** What «Save» writes: the description as the editor has it. */
  const written = async (): Promise<Op[]> => {
    const save = vi.spyOn(api, "updateSimboli").mockResolvedValue(undefined);
    await waitFor(() => expect(screen.getByTestId("symbol-editor-save").hasAttribute("disabled")).toBe(false));
    await answering(true, () => fireEvent.click(screen.getByTestId("symbol-editor-save")));
    return save.mock.calls.at(-1)![0].find((x) => x.slug === "stufa")!.ops as Op[];
  };
  const addFx = (kind: string) => fireEvent.change(screen.getByTestId("symbol-fx-add"), { target: { value: kind } });

  it("shows the symbol with nothing selected, the selection otherwise; an effect asks the name of its new input", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })]), isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    expect(screen.getByTestId("symbol-section-inputs")).toBeTruthy();
    expect(screen.getByTestId("symbol-section-ai-photo")).toBeTruthy();
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    expect(screen.queryByTestId("symbol-section-inputs")).toBeNull();
    // No input yet: its name is asked, «acceso» offered (test of the rc.29:
    // it was made in silence), and the flame follows it.
    const asked = await answering("acceso", () => addFx("flame"));
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({ tipo: "chiedi", iniziale: i18n.t("symbolEditor.fx.inputName") });
    await waitFor(() => expect(screen.getByTestId("symbol-fx-flame")).toBeTruthy());
    expect((screen.getByTestId("symbol-fx-input-flame") as HTMLSelectElement).value).toBe("acceso");
    // The question checks what is typed (`rispondi` doesn't: called by hand).
    const valida = (asked[0] as { valida: (v: string) => string | null }).valida;
    expect(valida(" Fuoco ")).toBeNull();
    expect(valida("body")).toBe(i18n.t("symbolEditor.id.reserved"));
    expect(valida("-in")).toBe(i18n.t("symbolEditor.id.rule"));
    // «Symbol» clears the selection.
    fireEvent.click(screen.getByTestId("symbol-tab-structure"));
    expect(screen.getByTestId("symbol-section-inputs")).toBeTruthy();
    expect(screen.getByTestId("symbol-input-row-acceso")).toBeTruthy();
  });

  it("Cancel on the name makes neither the effect nor the input", async () => {
    const ops: Op[] = [{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })];
    act(() => useAppStore.getState().openSymbolEditor({ draft: draft(ops), isNew: true }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    expect(await answering(null, () => addFx("flame"))).toHaveLength(1);
    expect(screen.queryByTestId("symbol-fx-flame")).toBeNull();
    expect(await written()).toEqual(ops);
  });

  it("two effects with two new inputs stay each on its own; a third one asks again", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 10, y: 10, w: 20, h: 20 }), newRect({ x: 60, y: 60, w: 20, h: 20 })]), isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    // The name offered is taken: «acceso» (it), «on» (en).
    const on = i18n.t("symbolEditor.fx.inputName");
    await answering((r: Richiesta) => (r as { iniziale: string }).iniziale, () => addFx("flame"));
    // The input went first: the second shape is the operation 3 now.
    fireEvent.click(screen.getByTestId("symbol-op-row-3"));
    const asked = await answering((r: Richiesta) => (r.tipo === "scegli" ? "__new__" : "fumo"), () => addFx("smoke"));
    expect(asked.map((r) => r.tipo)).toEqual(["scegli", "chiedi"]);
    // The choices: the inputs, kind · name, and a new one.
    expect((asked[0] as { scelte: { etichetta: string }[] }).scelte.map((s) => s.etichetta))
      .toEqual([`${i18n.t("symbolEditor.input.input")} · ${on}`, i18n.t("symbolEditor.fx.newInput")]);
    expect((asked[1] as { iniziale: string }).iniziale).toBe(`${on}-2`);
    // A third effect asks again, and takes what is chosen, not the newest
    // input. The second input went after the first: the first shape is 3 now.
    fireEvent.click(screen.getByTestId("symbol-op-row-3"));
    const third = await answering((r: Richiesta) => (r.tipo === "scegli" ? on : null), () => addFx("bubbles"));
    expect(third.map((r) => r.tipo)).toEqual(["scegli"]);
    const ops = await written();
    expect(ops.slice(0, 2)).toEqual([{ op: "ingresso", id: on }, { op: "ingresso", id: "fumo" }]);
    expect(ops.filter((o) => o.op === "effetto").map((o) => [o.kind, o.group, o.input])).toEqual([
      ["flame", i18n.t("symbolEditor.fx.groupName.flame"), on],
      ["smoke", i18n.t("symbolEditor.fx.groupName.smoke"), "fumo"],
      ["bubbles", i18n.t("symbolEditor.fx.groupName.flame"), on],
    ]);
  });

  it("with only some shapes of a group selected, «Add effect» waits for the whole group", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, { ...newRect({ x: 10, y: 10, w: 20, h: 20 }), group: "stufa" },
        { ...newRect({ x: 60, y: 60, w: 20, h: 20 }), group: "stufa" }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    // The list still picks one shape of a group.
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    expect((screen.getByTestId("symbol-fx-add") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByTestId("symbol-fx-whole-group")).toBeTruthy();
  });

  it("a drawing changed while the question is open: nothing is made, the change stays", async () => {
    const ops: Op[] = [{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })];
    act(() => useAppStore.getState().openSymbolEditor({ draft: draft(ops), isNew: true }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-1"));
    act(() => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
    // The answer waits; meanwhile the move is undone (as an AI proposal
    // arriving would change the drawing).
    let answer!: (v: string) => void;
    const auto = rispondi(() => new Promise<string>((r) => { answer = r; }));
    try {
      await act(async () => { addFx("flame"); });
      act(() => { fireEvent.keyDown(window, { key: "z", ctrlKey: true }); });
      await act(async () => { answer("acceso"); });
    } finally { auto.ferma(); }
    expect(await written()).toEqual(ops);
  });

  it("an input renamed in «Inputs» takes its effects along; removed, its effects are listed and go with it", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "ingresso", id: "acceso" }, { op: "corpo" }, { ...newRect({ x: 20, y: 20, w: 60, h: 60 }), group: "fiamma" },
        { op: "effetto", kind: "flame", group: "fiamma", input: "acceso" }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    const name = screen.getByTestId("symbol-input-name-acceso") as HTMLInputElement;
    // A name that can't be: said under the field, and the field goes back.
    fireEvent.change(name, { target: { value: "-x" } });
    expect(screen.getByTestId("symbol-input-name-error").textContent).toBe(i18n.t("symbolEditor.id.rule"));
    fireEvent.blur(name);
    expect(name.value).toBe("acceso");
    // One rename, with Enter (before, one at every letter).
    name.focus();
    fireEvent.change(name, { target: { value: "fuoco" } });
    expect(screen.getByTestId("symbol-input-row-acceso")).toBeTruthy();
    fireEvent.keyDown(name, { key: "Enter" });
    expect(screen.getByTestId("symbol-input-row-fuoco")).toBeTruthy();
    expect((await written()).filter((o) => o.op === "effetto").map((o) => o.input)).toEqual(["fuoco"]);
    // Removed: the flame that follows it is listed, and goes too.
    const asked = await answering(true, () => fireEvent.click(screen.getByTestId("symbol-input-remove-fuoco")));
    expect(asked).toHaveLength(1);
    expect(asked[0].tipo).toBe("conferma");
    expect((asked[0] as { testo: string }).testo).toContain("«fiamma»");
    expect(screen.queryByTestId("symbol-input-row-fuoco")).toBeNull();
    expect((await written()).some((o) => o.op === "effetto" || o.op === "ingresso")).toBe(false);
  });

  it("«Add» in «Inputs» asks the name of every input but the body; an «Input» is an `ingresso`", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 })]), isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    const addKind = async (kind: string, answer: unknown) => {
      fireEvent.change(screen.getByTestId("symbol-input-kind"), { target: { value: kind } });
      return answering(answer, () => fireEvent.click(screen.getByTestId("symbol-input-add")));
    };
    expect(await addKind("input", null)).toHaveLength(1);
    expect(screen.queryByTestId(/^symbol-input-row-(?!state)/)).toBeNull();
    expect(await addKind("input", "Fuoco")).toHaveLength(1);
    expect(screen.getByTestId("symbol-input-row-fuoco")).toBeTruthy();
    expect((await addKind("rotor", "ventola"))[0]).toMatchObject({ tipo: "chiedi", iniziale: "rotor" });
    const ops = await written();
    expect(ops[0]).toEqual({ op: "ingresso", id: "fuoco" });
    expect(ops.some((o) => o.op === "parte" && o.kind === "input")).toBe(false);
    expect(ops.some((o) => o.op === "parte" && o.id === "ventola" && o.kind === "rotor")).toBe(true);
  });

  it("gives the cut shape back, and selecting it alone does not stop the editor (rc.29: e.find is not a function)", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 }),
        { op: "image", src: "a.png", geo: [["x", 0], ["y", 0], ["width", 50], ["height", 50]],
          clip: { tag: "ellipse", geo: [["cx", 25], ["cy", 25], ["rx", 20], ["ry", 10]] } }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-2"));
    fireEvent.click(screen.getByTestId("symbol-unclip"));
    // The shape is back right after the photo: selected alone, the column
    // reads its colour.
    fireEvent.click(screen.getByTestId("symbol-op-row-3"));
    expect(screen.queryByTestId("symbol-editor-crashed")).toBeNull();
    expect(screen.getByTestId("symbol-op-row-3").getAttribute("aria-selected")).toBe("true");
  });

  it("opens a symbol whose attributes are written as objects (the compiler accepts them)", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 }),
        { op: "forma", tag: "ellipse", geo: { cx: 25, cy: 25, rx: 20, ry: 10 }, extra: { fill: "none" } }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-2"));
    expect(screen.queryByTestId("symbol-editor-crashed")).toBeNull();
    // Turned, it moves like any other shape.
    fireEvent.click(screen.getByTestId("symbol-turn-cw"));
    expect(screen.queryByTestId("symbol-editor-crashed")).toBeNull();
  });

  it("says that a photo doesn't turn, instead of doing nothing", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 }),
        { op: "image", src: "a.png", geo: [["x", 0], ["y", 0], ["width", 50], ["height", 50]] }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(api.compilaSimboli).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("symbol-op-row-2"));
    expect((screen.getByTestId("symbol-turn-cw") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("symbol-turn-photo")).toBeTruthy();
  });

  it("takes the effect parts of before out, and says so", async () => {
    act(() => useAppStore.getState().openSymbolEditor({
      draft: draft([{ op: "corpo" }, newRect({ x: 20, y: 20, w: 60, h: 60 }), { op: "parte", id: "neon", kind: "glow", geo: {} }]),
      isNew: true,
    }));
    render(<SymbolEditorHost />);
    await waitFor(() => expect(screen.getByTestId("symbol-editor-old-fx")).toBeTruthy());
  });
});

describe("groups, effects and masks in the model", () => {
  const ops: Op[] = [{ op: "corpo" }, newRect({ x: 0, y: 0, w: 10, h: 10 }), newRect({ x: 20, y: 0, w: 10, h: 10 }),
    { op: "image", src: "a.png", geo: [["x", 0], ["y", 0], ["width", 50], ["height", 50]] },
    { op: "forma", tag: "circle", geo: [["cx", 25], ["cy", 25], ["r", 20]] }];
  it("groups and ungroups, and an effect leaves with its group", () => {
    const g = groupOps(draft(ops), [1, 2]);
    expect(membersOf(g.d, g.group)).toEqual([1, 2]);
    const fx = addEffect(g.d, [1, 2], "glow", "on").d;
    expect((fx.ops as Op[]).filter((o) => o.op === "effetto")).toHaveLength(1);
    const back = ungroupOps(fx, [1, 2]);
    expect((back.ops as Op[]).some((o) => o.op === "effetto")).toBe(false);
  });
  it("cuts a photo to a shape and gives the shape back", () => {
    const cut = clipPhoto(draft(ops), 3, 4);
    expect((cut.ops as Op[])[3].clip).toEqual({ tag: "circle", geo: [["cx", 25], ["cy", 25], ["r", 20]] });
    expect(cut.ops).toHaveLength(4);
    const back = unclipPhoto(cut, 3);
    expect((back.ops as Op[])[4].tag).toBe("circle");
    expect((back.ops as Op[])[3].clip).toBeUndefined();
    // Pairs, like every other shape (rc.29 wrote `{ fill: "none" }`).
    const shape = (back.ops as Op[])[4];
    expect(shape.extra).toEqual([["fill", "none"]]);
    expect(fillOf(shape)).toEqual({ none: true });
    expect(() => setFill(back, 4, { color: "#ff0000" })).not.toThrow();
  });
  it("writes attributes given as objects as pairs, in the compiler's order", () => {
    expect(asPairs({ ry: 10, cx: 25, fill: "none", cy: 25, rx: 20 }))
      .toEqual([["cx", 25], ["cy", 25], ["rx", 20], ["ry", 10], ["fill", "none"]]);
    expect(asPairs(undefined)).toEqual([]);
    const d = draft([{ op: "corpo" }, { op: "parte", id: "rotor", kind: "rotor", geo: { cx: 5, cy: 5 } },
      { op: "forma", tag: "rect", geo: { x: 0, y: 0, width: 5, height: 5 }, extra: { fill: "none" } },
      { op: "image", src: "a.png", geo: [["x", 0]], clip: { tag: "circle", geo: { cx: 1, cy: 1, r: 1 } } }]);
    const n = normalizeOps(d);
    const ops = n.ops as Op[];
    expect(ops[1].geo).toEqual({ cx: 5, cy: 5 }); // a part keeps its own geometry
    expect(ops[2].geo).toEqual([["x", 0], ["y", 0], ["width", 5], ["height", 5]]);
    expect(ops[2].extra).toEqual([["fill", "none"]]);
    expect((ops[3].clip as { geo: unknown }).geo).toEqual([["cx", 1], ["cy", 1], ["r", 1]]);
    expect(normalizeOps(n)).toBe(n); // nothing to change: the same description
  });
  it("reads a symbol file with attributes as objects as pairs, and turns it", () => {
    const text = JSON.stringify({ format: SYMBOL_FILE_FORMAT, version: 1, symbol: { slug: "x", w: 100, h: 100, body: "body-pump", it: "X", en: "X",
      ops: [{ op: "corpo" }, { op: "forma", tag: "path", geo: { d: "M0 0 L10 0 L10 10 Z" }, extra: { fill: "none" } }] } });
    const r = readSymbolFile(text, []);
    expect(r.ok).toBe(true);
    const d = (r as { d: DescrizioneSimbolo }).d;
    expect(Array.isArray((d.ops as Op[])[1].geo)).toBe(true);
    expect(() => matrixOps(d, [1], turnMatrix("cw", 50, 50))).not.toThrow();
  });
});
