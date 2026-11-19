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
import { CampoNumero } from "@/components/CampoNumero";
import { useAppStore } from "@/store";
import type { DescrizioneSimbolo } from "@/types";
import { avviso, chiedi, conferma } from "@/finestraAvviso/finestraAvviso";
import { SimboloLibSvg } from "@/symbols/lib/SimboloLib";
import { trovaSimboloOriginale, useManifestoLib } from "@/symbols/lib/libreria";
import type { SimboloLib } from "@/symbols/lib/manifest";
import { useStileProgetto } from "@/symbols/stileProgetto";
import {
  addInput, boxToBox, deleteOps, duplicateOps, fillOf, inputs, insertInLayer, layers, newEllipse, newLine, newRect,
  r2, removeInput, renamePart, reorderOp, saveAsCopy, setFill, setGeo, setPartGeo, setVeil, transformOps, union,
  validSize, INPUT_KINDS, type Box, type InputKind, type Layer, type Op,
} from "./model";
import { takenSlugs, usage, withSymbol, withoutSymbol, writeSymbols, type SymbolEditorTarget } from "./open";

interface Catalog {
  materials: { name: string; color: string }[];
  veils: { name: string; type: string }[];
}

interface History { past: DescrizioneSimbolo[]; present: DescrizioneSimbolo; future: DescrizioneSimbolo[] }

type Tool = "select" | "rect" | "ellipse" | "line";

type Drag =
  | { kind: "move"; start: [number, number]; ids: number[]; d: [number, number] }
  | { kind: "resize"; box: Box; corner: [0 | 1, 0 | 1]; ids: number[]; cur: Box }
  | { kind: "draw"; start: [number, number]; cur: [number, number] }
  | { kind: "anchor"; op: number; cur: [number, number] };

const C = {
  bg: "var(--brand-bg, #0f172a)",
  surface: "var(--brand-surface, #1e293b)",
  border: "var(--brand-border, #334155)",
  text: "var(--brand-text, #e2e8f0)",
  muted: "var(--brand-text-muted, #94a3b8)",
  subtle: "var(--brand-text-subtle, #64748b)",
  accent: "var(--brand-primary, #3b82f6)",
  danger: "var(--brand-danger, #ef4444)",
};

const PAD = 12;

/** Mounted once by the editor shell: shows the editor while the store says so. */
export function SymbolEditorHost() {
  const target = useAppStore((s) => s.symbolEditor);
  if (!target) return null;
  return <SymbolEditor key={target.draft.slug} target={target} />;
}

function snap(v: number): number {
  return Math.round(v * 2) / 2;
}

