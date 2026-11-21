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
import { C, Field, Num, input } from "./ui";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo } from "@/types";
import { avviso, chiedi, conferma, scegli } from "@/finestraAvviso/finestraAvviso";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import { trovaSimboloOriginale, useManifestoLib } from "@/symbols/lib/libreria";
import type { SignalEntry, SimboloLib } from "@/symbols/lib/manifest";
import { useStileProgetto } from "@/symbols/stileProgetto";
import {
  addInput, addPort, align, boxToBox, deleteOps, distribute, duplicateOps, explodedOffsets, extraOf, fillOf, inputs,
  insertInLayer, layers, mapBox, matrixOps, moveLayer, movePort, moveToLayer, moveToNewLayer, NEW_LAYER, newCircle, newEllipse, newLine, newPath, newRect, ports, r2,
  removeInput, renamePart, reorderOp, resizeSymbol, saveAsCopy, setExtra, setFill, setGeo, setPartGeo, setPathD,
  setPort, setVeil, transformOps, turnMatrix, union, validPathD, validPortId, validSize, INPUT_KINDS, SIDES,
  animateSelection, setPartParam,
  type Affine, type AlignMode, type Box, type InputKind, type Layer, type Op, type Port, type Side,
} from "./model";
import { predefinito } from "@/coloriPredefiniti";
import type { ValoreParte } from "@/symbols/lib/libreria";
import { AnimateBlock, AnimationProps } from "./AnimationProps";
import { AiPanel } from "./AiPanel";
import { bindingsOnParts, pipesOnPorts, svgWarningLines, takenSlugs, usage, withSymbol, withoutSymbol, writeSymbols, type SymbolEditorTarget } from "./open";
import { importSvg, isBlank, looksLikeSvg, placeImport, roomFor, MAX_SVG_BYTES } from "./importSvg";
import { symbolFileName, symbolFileText } from "./symbolFile";

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
  | { kind: "resize"; box: Box; corner: [0 | 1, 0 | 1]; ids: number[]; cur: Box }
  | { kind: "draw"; start: [number, number]; cur: [number, number] }
  | { kind: "anchor"; op: number; cur: [number, number] }
  /** Where a slide goes: its (dx, dy), dragged by the dashed outline. */
  | { kind: "slide"; op: number; start: [number, number]; from: [number, number]; cur: [number, number] }
  | { kind: "port"; op: number; cur: [number, number] }
  | { kind: "marquee"; start: [number, number]; cur: [number, number]; add: boolean }
  | { kind: "pan"; client: [number, number]; centre: [number, number]; scale: number };


/** Where a port's pipe leaves, as a unit vector. */
const OUT: Record<Side, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const PAD = 24;

