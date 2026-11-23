// The symbol editor: a full-screen workspace on one project symbol (plan
// docs/plans/2026-11-18-editor-dei-simboli.md, phase 1).
//
// WYSIWYG: the drawing in the middle is `SimboloLibSvg` on the SVG the runtime
// compiled, the same component the canvas and the viewer use. The compile
// asks for the trace (`data-op` on every element), so a click finds the
// operation that drew it; moving and resizing change the operations, never the
// SVG. While a drag is in progress the elements are moved with a transform,
// and the real drawing comes back from the compiler when the drag ends.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { BAR_HEIGHT, C, Field, Num, Section, button, input, note } from "./ui";
import { SPAZIO, TESTO, useSezioneAperta } from "@/editor/stilePannelli";
import { trascinaBordo } from "@/editor/bordoPannello";
import { BAR, BTN, SELECT, SEP, dim, toggled } from "@/editor/EditorToolbar";
import { HDR_BTN } from "@/components/headerStyles";
import { EditorIcon, opIcon } from "./icons";
import { SymbolEditorBoundary } from "./SymbolEditorBoundary";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo } from "@/types";
import { avviso, chiedi, conferma, richiestaAperta, scegli } from "@/finestraAvviso/finestraAvviso";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import { trovaSimboloOriginale, useManifestoLib } from "@/symbols/lib/libreria";
import type { SignalEntry, SimboloLib } from "@/symbols/lib/manifest";
import { useStileProgetto } from "@/symbols/stileProgetto";
import {
  addInput, addPort, align, boxToBox, fillFrame, deleteOps, distribute, duplicateOps, explodedOffsets, extraOf, fillOf, inputs,
  insertInLayer, layers, mapBox, matrixOps, moveLayer, movePort, moveToLayer, moveToNewLayer, NEW_LAYER, newCircle, newEllipse, newLine, newPath, newRect, ports, r2,
  removeInput, renameInput, reorderOp, resizeSymbol, saveAsCopy, setExtra, setFill, setGeo, setPartGeo, setPathD,
  setPort, setVeil, transformOps, turnMatrix, union, validPathD, validSize, INPUT_KINDS, SIDES,
  animateSelection, setPartParam, newImage, setImageOpacity, nothingDrawn, draws,
  groupOf, membersOf, normalizeOps, stripOldEffects, turns, ungroupOps,
  animateCreatesPart, copyOps, effectsFollowing, freeInputId, freePartId, freePortId, idProblem, inputIds, normalizeId, regroupCopies,
  type Affine, type AlignMode, type Box, type InputKind, type Layer, type Op, type Port, type Side, type SymbolInput,
} from "./model";
import { predefinito } from "@/coloriPredefiniti";
import { valoriParti, type ValoreParte } from "@/symbols/lib/libreria";
import { AnimateBlock, AnimationProps } from "./AnimationProps";
import { FxProps, askId, confirmEffectsGo, groupAsking, idMessage } from "./FxProps";
import { apriInFinestra, inFinestraSimboli, ricordaStaccato, riportaNellIde, staccatoPreferito } from "./ponteSimboli";
import { AiPanel } from "./AiPanel";
import { AiPhoto } from "./AiPhoto";
import { bindingsOnParts, pipesOnPorts, svgWarningLines, takenSlugs, usage, withSymbol, withoutSymbol, writeSymbols, type SymbolEditorTarget } from "./open";
import { importSvg, isBlank, looksLikeSvg, placeImport, roomFor, MAX_SVG_BYTES } from "./importSvg";
import { symbolFileName, symbolFileText, symbolZip } from "./symbolFile";
import { symbolPhotos } from "@/images/usage";
import { PhotoPickerHost, pickPhoto } from "./photoPicker";
import { uploadEmbeddedPhotos } from "./photoUpload";
import { saveToLibrary, useCompanyLibrary } from "@/symbols/library/companyLibrary";

interface Catalog {
  materials: { name: string; color: string }[];
  veils: { name: string; type: string }[];
}

interface History { past: DescrizioneSimbolo[]; present: DescrizioneSimbolo; future: DescrizioneSimbolo[] }

type Tool = "select" | "rect" | "ellipse" | "circle" | "line" | "poly" | "port";
const TOOLS: Tool[] = ["select", "rect", "ellipse", "circle", "line", "poly", "port"];

/** The editor's clipboard: shapes copied with Ctrl+C, pasted with Ctrl+V, also
 *  into the next symbol opened in the same session (phase 2). */
let clipboard: Op[] = [];

/** The grouped layers of each symbol, while the IDE stays open: a way of
 *  looking at the drawing, like hiding a layer, not a part of the symbol. */
const groupedLayers = new Map<string, Set<string>>();

/** The «Try» tab: values the drawing is shown with, as on a page. */
interface Preview {
  state: "drawn" | "off" | "on" | "alarm";
  level: number;
  spin: boolean;
  parts: Record<string, number | boolean>;
  /** The timed effects on (rotation, vibration, pulse, blink), like «Anteprima effetti». */
  animate: boolean;
}

type Drag =
  | { kind: "move"; start: [number, number]; ids: number[]; d: [number, number] }
  /** `corner`: the corner being dragged (1 = right / bottom); the opposite one stays. */
  | { kind: "resize"; box: Box; corner: [0 | 1, 0 | 1]; ids: number[]; cur: Box }
  | { kind: "draw"; start: [number, number]; cur: [number, number] }
  | { kind: "anchor"; op: number; cur: [number, number] }
  /** Where a slide goes: its (dx, dy), dragged by the dashed outline. */
  | { kind: "slide"; op: number; start: [number, number]; from: [number, number]; cur: [number, number] }
  | { kind: "port"; op: number; cur: [number, number] }
  | { kind: "marquee"; start: [number, number]; cur: [number, number]; add: boolean }
  | { kind: "pan"; client: [number, number]; centre: [number, number]; scale: number };


/** The origin of an id made in this session (`partOrigin`, `origin`): it
 *  matches no id of the saved symbol. */
const NEW_ID = "\u0000new";

/** Where a port's pipe leaves, as a unit vector. */
const OUT: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const PAD = 24;

/** Mounted once by the editor shell: shows the editor while the store says so. */
export function SymbolEditorHost() {
  const target = useAppStore((s) => s.symbolEditor);
  // In a window of its own (22-11-2026), unless asked otherwise: the IDE stays
  // usable while a symbol is drawn. A blocked window opens it here.
  const detach = !!target && !target.inline && !inFinestraSimboli && staccatoPreferito();
  useEffect(() => {
    if (!detach || !target) return;
    if (apriInFinestra(target)) useAppStore.getState().closeSymbolEditor();
    else useAppStore.getState().openSymbolEditor({ ...target, inline: true });
  }, [detach, target]);
  if (!target || detach) return null;
  return <SymbolEditorBoundary><SymbolEditor key={target.draft.slug} target={target} /></SymbolEditorBoundary>;
}

/** Which id of `now` is the saved one `id`: the one renamed from it first,
 *  then itself if it has no other origin. An id made in this session
 *  (`NEW_ID`) is none of them, also with the same letters. */
function sameAs(now: string[], from: Map<string, string>, id: string): string | undefined {
  return now.find((x) => from.get(x) === id) ?? now.find((x) => x === id && !from.has(x));
}

/** Half units, or the grid when it snaps. */
function snapTo(v: number, step: number | null): number {
  return step ? Math.round(v / step) * step : Math.round(v * 2) / 2;
}

function opLabel(op: Op, t: (k: string) => string): string {
  switch (op.op) {
    case "forma": return t(`symbolEditor.shape.${String(op.tag)}`);
    case "luce": case "riflesso": return t("symbolEditor.shape.highlight");
    case "tratto": return t("symbolEditor.shape.line");
    case "image": return `${t("symbolEditor.shape.image")} ${String(op.src ?? "")}`;
    case "flangia_v": case "flangia_o": return t("symbolEditor.shape.flange");
    case "tubo_o": case "tubo_v": return t("symbolEditor.shape.stub");
    case "bocca": return `${t("symbolEditor.port.one")} ${String(op.id ?? "")}`;
    default: return op.op;
  }
}

function layerLabel(l: Layer, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (l.kind === "static") return t("symbolEditor.layer.static", { n: Number(l.id.slice(6)) + 1 });
  if (l.kind === "body") return t("symbolEditor.layer.body");
  return `${t(`symbolEditor.input.${l.kind}`)} · ${l.id}`;
}