function opLabel(op: Op, t: (k: string) => string): string {
  switch (op.op) {
    case "forma": return t(`symbolEditor.shape.${String(op.tag)}`);
    case "luce": case "riflesso": return t("symbolEditor.shape.highlight");
    case "tratto": return t("symbolEditor.shape.line");
    case "flangia_v": case "flangia_o": return t("symbolEditor.shape.flange");
    case "tubo_o": case "tubo_v": return t("symbolEditor.shape.stub");
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
  const [tab, setTab] = useState<"piece" | "structure">("piece");
  const [compiled, setCompiled] = useState<{ svg?: string; voce?: SimboloLib; errors: string[] }>({ errors: [] });
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [boxes, setBoxes] = useState<Map<number, Box>>(new Map());
  const [drag, setDrag] = useState<Drag | null>(null);
  const [busy, setBusy] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawRef = useRef<SVGGElement>(null);

  const commit = useCallback((next: DescrizioneSimbolo) => {
    setHist((h) => (next === h.present ? h : { past: [...h.past.slice(-99), h.present], present: next, future: [] }));
  }, []);
  const undo = useCallback(() => setHist((h) => h.past.length
    ? { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] } : h), []);
  const redo = useCallback(() => setHist((h) => h.future.length
    ? { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) } : h), []);

  useEffect(() => { void api.symbolCatalog().then(setCatalog).catch(() => {}); }, []);

  // Compile, with a short pause so typing a number does not fire ten requests.
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => {
      api.compilaSimboli([d], { trace: true }).then(([e]) => {
        if (!live) return;
        if (e?.ok && e.svg && e.voce) setCompiled({ svg: e.svg, voce: e.voce, errors: [] });
        else setCompiled((c) => ({ ...c, errors: e?.errori ?? ["?"] }));
      }).catch((err) => { if (live) setCompiled((c) => ({ ...c, errors: [String(err?.message ?? err)] })); });
    }, 150);
    return () => { live = false; clearTimeout(h); };
  }, [d]);

  // The boxes of what each operation drew, in viewBox units.
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
  }, [compiled.svg]);

  const ls = useMemo(() => layers(d), [d]);
  const ins = useMemo(() => inputs(d), [d]);
  const layerOf = useCallback((i: number) => ls.find((l) => l.ops.includes(i)), [ls]);
  const selBox = useMemo(() => union(sel.map((i) => boxes.get(i)).filter((b): b is Box => !!b)), [sel, boxes]);
  const dirty = saved === null || JSON.stringify(saved) !== JSON.stringify(d);
  const original = d.overrides ? trovaSimboloOriginale(d.overrides) : undefined;
  const use = useMemo(() => usage({ ...d, slug: savedSlug }), [d, savedSlug]);

  // ── pointer ──
  const toUnits = (e: { clientX: number; clientY: number }): [number, number] => {
    const s = svgRef.current;
    const m = s?.getScreenCTM();
    if (!s || !m) return [0, 0];
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return [p.x, p.y];
  };
  const elementsOf = (ids: number[]) =>
    ids.flatMap((i) => Array.from(drawRef.current?.querySelectorAll<SVGElement>(`[data-op="${i}"]`) ?? []));
  const liveTransform = (ids: number[], tr: string | null) => {
    for (const el of elementsOf(ids)) {
      if (tr) el.setAttribute("transform", tr);
      else el.removeAttribute("transform");
    }
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toUnits(e);
    svgRef.current?.setPointerCapture(e.pointerId);
    if (tool !== "select") { setDrag({ kind: "draw", start: p, cur: p }); return; }
    const tol = 1.5;
    let hit = -1;
    for (const [i, b] of boxes) {
      if (p[0] >= b.x - tol && p[0] <= b.x + b.w + tol && p[1] >= b.y - tol && p[1] <= b.y + b.h + tol && i > hit) hit = i;
    }
    if (hit < 0) { setSel([]); return; }
    let ids = sel;
    if (e.shiftKey) ids = sel.includes(hit) ? sel.filter((x) => x !== hit) : [...sel, hit];
    else if (!sel.includes(hit)) ids = [hit];
    setSel(ids);
    if (ids.length) setDrag({ kind: "move", start: p, ids, d: [0, 0] });
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const p = toUnits(e);
    if (drag.kind === "move") {
      const dd: [number, number] = [snap(p[0] - drag.start[0]), snap(p[1] - drag.start[1])];
      liveTransform(drag.ids, `translate(${dd[0]} ${dd[1]})`);
      setDrag({ ...drag, d: dd });
    } else if (drag.kind === "resize") {
      const b = drag.box;
      const x0 = drag.corner[0] ? b.x : snap(Math.min(p[0], b.x + b.w - 1));
      const x1 = drag.corner[0] ? snap(Math.max(p[0], b.x + 1)) : b.x + b.w;
      const y0 = drag.corner[1] ? b.y : snap(Math.min(p[1], b.y + b.h - 1));
      const y1 = drag.corner[1] ? snap(Math.max(p[1], b.y + 1)) : b.y + b.h;
      const cur = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      const a = boxToBox(b, cur);
      liveTransform(drag.ids, `matrix(${a.sx} 0 0 ${a.sy} ${a.tx} ${a.ty})`);
      setDrag({ ...drag, cur });
    } else if (drag.kind === "draw") {
      setDrag({ ...drag, cur: [snap(p[0]), snap(p[1])] });
    } else {
      setDrag({ ...drag, cur: [snap(p[0]), snap(p[1])] });
    }
  };

  const onPointerUp = () => {
    if (!drag) return;
    setDrag(null);
    if (drag.kind === "move") {
      if (drag.d[0] || drag.d[1]) commit(transformOps(d, drag.ids, { sx: 1, sy: 1, tx: drag.d[0], ty: drag.d[1] }));
      else liveTransform(drag.ids, null);
    } else if (drag.kind === "resize") {
      const same = drag.cur.x === drag.box.x && drag.cur.y === drag.box.y && drag.cur.w === drag.box.w && drag.cur.h === drag.box.h;
      if (!same) commit(transformOps(d, drag.ids, boxToBox(drag.box, drag.cur)));
      else liveTransform(drag.ids, null);
    } else if (drag.kind === "draw") {
      const [x0, y0] = drag.start.map(snap), [x1, y1] = drag.cur;
      const b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      if (b.w < 1 && b.h < 1) { setTool("select"); return; }
      const op = tool === "rect" ? newRect({ ...b, w: Math.max(1, b.w), h: Math.max(1, b.h) })
        : tool === "ellipse" ? newEllipse({ ...b, w: Math.max(1, b.w), h: Math.max(1, b.h) })
        : newLine(x0, y0, x1, y1);
      const layer = (sel.length ? layerOf(sel[0]) : undefined) ?? ls[ls.length - 1];
      const r = insertInLayer(d, layer.id, op);
      commit(r.d);
      setSel([r.at]);
      setTool("select");
    } else {
      commit(setPartGeo(setPartGeo(d, drag.op, "cx", drag.cur[0]), drag.op, "cy", drag.cur[1]));
    }
  };

  const startResize = (corner: [0 | 1, 0 | 1]) => (e: React.PointerEvent) => {
    if (!selBox) return;
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag({ kind: "resize", box: selBox, corner, ids: sel, cur: selBox });
  };
  const startAnchor = (op: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    const p = toUnits(e);
    setDrag({ kind: "anchor", op, cur: [snap(p[0]), snap(p[1])] });
  };

  // ── edits ──
  const del = useCallback(() => { if (sel.length) { commit(deleteOps(d, sel)); setSel([]); } }, [commit, d, sel]);
  const dup = useCallback(() => {
    if (!sel.length) return;
    const r = duplicateOps(d, sel);
    commit(r.d);
    setSel(r.added);
  }, [commit, d, sel]);
  const move = useCallback((dx: number, dy: number) => {
    if (sel.length) commit(transformOps(d, sel, { sx: 1, sy: 1, tx: dx, ty: dy }));
  }, [commit, d, sel]);

  const doClose = useCallback(async () => {
    if (dirty && !(await conferma({ titolo: t("symbolEditor.closeTitle"), testo: t("symbolEditor.closeUnsaved"), pericolo: true }))) return;
    close();
  }, [close, dirty, t]);

  // Keys stay inside the editor: Delete must not delete an object of the page.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      e.stopPropagation();
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
      else if (mod && k === "d") { e.preventDefault(); dup(); }
      else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); del(); }
      else if (e.key === "Escape") { if (sel.length) setSel([]); else if (tool !== "select") setTool("select"); else void doClose(); }
      else if (e.key.startsWith("Arrow") && sel.length) {
        e.preventDefault();
        const s = e.shiftKey ? 10 : 1;
        move(e.key === "ArrowLeft" ? -s : e.key === "ArrowRight" ? s : 0, e.key === "ArrowUp" ? -s : e.key === "ArrowDown" ? s : 0);
      }
    };
    window.addEventListener("keydown", h, true);
    return () => window.removeEventListener("keydown", h, true);
  }, [del, dup, move, redo, undo, sel, tool, doClose]);

  // ── saving ──
  const save = async () => {
    if (compiled.errors.length) return;
    setBusy(true);
    const err = await writeSymbols(withSymbol(d, savedSlug));
    setBusy(false);
    if (err) { await avviso({ livello: "errore", titolo: t("symbolEditor.saveFailed"), testo: err }); return; }
    setSaved(d);
    setSavedSlug(d.slug);
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
    color: on ? "var(--brand-primary-testo, #fff)" : C.text,
  });
  const small: React.CSSProperties = { ...btn(false), padding: "2px 6px", fontSize: 11 };
  const parts = ins.filter((i) => i.kind !== "state");
  const one = sel.length === 1 ? (d.ops[sel[0]] as Op) : undefined;
  const oneLayer = sel.length === 1 ? layerOf(sel[0]) : undefined;
  const lang = i18n.language.startsWith("it") ? "it" : "en";

  return (
    <div data-testid="symbol-editor" style={{
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
        <button type="button" style={btn(false)} disabled={busy || !!compiled.errors.length} onClick={() => void saveAs()}>{t("symbolEditor.saveAs")}</button>
        <button type="button" data-testid="symbol-editor-save" style={btn(dirty)} disabled={busy || !!compiled.errors.length || !dirty}
          onClick={() => void save()}>{t("symbolEditor.save")}</button>
        <button type="button" style={btn(false)} onClick={() => void doClose()}>{t("symbolEditor.close")}</button>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* layers */}
        <div style={{ width: 230, borderRight: `1px solid ${C.border}`, overflow: "auto", padding: 8 }}>
          <div style={{ color: C.subtle, fontWeight: 700, marginBottom: 4 }}>{t("symbolEditor.layers")}</div>
          {ls.map((l) => (
            <div key={`${l.id}-${l.start}`} style={{ marginBottom: 6 }}>
              <div onClick={() => setSel(l.ops)} style={{ cursor: "pointer", color: C.muted, fontWeight: 600 }}>{layerLabel(l, t)}</div>
              {l.ops.map((i) => (
                <div key={i} onClick={(e) => setSel(e.shiftKey ? [...sel, i] : [i])}
                  style={{
                    cursor: "pointer", padding: "1px 6px 1px 14px", borderRadius: 3,
                    background: sel.includes(i) ? C.accent : "transparent",
                    color: sel.includes(i) ? "var(--brand-primary-testo, #fff)" : C.text,
                  }}>
                  {opLabel(d.ops[i] as Op, t)} <span style={{ opacity: 0.6 }}>#{i + 1}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* canvas */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", gap: 6, padding: 6, borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
            {(["select", "rect", "ellipse", "line"] as Tool[]).map((k) => (
              <button key={k} type="button" data-testid={`symbol-tool-${k}`} style={btn(tool === k)} onClick={() => setTool(k)}>
                {t(`symbolEditor.tool.${k}`)}
              </button>
            ))}
            <span style={{ flex: 1 }} />
            <span style={{ color: C.subtle }}>{w} × {h}</span>
          </div>
          <div style={{ flex: 1, minHeight: 0, padding: 16, display: "flex" }}>
            <svg ref={svgRef} data-testid="symbol-editor-canvas"
              viewBox={`${-PAD} ${-PAD} ${w + 2 * PAD} ${h + 2 * PAD}`} preserveAspectRatio="xMidYMid meet"
              style={{ flex: 1, minWidth: 0, cursor: tool === "select" ? "default" : "crosshair", touchAction: "none" }}
              onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
              <defs>
                <pattern id="sym-edit-grid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M10 0 L0 0 0 10" fill="none" stroke={C.border} strokeWidth={0.2} />
                </pattern>
              </defs>
              <rect x={0} y={0} width={w} height={h} fill={C.surface} />
              <rect x={0} y={0} width={w} height={h} fill="url(#sym-edit-grid)" stroke={C.subtle} strokeWidth={0.3} strokeDasharray="2 2" />
              {compiled.svg && compiled.voce && manifesto && (
                <g ref={drawRef}>
                  <SimboloLibSvg sim={compiled.voce} svg={compiled.svg} manifesto={manifesto} prefisso="sym-edit"
                    x={0} y={0} w={w} h={h} valori={{ corpo: null, gira: false, periodoS: 2 }} progetto={projectStyle} />
                </g>
              )}
              {/* part geometry: the level window and the anchors */}
              {parts.map((p) => {
                const g = (d.ops[p.op] as Op).geo as Record<string, number>;
                if (p.kind === "level") return (
                  <rect key={p.id} x={g.x} y={g.y} width={g.w} height={g.h} fill="none" stroke={C.accent}
                    strokeWidth={0.4} strokeDasharray="1.5 1" pointerEvents="none" />
                );
                if (typeof g.cx !== "number") return null;
                const live = drag?.kind === "anchor" && drag.op === p.op ? drag.cur : [g.cx, g.cy];
                const active = oneLayer?.id === p.id;
                return (
                  <g key={p.id} style={{ cursor: "move" }} onPointerDown={startAnchor(p.op)} data-testid={`symbol-anchor-${p.id}`}>
                    <circle cx={live[0]} cy={live[1]} r={2.2} fill="transparent" stroke={active ? C.danger : C.accent} strokeWidth={0.5} />
                    <path d={`M${live[0] - 3.5} ${live[1]} H${live[0] + 3.5} M${live[0]} ${live[1] - 3.5} V${live[1] + 3.5}`}
                      stroke={active ? C.danger : C.accent} strokeWidth={0.4} />
                  </g>
                );
              })}
              {/* selection */}
              {selBox && drag?.kind !== "draw" && (() => {
                const b = drag?.kind === "resize" ? drag.cur
                  : drag?.kind === "move" ? { ...selBox, x: selBox.x + drag.d[0], y: selBox.y + drag.d[1] } : selBox;
                const hs = 2.4;
                return (
                  <g>
                    <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={C.accent} strokeWidth={0.4}
                      strokeDasharray="1 0.6" pointerEvents="none" />
                    {([[0, 0], [1, 0], [0, 1], [1, 1]] as [0 | 1, 0 | 1][]).map(([cx, cy]) => (
                      <rect key={`${cx}${cy}`} x={b.x + cx * b.w - hs / 2} y={b.y + cy * b.h - hs / 2} width={hs} height={hs}
                        fill={C.bg} stroke={C.accent} strokeWidth={0.4}
                        style={{ cursor: cx === cy ? "nwse-resize" : "nesw-resize" }}
                        onPointerDown={startResize([cx ? 0 : 1, cy ? 0 : 1] as [0 | 1, 0 | 1])} />
                    ))}
                  </g>
                );
              })()}
              {drag?.kind === "draw" && (() => {
                const [x0, y0] = drag.start, [x1, y1] = drag.cur;
                if (tool === "line") return <line x1={x0} y1={y0} x2={x1} y2={y1} stroke={C.accent} strokeWidth={0.6} />;
                const b = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
                return tool === "rect"
                  ? <rect x={b.x} y={b.y} width={b.w} height={b.h} fill="none" stroke={C.accent} strokeWidth={0.6} />
                  : <ellipse cx={b.x + b.w / 2} cy={b.y + b.h / 2} rx={b.w / 2} ry={b.h / 2} fill="none" stroke={C.accent} strokeWidth={0.6} />;
              })()}
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
            {(["piece", "structure"] as const).map((k) => (
              <button key={k} type="button" onClick={() => setTab(k)} data-testid={`symbol-tab-${k}`} style={{
                flex: 1, padding: 8, border: "none", cursor: "pointer", fontSize: 12,
                background: tab === k ? C.surface : "transparent", color: tab === k ? C.text : C.muted,
              }}>{t(`symbolEditor.tab.${k}`)}</button>
            ))}
          </div>
          <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 8 }}>
            {tab === "piece" ? (
              <PieceProps d={d} sel={sel} one={one} layer={oneLayer} catalog={catalog} commit={commit}
                onDup={dup} onDel={del} onReorder={(dir) => { const r = reorderOp(d, sel[0], dir); commit(r.d); setSel([r.at]); }} />
            ) : (
              <StructureProps d={d} catalog={catalog} commit={commit} isVariant={!!d.overrides} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the side panels ────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 90, color: C.muted, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, display: "flex", gap: 4 }}>{children}</span>
    </label>
  );
}

const input: React.CSSProperties = {
  width: "100%", minWidth: 0, padding: "3px 5px", fontSize: 12, borderRadius: 3,
  border: `1px solid ${C.border}`, background: C.surface, color: C.text,
};

function Num({ value, onChange, step = 0.5 }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <CampoNumero step={step} style={input} value={Number.isFinite(value) ? value : 0}
    onTesto={(s) => { const v = Number(s); if (s.trim() !== "" && Number.isFinite(v)) onChange(v); }} />;
}

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

function PieceProps({ d, sel, one, layer, catalog, commit, onDup, onDel, onReorder }: {
  d: DescrizioneSimbolo; sel: number[]; one?: Op; layer?: Layer; catalog: Catalog | null;
  commit: (d: DescrizioneSimbolo) => void; onDup: () => void; onDel: () => void; onReorder: (dir: 1 | -1) => void;
}) {
  const { t } = useTranslation();
  if (!sel.length) return <p style={{ color: C.subtle, margin: 0 }}>{t("symbolEditor.noSelection")}</p>;
  const actions = (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {one && <button type="button" style={input} onClick={() => onReorder(1)}>{t("symbolEditor.up")}</button>}
      {one && <button type="button" style={input} onClick={() => onReorder(-1)}>{t("symbolEditor.down")}</button>}
      <button type="button" style={input} onClick={onDup}>{t("symbolEditor.duplicate")}</button>
      <button type="button" style={{ ...input, color: C.danger }} onClick={onDel}>{t("symbolEditor.delete")}</button>
    </div>
  );
  if (!one) return <>{t("symbolEditor.manySelected", { n: sel.length })}{actions}</>;
  const i = sel[0];
  const fill = fillOf(one);
  const geo = Array.isArray(one.geo) ? (one.geo as [string, number | string][]) : [];
  const extra = (one.extra as [string, number | string][] | undefined) ?? [];
  const sw = extra.find(([k]) => k === "stroke_width")?.[1];
  const inBody = layer?.kind === "body";
  const fillKind = !fill ? "" : "mat" in fill ? "mat" : "color" in fill ? "color" : "body";
  return (
    <>
      <div style={{ fontWeight: 700 }}>{opLabel(one, t)} #{i + 1}
        {layer && <span style={{ color: C.subtle, fontWeight: 400 }}> · {layerLabel(layer, t)}</span>}</div>
      {geo.map(([k, v]) => typeof v === "number" && (
        <Field key={k} label={k}><Num value={v} onChange={(n) => commit(setGeo(d, i, k, n))} /></Field>
      ))}
      {(one.op === "forma" || one.op === "tratto") && fill && (
        <>
          <Field label={t("symbolEditor.colour")}>
            <select style={input} value={fillKind} onChange={(e) => {
              const k = e.target.value;
              commit(setFill(d, i, k === "mat" ? { mat: "steel" } : k === "color" ? { color: "#808080" } : { body: true }));
            }}>
              <option value="mat">{t("symbolEditor.fill.material")}</option>
              <option value="color">{t("symbolEditor.fill.own")}</option>
              {(inBody || fillKind === "body") && one.op === "forma" && <option value="body">{t("symbolEditor.fill.body")}</option>}
            </select>
          </Field>
          {"mat" in fill && <Field label=""><MaterialSelect value={fill.mat} catalog={catalog} onChange={(m) => commit(setFill(d, i, { mat: m }))} /></Field>}
          {"color" in fill && <Field label=""><input type="color" style={{ ...input, padding: 0, height: 24 }} value={fill.color}
            onChange={(e) => commit(setFill(d, i, { color: e.target.value }))} /></Field>}
          {fillKind === "color" && <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.ownColourNote")}</p>}
        </>
      )}
      {one.op === "forma" && (
        <Field label={t("symbolEditor.veil")}>
          <select style={input} value={String(one.velo ?? "")} onChange={(e) => commit(setVeil(d, i, e.target.value || null))}>
            <option value="">{t("symbolEditor.noVeil")}</option>
            {catalog?.veils.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
          </select>
        </Field>
      )}
      {(one.op === "forma" || one.op === "tratto") && (
        <Field label={t("symbolEditor.strokeWidth")}>
          <Num value={typeof sw === "number" ? sw : 1} step={0.1} onChange={(n) => commit(setGeo(d, i, "stroke_width", Math.max(0, Math.min(20, n))))} />
        </Field>
      )}
      {actions}
    </>
  );
}

function StructureProps({ d, catalog, commit, isVariant }: {
  d: DescrizioneSimbolo; catalog: Catalog | null; commit: (d: DescrizioneSimbolo) => void; isVariant: boolean;
}) {
  const { t } = useTranslation();
  const ins = inputs(d);
  const [adding, setAdding] = useState<InputKind | "">("");
  return (
    <>
      {isVariant && <p style={{ margin: 0, color: C.muted }}>{t("symbolEditor.variantNote")}</p>}
      <Field label={t("symbolEditor.nameIt")}><input style={input} value={d.it} maxLength={60} onChange={(e) => commit({ ...d, it: e.target.value })} /></Field>
      <Field label={t("symbolEditor.nameEn")}><input style={input} value={d.en} maxLength={60} onChange={(e) => commit({ ...d, en: e.target.value })} /></Field>
      <Field label={t("symbolEditor.category")}><input style={input} value={d.tipo ?? "project"} maxLength={30}
        onChange={(e) => commit({ ...d, tipo: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") })} /></Field>
      <Field label={t("symbolEditor.size")}>
        <Num value={d.w} step={10} onChange={(n) => commit({ ...d, w: validSize(n) })} />
        <Num value={d.h} step={10} onChange={(n) => commit({ ...d, h: validSize(n) })} />
      </Field>
      <Field label={t("symbolEditor.bodyMaterial")}><MaterialSelect value={d.body} catalog={catalog} onChange={(m) => commit({ ...d, body: m })} /></Field>

      <div style={{ fontWeight: 700, marginTop: 6 }}>{t("symbolEditor.inputs")}</div>
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.inputsNote")}</p>
      {ins.map((inp) => {
        const op = d.ops[inp.op] as Op;
        const g = (op.geo as Record<string, number> | undefined) ?? {};
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
                  onChange={(e) => commit(renamePart(d, inp.op, e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-")))} />
              </Field>
            )}
            {Object.entries(g).filter(([, v]) => typeof v === "number").map(([k, v]) => (
              <Field key={k} label={t(`symbolEditor.geo.${k}`, { defaultValue: k })}>
                <Num value={v} onChange={(n) => commit(setPartGeo(d, inp.op, k, n))} />
              </Field>
            ))}
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
      <p style={{ margin: 0, color: C.subtle, fontSize: 11 }}>{t("symbolEditor.sizeNote", { w: r2(d.w), h: r2(d.h) })}</p>
    </>
  );
}