/** Mounted once by the editor shell: shows the editor while the store says so. */
export function SymbolEditorHost() {
  const target = useAppStore((s) => s.symbolEditor);
  if (!target) return null;
  return <SymbolEditor key={target.draft.slug} target={target} />;
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

  const [hist, setHist] = useState<History>({ past: [], present: target.draft, future: [] });
  const d = hist.present;
  const [saved, setSaved] = useState<DescrizioneSimbolo | null>(target.isNew ? null : target.draft);
  const [savedSlug, setSavedSlug] = useState(target.draft.slug);
  const [fromObject, setFromObject] = useState(target.fromObjectId);
  const [sel, setSel] = useState<number[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [tab, setTab] = useState<"piece" | "structure" | "try" | "ai">("piece");
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
        if (e?.ok && e.svg && e.voce) setCompiled({ svg: e.svg, voce: e.voce, errors: [] });
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
  useEffect(() => { groupedLayers.set(savedSlug, grouped); }, [grouped, savedSlug]);
  /** What a click on the canvas picks: the shape, or the whole grouped layer. */
  const unitOf = useCallback((i: number): number[] => {
    const l = layerOf(i);
    return l && grouped.has(l.id) ? l.ops.filter((j) => j === i || boxes.has(j)) : [i];
  }, [layerOf, grouped, boxes]);
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
    if (inner) inner.style.overflow = explode.on ? "visible" : "";
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
  }, [offsets, hidden, ls, boxes, explode.on, holding]);
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
    const l = layerOf(i);
    return !l || (!hidden.has(l.id) && !locked.has(l.id));
  }, [layerOf, hidden, locked]);
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
      const layer = (sel.length ? layerOf(sel[0]) : undefined) ?? ls[ls.length - 1];
      const r = insertInLayer(d, layer.id, newPath(poly, closed && poly.length >= 3));
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
      const q = magnetPoint([sn(p[0]), sn(p[1])]);
      setGuides({});
      const r = addPort(d, q[0], q[1]);
      commit(r.d);
      setSel([r.at]);
      setTool("select");
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
      const layer = (sel.length ? layerOf(sel[0]) : undefined) ?? ls[ls.length - 1];
      const r = insertInLayer(d, layer.id, op);
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
    clipboard = which.sort((a, b) => a - b).map((i) => structuredClone(d.ops[i] as Op));
    pastes.current = 0;
    if (cut) { commit(deleteOps(d, which)); setSel([]); }
  }, [commit, d, sel, drawing]);
  const paste = useCallback(() => {
    if (!clipboard.length) return;
    pastes.current += 1;
    const off = 4 * pastes.current;
    const layer = (sel.length ? layerOf(sel[0]) : undefined) ?? ls[ls.length - 1];
    let out = d;
    const at: number[] = [];
    for (const op of clipboard) {
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
  const importSvgText = useCallback((text: string) => {
    const r = importSvg(text, { w: d.w, h: d.h, adapt: isBlank(d), room: roomFor(d) });
    if (!r.ok) {
      void avviso({ livello: "errore", titolo: t("symbolEditor.svg.failed"), testo: t(`symbolEditor.svg.err.${r.error}`) });
      return;
    }
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
    importSvgText(await f.text());
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
      else importSvgText(text);
    };
    window.addEventListener("paste", h, true);
    return () => window.removeEventListener("paste", h, true);
  }, [importSvgFile, importSvgText]);
  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([symbolFileText(d)], { type: "application/json" }));
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
      const cur = now.find((p) => (origin.current.get(p.id) ?? p.id) === id);
      if (!cur) removed.push({ id, n });
      else if (cur.id !== id) renamed.push({ from: id, to: cur.id, n });
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
      const cur = now.find((p) => (partOrigin.current.get(p) ?? p) === id);
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
  const btn = (on: boolean): React.CSSProperties => ({
    padding: "4px 10px", fontSize: 12, borderRadius: 4, cursor: "pointer",
    border: `1px solid ${on ? C.accent : C.border}`, background: on ? C.accent : "transparent",
    color: on ? "var(--brand-on-primary, #fff)" : C.text,
  });
  const small: React.CSSProperties = { ...btn(false), padding: "2px 6px", fontSize: 11 };
  const tiny = (enabled: boolean): React.CSSProperties => ({ ...small, minWidth: 24, opacity: enabled ? 1 : 0.4 });
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
  }

  return (
    <div data-testid="symbol-editor" ref={rootRef} onKeyDown={(e) => e.stopPropagation()} style={{
      position: "fixed", inset: 0, zIndex: 9000, background: C.bg, color: C.text,
      display: "flex", flexDirection: "column", fontSize: 12,
    }}>
      {/* top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: `1px solid ${C.border}` }}>
        <strong style={{ fontSize: 14 }}>{t("symbolEditor.title")}: {d[lang]}</strong>
        {original && <span style={{ color: C.muted }}>{t("symbolEditor.variantOf", { name: t(original.label) })}</span>}
        <span style={{ color: C.subtle }}>{t("symbolEditor.usage", { n: use.objects, pages: use.pages })}</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={small} disabled={!hist.past.length} onClick={undo} title="Ctrl+Z">{t("symbolEditor.undo")}</button>
        <button type="button" style={small} disabled={!hist.future.length} onClick={redo} title="Ctrl+Y">{t("symbolEditor.redo")}</button>
        {original && saved && <button type="button" style={small} onClick={() => void revert()}>{t("symbolEditor.revert")}</button>}
        <button type="button" style={btn(false)} disabled={!!compiled.errors.length} onClick={exportFile}
          data-testid="symbol-editor-export" title={t("symbolEditor.file.exportTitle")}>{t("symbolEditor.file.export")}</button>
        <button type="button" style={btn(false)} disabled={busy || !!compiled.errors.length} onClick={() => void saveAs()}>{t("symbolEditor.saveAs")}</button>
        <button type="button" data-testid="symbol-editor-save" style={btn(dirty)} disabled={busy || !!compiled.errors.length || !dirty}
          onClick={() => void save()}>{t("symbolEditor.save")}</button>
        <button type="button" data-testid="symbol-editor-close" style={btn(false)} onClick={() => void doClose()}>{t("symbolEditor.close")}</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* layers */}
        <div style={{ width: 230, borderRight: `1px solid ${C.border}`, overflow: "auto", padding: 8 }}>
          <div style={{ color: C.subtle, fontWeight: 700, marginBottom: 4 }}>{t("symbolEditor.layers")}</div>
          {ls.map((l) => (
            <div key={`${l.id}-${l.start}`} style={{ marginBottom: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <span onClick={() => setSel(l.ops.filter(pickable))} style={{ flex: 1, cursor: "pointer", color: C.muted, fontWeight: 600 }}>{layerLabel(l, t)}</span>
                {([[-1, "▲", "symbolEditor.layerUp"], [1, "▼", "symbolEditor.layerDown"]] as const).map(([dir, g, k]) => {
                  const can = moveLayer(d, l.id, dir).at.length > 0;
                  return (
                    <button key={dir} type="button" title={t(k)} disabled={!can} data-testid={`symbol-layer-${dir < 0 ? "up" : "down"}-${l.id}`}
                      style={{ ...tiny(can), minWidth: 18, padding: "0 2px" }} onClick={() => shiftLayer(l.id, dir)}>{g}</button>
                  );
                })}
                <button type="button" title={t(hidden.has(l.id) ? "symbolEditor.layerShow" : "symbolEditor.layerHide")}
                  data-testid={`symbol-layer-hide-${l.id}`} style={{ ...tiny(true), minWidth: 20 }}
                  onClick={() => setHidden((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  {hidden.has(l.id) ? "○" : "◉"}
                </button>
                <button type="button" title={t(locked.has(l.id) ? "symbolEditor.layerUnlock" : "symbolEditor.layerLock")}
                  style={{ ...tiny(true), minWidth: 20 }}
                  onClick={() => setLocked((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  {locked.has(l.id) ? "■" : "□"}
                </button>
                <button type="button" title={t(grouped.has(l.id) ? "symbolEditor.layerUngroup" : "symbolEditor.layerGroup")}
                  data-testid={`symbol-layer-group-${l.id}`} aria-pressed={grouped.has(l.id)} disabled={l.ops.length < 2}
                  style={{ ...tiny(l.ops.length >= 2), minWidth: 20, ...(grouped.has(l.id) ? { background: C.accent, borderColor: C.accent, color: "var(--brand-on-primary, #fff)" } : {}) }}
                  onClick={() => setGrouped((s) => { const n = new Set(s); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })}>
                  ⧉
                </button>
              </div>
              {/* The list still picks one shape, also of a grouped layer. */}
              <div style={grouped.has(l.id) ? { borderLeft: `2px solid ${C.accent}`, marginLeft: 6 } : undefined}>
              {l.ops.map((i) => (
                <div key={i} data-testid={`symbol-op-row-${i}`} aria-selected={sel.includes(i)} onClick={(e) => {
                  if (!pickable(i)) return;
                  setSel(e.shiftKey ? (sel.includes(i) ? sel.filter((x) => x !== i) : [...sel, i]) : [i]);
                }}
                  style={{
                    cursor: pickable(i) ? "pointer" : "default", padding: "1px 6px 1px 14px", borderRadius: 3,
                    background: sel.includes(i) ? C.accent : "transparent",
                    color: sel.includes(i) ? "var(--brand-on-primary, #fff)" : pickable(i) ? C.text : C.subtle,
                  }}>
                  {opLabel(d.ops[i] as Op, t)} <span style={{ opacity: 0.6 }}>#{i + 1}</span>
                </div>
              ))}
              </div>
            </div>
          ))}
        </div>

        {/* canvas */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 6, padding: 6, borderBottom: `1px solid ${C.border}`, alignItems: "center", flexWrap: "wrap" }}>
            {TOOLS.map((k) => (
              <button key={k} type="button" data-testid={`symbol-tool-${k}`} style={btn(tool === k)}
                onClick={() => { setPoly([]); setTool(k); }} title={k === "poly" ? t("symbolEditor.polyHint") : undefined}>
                {t(`symbolEditor.tool.${k}`)}
              </button>
            ))}
            <button type="button" style={btn(false)} data-testid="symbol-import-svg" title={t("symbolEditor.svg.importTitle")}
              onClick={() => svgInput.current?.click()}>{t("symbolEditor.svg.import")}</button>
            <input ref={svgInput} type="file" accept=".svg,image/svg+xml" style={{ display: "none" }} data-testid="symbol-import-svg-file"
              onChange={(e) => { void importSvgFile(e.target.files?.[0]); e.target.value = ""; }} />
            <span style={{ flex: 1 }} />
            <span style={{ color: C.subtle }}>{w} × {h}</span>
          </div>
          <div style={{ display: "flex", gap: 4, padding: "4px 6px", borderBottom: `1px solid ${C.border}`, alignItems: "center", flexWrap: "wrap" }}>
            <button type="button" style={tiny(true)} title={t("symbolEditor.zoomOut")} onClick={() => zoomAt(1 / 1.25)}>−</button>
            <span style={{ color: C.muted, minWidth: 40, textAlign: "center" }} data-testid="symbol-zoom">{Math.round(view.z * 100)}%</span>
            <button type="button" style={tiny(true)} title={t("symbolEditor.zoomIn")} onClick={() => zoomAt(1.25)}>+</button>
            <button type="button" style={small} onClick={fit}>{t("symbolEditor.fit")}</button>
            <span style={{ width: 8 }} />
            <label style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={grid.on} onChange={(e) => setGrid({ ...grid, on: e.target.checked })} />{t("symbolEditor.grid")}
            </label>
            <select style={{ ...small, padding: "1px 2px" }} value={grid.step} onChange={(e) => setGrid({ ...grid, step: Number(e.target.value) })}
              aria-label={t("symbolEditor.gridStep")}>
              {[5, 10, 20].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <label style={{ display: "flex", gap: 3, alignItems: "center" }}>
              <input type="checkbox" checked={grid.snap} onChange={(e) => setGrid({ ...grid, snap: e.target.checked })} data-testid="symbol-grid-snap" />{t("symbolEditor.gridSnap")}
            </label>
            <label style={{ display: "flex", gap: 3, alignItems: "center" }} title={t("symbolEditor.magnetHint")}>
              <input type="checkbox" checked={magnet} onChange={(e) => setMagnet(e.target.checked)} />{t("symbolEditor.magnet")}
            </label>
            <span style={{ width: 8 }} />
            <button type="button" style={tiny(sel.length > 0)} disabled={!sel.length} title={t("symbolEditor.turnCw")} onClick={() => turn("cw")} data-testid="symbol-turn-cw">⟳</button>
            <button type="button" style={tiny(sel.length > 0)} disabled={!sel.length} title={t("symbolEditor.turnCcw")} onClick={() => turn("ccw")}>⟲</button>
            <button type="button" style={tiny(sel.length > 0)} disabled={!sel.length} title={t("symbolEditor.flipH")} onClick={() => turn("flipH")}>⇋</button>
            <button type="button" style={tiny(sel.length > 0)} disabled={!sel.length} title={t("symbolEditor.flipV")} onClick={() => turn("flipV")}>⇵</button>
            <span style={{ width: 8 }} />
            {([["left", "⇤"], ["hcenter", "↔"], ["right", "⇥"], ["top", "⤒"], ["vcenter", "↕"], ["bottom", "⤓"]] as [AlignMode, string][]).map(([m, g]) => (
              <button key={m} type="button" style={tiny(nDrawing > 1)} disabled={nDrawing < 2} title={t(`symbolEditor.align.${m}`)}
                onClick={() => doAlign(m)} data-testid={`symbol-align-${m}`}>{g}</button>
            ))}
            <button type="button" style={tiny(nDrawing > 2)} disabled={nDrawing < 3} title={t("symbolEditor.distributeH")} onClick={() => doDistribute("h")}>⋯</button>
            <button type="button" style={tiny(nDrawing > 2)} disabled={nDrawing < 3} title={t("symbolEditor.distributeV")} onClick={() => doDistribute("v")}>⋮</button>
            <span style={{ width: 8 }} />
            <label style={{ display: "flex", gap: 3, alignItems: "center" }} title={t("symbolEditor.explodeHint")}>
              <input type="checkbox" checked={explode.on} data-testid="symbol-explode"
                onChange={(e) => { setExplode({ ...explode, on: e.target.checked }); }} />{t("symbolEditor.explode")}
            </label>
            {explode.on && (
              <input type="range" min={0} max={2} step={0.1} value={explode.k} aria-label={t("symbolEditor.explodeAmount")}
                onChange={(e) => setExplode({ ...explode, k: Number(e.target.value) })} style={{ width: 90 }} />
            )}
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
              {compiled.svg && compiled.voce && manifesto && (
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
              {/* part geometry: the level window and the anchors */}
              {!trying && parts.map((p) => {
                const g = (d.ops[p.op] as Op).geo as Record<string, number>;
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
                        onPointerDown={startResize([cx ? 0 : 1, cy ? 0 : 1] as [0 | 1, 0 | 1])} />
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
          {compiled.errors.length > 0 && (
            <div data-testid="symbol-editor-errors" style={{ borderTop: `1px solid ${C.border}`, padding: 8, color: C.danger, maxHeight: 120, overflow: "auto" }}>
              <strong>{t("symbolEditor.errors")}</strong>
              {compiled.errors.map((m, k) => <div key={k}>{m}</div>)}
            </div>
          )}
        </div>

        {/* properties */}
        <div style={{ width: 290, borderLeft: `1px solid ${C.border}`, overflow: "auto", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", borderBottom: `1px solid ${C.border}` }}>
            {(["piece", "structure", "try", "ai"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} data-testid={`symbol-tab-${k}`} style={{
                flex: 1, padding: 8, border: "none", cursor: "pointer", fontSize: 12,
                background: tab === k ? C.surface : "transparent", color: tab === k ? C.text : C.muted,
              }}>{t(`symbolEditor.tab.${k}`)}</button>
            ))}
          </div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {tab === "piece" ? (
              one?.op === "bocca" ? (
                <PortProps d={d} port={portList.find((q) => q.op === sel[0])!} pipes={pipes.get(String(one.id))?.total ?? 0}
                  commit={commit} onRename={renamePort} onDel={del} />
              ) : (
                <>
                  {nDrawing > 0 && (
                    <AnimateBlock d={d} partOp={selPart?.start} commit={commit}
                      onAnimate={(k) => {
                        const r = animateSelection(d, selPart ? selPart.ops : drawing(sel), k, boxes, firstColour());
                        if (r) { commit(r.d); setSel(r.shapes); }
                      }}
                      onRemove={() => { if (selPart) commit(removeInput(d, selPart.start)); }} />
                  )}
                  <PieceProps d={d} sel={sel} one={one} layer={oneLayer} layers={ls} catalog={catalog} commit={commit}
                    onDup={dup} onDel={del} onReorder={(dir) => { const r = reorderOp(d, sel[0], dir); commit(r.d); setSel([r.at]); }}
                    onMoveToLayer={(id) => {
                      const r = id === NEW_LAYER ? moveToNewLayer(d, drawing(sel)) : moveToLayer(d, drawing(sel), id);
                      commit(r.d);
                      setSel(r.at);
                    }} />
                </>
              )
            ) : tab === "structure" ? (
              <StructureProps d={d} catalog={catalog} commit={commit} isVariant={!!d.overrides}
                ports={portList} pipes={pipes} onSelectPort={(op) => { setSel([op]); setTab("piece"); }}
                onRenamePart={renamePartTracked} />
            ) : tab === "ai" ? (
              <AiPanel d={d} commit={commit} current={compiled} manifesto={manifesto} projectStyle={projectStyle} />
            ) : (
              <TryProps d={d} parts={parts} hasState={ins.some((i) => i.kind === "state")} preview={preview} setPreview={setPreview} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the side panels ────────────────────────────────────────────────────────




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

function PieceProps({ d, sel, one, layer, layers: ls, catalog, commit, onDup, onDel, onReorder, onMoveToLayer }: {
  d: DescrizioneSimbolo; sel: number[]; one?: Op; layer?: Layer; layers: Layer[]; catalog: Catalog | null;
  commit: (d: DescrizioneSimbolo) => void; onDup: () => void; onDel: () => void; onReorder: (dir: 1 | -1) => void;
  onMoveToLayer: (layerId: string) => void;
}) {
  const { t } = useTranslation();
  if (!sel.length) return <p style={{ color: C.subtle, margin: 0 }}>{t("symbolEditor.noSelection")}</p>;
  const toLayer = (
    <Field label={t("symbolEditor.moveToLayer")}>
      <select style={input} value="" data-testid="symbol-move-to-layer" onChange={(e) => { if (e.target.value) onMoveToLayer(e.target.value); }}>
        <option value="" />
        {ls.filter((l) => l.id !== layer?.id).map((l) => <option key={`${l.id}-${l.start}`} value={l.id}>{layerLabel(l, t)}</option>)}
        <option value={NEW_LAYER}>{t("symbolEditor.newLayer")}</option>
      </select>
    </Field>
  );
  const actions = (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {one && <button type="button" style={input} onClick={() => onReorder(1)}>{t("symbolEditor.up")}</button>}
      {one && <button type="button" style={input} onClick={() => onReorder(-1)}>{t("symbolEditor.down")}</button>}
      <button type="button" style={input} onClick={onDup}>{t("symbolEditor.duplicate")}</button>
      <button type="button" style={{ ...input, color: C.danger }} onClick={onDel}>{t("symbolEditor.delete")}</button>
    </div>
  );
  if (!one) return <>{t("symbolEditor.manySelected", { n: sel.length })}{toLayer}{actions}</>;
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
  return (
    <>
      <div style={{ fontWeight: 700 }}>{opLabel(one, t)} #{i + 1}
        {layer && <span style={{ color: C.subtle, fontWeight: 400 }}> · {layerLabel(layer, t)}</span>}</div>
      {geo.map(([k, v]) => typeof v === "number" && (
        <Field key={k} label={k}><Num value={v} onChange={(n) => commit(setGeo(d, i, k, n))} /></Field>
      ))}
      {(isLine || (isShape && one.tag === "path")) && <PathField value={pathD} onChange={(v) => commit(setPathD(d, i, v))} />}
      {(isShape || isLine) && fill && (
        <>
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
          {fillKind === "color" && <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.ownColourNote")}</p>}
        </>
      )}
      {isShape && (
        <Field label={t("symbolEditor.veil")}>
          <select style={input} value={String(one.velo ?? "")} onChange={(e) => commit(setVeil(d, i, e.target.value || null))}>
            <option value="">{t("symbolEditor.noVeil")}</option>
            {catalog?.veils.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {isShape && (
        <>
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
          {strokeKind === "color" && <Field label=""><input type="color" style={{ ...input, padding: 0, height: 24 }} value={String(stroke)}
            onChange={(e) => commit(setExtra(d, i, "stroke", e.target.value))} /></Field>}
        </>
      )}
      {(isShape || isLine) && (
        <>
          <Field label={t("symbolEditor.strokeWidth")}>
            <Num value={typeof sw === "number" ? sw : 1} step={0.1} onChange={(n) => commit(setGeo(d, i, "stroke_width", Math.max(0, Math.min(20, n))))} />
          </Field>
          {isShape && (
            <Field label={t("symbolEditor.fillOpacity")}>
              <Num value={num("fill_opacity") ?? 1} step={0.05} onChange={(n) => commit(setExtra(d, i, "fill_opacity", n >= 1 ? undefined : Math.max(0, n)))} />
            </Field>
          )}
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
        </>
      )}
      {toLayer}
      {actions}
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

function StructureProps({ d, catalog, commit, isVariant, ports: portList, pipes, onSelectPort, onRenamePart }: {
  d: DescrizioneSimbolo; catalog: Catalog | null; commit: (d: DescrizioneSimbolo) => void; isVariant: boolean;
  ports: Port[]; pipes: Map<string, { total: number }>; onSelectPort: (op: number) => void;
  onRenamePart: (from: string, to: string) => void;
}) {
  const { t } = useTranslation();
  const ins = inputs(d);
  const [adding, setAdding] = useState<InputKind | "">("");
  // A new size scales the drawing, its parts and its ports with it (19-11-2026):
  // before, only the box changed and the ports on the right and bottom fell off.
  const [scale, setScale] = useState(true);
  return (
    <>
      {isVariant && <p style={{ margin: 0, color: C.muted }}>{t("symbolEditor.variantNote")}</p>}
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
      <Field label={t("symbolEditor.bodyMaterial")}><MaterialSelect value={d.body} catalog={catalog} onChange={(m) => commit({ ...d, body: m })} /></Field>

      <div style={{ fontWeight: 700, marginTop: 6 }}>{t("symbolEditor.inputs")}</div>
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.inputsNote")}</p>
      {ins.map((inp) => {
        return (
          <div key={`${inp.id}-${inp.op}`} style={{ border: `1px solid ${C.border}`, borderRadius: 4, padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <strong style={{ flex: 1 }}>{t(`symbolEditor.input.${inp.kind}`)}</strong>
              <button type="button" style={{ ...input, width: "auto", color: C.danger }} onClick={() => commit(removeInput(d, inp.op))}>
                {t("symbolEditor.delete")}
              </button>
            </div>
            {inp.kind !== "state" && (
              <Field label={t("symbolEditor.inputId")}>
                <input style={input} value={inp.id} maxLength={30}
                  onChange={(e) => {
                    const to = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-");
                    onRenamePart(inp.id, to);
                    commit(renamePart(d, inp.op, to));
                  }} />
              </Field>
            )}
            <AnimationProps d={d} op={inp.op} commit={commit} />
          </div>
        );
      })}
      <Field label={t("symbolEditor.addInput")}>
        <select style={input} value={adding} onChange={(e) => setAdding(e.target.value as InputKind)}>
          <option value="" />
          {INPUT_KINDS.filter((k) => k !== "state" || !ins.some((i) => i.kind === "state")).map((k) => (
            <option key={k} value={k}>{t(`symbolEditor.input.${k}`)}</option>
          ))}
        </select>
        <button type="button" style={{ ...input, width: "auto" }} disabled={!adding} onClick={() => {
          const r = adding ? addInput(d, adding) : null;
          if (r) commit(r.d);
          setAdding("");
        }}>+</button>
      </Field>
      <div style={{ fontWeight: 700, marginTop: 6 }}>{t("symbolEditor.port.title")}</div>
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.port.note")}</p>
      {portList.length === 0 && <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.port.none")}</p>}
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
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.sizeNote", { w: r2(d.w), h: r2(d.h) })}</p>
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
  const taken = ports(d).some((q) => q.id === id && q.op !== port.op);
  const ok = validPortId(id) && !taken;
  return (
    <>
      <div style={{ fontWeight: 700 }}>{t("symbolEditor.port.one")} {port.id}</div>
      <p style={{ margin: 0, color: pipes ? C.port : C.subtle, fontSize: 11 }}>{t("symbolEditor.port.pipes", { n: pipes })}</p>
      <Field label={t("symbolEditor.port.id")}>
        <input style={{ ...input, borderColor: ok ? undefined : C.danger }} value={id} maxLength={30} data-testid="symbol-port-id"
          onChange={(e) => setId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
          onBlur={() => { if (ok && id !== port.id) { onRename(port.id, id); commit(setPort(d, port.op, { id })); } else setId(port.id); }}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
      </Field>
      {!ok && <p style={{ margin: 0, color: C.danger, fontSize: 11 }}>{t(taken ? "symbolEditor.port.idTaken" : "symbolEditor.port.idRule")}</p>}
      <Field label={t("symbolEditor.port.sideLabel")}>
        <select style={input} value={port.side} onChange={(e) => commit(setPort(d, port.op, { side: e.target.value as Side }))}>
          {SIDES.map((s) => <option key={s} value={s}>{t(`symbolEditor.port.side.${s}`)}</option>)}
        </select>
      </Field>
      <Field label={t("symbolEditor.port.diameter")}><Num value={port.d} onChange={(n) => commit(setPort(d, port.op, { d: Math.max(1, n) }))} /></Field>
      <Field label="x"><Num value={port.x} onChange={(n) => commit(setPort(d, port.op, { x: Math.min(d.w, Math.max(0, n)) }))} /></Field>
      <Field label="y"><Num value={port.y} onChange={(n) => commit(setPort(d, port.op, { y: Math.min(d.h, Math.max(0, n)) }))} /></Field>
      <button type="button" style={{ ...input, color: C.danger, width: "auto" }} onClick={onDel}>{t("symbolEditor.delete")}</button>
    </>
  );
}