function SymbolEditor({ target }: { target: SymbolEditorTarget }) {
  const { t, i18n } = useTranslation();
  const close = useAppStore((s) => s.closeSymbolEditor);
  const updateObject = useAppStore((s) => s.updateObject);
  const manifesto = useManifestoLib();
  const projectStyle = useStileProgetto();

  // The effect parts of the rc.22-rc.28 are gone (22-11-2026): taken out at
  // the opening, and said once.
  // Attributes written as objects (the compiler accepts them) become pairs
  // here, the form every reader of the editor expects (test of the rc.29).
  const [cleaned] = useState(() => stripOldEffects(normalizeOps(target.draft)));
  const [hist, setHist] = useState<History>({ past: [], present: cleaned.d, future: [] });
  const [oldFx, setOldFx] = useState(cleaned.removed);
  const d = hist.present;
  const [saved, setSaved] = useState<DescrizioneSimbolo | null>(target.isNew ? null : target.draft);
  const [savedSlug, setSavedSlug] = useState(target.draft.slug);
  const [fromObject, setFromObject] = useState(target.fromObjectId);
  const [sel, setSel] = useState<number[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  // The right column follows the selection (22-11-2026, the maintainer: the
  // sections «si accodano una sotto l'altra e non è collegata all'oggetto
  // selezionato»): «inspect» shows the symbol when nothing is selected, the
  // selection otherwise; «try» is the test bench.
  const [tab, setTab] = useState<"inspect" | "try">("inspect");
  const [compiled, setCompiled] = useState<{ svg?: string; voce?: SimboloLib; errors: string[] }>({ errors: [] });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [boxes, setBoxes] = useState<Map<number, Box>>(new Map());
  // A move or a resize just dropped: its shapes stay where they were dropped,
  // with the boxes they will have, until the drawing compiled from the new
  // description arrives. Without it they went back to where they started for
  // the time of a compile, then jumped forward (19-11-2026, the maintainer:
  // «uno strano movimento di assestamento»).
  const [held, setHeld] = useState<{ d: DescrizioneSimbolo; boxes: Map<number, Box> } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  // The view (phase 2): zoom (1 = the whole symbol) around a centre, in units.
  const [view, setView] = useState({ z: 1, cx: target.draft.w / 2, cy: target.draft.h / 2 });
  const [grid, setGrid] = useState({ on: true, step: 10, snap: false });
  const [magnet, setMagnet] = useState(true);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const [explode, setExplode] = useState({ on: false, k: 0.6 });
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [locked, setLocked] = useState<Set<string>>(new Set());
  // A grouped layer is one object on the canvas: one click picks all its
  // shapes, and the exploded view moves them together (19-11-2026).
  const [grouped, setGrouped] = useState<Set<string>>(() => groupedLayers.get(target.draft.slug) ?? new Set());
  const [poly, setPoly] = useState<[number, number][]>([]);
  const [hover, setHover] = useState<[number, number] | null>(null);
  const [preview, setPreview] = useState<Preview>({ state: "drawn", level: 0.6, spin: false, parts: {}, animate: false });
  const pastes = useRef(0);
  const space = useRef(false);
  // The ports as they were when the editor opened (or last saved), and what
  // each current port id was called then: a rename or a removal with pipes
  // attached is said before saving, and the pipes of this page follow a rename.
  const basePorts = useRef<string[]>(ports(target.draft).map((p) => p.id));
  const origin = useRef<Map<string, string>>(new Map(ports(target.draft).map((p) => [p.id, p.id])));
  // The same for the parts, which objects bind by id (`symbol_parts`, 19-11-2026).
  const partIds = (x: DescrizioneSimbolo) => inputs(x).filter((i) => i.kind !== "state").map((i) => i.id);
  const baseParts = useRef<string[]>(partIds(target.draft));
  const partOrigin = useRef<Map<string, string>>(new Map(partIds(target.draft).map((id) => [id, id])));
  const svgRef = useRef<SVGSVGElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<SVGGElement>(null);
  const sn = useCallback((v: number) => snapTo(v, grid.snap ? grid.step : null), [grid.snap, grid.step]);

  const commit = useCallback((next: DescrizioneSimbolo) => {
    setHist((h) => (next === h.present ? h : { past: [...h.past.slice(-99), h.present], present: next, future: [] }));
  }, []);
  // The selection is by index: after an undo it may point past the end, or at
  // other shapes (an undone import or duplicate crashed the editor, 20-11-2026).
  const undo = useCallback(() => {
    setSel([]);
    setHist((h) => h.past.length
      ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h);
  }, []);
  const redo = useCallback(() => {
    setSel([]);
    setHist((h) => h.future.length
      ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h);
  }, []);

  useEffect(() => { void api.symbolCatalog().then(setCatalog).catch(() => {}); }, []);

  // Compile, with a short pause so typing a number does not fire ten requests.
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      api.compilaSimboli([d], { trace: true }).then(([e]) => {
        if (!live) return;
        setHeld(null);
        // The drawing comes back also when the rules refuse it (22-11-2026):
        // the canvas shows what is there, and «Save» stays off while there are
        // errors. Before, a stove with an empty body never compiled, and the
        // canvas stayed empty while photos and shapes were piling up.
        if (e?.svg && e.voce) setCompiled({ svg: e.svg, voce: e.voce, errors: e.ok ? [] : e.errori ?? ["?"] });
        else setCompiled((c) => ({ ...c, errors: e?.errori ?? ["?"] }));
      }).catch((err) => {
        if (!live) return;
        setHeld(null);
        setCompiled((c) => ({ ...c, errors: [String(err?.message ?? err)] }));
      });
    }, 150);
    return () => { live = false; clearTimeout(h); };
  }, [d]);

  // The boxes of what each operation drew, in viewBox units (without the
  // exploded view's offsets: those are only for showing).
  useLayoutEffect(() => {
    const g = drawRef.current;
    if (!g) return;
    const m = new Map<number, Box[]>();
    g.querySelectorAll<SVGGraphicsElement>("[data-op]").forEach((el) => {
      el.removeAttribute("transform");
      const i = Number(el.getAttribute("data-op"));
      try {
        const b = el.getBBox();
        if (!m.has(i)) m.set(i, []);
        m.get(i)!.push({ x: b.x, y: b.y, w: b.width, h: b.height });
      } catch { /* not rendered */ }
    });
    const out = new Map<number, Box>();
    for (const [i, bs] of m) { const u = union(bs); if (u) out.set(i, u); }
    setBoxes(out);
  }, [compiled.svg, preview]);

  const ls = useMemo(() => layers(d), [d]);
  const ins = useMemo(() => inputs(d), [d]);
  const layerOf = useCallback((i: number) => ls.find((l) => l.ops.includes(i)), [ls]);
  // Where a new shape goes (22-11-2026): the layer of the selection; with
  // nothing selected, the layer last clicked in the list — empty ones too —
  // and only then the last layer. Before, a click on an empty layer chose
  // nothing visible and the shape went to the last layer, or to the layer of
  // a photo still selected: the maintainer «could not add a body».
  const [targetLayer, setTargetLayer] = useState<string | null>(null);
  // The two side columns are resizable like the IDE's panels (22-11-2026: «le
  // colonne di strumenti hanno larghezza fissa e tagliano testi»), and remember
  // their width.
  const layersCol = useRef<HTMLDivElement>(null);
  const propsCol = useRef<HTMLDivElement>(null);
  const [layersWidth, setLayersWidth] = useState(() => storedWidth(LAYERS_WIDTH_KEY, 220, LAYERS_MIN, LAYERS_MAX));
  const [propsWidth, setPropsWidth] = useState(() => storedWidth(PROPS_WIDTH_KEY, 300, PROPS_MIN, PROPS_MAX));
  const drawInto = useMemo(
    () => (sel.length ? layerOf(sel[0]) : undefined) ?? ls.find((l) => l.id === targetLayer) ?? ls[ls.length - 1],
    [sel, layerOf, ls, targetLayer],
  );
  useEffect(() => { groupedLayers.set(savedSlug, grouped); }, [grouped, savedSlug]);
  /** What a click on the canvas picks: the shape, or the whole grouped layer. */
  const unitOf = useCallback((i: number): number[] => {
    // A shape of a group picks the whole group (22-11-2026).
    const g = groupOf((d.ops as Op[])[i]);
    if (g) return membersOf(d, g);
    const l = layerOf(i);
    return l && grouped.has(l.id) ? l.ops.filter((j) => j === i || boxes.has(j)) : [i];
  }, [layerOf, grouped, boxes, d]);
  const offsets = useMemo(
    () => (explode.on
      ? explodedOffsets(boxes, [d.w / 2, d.h / 2], explode.k, Math.max(d.w, d.h), ls.filter((l) => grouped.has(l.id)).map((l) => l.ops))
      : new Map<number, [number, number]>()),
    [boxes, explode.on, explode.k, d.w, d.h, ls, grouped],
  );
  const holding = held && held.d === d ? held : null;
  /** The box of an operation's geometry: the drawn one, or where it was just dropped. */
  const realBox = useCallback((i: number): Box | undefined => holding?.boxes.get(i) ?? boxes.get(i), [holding, boxes]);
  /** Where an operation is shown: its box, moved by the exploded view. */
  const shown = useCallback((i: number): Box | undefined => {
    const b = realBox(i);
    const o = offsets.get(i);
    return b && o ? { ...b, x: b.x + o[0], y: b.y + o[1] } : b;
  }, [realBox, offsets]);
  // Hidden layers and the exploded view are applied to the drawing itself.
  useLayoutEffect(() => {
    const g = drawRef.current;
    if (!g) return;
    // The drawing is an `<svg>` the size of the symbol, which cuts what goes
    // beyond its border, and a level part cuts its shapes to the window: in the
    // exploded view the shapes go out of both, so neither cuts (19-11-2026, the
    // maintainer: «spariscono dietro il bordo»).
    const inner = g.querySelector<SVGSVGElement>(":scope > svg");
    // Outside «Prova» a photo past the frame shows whole, dimmed beyond the
    // border, so it can be centred (22-11-2026); the symbol cuts it everywhere
    // else.
    if (inner) inner.style.overflow = explode.on || tab !== "try" ? "visible" : "";
    // The layers are the `<g>` directly inside the drawing.
    inner?.querySelectorAll<SVGGElement>(":scope > g").forEach((s) => { s.style.clipPath = explode.on ? "none" : ""; });
    const hiddenOps = new Set(ls.filter((l) => hidden.has(l.id)).flatMap((l) => l.ops));
    g.querySelectorAll<SVGGraphicsElement>("[data-op]").forEach((el) => {
      const i = Number(el.getAttribute("data-op"));
      const o = offsets.get(i);
      // What was just dropped keeps the transform it was dropped with.
      if (holding?.boxes.has(i)) { /* kept */ }
      else if (o && (o[0] || o[1])) el.setAttribute("transform", `translate(${o[0]} ${o[1]})`);
      else el.removeAttribute("transform");
      el.style.display = hiddenOps.has(i) ? "none" : "";
    });
  }, [offsets, hidden, ls, boxes, explode.on, holding, tab]);
  // The view makes room for the exploded shapes, and comes back when it closes
  // (only then: with the view closed, the zoom chosen by hand stays).
  const wasExploded = useRef(false);
  useEffect(() => {
    if (!explode.on) {
      if (wasExploded.current) setView({ z: 1, cx: d.w / 2, cy: d.h / 2 });
      wasExploded.current = false;
      return;
    }
    wasExploded.current = true;
    const all = union([{ x: 0, y: 0, w: d.w, h: d.h }, ...[...boxes.keys()].map((i) => shown(i)).filter((b): b is Box => !!b)]);
    if (!all) return;
    const z = Math.min(1, (d.w + 2 * PAD) / (all.w + 2 * PAD), (d.h + 2 * PAD) / (all.h + 2 * PAD));
    setView({ z, cx: all.x + all.w / 2, cy: all.y + all.h / 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explode.on, explode.k, boxes]);
  const pickable = useCallback((i: number) => {
    // The drawing on the canvas is the last one that compiled: after a delete
    // that does not compile (the last shape of the body), it still shows shapes
    // the description no longer has. Picking one crashed the whole IDE (test of
    // 2.26.0-rc.23, 21-11-2026): only what is drawn in the description is picked.
    const op = (d.ops as Op[])[i];
    if (!op || !draws(op)) return false;
    const l = layerOf(i);
    return !l || (!hidden.has(l.id) && !locked.has(l.id));
  }, [d, layerOf, hidden, locked]);
  // What is selected and no longer there (a delete, an undo) leaves the selection.
  useEffect(() => {
    setSel((s) => {
      const kept = s.filter((i) => i < d.ops.length);
      return kept.length === s.length ? s : kept;
    });
  }, [d]);
  const selBox = useMemo(() => union(sel.map((i) => shown(i)).filter((b): b is Box => !!b)), [sel, shown]);
  const dirty = saved === null || JSON.stringify(saved) !== JSON.stringify(d);
  const original = d.overrides ? trovaSimboloOriginale(d.overrides) : undefined;
  const use = useMemo(() => usage({ ...d, slug: savedSlug }), [d, savedSlug]);
  const portList = useMemo(() => ports(d), [d]);
  const pipes = useMemo(() => pipesOnPorts({ ...d, slug: savedSlug }), [d, savedSlug]);
  const renamePort = useCallback((from: string, to: string) => {
    const o = origin.current;
    o.set(to, o.get(from) ?? from);
    o.delete(from);
  }, []);
  const renamePartTracked = useCallback((from: string, to: string) => {
    const o = partOrigin.current;
    o.set(to, o.get(from) ?? from);
    o.delete(from);
  }, []);
  // A part, an input or a port made now is never one of the symbol as it was
  // saved: a new input named like a part just renamed took the page's bindings
  // of that part, in silence (test of the rc.29, 23-11-2026).
  const partCreated = useCallback((id: string) => { partOrigin.current.set(id, NEW_ID); }, []);
  const portCreated = useCallback((id: string) => { origin.current.set(id, NEW_ID); }, []);
  // The drawing now, for what is done after a question: if it changed while
  // the question was open (the AI commits on its own), the indexes taken
  // before are of another drawing, and nothing is made.
  const dRef = useRef(d);
  useLayoutEffect(() => { dRef.current = d; }, [d]);
  const latest = useCallback(() => dRef.current, []);

  // ── the view ──
  const baseW = d.w + 2 * PAD, baseH = d.h + 2 * PAD;
  const vw = baseW / view.z, vh = baseH / view.z;
  const viewBox = `${view.cx - vw / 2} ${view.cy - vh / 2} ${vw} ${vh}`;
  const fit = () => setView({ z: 1, cx: d.w / 2, cy: d.h / 2 });
  const zoomAt = (factor: number, at?: [number, number]) => setView((v) => {
    const z = Math.min(16, Math.max(0.25, v.z * factor));
    const [px, py] = at ?? [v.cx, v.cy];
    return { z, cx: px + (v.cx - px) * (v.z / z), cy: py + (v.cy - py) * (v.z / z) };
  });

  // ── pointer ──
  const toUnits = (e: { clientX: number; clientY: number }): [number, number] => {
    const s = svgRef.current;
    const m = s?.getScreenCTM?.();
    if (!s || !m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const elementsOf = (ids: number[]) =>
    ids.flatMap((i) => Array.from(drawRef.current?.querySelectorAll<SVGElement>(`[data-op="${i}"]`) ?? []));
  /** Moves the elements of `ids` while dragging, on top of the exploded offset. */
  const liveTransform = (ids: number[], tr: ((i: number) => string) | null) => {
    for (const i of ids) {
      const o = offsets.get(i) ?? [0, 0];
      for (const el of elementsOf([i])) {
        const base = o[0] || o[1] ? `translate(${o[0]} ${o[1]}) ` : "";
        if (tr) el.setAttribute("transform", base + tr(i));
        else if (base) el.setAttribute("transform", base.trim());
        else el.removeAttribute("transform");
      }
    }
  };
  /** The operations under (x, y), the topmost first. */
  const hitsAt = (p: [number, number]): number[] => {
    const tol = 1.5 / view.z;
    const out: number[] = [];
    for (const [i] of boxes) {
      const b = shown(i);
      if (!b || !pickable(i)) continue;
      if (p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol) out.push(i);
    }
    return out.sort((a, b) => b - a);
  };
  /** The calamita: the move `dd` nudged so an edge or centre of `box` meets one
   *  of another shape or of the symbol, within 2 screen units; and the guides. */
  const magnetise = (box: Box, dd: [number, number], ids: number[]): { dd: [number, number]; g: { x?: number; y?: number } } => {
    if (!magnet) return { dd, g: {} };
    const thr = 2 / view.z;
    const xs = [0, d.w / 2, d.w], ys = [0, d.h / 2, d.h];
    for (const [i] of boxes) {
      if (ids.includes(i)) continue;
      const b = shown(i);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    const best = (cands: number[], lines: number[]) => {
      let r: { delta: number; at: number } | null = null;
      for (const c of cands) for (const l of lines) {
        const delta = c - l;
        if (Math.abs(delta) <= thr && (!r || Math.abs(delta) < Math.abs(r.delta))) r = { delta, at: c };
      }
      return r;
    };
    const bx = best(xs, [box.x + dd[0], box.x + box.w / 2 + dd[0], box.x + box.w + dd[0]]);
    const by = best(ys, [box.y + dd[1], box.y + box.h / 2 + dd[1], box.y + box.h + dd[1]]);
    return { dd: [r2(dd[0] + (bx?.delta ?? 0)), r2(dd[1] + (by?.delta ?? 0))], g: { x: bx?.at, y: by?.at } };
  };

  /** The calamita for a point (a corner being drawn or resized, a port, a
   *  pivot, a polyline point): x and y go to the nearest edge or centre of a
   *  shape, or of the symbol, within 2 screen units. */
  const magnetPoint = (p: [number, number], exclude: number[] = []): [number, number] => {
    if (!magnet) return p;
    const thr = 2 / view.z;
    const xs = [0, d.w / 2, d.w], ys = [0, d.h / 2, d.h];
    for (const [i] of boxes) {
      if (exclude.includes(i)) continue;
      const b = shown(i);
      if (!b) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    const near = (v: number, cands: number[]) => {
      let best: number | undefined;
      for (const c of cands) if (Math.abs(c - v) <= thr && (best === undefined || Math.abs(c - v) < Math.abs(best - v))) best = c;
      return best;
    };
    const x = near(p[0], xs), y = near(p[1], ys);
    setGuides({ x, y });
    return [x === undefined ? p[0] : r2(x), y === undefined ? p[1] : r2(y)];
  };

  const finishPoly = (closed: boolean) => {
    if (poly.length >= 2) {
      const r = insertInLayer(d, drawInto.id, newPath(poly, closed && poly.length >= 3));
      commit(r.d);
      setSel([r.at]);
    }
    setPoly([]);
    setTool("select");
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const pan = e.button === 1 || (e.button === 0 && space.current);
    if (e.button !== 0 && !pan) return;
    const p = toUnits(e);
    svgRef.current?.setPointerCapture?.(e.pointerId);
    if (pan) {
      const m = svgRef.current?.getScreenCTM?.();
      setDrag({ kind: "pan", client: [e.clientX, e.clientY], centre: [view.cx, view.cy], scale: m ? 1 / m.a : 1 });
      return;
    }
    if (tool === "port") {
      // The name first (test of the rc.29): Cancel makes no port. No default:
      // the mouse down that follows would take the focus from the question.
      e.preventDefault();
      const q = magnetPoint([sn(p[0]), sn(p[1])]);
      setGuides({});
      setTool("select");
      void (async () => {
        const id = await askId(t, {
          ns: "port", title: t("symbolEditor.ask.portTitle"), text: t("symbolEditor.ask.portText"),
          proposed: freePortId(d), taken: ports(d).map((x) => x.id),
        });
        if (!id || latest() !== d) return;
        const r = addPort(d, q[0], q[1], id);
        portCreated(id);
        commit(r.d);
        setSel([r.at]);
      })();
      return;
    }
    if (tool === "poly") {
      const q = magnetPoint([sn(p[0]), sn(p[1])]);
      // A click on the first point closes the shape.
      if (poly.length >= 3 && Math.hypot(q[0] - poly[0][0], q[1] - poly[0][1]) <= 3 / view.z) { finishPoly(true); return; }
      setPoly([...poly, q]);
      return;
    }
    if (tool !== "select") { const q = magnetPoint([sn(p[0]), sn(p[1])]); setDrag({ kind: "draw", start: q, cur: q }); return; }
    // The ports first: they are drawn above everything.
    const port = [...portList].reverse().find((q) => Math.hypot(p[0] - q.x, p[1] - q.y) <= Math.max(q.d / 2, 2) + 1 / view.z);
    if (port) {
      setSel([port.op]);
      setDrag({ kind: "port", op: port.op, cur: [port.x, port.y] });
      return;
    }
    const hits = hitsAt(p);
    if (!hits.length) {
      // On nothing: a selection box.
      if (!e.shiftKey) setSel([]);
      setDrag({ kind: "marquee", start: p, cur: p, add: e.shiftKey });
      return;
    }
    // What is under the pointer, a grouped layer counting once; Alt+click
    // goes to the one under the one selected.
    const units: number[][] = [];
    for (const i of hits) if (!units.some((u) => u.includes(i))) units.push(unitOf(i));
    let unit = units[0];
    const current = units.findIndex((u) => u.length === sel.length && u.every((i) => sel.includes(i)));
    if (e.altKey && current >= 0) unit = units[(current + 1) % units.length];
    const all = unit.every((i) => sel.includes(i));
    let ids = sel;
    if (e.shiftKey) ids = all ? sel.filter((x) => !unit.includes(x)) : [...new Set([...sel, ...unit])];
    else if (!all || e.altKey) ids = unit;
    setSel(ids);
    if (ids.length && !e.shiftKey) setDrag({ kind: "move", start: p, ids, d: [0, 0] });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toUnits(e);
    if (tool === "poly") setHover(magnetPoint([sn(p[0]), sn(p[1])]));
    if (!drag) return;
    if (drag.kind === "pan") {
      setView((v) => ({ ...v, cx: drag.centre[0] - (e.clientX - drag.client[0]) * drag.scale, cy: drag.centre[1] - (e.clientY - drag.client[1]) * drag.scale }));
    } else if (drag.kind === "move") {
      const raw = [p[0] - drag.start[0], p[1] - drag.start[1]];
      // The grid takes the top-left corner of what moves, not the distance:
      // a shape off the grid lands on it.
      const real = union(drag.ids.map(realBox).filter((b): b is Box => !!b));
      let dd: [number, number] = grid.snap && real
        ? [r2(sn(real.x + raw[0]) - real.x), r2(sn(real.y + raw[1]) - real.y)]
        : [sn(raw[0]), sn(raw[1])];
      const box = union(drag.ids.map((i) => shown(i)).filter((b): b is Box => !!b));
      if (box) { const m = magnetise(box, dd, drag.ids); dd = m.dd; setGuides(m.g); }
      liveTransform(drag.ids, () => `translate(${dd[0]} ${dd[1]})`);
      setDrag({ ...drag, d: dd });
    } else if (drag.kind === "resize") {
      const b = drag.box;
      const m = magnetPoint([sn(p[0]), sn(p[1])], drag.ids);
      const x0 = drag.corner[0] ? b.x : Math.min(m[0], b.x + b.w - 1);
      const x1 = drag.corner[0] ? Math.max(m[0], b.x + 1) : b.x + b.w;
      const y0 = drag.corner[1] ? b.y : Math.min(m[1], b.y + b.h - 1);
      const y1 = drag.corner[1] ? Math.max(m[1], b.y + 1) : b.y + b.h;
      const cur = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const a = boxToBox(b, cur);
      // The live preview is on the shown boxes; the offset comes first.
      liveTransform(drag.ids, (i) => {
        const o = offsets.get(i) ?? [0, 0];
        return `translate(${-o[0]} ${-o[1]}) matrix(${a.sx} 0 0 ${a.sy} ${a.tx} ${a.ty}) translate(${o[0]} ${o[1]})`;
      });
      setDrag({ ...drag, cur });
    } else if (drag.kind === "draw") {
      setDrag({ ...drag, cur: magnetPoint([sn(p[0]), sn(p[1])]) });
    } else if (drag.kind === "port") {
      const m = magnetPoint([sn(p[0]), sn(p[1])]);
      const q = ports(movePort(d, drag.op, m[0], m[1])).find((x) => x.op === drag.op);
      if (q) setDrag({ ...drag, cur: [q.x, q.y] });
    } else if (drag.kind === "marquee") {
      setDrag({ ...drag, cur: p });
    } else if (drag.kind === "slide") {
      setDrag({ ...drag, cur: [sn(drag.from[0] + p[0] - drag.start[0]), sn(drag.from[1] + p[1] - drag.start[1])] });
    } else {
      setDrag({ ...drag, cur: magnetPoint([sn(p[0]), sn(p[1])]) });
    }
  };

  /** Commits a dragged move or resize; the shapes stay where they were dropped. */
  const drop = (ids: number[], a: Affine) => {
    const next = transformOps(d, ids, a);
    commit(next);
    const moved = new Map<number, Box>();
    for (const i of ids) { const b = realBox(i); if (b) moved.set(i, mapBox(b, a)); }
    setHeld({ d: next, boxes: moved });
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    setGuides({});
    if (drag.kind === "pan") return;
    if (drag.kind === "move") {
      if (drag.d[0] || drag.d[1]) drop(drag.ids, { sx: 1, sy: 1, tx: drag.d[0], ty: drag.d[1] });
      else liveTransform(drag.ids, null);
    } else if (drag.kind === "resize") {
      const same = drag.cur.x === drag.box.x && drag.cur.y === drag.box.y && drag.cur.w === drag.box.w && drag.cur.h === drag.box.h;
      if (same) { liveTransform(drag.ids, null); return; }
      // On the shown box; the geometry is the real one, moved by the offset.
      const a = boxToBox(drag.box, drag.cur);
      const o = offsets.get(drag.ids[0]) ?? [0, 0];
      drop(drag.ids, { ...a, tx: a.tx + a.sx * o[0] - o[0], ty: a.ty + a.sy * o[1] - o[1] });
    } else if (drag.kind === "draw") {
      const [x0, y0] = drag.start, [x1, y1] = drag.cur;
      const b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      if (b.w < 1 && b.h < 1) { setTool("select"); return; }
      const bb = { ...b, w: Math.max(1, b.w), h: Math.max(1, b.h) };
      const op = tool === "rect" ? newRect(bb) : tool === "ellipse" ? newEllipse(bb) : tool === "circle" ? newCircle(bb) : newLine(x0, y0, x1, y1);
      const r = insertInLayer(d, drawInto.id, op);
      commit(r.d);
      setSel([r.at]);
      setTool("select");
    } else if (drag.kind === "port") {
      const before = ports(d).find((x) => x.op === drag.op);
      if (before && (before.x !== drag.cur[0] || before.y !== drag.cur[1])) commit(movePort(d, drag.op, drag.cur[0], drag.cur[1]));
    } else if (drag.kind === "marquee") {
      const [ax, ay] = drag.start, [bx, by] = drag.cur;
      const r = { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) };
      if (r.w < 0.5 && r.h < 0.5) return;
      const inside = [...boxes.keys()].filter((i) => {
        const b = shown(i);
        return b && pickable(i) && b.x < r.x + r.w && b.x + b.w > r.x && b.y < r.y + r.h && b.y + b.h > r.y;
      });
      const ports_ = portList.filter((q) => q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h).map((q) => q.op);
      const ids = [...new Set(inside.flatMap(unitOf)), ...ports_];
      setSel(drag.add ? [...new Set([...sel, ...ids])] : ids);
    } else if (drag.kind === "slide") {
      if (drag.cur[0] !== drag.from[0] || drag.cur[1] !== drag.from[1]) {
        commit(setPartParam(setPartParam(d, drag.op, "dx", drag.cur[0]), drag.op, "dy", drag.cur[1]));
      }
    } else {
      commit(setPartGeo(setPartGeo(d, drag.op, "cx", drag.cur[0]), drag.op, "cy", drag.cur[1]));
    }
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    zoomAt(Math.pow(1.1, -e.deltaY / 100), toUnits(e));
  };

  const startResize = (corner: [0 | 1, 0 | 1]) => (e: React.PointerEvent) => {
    if (!selBox) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setDrag({ kind: "resize", box: selBox, corner, ids: sel, cur: selBox });
  };
  const startSlide = (op: number, from: [number, number]) => (e: React.PointerEvent) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    setDrag({ kind: "slide", op, start: toUnits(e), from, cur: from });
  };
  const startAnchor = (op: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture?.(e.pointerId);
    const p = toUnits(e);
    setDrag({ kind: "anchor", op, cur: [sn(p[0]), sn(p[1])] });
  };

  // ── edits ──
  const drawing = useCallback((ids: number[]) => ids.filter((i) => (d.ops[i] as Op).op !== "bocca"), [d]);
  const del = useCallback(() => { if (sel.length) { commit(deleteOps(d, sel)); setSel([]); } }, [commit, d, sel]);
  const dup = useCallback(() => {
    // A port is not duplicated: two ports with the same id don't compile.
    const which = drawing(sel);
    if (!which.length) return;
    const r = duplicateOps(d, which);
    commit(r.d);
    setSel(r.added);
  }, [commit, d, sel, drawing]);
  const move = useCallback((dx: number, dy: number) => {
    if (sel.length) commit(transformOps(d, sel, { sx: 1, sy: 1, tx: dx, ty: dy }));
  }, [commit, d, sel]);
  const copy = useCallback((cut: boolean) => {
    const which = drawing(sel);
    if (!which.length) return;
    // A whole group keeps being one, a shape of a group leaves it (`copyOps`).
    clipboard = copyOps(d, which);
    pastes.current = 0;
    if (cut) { commit(deleteOps(d, which)); setSel([]); }
  }, [commit, d, sel, drawing]);
  const paste = useCallback(() => {
    if (!clipboard.length) return;
    pastes.current += 1;
    const off = 4 * pastes.current;
    const layer = drawInto;
    let out = d;
    const at: number[] = [];
    // A pasted group is a new group, without effects, also in another symbol
    // with a group of the same name (test of the rc.29).
    for (const op of regroupCopies(d, clipboard)) {
      const r = insertInLayer(out, layer.id, transformOps({ ...out, ops: [op] }, [0], { sx: 1, sy: 1, tx: off, ty: off }).ops[0] as Op);
      out = r.d;
      at.push(r.at);
    }
    commit(out);
    setSel(at);
  }, [commit, d, sel, layerOf, ls]);
  // An SVG drawing (plan docs/archive/2026-11-20-importa-svg-e-file-del-simbolo.md):
  // its shapes become operations of the symbol, selected so they move and
  // scale together; what was approximated or left out is said after.
  const importSvgText = useCallback(async (text: string) => {
    const r = importSvg(text, { w: d.w, h: d.h, adapt: isBlank(d), room: roomFor(d) });
    if (!r.ok) {
      void avviso({ livello: "errore", titolo: t("symbolEditor.svg.failed"), testo: t(`symbolEditor.svg.err.${r.error}`) });
      return;
    }
    // The photos inside the SVG go to the project's images first.
    const up = await uploadEmbeddedPhotos(r.ops, "svg");
    if (up.lost) r.warnings.image = (r.warnings.image ?? 0) + up.lost;
    r.ops = up.ops;
    const placed = placeImport(d, r);
    commit(placed.d);
    setSel(placed.at);
    setTool("select");
    setPoly([]);
    if (r.size) setView({ z: 1, cx: r.size.w / 2, cy: r.size.h / 2 });
    const notes = svgWarningLines(r.warnings);
    if (notes) void avviso({ titolo: t("symbolEditor.svg.done", { n: r.ops.length }), testo: notes });
  }, [commit, d, t]);
  const importSvgFile = useCallback(async (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_SVG_BYTES) {
      void avviso({ livello: "errore", titolo: t("symbolEditor.svg.failed"), testo: t("symbolEditor.svg.err.tooBig") });
      return;
    }
    await importSvgText(await f.text());
  }, [importSvgText, t]);
  const svgInput = useRef<HTMLInputElement>(null);
  // Ctrl+V waits a moment: if the clipboard holds SVG code the paste event
  // imports it, otherwise the shapes copied in the editor are pasted.
  const pendingPaste = useRef<number | null>(null);
  useEffect(() => {
    const h = (e: ClipboardEvent) => {
      e.stopPropagation();
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) return;
      const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type === "image/svg+xml" || /\.svg$/i.test(f.name));
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!file && !looksLikeSvg(text)) return;
      e.preventDefault();
      if (pendingPaste.current !== null) { window.clearTimeout(pendingPaste.current); pendingPaste.current = null; }
      if (file) void importSvgFile(file);
      else void importSvgText(text);
    };
    window.addEventListener("paste", h, true);
    return () => window.removeEventListener("paste", h, true);
  }, [importSvgFile, importSvgText]);
  // The company's library (plan 2026-11-21-simboli-fase-7-libreria-aziendale):
  // the drawing as it is now; the editor keeps the record of where it went,
  // so the project's copy is not «out of date» after its own «Save».
  const library = useCompanyLibrary();
  const toLibrary = async () => {
    try {
      const out = await saveToLibrary(d);
      if (!out) return;
      commit(out);
      void avviso({ testo: t("symbolLibrary.saved", { name: d[lang] }) });
    } catch (e) {
      void avviso({ livello: "errore", testo: e instanceof Error ? e.message : String(e) });
    }
  };
  const exportFile = async () => {
    // With photos, a zip that carries them (plan 2026-11-21-simboli-fase-3-foto).
    const names = symbolPhotos(d);
    let blob: Blob;
    if (names.length) {
      const photos: Record<string, Uint8Array> = {};
      try {
        for (const n of names) photos[n] = await api.projectImageBytes(n);
      } catch (e) {
        void avviso({ livello: "errore", testo: t("symbolEditor.photo.exportMissing", { error: e instanceof Error ? e.message : String(e) }) });
        return;
      }
      blob = new Blob([symbolZip(d, photos) as BlobPart], { type: "application/zip" });
    } else {
      blob = new Blob([symbolFileText(d)], { type: "application/json" });
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = symbolFileName(d);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const selectAll = useCallback(() => {
    setSel([...boxes.keys()].filter(pickable));
  }, [boxes, pickable]);
  const turn = useCallback((kind: "cw" | "ccw" | "flipH" | "flipV") => {
    const box = union(sel.map((i) => boxes.get(i)).filter((b): b is Box => !!b))
      ?? (sel.length ? { x: 0, y: 0, w: d.w, h: d.h } : null);
    if (!box) return;
    commit(matrixOps(d, sel, turnMatrix(kind, r2(box.x + box.w / 2), r2(box.y + box.h / 2))));
  }, [commit, d, sel, boxes]);
  const doAlign = (mode: AlignMode) => commit(align(d, drawing(sel), boxes, mode));
  const doFill = () => commit(fillFrame(d, boxes));
  // A whole layer back or forward; what the editor keeps by layer id (hidden,
  // locked, grouped) follows it, since static layers are named by their place.
  const shiftLayer = (id: string, dir: 1 | -1) => {
    const r = moveLayer(d, id, dir);
    if (!r.at.length) return;
    commit(r.d);
    setSel(r.at);
    const follow = (set: Set<string>) => new Set([...set].map((x) => r.renamed.get(x) ?? x));
    setHidden(follow);
    setLocked(follow);
    setGrouped(follow);
  };
  const doDistribute = (axis: "h" | "v") => commit(distribute(d, drawing(sel), boxes, axis));

  // Unsaved changes: cancel, leave without saving, or save and close. A symbol
  // with errors cannot be saved, so that choice is not offered. A save that
  // fails or is stopped (a rename of ports or parts) keeps the editor open.
  const doClose = async () => {
    if (!dirty) { close(); return; }
    const canSave = !compiled.errors.length;
    const choice = await scegli<"discard" | "save">({
      titolo: t("symbolEditor.closeTitle"),
      testo: t(canSave ? "symbolEditor.closeUnsaved" : "symbolEditor.closeUnsavedErrors"),
      scelte: [
        { valore: "discard", etichetta: t("symbolEditor.closeDiscard"), pericolo: true },
        ...(canSave ? [{ valore: "save" as const, etichetta: t("symbolEditor.closeSave") }] : []),
      ],
    });
    if (choice === "discard") close();
    else if (choice === "save" && (await save())) close();
  };

  // Keys stay inside the editor: Delete must not delete an object of the page.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      // A question is open (`chiedi`, `conferma`…, in a portal outside the
      // editor): its keys are its own. Stopped here, Enter and Esc never reached
      // its field — «Salva come» too — and Esc or Delete worked on the drawing
      // under it (test of the rc.29, 23-11-2026). The question's host stops
      // what starts outside it.
      if (richiestaAperta()) return;
      const el = e.target as HTMLElement | null;
      const field = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      // A field of the editor gets its keys (Enter in a port's name, Ctrl+Enter
      // in the AI tab): stopped here, they never reached React. The editor's
      // root stops them instead, before the page's listeners (20-11-2026).
      if (field && rootRef.current?.contains(el)) return;
      e.stopPropagation();
      if (field) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (e.key === " ") { space.current = true; return; }
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && k === "d") { e.preventDefault(); dup(); }
      else if (mod && k === "a") { e.preventDefault(); selectAll(); }
      else if (mod && k === "g" && e.shiftKey) { e.preventDefault(); if (sel.length) commit(ungroupOps(d, sel)); }
      else if (mod && k === "g") { e.preventDefault(); if (drawing(sel).length > 1) void groupAsking(t, d, drawing(sel), latest, commit); }
      else if (mod && k === "c") { e.preventDefault(); copy(false); }
      else if (mod && k === "x") { e.preventDefault(); copy(true); }
      else if (mod && k === "v") {
        // No preventDefault: the browser's paste event may bring SVG code.
        if (pendingPaste.current !== null) window.clearTimeout(pendingPaste.current);
        pendingPaste.current = window.setTimeout(() => { pendingPaste.current = null; paste(); }, 0);
      }
      else if (e.key === "Enter" && tool === "poly") { e.preventDefault(); finishPoly(false); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); }
      else if (e.key === "Escape") {
        if (poly.length) { setPoly([]); setTool("select"); }
        else if (sel.length) setSel([]);
        else if (tool !== "select") setTool("select");
        else void doClose();
      } else if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const s = e.shiftKey ? (grid.snap ? grid.step : 10) : grid.snap ? grid.step : 1;
        move(e.key === "ArrowLeft" ? -s : e.key === "ArrowRight" ? s : 0, e.key === "ArrowUp" ? -s : e.key === "ArrowDown" ? s : 0);
      }
    };
    const up = (e: KeyboardEvent) => { if (e.key === " ") space.current = false; };
    window.addEventListener("keydown", h, true);
    window.addEventListener("keyup", up, true);
    return () => { window.removeEventListener("keydown", h, true); window.removeEventListener("keyup", up, true); };
  });

  // ── saving ──
  /** Before writing: the ports that had pipes attached and are gone or renamed.
   *  Asks, and moves the pipes of this page to the new names. `false` = stop. */
  const portsChecked = async (): Promise<boolean> => {
    const now = ports(d);
    const renamed: { from: string; to: string; n: number }[] = [];
    const removed: { id: string; n: number }[] = [];
    for (const id of basePorts.current) {
      const n = pipes.get(id)?.total ?? 0;
      if (!n) continue;
      const cur = sameAs(now.map((p) => p.id), origin.current, id);
      if (!cur) removed.push({ id, n });
      else if (cur !== id) renamed.push({ from: id, to: cur, n });
    }
    if (!renamed.length && !removed.length) return true;
    const righe = [
      ...renamed.map((r) => t("symbolEditor.port.renamedWithPipes", { from: r.from, to: r.to, n: r.n })),
      ...removed.map((r) => t("symbolEditor.port.removedWithPipes", { id: r.id, n: r.n })),
    ].join("\n");
    if (!(await conferma({ titolo: t("symbolEditor.port.changedTitle"), testo: `${righe}\n\n${t("symbolEditor.port.changedText")}` }))) return false;
    for (const r of renamed) {
      for (const h of pipes.get(r.from)?.here ?? []) updateObject(h.pipeId, { [h.end]: r.to });
    }
    return true;
  };
  // A part bound in the pages that changes name or goes (19-11-2026): said
  // before saving, and the objects of this page follow a rename.
  const partsChecked = async (): Promise<boolean> => {
    const bound = bindingsOnParts({ ...d, slug: savedSlug });
    const now = partIds(d);
    const renamed: { from: string; to: string; n: number }[] = [];
    const removed: { id: string; n: number }[] = [];
    for (const id of baseParts.current) {
      const n = bound.get(id)?.total ?? 0;
      if (!n) continue;
      const cur = sameAs(now, partOrigin.current, id);
      if (!cur) removed.push({ id, n });
      else if (cur !== id) renamed.push({ from: id, to: cur, n });
    }
    if (!renamed.length && !removed.length) return true;
    const righe = [
      ...renamed.map((r) => t("symbolEditor.anim.boundRenamed", { from: r.from, to: r.to, n: r.n })),
      ...removed.map((r) => t("symbolEditor.anim.boundRemoved", { id: r.id, n: r.n })),
    ].join("\n");
    if (!(await conferma({ titolo: t("symbolEditor.anim.boundTitle"), testo: `${righe}\n\n${t("symbolEditor.anim.boundText")}` }))) return false;
    const objects = useAppStore.getState().pages.find((p) => p.id === useAppStore.getState().currentPageId)?.objects ?? [];
    for (const r of renamed) {
      for (const objId of bound.get(r.from)?.here ?? []) {
        const o = objects.find((x) => x.id === objId);
        const parts = { ...(o?.symbol_parts ?? {}) };
        if (!(r.from in parts)) continue;
        parts[r.to] = parts[r.from];
        delete parts[r.from];
        updateObject(objId, { symbol_parts: parts });
      }
    }
    return true;
  };
  const partsSaved = (x: DescrizioneSimbolo) => {
    baseParts.current = partIds(x);
    partOrigin.current = new Map(partIds(x).map((id) => [id, id]));
  };
  const portsSaved = (x: DescrizioneSimbolo) => {
    basePorts.current = ports(x).map((p) => p.id);
    origin.current = new Map(ports(x).map((p) => [p.id, p.id]));
  };

  /** `true` when the symbol was written. */
  const save = async (): Promise<boolean> => {
    if (compiled.errors.length) return false;
    if (!(await portsChecked())) return false;
    if (!(await partsChecked())) return false;
    setBusy(true);
    const err = await writeSymbols(withSymbol(d, savedSlug));
    setBusy(false);
    if (err) { await avviso({ livello: "errore", titolo: t("symbolEditor.saveFailed"), testo: err }); return false; }
    setSaved(d);
    setSavedSlug(d.slug);
    portsSaved(d);
    partsSaved(d);
    return true;
  };

  const saveAs = async () => {
    if (compiled.errors.length) return;
    const lang = i18n.language.startsWith("it") ? "it" : "en";
    const name = await chiedi({
      titolo: t("symbolEditor.saveAsTitle"), testo: t("symbolEditor.saveAsText"), iniziale: d[lang],
      valida: (v) => (v.trim() && v.trim().length <= 60 && !/[<>"&]/.test(v) ? null : t("symbolEditor.badName")),
    });
    if (!name) return;
    const label = name.trim();
    const copy = saveAsCopy(d, { it: label, en: label }, takenSlugs());
    setBusy(true);
    const err = await writeSymbols(withSymbol(copy, "\u0000"));
    setBusy(false);
    if (err) { await avviso({ livello: "errore", titolo: t("symbolEditor.saveFailed"), testo: err }); return; }
    const newId = `prj:${copy.slug}`;
    const others = use.onPage.filter((o) => o.id !== fromObject);
    if (fromObject) updateObject(fromObject, { symbol_id: newId as never });
    if (others.length && await conferma({
      titolo: t("symbolEditor.saveAsTitle"), testo: t("symbolEditor.moveOthers", { n: others.length, name: label }),
    })) for (const o of others) updateObject(o.id, { symbol_id: newId as never });
    // From now on the editor is on the copy.
    setHist({ past: [], present: copy, future: [] });
    setSaved(copy);
    setSavedSlug(copy.slug);
    portsSaved(copy);
    setFromObject(undefined);
    setSel([]);
  };

  const revert = async () => {
    if (!(await conferma({
      titolo: t("symbolEditor.revertTitle"), testo: t("symbolEditor.revertText", { n: use.objects }), pericolo: true,
    }))) return;
    const err = await writeSymbols(withoutSymbol(savedSlug));
    if (err) { await avviso({ livello: "errore", titolo: t("symbolEditor.saveFailed"), testo: err }); return; }
    close();
  };

  // ── render ──
  const { w, h } = d;
  /** A check box of the toolbar, as «Snap alla griglia» in the IDE's. */
  const check: React.CSSProperties = { display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 12, color: C.muted, whiteSpace: "nowrap" };
  const accent: React.CSSProperties = { accentColor: C.accent, margin: 0 };
  /** A layer's command: an icon, as the page commands in the IDE's tree. */
  const layerButton = (enabled: boolean, on = false): React.CSSProperties => ({
    background: "transparent", border: "none", padding: 2, borderRadius: 3, lineHeight: 0, flexShrink: 0,
    cursor: enabled ? "pointer" : "default", opacity: enabled ? 1 : 0.35, color: on ? C.accent : C.subtle,
  });
  const parts = ins.filter((i) => i.kind !== "state");
  // The piece the selected shapes are all in, if they are in one (19-11-2026).
  const selLayers = [...new Set(drawing(sel).map((i) => layerOf(i)))];
  const selPart = selLayers.length === 1 && selLayers[0] && selLayers[0].start >= 0
    && (d.ops[selLayers[0].start] as Op).op === "parte" ? selLayers[0] : undefined;
  /** The colour of the first chosen shape: a signal starts from it. */
  const firstColour = (): string | undefined => {
    const first = drawing(sel)[0];
    const f = first === undefined ? undefined : fillOf(d.ops[first] as Op);
    if (!f) return undefined;
    if ("color" in f) return f.color;
    if ("mat" in f) return catalog?.materials.find((m) => m.name === f.mat)?.color;
    return undefined;
  };
  /** «Anima…» and «Change with an input»: the name is asked only when a part
   *  is really made — on the shapes of one part only its kind changes — and
   *  the effects of a part left empty are listed before they go (test of the
   *  rc.29, decision D2 of the maintainer). One step of the history. */
  const animate = async (which: number[], kind: InputKind) => {
    const colour = firstColour();
    let id: string | undefined;
    if (animateCreatesPart(d, which)) {
      const asked = await askId(t, {
        ns: "input", title: t("symbolEditor.ask.partTitle", { kind: t(`symbolEditor.input.${kind}`) }),
        text: t("symbolEditor.ask.partText"), proposed: freePartId(d, kind), taken: inputIds(d),
      });
      if (!asked || latest() !== d) return;
      id = asked;
    }
    const r = animateSelection(d, which, kind, boxes, colour, id);
    if (!r) return;
    if (r.lost.length && (!(await confirmEffectsGo(t, r.lost, "input")) || latest() !== d)) return;
    if (id) partCreated(id);
    commit(r.d);
    setSel(r.shapes);
  };
  /** An input removed (the list of inputs, «Togli animazione»): the effects
   *  that follow it go too, listed and asked first (decision D2). */
  const removeAsking = async (opIndex: number) => {
    const op = d.ops[opIndex] as Op | undefined;
    if (!op) return;
    const fx = op.op === "corpo" ? [] : effectsFollowing(d, [String(op.id)]);
    if (fx.length && (!(await confirmEffectsGo(t, fx.map((f) => f.fx), "input")) || latest() !== d)) return;
    const gone = [...fx.map((f) => f.at), ...(op.op === "ingresso" ? [opIndex] : [])];
    commit(removeInput(d, opIndex));
    if (gone.length) setSel((s) => s.filter((i) => !gone.includes(i)).map((i) => i - gone.filter((g) => g < i).length));
  };
  const one = sel.length === 1 ? (d.ops[sel[0]] as Op) : undefined;
  const oneLayer = sel.length === 1 ? layerOf(sel[0]) : undefined;
  const lang = i18n.language.startsWith("it") ? "it" : "en";
  const nDrawing = drawing(sel).length;
  const u = 1 / view.z;

  // The «Try» tab shows the symbol with the values of its inputs, as a page would.
  const trying = tab === "try";
  const stateColour = !trying || preview.state === "drawn" ? null
    : predefinito("symbol", preview.state === "off" ? "state_off_color" : preview.state === "on" ? "state_on_color" : "state_alarm_color") ?? null;
  const partValues: Record<string, ValoreParte> = {};
  if (trying) {
    for (const p of parts) {
      const v = preview.parts[p.id];
      if (p.kind === "needle") partValues[p.id] = { frazione: typeof v === "number" ? v : 0.5 };
      else if (p.kind === "lever") partValues[p.id] = { aperta: v === undefined ? null : !!v };
      else if (p.kind === "lamp") partValues[p.id] = { accesa: !!v };
      else if (p.kind === "slide") partValues[p.id] = { frazione: typeof v === "number" ? v : 0 };
      else if (p.kind === "vibrate" || p.kind === "pulse") partValues[p.id] = { active: !!v };
      else if (p.kind === "signal") partValues[p.id] = { entry: typeof v === "number" && v >= 0 ? v : null };
    }
    // The effects follow their input's test value (22-11-2026), as on a page.
    if (compiled.voce) {
      const fx = compiled.voce.parts.filter((p) => p.kind === "glow" || p.kind === "bubbles" || p.kind === "smoke" || p.kind === "flame");
      const legami = Object.fromEntries(Object.entries(preview.parts).map(([k, v]) => [k, { value: v }]));
      Object.assign(partValues, valoriParti(fx, legami, () => undefined));
    }
  }

  // A photo from the project's images (plan 2026-11-21-simboli-fase-3-foto):
  // in the layer of the selection, or under everything as a background.
  const addPhoto = async () => {
    const p = await pickPhoto();
    if (!p) return;
    const op = newImage(p.name, w, h, p.size);
    const layer = sel.length ? layerOf(sel[0]) : ls.find((l) => l.id === targetLayer);
    if (layer) {
      const r = insertInLayer(d, layer.id, op);
      commit(r.d);
      setSel([r.at]);
    } else {
      commit({ ...d, ops: [op, ...d.ops] });
      setSel([0]);
    }
  };

  return (
    <div data-testid="symbol-editor" ref={rootRef} onKeyDown={(e) => e.stopPropagation()} style={{
      position: "fixed", inset: 0, zIndex: 9000, background: C.bg, color: C.text,
      display: "flex", flexDirection: "column", fontSize: 12,
    }}>
      <PhotoPickerHost />
      {/* top bar: the IDE's header (48 px, its buttons) */}
      <div style={{
        height: 48, flexShrink: 0, display: "flex", alignItems: "center", gap: 12, padding: "0 16px",
        background: C.surface, borderBottom: `1px solid ${C.surface2}`,
      }}>
        <strong style={{ fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {t("symbolEditor.title")}: {d[lang]}
        </strong>
        {original && <span style={{ color: C.muted, fontSize: 13 }}>{t("symbolEditor.variantOf", { name: t(original.label) })}</span>}
        <span style={{ color: C.subtle, fontSize: 13, whiteSpace: "nowrap" }}>{t("symbolEditor.usage", { n: use.objects, pages: use.pages })}</span>
        <span style={{ flex: 1 }} />
        {original && saved && <button type="button" style={HDR_BTN} onClick={() => void revert()}>{t("symbolEditor.revert")}</button>}
        <button type="button" style={{ ...HDR_BTN, ...dim(!!compiled.errors.length) }} disabled={!!compiled.errors.length} onClick={() => void exportFile()}
          data-testid="symbol-editor-export" title={t("symbolEditor.file.exportTitle")}>{t("symbolEditor.file.export")}</button>
        {library && (
          <button type="button" style={{ ...HDR_BTN, ...dim(busy || !!compiled.errors.length) }} disabled={busy || !!compiled.errors.length} data-testid="symbol-editor-to-library"
            title={t("symbolLibrary.saveTitle")} onClick={() => void toLibrary()}>{t("symbolLibrary.save")}</button>
        )}
        <button type="button" style={{ ...HDR_BTN, ...dim(busy || !!compiled.errors.length) }} disabled={busy || !!compiled.errors.length} onClick={() => void saveAs()}>{t("symbolEditor.saveAs")}</button>
        <button type="button" data-testid="symbol-editor-save" disabled={busy || !!compiled.errors.length || !dirty}
          style={dirty
            ? { ...HDR_BTN, background: C.accent, borderColor: C.accent, color: "var(--brand-on-primary, #fff)", ...dim(busy || !!compiled.errors.length) }
            : { ...HDR_BTN, ...dim(true) }}
          onClick={() => void save()}>{t("symbolEditor.save")}</button>
        {/* Its own window, or back into the IDE (22-11-2026): the drawing as
            it is now goes along, saved or not. */}
        {inFinestraSimboli ? (
          <button type="button" style={HDR_BTN} data-testid="symbol-editor-bring-back" title={t("symbolEditor.window.backTitle")}
            onClick={() => { riportaNellIde({ ...target, draft: d, isNew: target.isNew && !saved }); window.close(); }}>
            {t("symbolEditor.window.back")}
          </button>
        ) : typeof BroadcastChannel !== "undefined" && (
          <button type="button" style={HDR_BTN} data-testid="symbol-editor-detach" title={t("symbolEditor.window.detachTitle")}
            onClick={() => {
              ricordaStaccato(true);
              if (apriInFinestra({ ...target, draft: d, isNew: target.isNew && !saved, inline: false })) close();
            }}>
            {t("symbolEditor.window.detach")}
          </button>
        )}
        <button type="button" data-testid="symbol-editor-close" style={HDR_BTN} onClick={() => void doClose()}>{t("symbolEditor.close")}</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* layers */}
        <div ref={layersCol} data-testid="symbol-layers-column" style={{ width: layersWidth, flexShrink: 0, overflow: "auto", background: C.surface, display: "flex", flexDirection: "column" }}>
          <div style={barTitle}>{t("symbolEditor.layers")}</div>
          {ls.map((l) => (
            <LayerBlock key={`${l.id}-${l.start}`} id={l.id} title={layerLabel(l, t)} count={l.ops.length}
              target={drawInto.id === l.id}
              onSelect={() => { setTargetLayer(l.id); setSel(l.ops.filter(pickable)); }}
              actions={<>
                {([[-1, "up", "symbolEditor.layerUp"], [1, "down", "symbolEditor.layerDown"]] as const).map(([dir, g, k]) => {
                  const can = moveLayer(d, l.id, dir).at.length > 0;
                  return (
                    <button key={dir} type="button" title={t(k)} aria-label={t(k)} disabled={!can} data-testid={`symbol-layer-${dir < 0 ? "up" : "down"}-${l.id}`}
                      style={layerButton(can)} onClick={() => shiftLayer(l.id, dir)}><EditorIcon name={g} size={13} /></button>
                  );
                })}
                <button type="button" title={t(hidden.has(l.id) ? "symbolEditor.layerShow" : "symbolEditor.layerHide")}
                  aria-label={t(hidden.has(l.id) ? "symbolEditor.layerShow" : "symbolEditor.layerHide")} aria-pressed={hidden.has(l.id)}
                  data-testid={`symbol-layer-hide-${l.id}`} style={layerButton(true, hidden.has(l.id))}
                  onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  <EditorIcon name={hidden.has(l.id) ? "eye-off" : "eye"} size={13} />
                </button>
                <button type="button" title={t(locked.has(l.id) ? "symbolEditor.layerUnlock" : "symbolEditor.layerLock")}
                  aria-label={t(locked.has(l.id) ? "symbolEditor.layerUnlock" : "symbolEditor.layerLock")} aria-pressed={locked.has(l.id)}
                  style={layerButton(true, locked.has(l.id))}
                  onClick={() => setLocked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  <EditorIcon name={locked.has(l.id) ? "lock" : "unlock"} size={13} />
                </button>
                <button type="button" title={t(grouped.has(l.id) ? "symbolEditor.layerUngroup" : "symbolEditor.layerGroup")}
                  aria-label={t(grouped.has(l.id) ? "symbolEditor.layerUngroup" : "symbolEditor.layerGroup")}
                  data-testid={`symbol-layer-group-${l.id}`} aria-pressed={grouped.has(l.id)} disabled={l.ops.length < 2}
                  style={layerButton(l.ops.length >= 2, grouped.has(l.id))}
                  onClick={() => setGrouped((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  <EditorIcon name="group" size={13} />
                </button>
              </>}>
              {/* The list still picks one shape, also of a grouped layer. */}
              <div style={grouped.has(l.id) ? { borderLeft: `2px solid ${C.accent}`, marginLeft: 10 } : undefined}>
              {l.ops.length === 0 && (
                <div data-testid={`symbol-layer-empty-${l.id}`} onClick={() => { setTargetLayer(l.id); setSel([]); }}
                  style={{ ...note, padding: "2px 12px 2px 26px", cursor: "pointer" }}>
                  {t(drawInto.id === l.id ? "symbolEditor.layerEmptyTarget" : "symbolEditor.layerEmptyPick")}
                </div>
              )}
              {l.ops.map((i) => (
                <div key={i} data-testid={`symbol-op-row-${i}`} aria-selected={sel.includes(i)} onClick={(e) => {
                  if (!pickable(i)) return;
                  setSel(e.shiftKey ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]) : [i]);
                }}
                  style={{
                    // The rows of the IDE's tree (`LeftPanel`, `S.row`).
                    display: "flex", alignItems: "center", gap: SPAZIO.s,
                    cursor: pickable(i) ? "pointer" : "default", padding: "3px 12px 3px 26px", fontSize: TESTO.riga,
                    background: sel.includes(i) ? C.surface2 : "transparent",
                    color: sel.includes(i) ? C.text : pickable(i) ? "var(--brand-text-2, #cbd5e1)" : C.subtle,
                  }}>
                  <span style={{ color: sel.includes(i) ? C.accent : C.subtle }}><EditorIcon name={opIcon(d.ops[i] as Op)} size={13} /></span>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {opLabel(d.ops[i] as Op, t)} <span style={{ color: C.subtle }}>#{i + 1}</span>
                  </span>
                </div>
              ))}
              </div>
            </LayerBlock>
          ))}
        </div>
        <ResizeEdge testid="symbol-layers-resize" side="right" onMouseDown={(e) => trascinaBordo(e, {
          larghezza: layersWidth, min: LAYERS_MIN, max: LAYERS_MAX, verso: 1, contenuto: layersCol.current,
          onFine: (l) => { setLayersWidth(l); saveWidth(LAYERS_WIDTH_KEY, l); },
        })} />

        {/* canvas */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {/* The IDE's toolbar, in its order: undo/redo, the view, the grid. */}
          <div style={{ ...BAR, ...TOOLBAR_SCROLL, height: BAR_HEIGHT, boxSizing: "border-box", gap: 6 }}>
            <button type="button" style={{ ...BTN, ...dim(!hist.past.length) }} disabled={!hist.past.length} onClick={undo}
              title={`${t("symbolEditor.undo")} (Ctrl+Z)`} aria-label={t("symbolEditor.undo")}>↶</button>
            <button type="button" style={{ ...BTN, ...dim(!hist.future.length) }} disabled={!hist.future.length} onClick={redo}
              title={`${t("symbolEditor.redo")} (Ctrl+Y)`} aria-label={t("symbolEditor.redo")}>↷</button>
            <div style={SEP} />
            <button type="button" style={BTN} title={t("symbolEditor.zoomOut")} onClick={() => zoomAt(1 / 1.25)}>−</button>
            <span style={{ color: C.muted, minWidth: 44, textAlign: "center", fontFamily: "monospace" }} data-testid="symbol-zoom">{Math.round(view.z * 100)}%</span>
            <button type="button" style={BTN} title={t("symbolEditor.zoomIn")} onClick={() => zoomAt(1.25)}>+</button>
            <button type="button" style={BTN} onClick={fit}><span aria-hidden="true">⊡</span> {t("symbolEditor.fit")}</button>
            <div style={SEP} />
            <label style={check}>
              <input type="checkbox" checked={grid.on} onChange={(e) => setGrid({ ...grid, on: e.target.checked })} style={accent} />{t("symbolEditor.grid")}
            </label>
            <select style={SELECT} value={grid.step} onChange={(e) => setGrid({ ...grid, step: Number(e.target.value) })}
              aria-label={t("symbolEditor.gridStep")}>
              {[5, 10, 20].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label style={check}>
              <input type="checkbox" checked={grid.snap} onChange={(e) => setGrid({ ...grid, snap: e.target.checked })} data-testid="symbol-grid-snap" style={accent} />{t("symbolEditor.gridSnap")}
            </label>
            <label style={check} title={t("symbolEditor.magnetHint")}>
              <input type="checkbox" checked={magnet} onChange={(e) => setMagnet(e.target.checked)} style={accent} />{t("symbolEditor.magnet")}
            </label>
            <div style={SEP} />
            <label style={check} title={t("symbolEditor.explodeHint")}>
              <input type="checkbox" checked={explode.on} data-testid="symbol-explode" style={accent}
                onChange={(e) => { setExplode({ ...explode, on: e.target.checked }); }} />{t("symbolEditor.explode")}
            </label>
            {explode.on && (
              <input type="range" min={0} max={2} step={0.1} value={explode.k} aria-label={t("symbolEditor.explodeAmount")}
                onChange={(e) => setExplode({ ...explode, k: Number(e.target.value) })} style={{ width: 90, ...accent, cursor: "pointer" }} />
            )}
            <span style={{ flex: 1 }} />
            <span style={{ color: C.subtle, whiteSpace: "nowrap" }}>{w} × {h}</span>
          </div>
          {/* The drawing tools, with the IDE's icons. */}
          <div style={{ ...BAR, ...TOOLBAR_SCROLL, height: BAR_HEIGHT, boxSizing: "border-box", gap: 2, background: C.bg }}>
            {TOOLS.map((k) => (
              <button key={k} type="button" data-testid={`symbol-tool-${k}`} aria-pressed={tool === k}
                style={{ ...BTN, ...toggled(tool === k), ...(tool === k ? { color: C.text } : {}) }}
                onClick={() => { setPoly([]); setTool(k); }} title={k === "poly" ? t("symbolEditor.polyHint") : undefined}>
                <EditorIcon name={k} />{t(`symbolEditor.tool.${k}`)}
              </button>
            ))}
            <div style={{ ...SEP, margin: "0 6px" }} />
            <button type="button" style={BTN} data-testid="symbol-import-svg" title={t("symbolEditor.svg.importTitle")}
              onClick={() => svgInput.current?.click()}><EditorIcon name="importSvg" />{t("symbolEditor.svg.import")}</button>
            <input ref={svgInput} type="file" accept=".svg,image/svg+xml" style={{ display: "none" }} data-testid="symbol-import-svg-file"
              onChange={(e) => { void importSvgFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button type="button" style={BTN} data-testid="symbol-add-photo" title={t("symbolEditor.photo.addTitle")}
              onClick={() => void addPhoto()}><EditorIcon name="photo" />{t("symbolEditor.photo.add")}</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex" }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); e.stopPropagation(); } }}
            onDrop={(e) => {
              if (!e.dataTransfer.files.length) return;
              // Any file: the browser would otherwise open it in place of the IDE.
              e.preventDefault();
              e.stopPropagation();
              const f = [...e.dataTransfer.files].find((x) => x.type === "image/svg+xml" || /\.svg$/i.test(x.name));
              if (f) void importSvgFile(f);
            }}>
            <svg ref={svgRef} data-testid="symbol-editor-canvas"
              viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
              style={{ flex: 1, minWidth: 0, cursor: drag?.kind === "pan" ? "grabbing" : tool === "select" ? "default" : "crosshair", touchAction: "none" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onWheel={onWheel}
              onDoubleClick={() => { if (tool === "poly") finishPoly(false); }}
              onPointerLeave={() => setHover(null)}>
              <defs>
                <pattern id="sym-edit-grid" width={grid.step} height={grid.step} patternUnits="userSpaceOnUse">
                  <path d={`M${grid.step} 0 L0 0 0 ${grid.step}`} fill="none" stroke={C.border} strokeWidth={0.2 * u} />
                </pattern>
              </defs>
              <rect x={0} y={0} width={w} height={h} fill={C.surface} />
              <rect x={0} y={0} width={w} height={h} fill={grid.on ? "url(#sym-edit-grid)" : "none"} stroke={C.subtle} strokeWidth={0.3 * u} strokeDasharray={`${2 * u} ${2 * u}`} />
              {/* Nothing drawn: no drawing, not the last one that compiled. */}
              {compiled.svg && compiled.voce && manifesto && !nothingDrawn(d) && (
                <g ref={drawRef}>
                  <SimboloLibSvg sim={compiled.voce} svg={compiled.svg} manifesto={manifesto} prefisso="sym-edit"
                    x={0} y={0} w={w} h={h}
                    valori={trying
                      ? { corpo: stateColour, livello: preview.level, gira: preview.spin, periodoS: 2, parti: partValues,
          animate: preview.animate, blinkMs: 800 }
                      : { corpo: null, gira: false, periodoS: 2 }}
                    progetto={projectStyle} />
                </g>
              )}
              {/* What lies past the frame (a photo, the only thing allowed
                  there) is shown dimmed: on the page it is cut away. */}
              {!trying && (
                <path d={`M${-10 * w} ${-10 * h}H${11 * w}V${11 * h}H${-10 * w}Z M0 0V${h}H${w}V0Z`}
                  fillRule="evenodd" fill={C.surface} fillOpacity={0.7} style={{ pointerEvents: "none" }}
                  data-testid="symbol-outside-frame" />
              )}
              {/* part geometry: the level window and the anchors */}
              {!trying && parts.map((p) => {
                // An input with no layer has no geometry to show (22-11-2026).
                const g = ((d.ops[p.op] as Op).geo ?? {}) as Record<string, number>;
                if (p.kind === "level") return (
                  <rect key={p.id} x={g.x} y={g.y} width={g.w} height={g.h} fill="none" stroke={C.accent}
                    strokeWidth={0.4 * u} strokeDasharray={`${1.5 * u} ${u}`} pointerEvents="none" />
                );
                if (p.kind === "slide") {
                  // Where the slide goes: its shapes' outline moved by (dx, dy),
                  // dashed, with a handle in the middle to drag it.
                  const layer = ls.find((l) => l.start === p.op);
                  const b = union((layer?.ops ?? []).map((i) => realBox(i)).filter((x): x is Box => !!x));
                  if (!b) return null;
                  const dd: [number, number] = drag?.kind === "slide" && drag.op === p.op
                    ? drag.cur : [Number(g.dx) || 0, Number(g.dy) || 0];
                  const cx = b.x + b.w / 2 + dd[0], cy = b.y + b.h / 2 + dd[1];
                  return (
                    <g key={p.id} data-testid={`symbol-slide-${p.id}`}>
                      <rect x={b.x + dd[0]} y={b.y + dd[1]} width={b.w} height={b.h} fill="none" stroke={C.accent}
                        strokeWidth={0.4 * u} strokeDasharray={`${1.5 * u} ${u}`} pointerEvents="none" />
                      <line x1={b.x + b.w / 2} y1={b.y + b.h / 2} x2={cx} y2={cy} stroke={C.accent} strokeWidth={0.3 * u}
                        strokeDasharray={`${u} ${u}`} pointerEvents="none" />
                      <circle cx={cx} cy={cy} r={2.2 * u} fill={C.bg} stroke={C.accent} strokeWidth={0.5 * u} style={{ cursor: "move" }}
                        data-testid={`symbol-slide-handle-${p.id}`}
                        onPointerDown={startSlide(p.op, [Number(g.dx) || 0, Number(g.dy) || 0])} />
                    </g>
                  );
                }
                if (typeof g.cx !== "number") return null;
                const live = drag?.kind === "anchor" && drag.op === p.op ? drag.cur : [g.cx, g.cy];
                const active = oneLayer?.id === p.id;
                return (
                  <g key={p.id} style={{ cursor: "move" }} onPointerDown={startAnchor(p.op)} data-testid={`symbol-anchor-${p.id}`}>
                    <circle cx={live[0]} cy={live[1]} r={2.2 * u} fill="transparent" stroke={active ? C.danger : C.accent} strokeWidth={0.5 * u} />
                    <path d={`M${live[0] - 3.5 * u} ${live[1]} H${live[0] + 3.5 * u} M${live[0]} ${live[1] - 3.5 * u} V${live[1] + 3.5 * u}`}
                      stroke={active ? C.danger : C.accent} strokeWidth={0.4 * u} />
                  </g>
                );
              })}
              {/* the pipe ports: where a pipe attaches, and which way it leaves */}
              {portList.map((q) => {
                const [x, y] = drag?.kind === "port" && drag.op === q.op ? drag.cur : [q.x, q.y];
                const [ox, oy] = OUT[q.side];
                const r = Math.max(q.d / 2, 1.5 * u);
                const on = sel.includes(q.op);
                return (
                  <g key={`port-${q.op}`} data-testid={`symbol-port-${q.id}`} style={{ cursor: "move" }}>
                    <circle cx={x} cy={y} r={r} fill={on ? C.port : "transparent"} fillOpacity={on ? 0.35 : 1}
                      stroke={C.port} strokeWidth={(on ? 0.7 : 0.45) * u} />
                    <path d={`M${x} ${y} L${x + ox * (r + 4 * u)} ${y + oy * (r + 4 * u)}`} stroke={C.port} strokeWidth={0.5 * u} />
                    <text x={x + ox * (r + 5.5 * u)} y={y + oy * (r + 5.5 * u) + u} fontSize={3.2 * u} fill={C.port}
                      textAnchor={ox < 0 ? "end" : ox > 0 ? "start" : "middle"} pointerEvents="none">{q.id}</text>
                  </g>
                );
              })}
              {/* the calamita's guides */}
              {guides.x !== undefined && <line x1={guides.x} x2={guides.x} y1={view.cy - vh} y2={view.cy + vh} stroke={C.danger} strokeWidth={0.3 * u} pointerEvents="none" />}
              {guides.y !== undefined && <line y1={guides.y} y2={guides.y} x1={view.cx - vw} x2={view.cx + vw} stroke={C.danger} strokeWidth={0.3 * u} pointerEvents="none" />}
              {/* selection */}
              {selBox && drag?.kind !== "draw" && drag?.kind !== "marquee" && (() => {
                const b = drag?.kind === "resize" ? drag.cur
                  : drag?.kind === "move" ? { ...selBox, x: selBox.x + drag.d[0], y: selBox.y + drag.d[1] } : selBox;
                const hs = 2.4 * u;
                // In the exploded view the shapes of a selection move apart: no handles,
                // unless they move together (a grouped layer).
                const handles = !explode.on || new Set(sel.map((i) => String(offsets.get(i)))).size <= 1;
                return (
                  <g>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={C.accent} strokeWidth={0.4 * u}
                      strokeDasharray={`${u} ${0.6 * u}`} pointerEvents="none" />
                    {handles && ([[0, 0], [1, 0], [0, 1], [1, 1]] as [0 | 1, 0 | 1][]).map(([cx, cy]) => (
                      <rect key={`${cx}${cy}`} x={b.x + cx * b.w - hs / 2} y={b.y + cy * b.h - hs / 2} width={hs} height={hs}
                        fill={C.bg} stroke={C.accent} strokeWidth={0.4 * u}
                        style={{ cursor: cx === cy ? "nwse-resize" : "nesw-resize" }}
                        data-testid={`symbol-resize-${cx}${cy}`}
                        onPointerDown={startResize([cx, cy])} />
                    ))}
                  </g>
                );
              })()}
              {drag?.kind === "marquee" && (() => {
                const [ax, ay] = drag.start, [bx, by] = drag.cur;
                return <rect data-testid="symbol-marquee" x={Math.min(ax, bx)} y={Math.min(ay, by)} width={Math.abs(bx - ax)} height={Math.abs(by - ay)}
                  fill={C.accent} fillOpacity={0.08} stroke={C.accent} strokeWidth={0.3 * u} strokeDasharray={`${u} ${u}`} pointerEvents="none" />;
              })()}
              {drag?.kind === "draw" && (() => {
                const [x0, y0] = drag.start, [x1, y1] = drag.cur;
                if (tool === "line") return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={C.accent} strokeWidth={0.6 * u} />;
                const b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
                if (tool === "rect") return <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={C.accent} strokeWidth={0.6 * u} />;
                if (tool === "circle") return <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={Math.min(b.w, b.h) / 2} fill="none" stroke={C.accent} strokeWidth={0.6 * u} />;
                return <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="none" stroke={C.accent} strokeWidth={0.6 * u} />;
              })()}
              {poly.length > 0 && (
                <g pointerEvents="none" data-testid="symbol-poly">
                  <polyline points={[...poly, ...(hover ? [hover] : [])].map((q) => q.join(",")).join(" ")}
                    fill="none" stroke={C.accent} strokeWidth={0.6 * u} />
                  {poly.map((q, k) => <circle key={k} cx={q[0]} cy={q[1]} r={(k === 0 ? 1.6 : 1) * u} fill={C.accent} />)}
                </g>
              )}
            </svg>
          </div>
          {nothingDrawn(d) && (
            <div data-testid="symbol-editor-empty" style={{ borderTop: `1px solid ${C.border}`, padding: 8, color: C.muted }}>
              {t("symbolEditor.drawFirst")}
            </div>
          )}
          {oldFx > 0 && (
            <div data-testid="symbol-editor-old-fx" style={{ borderTop: `1px solid ${C.border}`, padding: 8, color: C.muted, fontSize: 12, display: "flex", gap: 8 }}>
              <span style={{ flex: 1 }}>{t("symbolEditor.fx.oldRemoved", { n: oldFx })}</span>
              <button type="button" style={button} onClick={() => setOldFx(0)}>✕</button>
            </div>
          )}
          {compiled.errors.length > 0 && !nothingDrawn(d) && (
            <div data-testid="symbol-editor-errors" style={{ borderTop: `1px solid ${C.border}`, padding: 8, color: C.danger, maxHeight: 120, overflow: "auto" }}>
              <strong>{t("symbolEditor.errors")}</strong>
              {compiled.errors.map((m, k) => <div key={k}>{m}</div>)}
            </div>
          )}
        </div>

        {/* properties */}
        <ResizeEdge testid="symbol-props-resize" side="left" onMouseDown={(e) => trascinaBordo(e, {
          larghezza: propsWidth, min: PROPS_MIN, max: PROPS_MAX, verso: -1, contenuto: propsCol.current,
          onFine: (l) => { setPropsWidth(l); saveWidth(PROPS_WIDTH_KEY, l); },
        })} />
        <div ref={propsCol} data-testid="symbol-props-column" style={{ width: propsWidth, flexShrink: 0, overflow: "auto", display: "flex", flexDirection: "column", background: C.surface }}>
          <div role="tablist" style={{ ...barTitle, padding: 0, gap: 0 }}>
            {/* What the column shows: the symbol (nothing selected), the
                selection, or the test bench. «Symbol» clears the selection. */}
            {([
              ["structure", t("symbolEditor.tab.symbol"), tab === "inspect" && sel.length === 0, () => { setSel([]); setTab("inspect"); }],
              ["piece", sel.length ? t("symbolEditor.tab.selection", { n: sel.length }) : t("symbolEditor.tab.selectionNone"), tab === "inspect" && sel.length > 0, () => setTab("inspect")],
              ["try", t("symbolEditor.tab.try"), tab === "try", () => setTab(tab === "try" ? "inspect" : "try")],
            ] as [string, string, boolean, () => void][]).map(([k, label, on, go]) => (
              <button key={k} type="button" role="tab" aria-selected={on} onClick={go} data-testid={`symbol-tab-${k}`}
                disabled={k === "piece" && !sel.length} style={{
                flex: 1, height: "100%", border: "none", borderBottom: `2px solid ${on ? C.accent : "transparent"}`,
                background: "transparent", cursor: k === "piece" && !sel.length ? "default" : "pointer", fontFamily: "inherit",
                fontSize: TESTO.titoloSezione, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase",
                color: on ? C.text : C.muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              }}>{label}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {tab === "inspect" && sel.length > 0 ? (
              one?.op === "bocca" ? (
                <Section id="port" title={`${t("symbolEditor.port.one")} ${String(one.id ?? "")}`}>
                  <PortProps d={d} port={portList.find((q) => q.op === sel[0])!} pipes={pipes.get(String(one.id))?.total ?? 0}
                    commit={commit} onRename={renamePort} onDel={del} />
                </Section>
              ) : (
                <PieceProps d={d} sel={sel} one={one} layer={oneLayer} layers={ls} catalog={catalog} commit={commit}
                  fx={<FxProps d={d} sel={sel} commit={commit} setSel={setSel} latest={latest} onCreated={partCreated} />}
                  onPhotoSignal={() => void animate(drawing(sel), "signal")}
                  onDup={dup} onDel={del} onReorder={(dir) => { const r = reorderOp(d, sel[0], dir); commit(r.d); setSel([r.at]); }}
                  onMoveToLayer={(id) => {
                    const r = id === NEW_LAYER ? moveToNewLayer(d, drawing(sel)) : moveToLayer(d, drawing(sel), id);
                    commit(r.d);
                    setSel(r.at);
                  }}
                  transform={(
                    <TransformBlock canTurn={sel.some((i) => turns(d.ops[i] as Op))}
                      turnHint={sel.some((i) => (d.ops[i] as Op)?.op === "image") ? t("symbolEditor.turnPhoto") : undefined}
                      canAlign={nDrawing > 1} canDistribute={nDrawing > 2}
                      onTurn={turn} onAlign={doAlign} onDistribute={doDistribute} onFill={doFill} />
                  )}
                  animation={nDrawing > 0 ? (
                    <AnimateBlock d={d} partOp={selPart?.start} commit={commit}
                      onAnimate={(k) => void animate(selPart ? selPart.ops : drawing(sel), k)}
                      onRemove={() => { if (selPart) void removeAsking(selPart.start); }} />
                  ) : undefined} />
              )
            ) : tab === "inspect" ? (
              <>
                <StructureProps d={d} catalog={catalog} commit={commit} isVariant={!!d.overrides}
                  ports={portList} pipes={pipes} onSelectPort={(op) => setSel([op])}
                  onRenamePart={renamePartTracked} onCreated={partCreated} latest={latest}
                  onRemoveInput={(op) => void removeAsking(op)} />
                {!nothingDrawn(d) && (
                  <Section id="frame" title={t("symbolEditor.transform.frame")}>
                    <button type="button" style={button} title={t("symbolEditor.fillFrameHint")} onClick={doFill}
                      data-testid="symbol-fill-frame-symbol">⛶ {t("symbolEditor.fillFrame")}</button>
                  </Section>
                )}
                <Section id="ai-draw" title={t("symbolEditor.section.aiDraw")}>
                  <AiPanel d={d} commit={commit} current={compiled} manifesto={manifesto} projectStyle={projectStyle} />
                </Section>
                <Section id="ai-photo" title={t("symbolEditor.aiPhoto.title")}>
                  <AiPhoto d={d} commit={commit} />
                </Section>
              </>
            ) : (
              <Section id="try" title={t("symbolEditor.section.try")}>
                <TryProps d={d} parts={parts} hasState={ins.some((i) => i.kind === "state")} preview={preview} setPreview={setPreview} />
              </Section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the side panels ──

/** The bar on top of a side column: the height of the canvas tools, so the
 *  three columns start on one line (21-11-2026), in the style of the IDE's
 *  view titles (`TitoloVista`). */
const barTitle: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: SPAZIO.s, flexShrink: 0, height: BAR_HEIGHT, boxSizing: "border-box",
  padding: `0 ${SPAZIO.m}px`, fontSize: TESTO.titoloSezione, fontWeight: 700, letterSpacing: 0.5,
  textTransform: "uppercase", color: C.muted, background: C.surface, borderBottom: `1px solid ${C.surface2}`,
};

/** The canvas toolbars scroll sideways instead of cutting the last tools when
 *  the columns are wide (22-11-2026), with a thin scrollbar only when needed;
 *  their buttons keep their size. */
const TOOLBAR_SCROLL: React.CSSProperties = { overflowX: "auto", overflowY: "hidden", scrollbarWidth: "thin", flexShrink: 0 };

const LAYERS_WIDTH_KEY = "sws.simboli.larghezza.strati";
const PROPS_WIDTH_KEY = "sws.simboli.larghezza.proprieta";
const LAYERS_MIN = 160, LAYERS_MAX = 480;
const PROPS_MIN = 240, PROPS_MAX = 600;

function storedWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return v >= min && v <= max ? v : fallback;
  } catch { return fallback; }
}
function saveWidth(key: string, v: number) {
  try { localStorage.setItem(key, String(Math.round(v))); } catch { /* private window: it is only a preference */ }
}

/** The border between a side column and the canvas, dragged to resize: the
 *  IDE's handle (`EditorShell`, the right panel), here a 5-px strip that is
 *  also the column's border line. */
function ResizeEdge({ side, testid, onMouseDown }: { side: "left" | "right"; testid: string; onMouseDown: (e: React.MouseEvent) => void }) {
  const { t } = useTranslation();
  return (
    <div role="separator" aria-orientation="vertical" data-testid={testid} title={t("editor.dragToResize")} onMouseDown={onMouseDown}
      style={{ width: 5, flexShrink: 0, cursor: "ew-resize", background: "transparent",
        [side === "right" ? "borderLeft" : "borderRight"]: `1px solid ${C.surface2}` }} />
  );
}

/** A layer of the list: opens and closes like a section of the IDE (the arrow),
 *  and the name picks its shapes, as before. */
function LayerBlock({ id, title, count, target, onSelect, actions, children }: {
  id: string; title: string; count: number;
  /** New shapes go into this layer: marked like the IDE's active row. */
  target: boolean;
  onSelect: () => void; actions: React.ReactNode; children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const [open, toggle] = useSezioneAperta(`simboli.strato.${id}`, true);
  return (
    <div data-testid={`symbol-layer-${id}`} data-target={target || undefined}
      style={{ borderBottom: `1px solid ${C.surface2}`, padding: `${SPAZIO.xs}px 0`,
        boxShadow: target ? `inset 2px 0 0 ${C.accent}` : undefined }}>
      <div title={target ? t("symbolEditor.layerTarget") : undefined}
        style={{ display: "flex", alignItems: "center", gap: SPAZIO.xs, padding: `2px ${SPAZIO.s}px 2px ${SPAZIO.m}px` }}>
        <button type="button" onClick={toggle} aria-expanded={open} title={t(open ? "symbolEditor.collapse" : "symbolEditor.expand")}
          data-testid={`symbol-layer-toggle-${id}`}
          style={{ border: "none", background: "transparent", cursor: "pointer", padding: 0, width: 12, fontSize: 10, color: C.subtle }}>
          {open ? "▾" : "▸"}
        </button>
        <span onClick={onSelect} title={`${title} — ${t("symbolEditor.layerSelect")}`} data-testid={`symbol-layer-name-${id}`} style={{
          flex: 1, minWidth: 0, cursor: "pointer", fontSize: TESTO.titoloSezione, fontWeight: 700, letterSpacing: 0.3,
          color: target ? C.text : "var(--brand-text-2, #cbd5e1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
        }}>{title} <span style={{ fontWeight: 400, color: C.subtle }}>({count})</span></span>
        {actions}
      </div>
      {open && <div style={{ paddingTop: 2 }}>{children}</div>}
    </div>
  );
}
// ──────────────────────────────────────────────────────




function MaterialSelect({ value, catalog, onChange }: { value: string; catalog: Catalog | null; onChange: (m: string) => void }) {
  const colour = catalog?.materials.find((m) => m.name === value)?.color;
  return (
    <>
      <span style={{ width: 16, height: 16, borderRadius: 3, flexShrink: 0, background: colour, border: `1px solid ${C.border}` }} />
      <select style={input} value={value} onChange={(e) => onChange(e.target.value)}>
        {(catalog?.materials ?? [{ name: value, color: "" }]).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
      </select>
    </>
  );
}

function PieceProps({ d, sel, one, layer, layers: ls, catalog, commit, onDup, onDel, onReorder, onMoveToLayer, animation, transform, fx, onPhotoSignal }: {
  d: DescrizioneSimbolo; sel: number[]; one?: Op; layer?: Layer; layers: Layer[]; catalog: Catalog | null;
  commit: (d: DescrizioneSimbolo) => void; onDup: () => void; onDel: () => void; onReorder: (dir: 1 | -1) => void;
  onMoveToLayer: (layerId: string) => void;
  /** The «Animate» block, when the selection draws something. */
  animation?: React.ReactNode;
  /** Turn, flip, align and distribute (`TransformBlock`). */
  transform?: React.ReactNode;
  /** Group, effects and mask (`FxProps`, 22-11-2026). */
  fx?: React.ReactNode;
  /** «Change with an input» on a photo: it becomes a signal whose entries
   *  each show a photo (22-11-2026). */
  onPhotoSignal?: () => void;
}) {
  const { t } = useTranslation();
  if (!sel.length) return <p style={{ ...note, padding: `${SPAZIO.m}px ${SPAZIO.m + 2}px` }}>{t("symbolEditor.noSelection")}</p>;
  const arrange = (
    <Section id="arrange" title={t("symbolEditor.section.arrange")}>
      <Field label={t("symbolEditor.moveToLayer")}>
        <select style={input} value="" data-testid="symbol-move-to-layer" onChange={(e) => { if (e.target.value) onMoveToLayer(e.target.value); }}>
          <option value="" />
          {ls.filter((l) => l.id !== layer?.id).map((l) => <option key={`${l.id}-${l.start}`} value={l.id}>{layerLabel(l, t)}</option>)}
          <option value={NEW_LAYER}>{t("symbolEditor.newLayer")}</option>
        </select>
      </Field>
      <div style={{ display: "flex", gap: SPAZIO.xs, flexWrap: "wrap" }}>
        {one && <button type="button" style={button} onClick={() => onReorder(1)}>{t("symbolEditor.up")}</button>}
        {one && <button type="button" style={button} onClick={() => onReorder(-1)}>{t("symbolEditor.down")}</button>}
        <button type="button" style={button} onClick={onDup}>{t("symbolEditor.duplicate")}</button>
        <button type="button" style={{ ...button, color: C.danger }} onClick={onDel}>{t("symbolEditor.delete")}</button>
      </div>
    </Section>
  );
  const head = (text: React.ReactNode) => (
    <div style={{ padding: `${SPAZIO.m}px ${SPAZIO.m + 2}px ${SPAZIO.s}px`, fontSize: TESTO.riga, fontWeight: 700 }}>{text}</div>
  );
  const anim = animation && <Section id="animation" title={t("symbolEditor.anim.animation")}>{animation}</Section>;
  const turnAlign = transform && <Section id="transform" title={t("symbolEditor.section.transform")}>{transform}</Section>;
  if (!one) return <>{head(t("symbolEditor.manySelected", { n: sel.length }))}{anim}{fx}{turnAlign}{arrange}</>;
  const i = sel[0];
  const fill = fillOf(one);
  const geo = Array.isArray(one.geo) ? (one.geo as [string, number | string][]) : [];
  const sw = extraOf(one, "stroke_width");
  const inBody = layer?.kind === "body";
  const fillKind = !fill ? "" : "mat" in fill ? "mat" : "color" in fill ? "color" : "none" in fill ? "none" : "body";
  const isShape = one.op === "forma";
  const isLine = one.op === "tratto";
  const pathD = isLine ? String(one.d ?? "") : String(geo.find(([k]) => k === "d")?.[1] ?? "");
  const stroke = extraOf(one, "stroke");
  const strokeKind = stroke === undefined ? "layer" : stroke === "none" ? "none" : "color";
  const num = (k: string) => { const v = extraOf(one, k); return typeof v === "number" ? v : typeof v === "string" && v !== "" ? Number(v) : undefined; };
  const numbers = geo.filter(([, v]) => typeof v === "number") as [string, number][];
  return (
    <>
      {head(<>{opLabel(one, t)} #{i + 1}
        {layer && <span style={{ color: C.subtle, fontWeight: 400 }}> · {layerLabel(layer, t)}</span>}</>)}
      {anim}
      {fx}
      {(numbers.length > 0 || isLine || (isShape && one.tag === "path")) && (
        <Section id="geometry" title={t("symbolEditor.section.geometry")}>
          {numbers.map(([k, v]) => (
            <Field key={k} label={k}><Num value={v} onChange={(n) => commit(setGeo(d, i, k, n))} /></Field>
          ))}
          {(isLine || (isShape && one.tag === "path")) && <PathField value={pathD} onChange={(v) => commit(setPathD(d, i, v))} />}
        </Section>
      )}
      {turnAlign}
      {one.op === "image" && (
        <Section id="photo" title={t("symbolEditor.section.photo")}>
          <Field label={t("symbolEditor.photo.file")}>
            <button type="button" style={{ ...input, textAlign: "left", cursor: "pointer" }} data-testid="symbol-photo-change" title={t("symbolEditor.photo.change")}
              onClick={() => void pickPhoto().then((p) => {
                if (p) commit({ ...d, ops: (d.ops as Op[]).map((o, k) => (k === i ? { ...o, src: p.name } : o)) });
              })}>{String(one.src ?? "")}</button>
          </Field>
          <Field label={t("symbolEditor.photo.opacity")}>
            <Num value={typeof one.opacity === "number" ? one.opacity : 1} step={0.05}
              onChange={(n) => commit(setImageOpacity(d, i, n))} />
          </Field>
          <p style={note}>{t("symbolEditor.photo.note")}</p>
        </Section>
      )}
      {/* «Foto per stato», where it is looked for (22-11-2026, anomaly 8 of the
          rc.28 test run): on the photo itself. In a signal already, its
          entries (each with a photo) are in «Animation» above. */}
      {one.op === "image" && layer?.kind !== "signal" && onPhotoSignal && (
        <Section id="photo-signal" title={t("symbolEditor.photo.byInput")}>
          <button type="button" style={button} data-testid="symbol-photo-signal" onClick={onPhotoSignal}>
            {t("symbolEditor.photo.byInputButton")}
          </button>
          <p style={note}>{t("symbolEditor.photo.byInputNote")}</p>
        </Section>
      )}
      {(isShape || isLine) && fill && (
        <Section id="fill" title={t(isLine ? "symbolEditor.lineColour" : "symbolEditor.section.fill")}>
          <Field label={t(isLine ? "symbolEditor.lineColour" : "symbolEditor.colour")}>
            <select style={input} value={fillKind} data-testid="symbol-fill-kind" onChange={(e) => {
              const k = e.target.value;
              commit(setFill(d, i, k === "mat" ? { mat: "steel" } : k === "color" ? { color: "#808080" } : k === "none" ? { none: true } : { body: true }));
            }}>
              <option value="mat">{t("symbolEditor.fill.material")}</option>
              <option value="color">{t("symbolEditor.fill.own")}</option>
              {isShape && <option value="none">{t("symbolEditor.fill.none")}</option>}
              {(inBody || fillKind === "body") && isShape && <option value="body">{t("symbolEditor.fill.body")}</option>}
            </select>
          </Field>
          {"mat" in fill && <Field label=""><MaterialSelect value={fill.mat} catalog={catalog} onChange={(m) => commit(setFill(d, i, { mat: m }))} /></Field>}
          {"color" in fill && <Field label=""><input type="color" style={{ ...input, padding: 0, height: 24 }} value={fill.color}
            onChange={(e) => commit(setFill(d, i, { color: e.target.value }))} /></Field>}
          {fillKind === "color" && <p style={note}>{t("symbolEditor.ownColourNote")}</p>}
          {isShape && (
            <Field label={t("symbolEditor.veil")}>
              <select style={input} value={String(one.velo ?? "")} onChange={(e) => commit(setVeil(d, i, e.target.value || null))}>
                <option value="">{t("symbolEditor.noVeil")}</option>
                {catalog?.veils.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
              </select>
            </Field>
          )}
          {isShape && (
            <Field label={t("symbolEditor.fillOpacity")}>
              <Num value={num("fill_opacity") ?? 1} step={0.05} onChange={(n) => commit(setExtra(d, i, "fill_opacity", n >= 1 ? undefined : Math.max(0, n)))} />
            </Field>
          )}
        </Section>
      )}
      {(isShape || isLine) && (
        <Section id="outline" title={t("symbolEditor.section.outline")}>
          {isShape && (
            <Field label={t("symbolEditor.outline")}>
              <select style={input} value={strokeKind} data-testid="symbol-stroke-kind" onChange={(e) => {
                const k = e.target.value;
                commit(setExtra(d, i, "stroke", k === "layer" ? undefined : k === "none" ? "none" : "#1c2329" /* fixed-colour */));
              }}>
                <option value="layer">{t("symbolEditor.outlineLayer")}</option>
                <option value="color">{t("symbolEditor.fill.own")}</option>
                <option value="none">{t("symbolEditor.outlineNone")}</option>
              </select>
            </Field>
          )}
          {isShape && strokeKind === "color" && <Field label=""><input type="color" style={{ ...input, padding: 0, height: 24 }} value={String(stroke)}
            onChange={(e) => commit(setExtra(d, i, "stroke", e.target.value))} /></Field>}
          <Field label={t("symbolEditor.strokeWidth")}>
            <Num value={typeof sw === "number" ? sw : 1} step={0.1} onChange={(n) => commit(setGeo(d, i, "stroke_width", Math.max(0, Math.min(20, n))))} />
          </Field>
          <Field label={t("symbolEditor.strokeOpacity")}>
            <Num value={num("stroke_opacity") ?? 1} step={0.05} onChange={(n) => commit(setExtra(d, i, "stroke_opacity", n >= 1 ? undefined : Math.max(0, n)))} />
          </Field>
          <Field label={t("symbolEditor.dash")}>
            <input style={input} placeholder="4 2" defaultValue={String(extraOf(one, "stroke_dasharray") ?? "")} key={`dash-${i}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v === "" || /^[0-9.]+([ ,][0-9.]+)*$/.test(v)) commit(setExtra(d, i, "stroke_dasharray", v || undefined));
              }} />
          </Field>
          <Field label={t("symbolEditor.linecap")}>
            <select style={input} value={String(extraOf(one, "stroke_linecap") ?? "")}
              onChange={(e) => commit(setExtra(d, i, "stroke_linecap", e.target.value || undefined))}>
              <option value="">—</option>
              {["butt", "round", "square"].map((c) => <option key={c} value={c}>{t(`symbolEditor.cap.${c}`)}</option>)}
            </select>
          </Field>
        </Section>
      )}
      {arrange}
    </>
  );
}

/** Turn, flip, align and distribute the selection: in the panel, as the IDE's
 *  alignment of several objects (`MultiSelectionProps`), and no longer in a
 *  second canvas toolbar (22-11-2026). */
function TransformBlock({ canTurn, turnHint, canAlign, canDistribute, onTurn, onAlign, onDistribute, onFill }: {
  canTurn: boolean; canAlign: boolean; canDistribute: boolean;
  /** Why a photo in the selection doesn't turn: said, not done in silence. */
  turnHint?: string;
  onTurn: (how: "cw" | "ccw" | "flipH" | "flipV") => void;
  onAlign: (m: AlignMode) => void;
  onDistribute: (axis: "h" | "v") => void;
  /** The whole drawing on the frame; absent where it doesn't apply. */
  onFill?: () => void;
}) {
  const { t } = useTranslation();
  const b = (enabled: boolean): React.CSSProperties => ({
    ...button, flex: 1, fontSize: 13, padding: "4px 0", color: "var(--brand-text-2, #cbd5e1)", ...dim(!enabled),
  });
  const row = (label: string, children: React.ReactNode) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ color: C.muted, fontSize: TESTO.etichetta }}>{label}</span>
      <div style={{ display: "flex", gap: SPAZIO.xs }}>{children}</div>
    </div>
  );
  return (
    <>
      {row(t("symbolEditor.transform.turn"), <>
        <button type="button" style={b(canTurn)} disabled={!canTurn} title={turnHint ?? t("symbolEditor.turnCw")} onClick={() => onTurn("cw")} data-testid="symbol-turn-cw">⟳</button>
        <button type="button" style={b(canTurn)} disabled={!canTurn} title={turnHint ?? t("symbolEditor.turnCcw")} onClick={() => onTurn("ccw")}>⟲</button>
        <button type="button" style={b(canTurn)} disabled={!canTurn} title={turnHint ?? t("symbolEditor.flipH")} onClick={() => onTurn("flipH")}>⇋</button>
        <button type="button" style={b(canTurn)} disabled={!canTurn} title={turnHint ?? t("symbolEditor.flipV")} onClick={() => onTurn("flipV")}>⇵</button>
      </>)}
      {turnHint && (
        <span data-testid="symbol-turn-photo" style={{ color: C.muted, fontSize: TESTO.etichetta }}>{turnHint}</span>
      )}
      {row(t("symbolEditor.transform.align"), (
        ([["left", "⇤"], ["hcenter", "↔"], ["right", "⇥"], ["top", "⤒"], ["vcenter", "↕"], ["bottom", "⤓"]] as [AlignMode, string][]).map(([m, g]) => (
          <button key={m} type="button" style={b(canAlign)} disabled={!canAlign} title={t(`symbolEditor.align.${m}`)}
            onClick={() => onAlign(m)} data-testid={`symbol-align-${m}`}>{g}</button>
        ))
      ))}
      {row(t("symbolEditor.transform.distribute"), <>
        <button type="button" style={b(canDistribute)} disabled={!canDistribute} title={t("symbolEditor.distributeH")} onClick={() => onDistribute("h")}>⋯</button>
        <button type="button" style={b(canDistribute)} disabled={!canDistribute} title={t("symbolEditor.distributeV")} onClick={() => onDistribute("v")}>⋮</button>
      </>)}
      {onFill && row(t("symbolEditor.transform.frame"), (
        <button type="button" style={{ ...b(true), fontSize: TESTO.etichetta }} title={t("symbolEditor.fillFrameHint")}
          onClick={onFill} data-testid="symbol-fill-frame">⛶ {t("symbolEditor.fillFrame")}</button>
      ))}
    </>
  );
}

/** The `d` of a path as text: applied when it leaves the field, if valid. */
function PathField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const one = v.replace(/\s+/g, " ").trim();
  const ok = validPathD(one);
  return (
    <>
      <span style={{ color: C.muted }}>{t("symbolEditor.pathD")}</span>
      <textarea style={{ ...input, fontFamily: "ui-monospace, monospace", minHeight: 56, borderColor: ok ? undefined : C.danger }}
        value={v} onChange={(e) => setV(e.target.value)} data-testid="symbol-path-d"
        onBlur={() => { if (ok && one !== value) onChange(one); else if (!ok) setV(value); }} />
      {!ok && <span style={{ color: C.danger, fontSize: 11 }}>{t("symbolEditor.pathDRule")}</span>}
    </>
  );
}

/** «Try»: the symbol as a page would show it, with the values of its inputs. */
function TryProps({ d, parts, hasState, preview, setPreview }: {
  d: DescrizioneSimbolo; parts: { id: string; kind: InputKind; op: number }[]; hasState: boolean; preview: Preview;
  setPreview: (p: Preview) => void;
}) {
  const { t } = useTranslation();
  const part = (id: string, v: number | boolean) => setPreview({ ...preview, parts: { ...preview.parts, [id]: v } });
  const entriesOf = (op: number): SignalEntry[] => {
    const g = (d.ops[op] as Op).geo as Record<string, unknown> | undefined;
    return Array.isArray(g?.entries) ? (g.entries as SignalEntry[]) : [];
  };
  return (
    <>
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.tryNote")}</p>
      <label style={{ display: "flex", gap: 4, alignItems: "center" }} title={t("symbolEditor.try.playNote")}>
        <input type="checkbox" checked={preview.animate} data-testid="symbol-try-play"
          onChange={(e) => setPreview({ ...preview, animate: e.target.checked })} />
        {t("symbolEditor.try.play")}
      </label>
      {hasState && (
        <Field label={t("symbolEditor.input.state")}>
          <select style={input} value={preview.state} data-testid="symbol-try-state"
            onChange={(e) => setPreview({ ...preview, state: e.target.value as Preview["state"] })}>
            {(["drawn", "off", "on", "alarm"] as const).map((s) => <option key={s} value={s}>{t(`symbolEditor.try.${s}`)}</option>)}
          </select>
        </Field>
      )}
      {parts.map((p) => (
        <Field key={p.id} label={`${t(`symbolEditor.input.${p.kind}`)} · ${p.id}`}>
          {p.kind === "level" && (
            <input type="range" min={0} max={1} step={0.01} value={preview.level}
              onChange={(e) => setPreview({ ...preview, level: Number(e.target.value) })} style={{ width: "100%" }} />
          )}
          {p.kind === "rotor" && (
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={preview.spin} onChange={(e) => setPreview({ ...preview, spin: e.target.checked })} />
              {t("symbolEditor.try.spin")}
            </label>
          )}
          {p.kind === "needle" && (
            <input type="range" min={0} max={1} step={0.01} value={typeof preview.parts[p.id] === "number" ? (preview.parts[p.id] as number) : 0.5}
              onChange={(e) => part(p.id, Number(e.target.value))} style={{ width: "100%" }} />
          )}
          {(p.kind === "lever" || p.kind === "lamp") && (
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={!!preview.parts[p.id]} onChange={(e) => part(p.id, e.target.checked)} />
              {t(p.kind === "lever" ? "symbolEditor.try.open" : "symbolEditor.try.lit")}
            </label>
          )}
          {p.kind === "slide" && (
            <input type="range" min={0} max={1} step={0.01} data-testid={`symbol-try-${p.id}`} aria-label={t("symbolEditor.try.position")}
              value={typeof preview.parts[p.id] === "number" ? (preview.parts[p.id] as number) : 0}
              onChange={(e) => part(p.id, Number(e.target.value))} style={{ width: "100%" }} />
          )}
          {(p.kind === "vibrate" || p.kind === "pulse") && (
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" data-testid={`symbol-try-${p.id}`} checked={!!preview.parts[p.id]}
                onChange={(e) => part(p.id, e.target.checked)} />
              {t("symbolEditor.try.moves")}
            </label>
          )}
          {p.kind === "input" && (
            <Num value={typeof preview.parts[p.id] === "number" ? (preview.parts[p.id] as number) : 0} step={1}
              onChange={(v) => part(p.id, v)} />
          )}
          {p.kind === "signal" && (
            <select style={input} data-testid={`symbol-try-${p.id}`} aria-label={t("symbolEditor.try.entry")}
              value={typeof preview.parts[p.id] === "number" ? String(preview.parts[p.id]) : "-1"}
              onChange={(e) => part(p.id, Number(e.target.value))}>
              <option value="-1">{t("symbolEditor.try.drawn")}</option>
              {(entriesOf(p.op)).map((e, i) => (
                <option key={i} value={i}>{e.value_min !== undefined || e.value_max !== undefined
                  ? `${e.value_min ?? "…"}–${e.value_max ?? "…"}` : String(e.value ?? "")}{e.hidden ? ` · ${t("symbolEditor.anim.hidden")}` : ""}</option>
              ))}
            </select>
          )}
        </Field>
      ))}
      {!hasState && parts.length === 0 && <p style={{ margin: 0, color: C.subtle }}>{t("symbolEditor.tryNone")}</p>}
    </>
  );
}

/** The category (`tipo`) of a project symbol: the library's kinds by family, «Project», or «Other…» with
 *  the free text of before (19-11-2026). The gallery of the properties panel offers the symbols of the
 *  same kind, so a new symbol put in «Pumps» is offered with the pumps. */
export function CategorySelect({ value, onChange }: { value: string; onChange: (tipo: string) => void }) {
  const { t } = useTranslation();
  const manifesto = useManifestoLib();
  const families: { family: string; kinds: string[] }[] = [];
  for (const s of manifesto?.symbols ?? []) {
    let f = families.find((x) => x.family === s.family);
    if (!f) { f = { family: s.family, kinds: [] }; families.push(f); }
    if (!f.kinds.includes(s.kind)) f.kinds.push(s.kind);
  }
  const known = value === "project" || families.some((f) => f.kinds.includes(value));
  const [other, setOther] = useState(!known);
  const showText = other || !known;
  return (
    <>
      <select style={input} aria-label={t("symbolEditor.category")} value={showText ? "__other" : value}
        onChange={(e) => {
          if (e.target.value === "__other") { setOther(true); return; }
          setOther(false);
          onChange(e.target.value);
        }}>
        <option value="project">{t("symbols.lib.tipo.project")}</option>
        {families.map((f) => (
          <optgroup key={f.family} label={t(`symbols.lib.famiglia.${f.family}`)}>
            {f.kinds.map((k) => <option key={k} value={k}>{t(`symbols.lib.tipo.${k}`, { defaultValue: k })}</option>)}
          </optgroup>
        ))}
        <option value="__other">{t("symbolEditor.categoryOther")}</option>
      </select>
      {showText && (
        <input style={input} value={value} maxLength={30} aria-label={t("symbolEditor.categoryOther")}
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
      )}
    </>
  );
}

function StructureProps({ d, catalog, commit, isVariant, ports: portList, pipes, onSelectPort, onRenamePart, onCreated, latest, onRemoveInput }: {
  d: DescrizioneSimbolo; catalog: Catalog | null; commit: (d: DescrizioneSimbolo) => void; isVariant: boolean;
  ports: Port[]; pipes: Map<string, { total: number }>; onSelectPort: (op: number) => void;
  onRenamePart: (from: string, to: string) => void;
  /** A new input was made with this name. */
  onCreated: (id: string) => void;
  /** The drawing now (a question answered after it changed makes nothing). */
  latest: () => DescrizioneSimbolo;
  /** Removes the input of operation `op`, asking about its effects. */
  onRemoveInput: (op: number) => void;
}) {
  const { t } = useTranslation();
  const ins = inputs(d);
  const [adding, setAdding] = useState<InputKind | "">("");
  // Every input but the body has a name, asked first (test of the rc.29); an
  // «Ingresso» is an input with no layer, that effects follow.
  const add = async (kind: InputKind) => {
    if (kind === "state") { const r = addInput(d, kind); if (r) commit(r.d); return; }
    const plain = kind === "input";
    const id = await askId(t, {
      ns: "input",
      title: plain ? t("symbolEditor.ask.inputTitle") : t("symbolEditor.ask.partTitle", { kind: t(`symbolEditor.input.${kind}`) }),
      text: t(plain ? "symbolEditor.ask.inputText" : "symbolEditor.ask.partText"),
      proposed: plain ? freeInputId(d, t("symbolEditor.fx.inputName")) : freePartId(d, kind), taken: inputIds(d),
    });
    if (!id || latest() !== d) return;
    const r = addInput(d, kind, id);
    if (!r) return;
    onCreated(id);
    commit(r.d);
  };
  // A new size scales the drawing, its parts and its ports with it (19-11-2026):
  // before, only the box changed and the ports on the right and bottom fell off.
  const [scale, setScale] = useState(true);
  return (
    <>
      <Section id="symbol" title={t("symbolEditor.section.symbol")}>
        {isVariant && <p style={{ ...note, color: C.muted }}>{t("symbolEditor.variantNote")}</p>}
        <Field label={t("symbolEditor.nameIt")}><input style={input} value={d.it} maxLength={60} onChange={(e) => commit({ ...d, it: e.target.value })} /></Field>
        <Field label={t("symbolEditor.nameEn")}><input style={input} value={d.en} maxLength={60} onChange={(e) => commit({ ...d, en: e.target.value })} /></Field>
        <Field label={t("symbolEditor.category")}>
          <CategorySelect value={d.tipo ?? "project"} onChange={(tipo) => commit({ ...d, tipo })} />
        </Field>
        <Field label={t("symbolEditor.size")}>
          <Num value={d.w} step={10} onChange={(n) => commit(resizeSymbol(d, validSize(n), d.h, scale))} />
          <Num value={d.h} step={10} onChange={(n) => commit(resizeSymbol(d, d.w, validSize(n), scale))} />
        </Field>
        <label style={{ display: "flex", gap: 6, alignItems: "center", color: C.muted, fontSize: 11 }}>
          <input type="checkbox" checked={scale} onChange={(e) => setScale(e.target.checked)} data-testid="symbol-scale-drawing" />
          {t("symbolEditor.scaleDrawing")}
        </label>
        <p style={note}>{t("symbolEditor.sizeNote", { w: r2(d.w), h: r2(d.h) })}</p>
        <Field label={t("symbolEditor.bodyMaterial")}><MaterialSelect value={d.body} catalog={catalog} onChange={(m) => commit({ ...d, body: m })} /></Field>
      </Section>

      <Section id="inputs" title={t("symbolEditor.inputs")} count={ins.length}>
        <p style={note}>{t("symbolEditor.inputsNote")}</p>
        {ins.map((inp) => {
          return (
            // By operation, not by name: with the name in the key the row was
            // made again at every letter, and the field lost the focus.
            <div key={inp.op} data-testid={`symbol-input-row-${inp.id}`} style={{ border: `1px solid ${C.surface2}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 4, background: C.bg }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <strong style={{ flex: 1, fontSize: TESTO.riga }}>{t(`symbolEditor.input.${inp.kind}`)}</strong>
                <button type="button" style={{ ...button, color: C.danger }} data-testid={`symbol-input-remove-${inp.id}`}
                  onClick={() => onRemoveInput(inp.op)}>
                  {t("symbolEditor.delete")}
                </button>
              </div>
              {inp.kind !== "state" && <InputName d={d} inp={inp} commit={commit} onRename={onRenamePart} />}
              <AnimationProps d={d} op={inp.op} commit={commit} />
            </div>
          );
        })}
        <Field label={t("symbolEditor.addInput")}>
          <select style={input} value={adding} data-testid="symbol-input-kind" onChange={(e) => setAdding(e.target.value as InputKind)}>
            <option value="" />
            {INPUT_KINDS.filter((k) => k !== "state" || !ins.some((i) => i.kind === "state")).map((k) => (
              <option key={k} value={k}>{t(`symbolEditor.input.${k}`)}</option>
            ))}
          </select>
          <button type="button" style={button} disabled={!adding} data-testid="symbol-input-add" onClick={() => {
            if (adding) void add(adding);
            setAdding("");
          }}>+</button>
        </Field>
      </Section>

      <Section id="ports" title={t("symbolEditor.port.title")} count={portList.length}>
        <p style={note}>{t("symbolEditor.port.note")}</p>
        {portList.length === 0 && <p style={note}>{t("symbolEditor.port.none")}</p>}
        {portList.map((q) => (
          <button key={q.op} type="button" data-testid={`symbol-port-row-${q.id}`} onClick={() => onSelectPort(q.op)}
            style={{ ...input, display: "flex", gap: 6, cursor: "pointer", textAlign: "left" }}>
            <strong style={{ flex: 1 }}>{q.id}</strong>
            <span style={{ color: C.muted }}>{t(`symbolEditor.port.side.${q.side}`)} · Ø {q.d}</span>
            <span style={{ color: (pipes.get(q.id)?.total ?? 0) ? C.port : C.subtle }}>
              {t("symbolEditor.port.pipes", { n: pipes.get(q.id)?.total ?? 0 })}
            </span>
          </button>
        ))}
      </Section>
    </>
  );
}

/** The name of a part or an input, in «Inputs»: applied when it leaves the
 *  field or with Enter, if it can be, with the reason under it otherwise.
 *  Before the rc.30 every letter was a rename (and a step of the history),
 *  unchecked, and an `ingresso` did not change at all (test of the rc.29). */
function InputName({ d, inp, commit, onRename }: {
  d: DescrizioneSimbolo; inp: SymbolInput; commit: (d: DescrizioneSimbolo) => void;
  onRename: (from: string, to: string) => void;
}) {
  const { t } = useTranslation();
  const [v, setV] = useState(inp.id);
  useEffect(() => setV(inp.id), [inp.id, inp.op]);
  const id = normalizeId(v);
  const problem = idProblem(id, "input", inputIds(d).filter((x) => x !== inp.id));
  const apply = () => {
    if (problem || id === inp.id) { setV(inp.id); return; }
    onRename(inp.id, id);
    commit(renameInput(d, inp.op, id));
  };
  return (
    <>
      <Field label={t("symbolEditor.inputId")}>
        <input style={{ ...input, borderColor: problem ? C.danger : undefined }} value={v} maxLength={30} data-testid={`symbol-input-name-${inp.id}`}
          onChange={(e) => setV(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          onBlur={apply} onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </Field>
      {problem && <p style={{ margin: 0, color: C.danger, fontSize: 11 }} data-testid="symbol-input-name-error">{idMessage(t, "input", problem)}</p>}
    </>
  );
}

/** One pipe port: its id (what the pipes attach to), side, diameter, position. */
function PortProps({ d, port, pipes, commit, onRename, onDel }: {
  d: DescrizioneSimbolo; port: Port; pipes: number; commit: (d: DescrizioneSimbolo) => void;
  onRename: (from: string, to: string) => void; onDel: () => void;
}) {
  const { t } = useTranslation();
  const [id, setId] = useState(port.id);
  useEffect(() => setId(port.id), [port.id, port.op]);
  const problem = idProblem(id, "port", ports(d).filter((q) => q.op !== port.op).map((q) => q.id));
  const ok = !problem;
  return (
    <>
      <p style={{ ...note, color: pipes ? C.port : C.subtle }}>{t("symbolEditor.port.pipes", { n: pipes })}</p>
      <Field label={t("symbolEditor.port.id")}>
        <input style={{ ...input, borderColor: ok ? undefined : C.danger }} value={id} maxLength={30} data-testid="symbol-port-id"
          onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          onBlur={() => { if (ok && id !== port.id) { onRename(port.id, id); commit(setPort(d, port.op, { id })); } else setId(port.id); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </Field>
      {problem && <p style={{ margin: 0, color: C.danger, fontSize: 11 }}>{idMessage(t, "port", problem)}</p>}
      <Field label={t("symbolEditor.port.sideLabel")}>
        <select style={input} value={port.side} onChange={(e) => commit(setPort(d, port.op, { side: e.target.value as Side }))}>
          {SIDES.map((s) => <option key={s} value={s}>{t(`symbolEditor.port.side.${s}`)}</option>)}
        </select>
      </Field>
      <Field label={t("symbolEditor.port.diameter")}><Num value={port.d} onChange={(n) => commit(setPort(d, port.op, { d: Math.max(1, n) }))} /></Field>
      <Field label="x"><Num value={port.x} onChange={(n) => commit(setPort(d, port.op, { x: Math.min(d.w, Math.max(0, n)) }))} /></Field>
      <Field label="y"><Num value={port.y} onChange={(n) => commit(setPort(d, port.op, { y: Math.min(d.h, Math.max(0, n)) }))} /></Field>
      <div><button type="button" style={{ ...button, color: C.danger }} onClick={onDel}>{t("symbolEditor.delete")}</button></div>
    </>
  );
}
