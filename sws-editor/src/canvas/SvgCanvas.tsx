import { useEffect, useRef, useState } from "react";
import { TrendCanvas } from "@/canvas/TrendCanvas";
import { useAppStore } from "@/store";
import { SYMBOLS } from "@/symbols/library";
import type { CustomSymbol, GridCell, SynopticObject, TagState } from "@/types";

// ── Canvas props ──────────────────────────────────────────────────────────────

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagState>;
  background?: string;
  selectedId?: string | null;
  /** Full multi-selection set. Falls back to `selectedId` when not provided. */
  selectedIds?: string[];
  gridSize?: number;
  snapEnabled?: boolean;
  /** Custom symbols defined in the project (persisted in project.yaml). */
  customSymbols?: CustomSymbol[];
  /** Page design width in px. Shows a dashed boundary rect in edit mode. */
  pageWidth?: number;
  /** Page design height in px. Shows a dashed boundary rect in edit mode. */
  pageHeight?: number;
  /** Current page id — keys persisted ruler guides in localStorage. */
  pageId?: string;
  /** Currently selected grid cell in edit mode. */
  selectedCell?: { objectId: string; row: number; col: number } | null;
  /** Currently selected child object within a grid cell. */
  selectedCellChild?: { objectId: string; row: number; col: number } | null;
  /** Currently selected rectangular range of grid cells (for merge). */
  selectedCellRange?: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null;
  /** Currently selected slot inside a split (`cell.sub`) cell. */
  selectedSubCell?: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null;
  /** Single-select (replace) when shift is false; toggle into the set when true. */
  onSelect?: (id: string | null, shift?: boolean) => void;
  /** Called with the full set of ids enclosed by a drag-selection rectangle. */
  onSelectMany?: (ids: string[]) => void;
  onMove?: (id: string, patch: Partial<SynopticObject>) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  /** View-mode dispatcher for on_press / on_release function bindings. */
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
  onSelectCell?: (objectId: string, row: number, col: number) => void;
  onSelectCellChild?: (objectId: string, row: number, col: number) => void;
  /** Shift+click on a second cell of the same grid: form/extend a rect range. */
  onSelectCellRange?: (objectId: string, r1: number, c1: number, r2: number, c2: number) => void;
  /** Click on slot "a" or "b" inside a split cell. */
  onSelectSubCell?: (objectId: string, row: number, col: number, path: ("a" | "b")[]) => void;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
  dx2?: number;
  dy2?: number;
}

interface ResizeState {
  objId: string;
  /** Box handles: "tl"|"tc"|"tr"|"ml"|"mr"|"bl"|"bc"|"br"
   *  Line endpoint handles: "p1"|"p2" */
  handle: string;
  startX: number;
  startY: number;
  startObj: { x: number; y: number; width: number; height: number; x2?: number; y2?: number };
}

/** Active drag on an interior border of a `grid` object (between two
 *  columns or two rows). The user gets a single bracketed history entry
 *  per drag thanks to openInteraction/closeInteraction in startDrag. */
interface GridBorderResizeState {
  objId: string;
  axis: "col" | "row";
  /** Index of the border: between column `index-1` and `index` (col-axis)
   *  or between row `index-1` and `index` (row-axis). Valid 1..count-1. */
  index: number;
  /** Mouse clientX (col axis) or clientY (row axis) at startMouse. */
  startMouse: number;
  /** Pixel sizes of the two adjacent tracks at the start of the drag. */
  startA: number;
  startB: number;
  /** Snapshot of all column widths or row heights at start. */
  startSizes: number[];
}

/** Active drag on the internal border of a split (`cell.sub`) cell or
 *  any nested sub-cell. `path` addresses the SubGrid being resized: empty
 *  = the cell-level `sub`, `["a"]` = the SubGrid living inside slot a's
 *  `entry.sub`, and so on. */
interface SubBorderResizeState {
  objId: string;
  row: number;
  col: number;
  path: ("a" | "b")[];
  /** Orientation cached so handleMouseMove picks the right mouse axis
   *  without re-traversing the grid. */
  orientation: "rows" | "cols";
  startMouse: number;
  startRatio: number;
  /** Length (px) of the parent cell along the split axis at start. */
  cellPxSize: number;
}

/** Coordinates of an in-progress drag-selection rectangle (SVG space). */
interface SelRect {
  startX: number;
  startY: number;
  curX: number;
  curY: number;
}

// ── SVG geometry helpers ──────────────────────────────────────────────────────

/** Convert polar angle (degrees from North/12-o'clock, clockwise) to Cartesian. */
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG arc path from startAngle to endAngle (clockwise, degrees from North). */
function arcPath(cx: number, cy: number, r: number, startDeg: number, endDeg: number): string {
  const s = polar(cx, cy, r, startDeg);
  const e = polar(cx, cy, r, endDeg);
  const sweep = ((endDeg - startDeg) + 360) % 360;
  const largeArc = sweep > 180 ? 1 : 0;
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${largeArc} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// ── Quality helpers ───────────────────────────────────────────────────────────

/**
 * Stable sort by z_index (default 0). Objects with the same z keep their
 * original array order (later in the array → drawn on top within the tier).
 * SVG paints in document order, so the returned array matches "back-to-front".
 */
function sortByZ(objects: SynopticObject[]): SynopticObject[] {
  return objects
    .map((o, i) => ({ o, i }))
    .sort((a, b) => {
      const za = a.o.z_index ?? 0;
      const zb = b.o.z_index ?? 0;
      if (za !== zb) return za - zb;
      return a.i - b.i;
    })
    .map((x) => x.o);
}

/**
 * Resolve runtime visibility for an object.
 * If `visible_tag` is bound and present in tagValues, its value drives the
 * decision (truthy → visible). Otherwise the static `visible` flag wins
 * (default true). Edit mode uses this only to dim hidden objects; runtime
 * mode skips them entirely.
 */
function isObjectVisible(obj: SynopticObject, tagValues: Record<string, TagState>): boolean {
  if (obj.visible_tag && tagValues[obj.visible_tag]) {
    const v = tagValues[obj.visible_tag].value;
    if (typeof v === "boolean") return v;
    if (typeof v === "number")  return v !== 0;
    if (typeof v === "string")  return v.trim().length > 0;
    return Boolean(v);
  }
  return obj.visible !== false;
}

function qualityColor(
  quality: TagState["quality"],
  goodColor?: string, badColor?: string, uncertainColor?: string,
): string {
  if (quality === "Good") return goodColor ?? "#22c55e";
  if (quality === "Bad")  return badColor  ?? "#ef4444";
  return uncertainColor ?? "#eab308";
}

/** Determine fill color based on value vs thresholds. Returns null to use default. */
function thresholdColor(
  value: number,
  alarmLow?: number, warnLow?: number, warnHigh?: number, alarmHigh?: number,
): string | null {
  if (alarmHigh !== undefined && value >= alarmHigh) return "#ef4444";
  if (alarmLow  !== undefined && value <= alarmLow)  return "#ef4444";
  if (warnHigh  !== undefined && value >= warnHigh)  return "#eab308";
  if (warnLow   !== undefined && value <= warnLow)   return "#eab308";
  return null;
}

function formatValue(value: number | string | boolean, format?: string): string {
  if (format && typeof value === "number") {
    const m = format.match(/\{value:\.(\d+)f\}/);
    if (m) return format.replace(/\{value:[^}]+\}/, value.toFixed(Number(m[1])));
  }
  return String(value);
}

// ── Binding resolver ─────────────────────────────────────────────────────────

/**
 * Returns a CSS `transition` style for the four CSS-animatable visual props
 * (fill / stroke / opacity / transform) when the object has a positive
 * `transition_duration_ms`. Returns undefined otherwise — the spread becomes
 * a no-op. Easing is fixed to `ease-out` (good for snap-to-target feel).
 */
function transitionStyle(obj: SynopticObject): React.CSSProperties | undefined {
  const ms = obj.transition_duration_ms;
  if (!ms || ms <= 0) return undefined;
  return {
    transition: `fill ${ms}ms ease-out, stroke ${ms}ms ease-out, opacity ${ms}ms ease-out, transform ${ms}ms ease-out`,
  };
}

/**
 * Applies `obj.bindings` overrides: for each entry whose tag has a live value,
 * replaces the corresponding top-level prop with the live value.
 * Boolean-typed props (visible, flip_h, flip_v) are coerced via truthy logic.
 * Returns the same object reference when there is nothing to resolve.
 */
function resolveObject(obj: SynopticObject, tagValues: Record<string, TagState>): SynopticObject {
  if (!obj.bindings) return obj;
  const entries = Object.entries(obj.bindings);
  if (entries.length === 0) return obj;
  const BOOL_PROPS = new Set(["visible", "flip_h", "flip_v"]);
  const patch: Partial<SynopticObject> = {};
  for (const [prop, tagId] of entries) {
    const tv = tagValues[tagId];
    if (!tv) continue;
    const v = tv.value;
    if (BOOL_PROPS.has(prop)) {
      const b = typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : String(v).trim().length > 0;
      (patch as Record<string, unknown>)[prop] = b;
    } else {
      (patch as Record<string, unknown>)[prop] = v;
    }
  }
  return Object.keys(patch).length > 0 ? { ...obj, ...patch } : obj;
}

/**
 * Wraps `content` in a `<g>` with rotation/flip/opacity transforms when any
 * are significant. Returns `content` unwrapped when nothing to apply.
 * Center of rotation = bounding-box centre (obj.x + w/2, obj.y + h/2).
 */
function applyTransform(obj: SynopticObject, w: number, h: number, content: React.ReactNode): React.ReactNode {
  const rot     = obj.rotation ?? 0;
  const sx      = obj.flip_h   ? -1 : 1;
  const sy      = obj.flip_v   ? -1 : 1;
  const opacity = obj.opacity  ?? 1;
  const hasRotFlip = rot !== 0 || sx !== 1 || sy !== 1;
  const hasOpacity = opacity < 1;
  const txStyle    = transitionStyle(obj);
  // Wrap when there is geometry to apply OR when a transition is active —
  // the latter case ensures binding-driven rotation/opacity changes animate
  // smoothly even if the static values are defaults (rot=0, opacity=1).
  if (!hasRotFlip && !hasOpacity && !txStyle) return content;
  const cx = obj.x + w / 2;
  const cy = obj.y + h / 2;
  const transform = hasRotFlip
    ? `rotate(${rot} ${cx} ${cy}) translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`
    : undefined;
  return (
    <g transform={transform} opacity={hasOpacity ? opacity : undefined} style={txStyle}>
      {content}
    </g>
  );
}

// ── Quality dot overlay ───────────────────────────────────────────────────────

function QDot({ x, y, quality, goodColor, badColor, uncertainColor }: {
  x: number; y: number; quality: TagState["quality"];
  goodColor?: string; badColor?: string; uncertainColor?: string;
}) {
  return (
    <circle cx={x} cy={y} r={5}
      fill={qualityColor(quality, goodColor, badColor, uncertainColor)}
      style={{ pointerEvents: "none" }} />
  );
}

// ── SvgCanvas root ────────────────────────────────────────────────────────────

export function SvgCanvas({
  objects,
  tagValues = {},
  background = "#1a1a2e",
  selectedId,
  selectedIds,
  gridSize = 10,
  snapEnabled = true,
  customSymbols = [],
  pageWidth,
  pageHeight,
  pageId,
  selectedCell,
  selectedCellChild,
  selectedCellRange,
  selectedSubCell,
  onSelect,
  onSelectMany,
  onMove,
  onWriteTag,
  onScript,
  onNavigate,
  onSelectCell,
  onSelectCellChild,
  onSelectCellRange,
  onSelectSubCell,
}: SvgCanvasProps) {
  // Resolved selection set: prefer the explicit array, fall back to the
  // legacy single-id prop, then to "nothing selected".
  const selIds = selectedIds ?? (selectedId ? [selectedId] : []);
  const selSet = new Set(selIds);

  // Bracketed-interaction helpers — coalesce drag/resize into a single
  // history entry per gesture rather than per pixel.
  const beginInteraction = useAppStore((s) => s.beginInteraction);
  const endInteraction = useAppStore((s) => s.endInteraction);
  const resizeSubBorderAction = useAppStore((s) => s.resizeSubBorder);
  // Tracks whether we actually opened an interaction this gesture, so
  // endDrag only closes one when one was opened.
  const interactionOpen = useRef(false);
  const openInteraction = (label: string) => {
    if (interactionOpen.current) return;
    beginInteraction(label);
    interactionOpen.current = true;
  };
  const closeInteraction = () => {
    if (!interactionOpen.current) return;
    endInteraction();
    interactionOpen.current = false;
  };

  // Object drag state
  const dragRef = useRef<DragState | null>(null);
  // Resize handle drag state
  const resizeRef = useRef<ResizeState | null>(null);
  // Grid interior-border resize state (drag between columns or between rows).
  const gridBorderRef = useRef<GridBorderResizeState | null>(null);
  // Sub-grid (split cell) interior border resize state.
  const subBorderRef = useRef<SubBorderResizeState | null>(null);

  // Selection-rectangle drag state. `selDragRef` tracks the active drag for
  // event handlers (always up-to-date); `selRect` drives the visual overlay.
  const selDragRef     = useRef<SelRect | null>(null);
  const [selRect, setSelRect] = useState<SelRect | null>(null);
  // Set to true when a rect-selection just completed so the SVG onClick
  // (which fires on every mouseup) does not deselect the result.
  const suppressClick  = useRef(false);

  // Zoom + pan (edit mode only). Use refs for event handler closures +
  // state for render. panDragRef: middle-click panning.
  const svgRef   = useRef<SVGSVGElement>(null);
  const zoomRef  = useRef(1);
  const panRef   = useRef({ x: 0, y: 0 });
  const [viewT, setViewT] = useState({ zoom: 1, panX: 0, panY: 0 });
  const panDragRef = useRef<{ startCX: number; startCY: number; startPX: number; startPY: number } | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [snapLines, setSnapLines] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });

  // ── Rulers + guides ──
  // Guides are page-local px coordinates (SVG user space). Persisted in
  // localStorage keyed by pageId — not in project.yaml (deliberate: guides
  // are an editor convenience, not part of the published synoptic).
  // RULER_PX is the strip thickness (top + left). Stored as a constant so
  // hit-testing, render, and snap-delete zone all agree.
  const RULER_PX = 20;
  type Guide = { id: string; axis: "h" | "v"; pos: number };
  const [showRulers, setShowRulers] = useState(() => {
    try { return localStorage.getItem("sws.canvas.showRulers") !== "0"; }
    catch { return true; }
  });
  const [guides, setGuides] = useState<Guide[]>([]);
  // Track which guide (if any) is being dragged. `pendingAxis` is set during
  // a brand-new drag from a ruler (no id yet); the guide is committed on
  // mouse-up.
  const guideDragRef = useRef<{ id: string | null; axis: "h" | "v"; startPos: number } | null>(null);
  const [draggingGuide, setDraggingGuide] = useState<{ axis: "h" | "v"; pos: number; deleting: boolean } | null>(null);

  // Load guides whenever the active page changes
  useEffect(() => {
    if (!pageId) { setGuides([]); return; }
    try {
      const raw = localStorage.getItem(`sws.canvas.guides.${pageId}`);
      setGuides(raw ? JSON.parse(raw) : []);
    } catch { setGuides([]); }
  }, [pageId]);

  // Persist on every change (debounce not needed — guides change at most
  // a few times per second during a drag, and localStorage writes are sync).
  const persistGuides = (next: Guide[]) => {
    setGuides(next);
    if (!pageId) return;
    try { localStorage.setItem(`sws.canvas.guides.${pageId}`, JSON.stringify(next)); }
    catch { /* quota — ignore */ }
  };

  const toggleRulers = () => {
    setShowRulers((v) => {
      const next = !v;
      try { localStorage.setItem("sws.canvas.showRulers", next ? "1" : "0"); }
      catch { /* ignore */ }
      return next;
    });
  };

  const applyView = (z: number, px: number, py: number) => {
    zoomRef.current = z;
    panRef.current = { x: px, y: py };
    setViewT({ zoom: z, panX: px, panY: py });
  };

  const fitView = () => {
    const el = svgRef.current;
    if (!el || objects.length === 0) { applyView(1, 0, 0); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objects) {
      const bb = objBBox(o);
      minX = Math.min(minX, bb.x1); minY = Math.min(minY, bb.y1);
      maxX = Math.max(maxX, bb.x2); maxY = Math.max(maxY, bb.y2);
    }
    const W = maxX - minX; const H = maxY - minY;
    const cw = el.clientWidth; const ch = el.clientHeight;
    const z = Math.max(0.1, Math.min(4, Math.min(cw / (W + 80), ch / (H + 80))));
    applyView(z, (cw - W * z) / 2 - minX * z, (ch - H * z) / 2 - minY * z);
  };

  // Non-passive wheel listener for zoom + pan via scroll.
  useEffect(() => {
    if (!onMove) return; // only in edit mode
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      if (e.ctrlKey) {
        // Zoom centred on cursor
        const factor = e.deltaY > 0 ? 1 / 1.1 : 1.1;
        const oldZ = zoomRef.current;
        const newZ = Math.max(0.1, Math.min(8, oldZ * factor));
        const svgCX = (cx - panRef.current.x) / oldZ;
        const svgCY = (cy - panRef.current.y) / oldZ;
        applyView(newZ, cx - svgCX * newZ, cy - svgCY * newZ);
      } else {
        // Pan
        const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
        const dy = e.shiftKey ?  0        : -e.deltaY;
        applyView(zoomRef.current, panRef.current.x + dx, panRef.current.y + dy);
      }
    };
    const resetHandler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "0") { e.preventDefault(); fitView(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "0") { e.preventDefault(); applyView(1, 0, 0); }
    };
    el.addEventListener("wheel", handler, { passive: false });
    window.addEventListener("keydown", resetHandler);
    return () => { el.removeEventListener("wheel", handler); window.removeEventListener("keydown", resetHandler); };
  }, [onMove]);

  /** Convert screen coordinates (relative to SVG element) to SVG user-space. */
  const toSvg = (screenX: number, screenY: number) => ({
    x: (screenX - panRef.current.x) / zoomRef.current,
    y: (screenY - panRef.current.y) / zoomRef.current,
  });

  const snap = (v: number) =>
    snapEnabled && gridSize > 0 ? Math.round(v / gridSize) * gridSize : v;

  /** Compute the bounding box of an object in SVG space.
   *  Lines use the min/max of their two endpoints; other types use x/y/w/h. */
  const objBBox = (obj: SynopticObject): { x1: number; y1: number; x2: number; y2: number } => {
    if (obj.type === "line") {
      const lx1 = Math.min(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
      const ly1 = Math.min(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
      const lx2 = Math.max(obj.x ?? 0, obj.x2 ?? obj.x ?? 0);
      const ly2 = Math.max(obj.y ?? 0, obj.y2 ?? obj.y ?? 0);
      return { x1: lx1, y1: ly1, x2: lx2, y2: ly2 };
    }
    const ox = obj.x ?? 0;
    const oy = obj.y ?? 0;
    return { x1: ox, y1: oy, x2: ox + (obj.width ?? 0), y2: oy + (obj.height ?? 0) };
  };

  const handleSvgMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!onMove) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    if (e.button === 1) {
      // Middle-click → start pan drag
      e.preventDefault();
      panDragRef.current = {
        startCX: e.clientX, startCY: e.clientY,
        startPX: panRef.current.x, startPY: panRef.current.y,
      };
      return;
    }
    if (e.button !== 0) return;
    // If an object drag is already active, ignore (startDrag sets dragRef first
    // because child handlers fire before parent handlers in React).
    if (dragRef.current) return;
    const pt = toSvg(e.clientX - svgRect.left, e.clientY - svgRect.top);
    selDragRef.current = { startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y };
  };

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - svgRect.left;
    const screenY = e.clientY - svgRect.top;
    const pt = toSvg(screenX, screenY);

    if (panDragRef.current) {
      // Middle-click pan
      const pd = panDragRef.current;
      applyView(zoomRef.current,
        pd.startPX + (e.clientX - pd.startCX),
        pd.startPY + (e.clientY - pd.startCY));
      return;
    }

    // Guide drag — updates the visual immediately; commit on mouseup.
    // Dragging the cursor back over the originating ruler arms a delete:
    // the line turns red and is removed on release.
    if (guideDragRef.current && onMove) {
      const ref = guideDragRef.current;
      const pos = ref.axis === "v" ? pt.x : pt.y;
      const overRuler = ref.axis === "v" ? screenY < RULER_PX : screenX < RULER_PX;
      setDraggingGuide({ axis: ref.axis, pos, deleting: overRuler });
      return;
    }

    // Update mouse position display
    if (onMove) setMousePos(pt);

    const z = zoomRef.current;

    // Grid interior-border drag — adjust two adjacent track sizes while
    // keeping the sum constant. Snap to the other border positions in the
    // same grid so the user can easily re-align columns.
    if (gridBorderRef.current && onMove) {
      const ref = gridBorderRef.current;
      const grid = objects.find((o) => o.id === ref.objId);
      if (grid) {
        const deltaScreen = ref.axis === "col" ? (e.clientX - ref.startMouse) : (e.clientY - ref.startMouse);
        let delta = deltaScreen / z;
        let newA = ref.startA + delta;
        let newB = ref.startB - delta;
        const MIN = 8;
        if (newA < MIN) { delta = MIN - ref.startA; newA = MIN; newB = ref.startB - delta; }
        if (newB < MIN) { delta = ref.startB - MIN; newA = ref.startA + delta; newB = MIN; }

        // Snap candidates: cumulative positions of every other interior
        // border on the same axis. The moving border's reference position
        // is the sum of sizes[0..ref.index-1] (before this drag) plus the
        // new value of sizes[ref.index-1].
        const sizes = ref.startSizes.slice();
        let baseBefore = 0; // sum sizes[0..ref.index-1] before mutation
        for (let i = 0; i < ref.index - 1; i++) baseBefore += sizes[i];
        const draggedPos = baseBefore + newA;
        const otherBorders: number[] = [];
        let acc = 0;
        for (let i = 0; i < sizes.length - 1; i++) {
          acc += sizes[i];
          if (i + 1 !== ref.index) otherBorders.push(acc);
        }
        const threshold = 8 / z;
        let snapHit: number | null = null;
        for (const cand of otherBorders) {
          if (Math.abs(draggedPos - cand) < threshold) { snapHit = cand; break; }
        }
        if (snapHit !== null) {
          // Recompute newA so the dragged border lands exactly on the snap.
          const snappedA = snapHit - baseBefore;
          if (snappedA >= MIN && (ref.startA + ref.startB - snappedA) >= MIN) {
            newA = snappedA;
            newB = ref.startA + ref.startB - snappedA;
          }
        }

        sizes[ref.index - 1] = newA;
        sizes[ref.index] = newB;
        const patch: Partial<SynopticObject> = ref.axis === "col"
          ? { col_widths: sizes }
          : { row_heights: sizes };
        onMove(ref.objId, patch);

        // Snap line is in canvas coordinates: position relative to grid origin.
        if (snapHit !== null) {
          if (ref.axis === "col") setSnapLines({ x: (grid.x ?? 0) + snapHit, y: null });
          else                    setSnapLines({ x: null, y: (grid.y ?? 0) + snapHit });
        } else {
          setSnapLines({ x: null, y: null });
        }
      }
      return;
    }

    // Sub-grid (split cell) interior border drag — updates the ratio of
    // the SubGrid at `ref.path` inside the cell. Orientation was captured
    // at drag start, so we don't need to re-traverse here.
    if (subBorderRef.current) {
      const ref = subBorderRef.current;
      const screenDelta = ref.orientation === "rows"
        ? (e.clientY - ref.startMouse)
        : (e.clientX - ref.startMouse);
      const deltaFrac = (screenDelta / z) / ref.cellPxSize;
      const minFrac = 8 / ref.cellPxSize;
      const newRatio = clamp(ref.startRatio + deltaFrac, minFrac, 1 - minFrac);
      const pageId = useAppStore.getState().currentPageId;
      resizeSubBorderAction(pageId, ref.objId, ref.row, ref.col, ref.path, newRatio);
      return;
    }

    if (resizeRef.current && onMove) {
      // Resize / endpoint handle drag. dx/dy in screen pixels → divide by zoom.
      const { handle, startX, startY, startObj, objId } = resizeRef.current;
      const dx = (e.clientX - startX) / z;
      const dy = (e.clientY - startY) / z;
      if (handle === "p1") {
        onMove(objId, { x: snap(startObj.x + dx), y: snap(startObj.y + dy) });
      } else if (handle === "p2") {
        onMove(objId, { x2: snap((startObj.x2 ?? startObj.x + 100) + dx), y2: snap((startObj.y2 ?? startObj.y) + dy) });
      } else {
        let { x, y, width, height } = startObj;
        const isCorner = (handle === "tl" || handle === "tr" || handle === "bl" || handle === "br");
        // Shift + corner drag → preserve aspect ratio. We pick whichever axis
        // moved more (in width-equivalent units) as the driver and derive the
        // other axis from it. Mid-edge handles ignore Shift since only one
        // dimension is meaningful.
        if (e.shiftKey && isCorner && startObj.width > 0 && startObj.height > 0) {
          const aspect = startObj.width / startObj.height;
          const dxSigned = handle.includes("l") ? -dx : dx;   // outward = grow
          const dySigned = handle.includes("t") ? -dy : dy;
          // Convert dy to width-equivalent units so we can compare magnitudes.
          const dyAsW = dySigned * aspect;
          const dw = Math.abs(dxSigned) >= Math.abs(dyAsW) ? dxSigned : dyAsW;
          let newW = snap(startObj.width + dw);
          if (newW < 4) newW = 4;
          let newH = snap(newW / aspect);
          if (newH < 4) { newH = 4; newW = snap(newH * aspect); }
          width = newW;
          height = newH;
          // Anchor the opposite corner: "l" handles move x right by the width
          // delta; "t" handles move y down by the height delta.
          if (handle.includes("l")) x = startObj.x + (startObj.width - newW);
          if (handle.includes("t")) y = startObj.y + (startObj.height - newH);
        } else {
          if (handle.includes("l")) { x = snap(startObj.x + dx); width = snap(startObj.width - dx); }
          if (handle.includes("r")) { width = snap(startObj.width + dx); }
          if (handle.includes("t")) { y = snap(startObj.y + dy); height = snap(startObj.height - dy); }
          if (handle.includes("b")) { height = snap(startObj.height + dy); }
        }
        if (width >= 4 && height >= 4) onMove(objId, { x, y, width, height });
      }
    } else if (dragRef.current && onMove) {
      // Object drag — coords in SVG space with edge snapping
      const rawX = pt.x - dragRef.current.offsetX;
      const rawY = pt.y - dragRef.current.offsetY;
      const draggedObj = objects.find((o) => o.id === dragRef.current!.objId);
      const dw = draggedObj?.width ?? 0;
      const dh = draggedObj?.height ?? 0;

      const threshold = 8 / z;
      let newX = rawX; let newY = rawY;
      let snapX: number | null = null; let snapY: number | null = null;

      // Helper: test a list of candidate edges against the three drag
      // anchor points (left/centre/right or top/middle/bottom).
      const trySnapX = (exs: number[]): { snap: number; out: number } | null => {
        for (const ex of exs) {
          if (Math.abs(rawX - ex) < threshold)           return { snap: ex, out: ex };
          if (Math.abs(rawX + dw / 2 - ex) < threshold) return { snap: ex, out: ex - dw / 2 };
          if (Math.abs(rawX + dw - ex) < threshold)     return { snap: ex, out: ex - dw };
        }
        return null;
      };
      const trySnapY = (eys: number[]): { snap: number; out: number } | null => {
        for (const ey of eys) {
          if (Math.abs(rawY - ey) < threshold)           return { snap: ey, out: ey };
          if (Math.abs(rawY + dh / 2 - ey) < threshold) return { snap: ey, out: ey - dh / 2 };
          if (Math.abs(rawY + dh - ey) < threshold)     return { snap: ey, out: ey - dh };
        }
        return null;
      };

      for (const other of objects) {
        if (other.id === dragRef.current.objId) continue;
        const bb = objBBox(other);
        if (snapX === null) {
          const hit = trySnapX([bb.x1, (bb.x1 + bb.x2) / 2, bb.x2]);
          if (hit) { snapX = hit.snap; newX = hit.out; }
        }
        if (snapY === null) {
          const hit = trySnapY([bb.y1, (bb.y1 + bb.y2) / 2, bb.y2]);
          if (hit) { snapY = hit.snap; newY = hit.out; }
        }
        if (snapX !== null && snapY !== null) break;
      }

      // Page-border snapping — fall back to the page's left/centre/right and
      // top/middle/bottom edges if no nearby object edge already caught
      // the drag. Same threshold; same anchor logic.
      if (pageWidth && pageWidth > 0 && snapX === null) {
        const hit = trySnapX([0, pageWidth / 2, pageWidth]);
        if (hit) { snapX = hit.snap; newX = hit.out; }
      }
      if (pageHeight && pageHeight > 0 && snapY === null) {
        const hit = trySnapY([0, pageHeight / 2, pageHeight]);
        if (hit) { snapY = hit.snap; newY = hit.out; }
      }
      // Ruler-guide snapping — pulls the drag onto any vertical guide (x) or
      // horizontal guide (y) within the same threshold band.
      if (snapX === null) {
        const xGuides = guides.filter((g) => g.axis === "v").map((g) => g.pos);
        if (xGuides.length > 0) {
          const hit = trySnapX(xGuides);
          if (hit) { snapX = hit.snap; newX = hit.out; }
        }
      }
      if (snapY === null) {
        const yGuides = guides.filter((g) => g.axis === "h").map((g) => g.pos);
        if (yGuides.length > 0) {
          const hit = trySnapY(yGuides);
          if (hit) { snapY = hit.snap; newY = hit.out; }
        }
      }

      if (snapX === null) newX = snap(rawX);
      if (snapY === null) newY = snap(rawY);
      setSnapLines({ x: snapX, y: snapY });

      const patch: Partial<SynopticObject> = { x: newX, y: newY };
      if (dragRef.current.dx2 !== undefined) {
        patch.x2 = newX + dragRef.current.dx2!;
        patch.y2 = newY + dragRef.current.dy2!;
      }
      onMove(dragRef.current.objId, patch);
    } else if (selDragRef.current) {
      // Selection rect update — coords in SVG space
      const updated: SelRect = { ...selDragRef.current, curX: pt.x, curY: pt.y };
      selDragRef.current = updated;
      setSelRect(updated);
    }
  };

  const endDrag = () => {
    closeInteraction();
    dragRef.current = null;
    resizeRef.current = null;
    gridBorderRef.current = null;
    subBorderRef.current = null;
    panDragRef.current = null;
    setSnapLines({ x: null, y: null });

    // Commit guide drag: delete if the user released over the originating
    // ruler ("deleting" flag), otherwise persist the new position. Creating
    // a brand-new guide (no id yet) on top of the ruler simply discards it.
    if (guideDragRef.current && draggingGuide) {
      const ref = guideDragRef.current;
      if (draggingGuide.deleting) {
        if (ref.id) persistGuides(guides.filter((g) => g.id !== ref.id));
      } else if (ref.id) {
        persistGuides(guides.map((g) => g.id === ref.id ? { ...g, pos: Math.round(draggingGuide.pos) } : g));
      } else {
        const newGuide: Guide = {
          id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          axis: ref.axis,
          pos: Math.round(draggingGuide.pos),
        };
        persistGuides([...guides, newGuide]);
      }
    }
    guideDragRef.current = null;
    setDraggingGuide(null);

    const rect = selDragRef.current;
    selDragRef.current = null;
    setSelRect(null);

    if (!rect || !onSelectMany) return;
    const dx = Math.abs(rect.curX - rect.startX);
    const dy = Math.abs(rect.curY - rect.startY);
    if (dx < 5 && dy < 5) return; // treat as click, let onClick handle it

    const x1 = Math.min(rect.startX, rect.curX);
    const y1 = Math.min(rect.startY, rect.curY);
    const x2 = Math.max(rect.startX, rect.curX);
    const y2 = Math.max(rect.startY, rect.curY);

    const ids = objects
      .filter((obj) => {
        const bb = objBBox(obj);
        // Intersection: rect overlaps bounding box (not just touch)
        return bb.x2 > x1 && bb.x1 < x2 && bb.y2 > y1 && bb.y1 < y2;
      })
      .map((o) => o.id);

    if (ids.length > 0) {
      suppressClick.current = true;
      onSelectMany(ids);
    }
  };

  const startDrag = (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => {
    // Object drag wins: cancel any pending selection rect / pan.
    selDragRef.current = null;
    panDragRef.current = null;
    setSelRect(null);

    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svgEl.getBoundingClientRect();
    // Convert cursor to SVG space then compute offset from object origin.
    const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
    const ds: DragState = {
      objId:   obj.id,
      offsetX: pt.x - (obj.x ?? 0),
      offsetY: pt.y - (obj.y ?? 0),
    };
    if (obj.type === "line") {
      ds.dx2 = (obj.x2 ?? obj.x + 100) - (obj.x ?? 0);
      ds.dy2 = (obj.y2 ?? obj.y ?? 0)  - (obj.y ?? 0);
    }
    openInteraction("Sposta oggetto");
    dragRef.current = ds;
  };

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      style={{ background, display: "block", userSelect: "none",
               cursor: panDragRef.current ? "grabbing" : undefined }}
      onMouseDown={handleSvgMouseDown}
      onClick={() => {
        if (suppressClick.current) { suppressClick.current = false; return; }
        onSelect?.(null);
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {/* Pattern def is in global SVG space so it tiles correctly after pan */}
      {gridSize > 0 && (
        <defs>
          <pattern id="sws-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
            <path
              d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
              fill="none" stroke="#1e293b" strokeWidth="0.5"
            />
          </pattern>
        </defs>
      )}
      {/* All zoomed+panned content is inside this group */}
      <g transform={`translate(${viewT.panX}, ${viewT.panY}) scale(${viewT.zoom})`}>
      {gridSize > 0 && <rect x={-50000} y={-50000} width={100000} height={100000} fill="url(#sws-grid)" />}

      {/* Page boundary indicator — edit mode only, when dimensions are defined */}
      {onMove && pageWidth && pageHeight && (
        <rect
          x={0} y={0} width={pageWidth} height={pageHeight}
          fill="none" stroke="#3b82f6" strokeWidth={1} strokeDasharray="6 3"
          pointerEvents="none"
        />
      )}

      {sortByZ(objects).map((obj) => {
        // Visibility: in view mode, skip non-visible objects entirely.
        // In edit mode, always render so the designer can still select them
        // (rendered at reduced opacity to signal "hidden at runtime").
        const visible = isObjectVisible(obj, tagValues);
        const inEdit = !!onMove;
        if (!visible && !inEdit) return null;
        const gStyle = !visible && inEdit ? { opacity: 0.35 } : undefined;
        // Press/release dispatch (view mode only). Each handler resolves the
        // referenced function and forwards the per-binding parameter
        // overrides. Doesn't interfere with the per-type click handlers
        // inside SvgObject — both can fire.
        const onPress   = !inEdit && obj.on_press_fn && onScript
          ? () => onScript(obj.on_press_fn!, obj.on_press_args ?? {})
          : undefined;
        const onRelease = !inEdit && obj.on_release_fn && onScript
          ? () => onScript(obj.on_release_fn!, obj.on_release_args ?? {})
          : undefined;
        return (
          <g key={obj.id} style={gStyle} onMouseDown={obj.type !== "grid" ? onPress : undefined} onMouseUp={obj.type !== "grid" ? onRelease : undefined}>
            <SvgObject
              obj={obj}
              tagValues={tagValues}
              selected={selSet.has(obj.id)}
              isEditMode={inEdit}
              customSymbols={customSymbols}
              selectedCell={selectedCell}
              selectedCellChild={selectedCellChild}
              selectedCellRange={selectedCellRange}
              selectedSubCell={selectedSubCell}
              onSelect={onSelect}
              onStartDrag={onMove ? startDrag : undefined}
              onWriteTag={onWriteTag}
              onScript={onScript}
              onNavigate={onNavigate}
              onSelectCell={onSelectCell}
              onSelectCellChild={onSelectCellChild}
              onSelectCellRange={onSelectCellRange}
              onSelectSubCell={onSelectSubCell}
            />
            {inEdit && (() => {
              const bb = objBBox(obj);
              return (
                <rect
                  x={bb.x1} y={bb.y1}
                  width={bb.x2 - bb.x1} height={bb.y2 - bb.y1}
                  fill="none"
                  stroke="#475569"
                  strokeWidth={1}
                  strokeDasharray="4 3"
                  opacity={0.5}
                  style={{ pointerEvents: "none" }}
                />
              );
            })()}
          </g>
        );
      })}

      {selRect && (() => {
        const rx = Math.min(selRect.startX, selRect.curX);
        const ry = Math.min(selRect.startY, selRect.curY);
        const rw = Math.abs(selRect.curX - selRect.startX);
        const rh = Math.abs(selRect.curY - selRect.startY);
        const sw = 1 / viewT.zoom;
        return (
          <rect
            x={rx} y={ry} width={rw} height={rh}
            fill="rgba(59,130,246,0.1)" stroke="#3b82f6"
            strokeWidth={sw} strokeDasharray={`${4 * sw} ${2 * sw}`}
            pointerEvents="none"
          />
        );
      })()}

      {/* Line endpoint handles — single selected line in edit mode */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "line") return null;
        const x2 = obj.x2 ?? obj.x + 100;
        const y2 = obj.y2 ?? obj.y;
        const r = 5 / viewT.zoom;
        const sw = 1.5 / viewT.zoom;
        const makeEndpoint = (handle: "p1" | "p2", cx: number, cy: number) => (
          <circle
            key={handle}
            cx={cx} cy={cy} r={r}
            fill="white" stroke="#facc15" strokeWidth={sw}
            style={{ cursor: "crosshair" }}
            onMouseDown={(e) => {
              e.stopPropagation();
              dragRef.current = null;
              selDragRef.current = null;
              setSelRect(null);
              openInteraction("Sposta estremo linea");
              resizeRef.current = {
                objId: obj.id, handle,
                startX: e.clientX, startY: e.clientY,
                startObj: { x: obj.x ?? 0, y: obj.y ?? 0, width: 0, height: 0, x2, y2 },
              };
            }}
          />
        );
        return <>{makeEndpoint("p1", obj.x ?? 0, obj.y ?? 0)}{makeEndpoint("p2", x2, y2)}</>;
      })()}

      {/* Resize handles — single selection, edit mode, no rotation, not line/grid */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type === "line" || obj.type === "grid" || (obj.rotation ?? 0) !== 0) return null;
        const bb = objBBox(obj);
        const cx = (bb.x1 + bb.x2) / 2;
        const cy = (bb.y1 + bb.y2) / 2;
        const hs = 4 / viewT.zoom;
        const sw = 1.5 / viewT.zoom;
        const handles: { id: string; x: number; y: number; cursor: string }[] = [
          { id: "tl", x: bb.x1, y: bb.y1, cursor: "nw-resize" },
          { id: "tc", x: cx,    y: bb.y1, cursor: "n-resize"  },
          { id: "tr", x: bb.x2, y: bb.y1, cursor: "ne-resize" },
          { id: "ml", x: bb.x1, y: cy,    cursor: "w-resize"  },
          { id: "mr", x: bb.x2, y: cy,    cursor: "e-resize"  },
          { id: "bl", x: bb.x1, y: bb.y2, cursor: "sw-resize" },
          { id: "bc", x: cx,    y: bb.y2, cursor: "s-resize"  },
          { id: "br", x: bb.x2, y: bb.y2, cursor: "se-resize" },
        ];
        return (
          <>
            {handles.map(({ id, x, y, cursor }) => (
              <rect
                key={id}
                x={x - hs} y={y - hs} width={hs * 2} height={hs * 2}
                fill="white" stroke="#facc15" strokeWidth={sw}
                style={{ cursor }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona oggetto");
                  resizeRef.current = {
                    objId: obj.id,
                    handle: id,
                    startX: e.clientX,
                    startY: e.clientY,
                    startObj: {
                      x: obj.x ?? 0, y: obj.y ?? 0,
                      width: obj.width ?? 0, height: obj.height ?? 0,
                    },
                  };
                }}
              />
            ))}
          </>
        );
      })()}

      {/* Grid interior border handles — single grid selected, edit mode.
          6 px corridor centred on each interior column/row border. Rendered
          AFTER cells (and AFTER the 8 corner handles) so they win the
          pointer hit-test inside the corridor. */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "grid") return null;
        const w = obj.width ?? 400;
        const h = obj.height ?? 300;
        const nRows = obj.grid_rows ?? 2;
        const nCols = obj.grid_cols ?? 2;
        const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
        const colW: number[] = [];
        for (let c = 0; c < nCols; c++) {
          colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
        }
        const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
        const rowH: number[] = [];
        for (let r = 0; r < nRows; r++) {
          rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
        }
        const colX: number[] = [];
        let cx0 = obj.x; for (let c = 0; c < nCols; c++) { colX.push(cx0); cx0 += colW[c]; }
        const rowY: number[] = [];
        let ry0 = obj.y; for (let r = 0; r < nRows; r++) { rowY.push(ry0); ry0 += rowH[r]; }
        const hitWidth = 6 / viewT.zoom;
        return (
          <>
            {Array.from({ length: Math.max(0, nCols - 1) }, (_, i) => (
              <rect
                key={`gbv-${i}`}
                x={colX[i + 1] - hitWidth / 2} y={obj.y}
                width={hitWidth} height={h}
                fill="transparent"
                style={{ cursor: "col-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction(`Ridimensiona colonna ${i + 1}`);
                  gridBorderRef.current = {
                    objId: obj.id, axis: "col", index: i + 1,
                    startMouse: e.clientX,
                    startA: colW[i], startB: colW[i + 1],
                    startSizes: colW.slice(),
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
            {Array.from({ length: Math.max(0, nRows - 1) }, (_, i) => (
              <rect
                key={`gbh-${i}`}
                x={obj.x} y={rowY[i + 1] - hitWidth / 2}
                width={w} height={hitWidth}
                fill="transparent"
                style={{ cursor: "row-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction(`Ridimensiona riga ${i + 1}`);
                  gridBorderRef.current = {
                    objId: obj.id, axis: "row", index: i + 1,
                    startMouse: e.clientY,
                    startA: rowH[i], startB: rowH[i + 1],
                    startSizes: rowH.slice(),
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />
            ))}
          </>
        );
      })()}

      {/* Sub-grid border handles — for every split cell (and every nested
          sub-cell that's also split) of the selected grid, render a 6 px
          transparent corridor over the divider. Walks `cell.sub` recursively
          so multi-level splits are all draggable. */}
      {onMove && selIds.length === 1 && (() => {
        const obj = objects.find((o) => o.id === selIds[0]);
        if (!obj || obj.type !== "grid") return null;
        const w = obj.width ?? 400;
        const h = obj.height ?? 300;
        const nRows = obj.grid_rows ?? 2;
        const nCols = obj.grid_cols ?? 2;
        const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
        const colW: number[] = [];
        for (let c = 0; c < nCols; c++) colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
        const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
        const rowH: number[] = [];
        for (let r = 0; r < nRows; r++) rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
        const colX: number[] = [];
        let cx0 = obj.x; for (let c = 0; c < nCols; c++) { colX.push(cx0); cx0 += colW[c]; }
        const rowY: number[] = [];
        let ry0 = obj.y; for (let r = 0; r < nRows; r++) { rowY.push(ry0); ry0 += rowH[r]; }
        const hitWidth = 6 / viewT.zoom;
        const cells = (obj.grid_cells as GridCell[] | undefined) ?? [];

        // Recursive helper: yields one handle per SubGrid along the tree.
        const handles: React.ReactNode[] = [];
        const walk = (
          sg: import("@/types").SubGrid,
          cellRow: number, cellCol: number,
          x: number, y: number, w: number, h: number,
          path: ("a" | "b")[],
        ) => {
          const ratio = Math.max(0.05, Math.min(0.95, sg.ratio ?? 0.5));
          // Emit one handle for THIS SubGrid (the divider between a and b).
          if (sg.orientation === "rows") {
            const borderY = y + h * ratio;
            handles.push(
              <rect
                key={`sbh-${cellRow}-${cellCol}-${path.join("")}`}
                x={x} y={borderY - hitWidth / 2}
                width={w} height={hitWidth}
                fill="transparent"
                style={{ cursor: "row-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona sub-cella");
                  subBorderRef.current = {
                    objId: obj.id, row: cellRow, col: cellCol, path,
                    orientation: "rows",
                    startMouse: e.clientY,
                    startRatio: ratio,
                    cellPxSize: h,
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />,
            );
          } else {
            const borderX = x + w * ratio;
            handles.push(
              <rect
                key={`sbv-${cellRow}-${cellCol}-${path.join("")}`}
                x={borderX - hitWidth / 2} y={y}
                width={hitWidth} height={h}
                fill="transparent"
                style={{ cursor: "col-resize" }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = null;
                  resizeRef.current = null;
                  selDragRef.current = null;
                  setSelRect(null);
                  openInteraction("Ridimensiona sub-cella");
                  subBorderRef.current = {
                    objId: obj.id, row: cellRow, col: cellCol, path,
                    orientation: "cols",
                    startMouse: e.clientX,
                    startRatio: ratio,
                    cellPxSize: w,
                  };
                }}
                onClick={(e) => e.stopPropagation()}
              />,
            );
          }
          // Recurse into each slot if it has its own sub.
          let aX = x, aY = y, aW = w, aH = h, bX = x, bY = y, bW = w, bH = h;
          if (sg.orientation === "rows") {
            aH = h * ratio; bY = y + aH; bH = h - aH;
          } else {
            aW = w * ratio; bX = x + aW; bW = w - aW;
          }
          if (sg.a?.sub) walk(sg.a.sub, cellRow, cellCol, aX, aY, aW, aH, [...path, "a"]);
          if (sg.b?.sub) walk(sg.b.sub, cellRow, cellCol, bX, bY, bW, bH, [...path, "b"]);
        };

        for (const cd of cells) {
          if (!cd.sub) continue;
          const rs = cd.rowspan ?? 1;
          const cs = cd.colspan ?? 1;
          let cellW = 0;
          for (let cc = cd.col; cc < Math.min(cd.col + cs, nCols); cc++) cellW += colW[cc];
          let cellH = 0;
          for (let rr = cd.row; rr < Math.min(cd.row + rs, nRows); rr++) cellH += rowH[rr];
          walk(cd.sub, cd.row, cd.col, colX[cd.col], rowY[cd.row], cellW, cellH, []);
        }
        return <>{handles}</>;
      })()}

      {/* Snap guide lines — inside the transform so coords match SVG space */}
      {snapLines.x !== null && (
        <line x1={snapLines.x} y1={-50000} x2={snapLines.x} y2={50000}
          stroke="#06b6d4" strokeWidth={1 / viewT.zoom}
          style={{ pointerEvents: "none" }} />
      )}
      {snapLines.y !== null && (
        <line x1={-50000} y1={snapLines.y} x2={50000} y2={snapLines.y}
          stroke="#06b6d4" strokeWidth={1 / viewT.zoom}
          style={{ pointerEvents: "none" }} />
      )}

      {/* Ruler guides — page-local persisted lines, draggable in edit mode.
          Stroke width is scaled inverse to zoom so the line stays at ~1.5 px
          on screen regardless of zoom level. */}
      {onMove && showRulers && guides.map((g) => {
        const isDragging = guideDragRef.current?.id === g.id;
        const renderPos = isDragging && draggingGuide ? draggingGuide.pos : g.pos;
        const deleting = isDragging && draggingGuide?.deleting;
        const sw = 1.5 / viewT.zoom;
        const stroke = deleting ? "#ef4444" : "#f59e0b";
        return g.axis === "v" ? (
          <line key={g.id}
            x1={renderPos} y1={-50000} x2={renderPos} y2={50000}
            stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`}
            style={{ cursor: "ew-resize", opacity: deleting ? 0.5 : 1 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              guideDragRef.current = { id: g.id, axis: "v", startPos: g.pos };
              setDraggingGuide({ axis: "v", pos: g.pos, deleting: false });
            }}
          />
        ) : (
          <line key={g.id}
            x1={-50000} y1={renderPos} x2={50000} y2={renderPos}
            stroke={stroke} strokeWidth={sw} strokeDasharray={`${4 * sw} ${3 * sw}`}
            style={{ cursor: "ns-resize", opacity: deleting ? 0.5 : 1 }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              e.stopPropagation();
              guideDragRef.current = { id: g.id, axis: "h", startPos: g.pos };
              setDraggingGuide({ axis: "h", pos: g.pos, deleting: false });
            }}
          />
        );
      })}

      {/* Preview while creating a brand-new guide (no id committed yet). */}
      {onMove && showRulers && draggingGuide && !guideDragRef.current?.id && (
        draggingGuide.axis === "v" ? (
          <line x1={draggingGuide.pos} y1={-50000} x2={draggingGuide.pos} y2={50000}
            stroke="#f59e0b" strokeWidth={1.5 / viewT.zoom}
            strokeDasharray={`${4 * 1.5 / viewT.zoom} ${3 * 1.5 / viewT.zoom}`}
            style={{ pointerEvents: "none", opacity: draggingGuide.deleting ? 0 : 1 }}
          />
        ) : (
          <line x1={-50000} y1={draggingGuide.pos} x2={50000} y2={draggingGuide.pos}
            stroke="#f59e0b" strokeWidth={1.5 / viewT.zoom}
            strokeDasharray={`${4 * 1.5 / viewT.zoom} ${3 * 1.5 / viewT.zoom}`}
            style={{ pointerEvents: "none", opacity: draggingGuide.deleting ? 0 : 1 }}
          />
        )
      )}
      </g>{/* end zoom+pan group */}

      {/* Rulers — screen-space strips along top and left edges (edit mode).
          Tick spacing adapts to zoom level so labels never collide. Click+drag
          on a ruler spawns a fresh guide on the orthogonal axis. */}
      {onMove && showRulers && (() => {
        const z = viewT.zoom;
        // Pick a tick step that keeps adjacent labels ≥ 50 screen-px apart.
        // Steps follow a 1/2/5 progression across decades so the numbers
        // remain "round" at every zoom (e.g. 10, 20, 50, 100, 200, 500, 1000).
        const targetPx = 50;
        const rawStep = targetPx / z;
        const pow = Math.pow(10, Math.floor(Math.log10(rawStep)));
        const norm = rawStep / pow;
        const niceStep = (norm < 2 ? 1 : norm < 5 ? 2 : 5) * pow;
        // Visible range in SVG space — derive from element rect at render
        // time. We use a safe wide range as fallback (rendering offscreen
        // ticks is cheap).
        const el = svgRef.current;
        const wScreen = el?.clientWidth ?? 2000;
        const hScreen = el?.clientHeight ?? 1000;
        const minX = (-viewT.panX) / z;
        const maxX = (wScreen - viewT.panX) / z;
        const minY = (-viewT.panY) / z;
        const maxY = (hScreen - viewT.panY) / z;
        const firstTickX = Math.ceil(minX / niceStep) * niceStep;
        const firstTickY = Math.ceil(minY / niceStep) * niceStep;
        const ticksX: number[] = [];
        for (let v = firstTickX; v <= maxX; v += niceStep) ticksX.push(v);
        const ticksY: number[] = [];
        for (let v = firstTickY; v <= maxY; v += niceStep) ticksY.push(v);

        const rulerStyle: React.CSSProperties = {
          fill: "#0f172a", stroke: "#334155", strokeWidth: 1,
          cursor: "crosshair",
        };

        return (
          <g>
            {/* Top strip */}
            <rect x={0} y={0} width="100%" height={RULER_PX}
              style={rulerStyle}
              onMouseDown={(e) => {
                if (e.button !== 0 || !onMove) return;
                e.stopPropagation();
                const rect = (e.currentTarget.ownerSVGElement!).getBoundingClientRect();
                const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
                guideDragRef.current = { id: null, axis: "v", startPos: pt.x };
                setDraggingGuide({ axis: "v", pos: pt.x, deleting: false });
              }}
            />
            {ticksX.map((v) => {
              const sx = v * z + viewT.panX;
              if (sx < RULER_PX) return null;
              return (
                <g key={`tx-${v}`} style={{ pointerEvents: "none" }}>
                  <line x1={sx} y1={RULER_PX - 5} x2={sx} y2={RULER_PX} stroke="#64748b" strokeWidth={1} />
                  <text x={sx + 2} y={11}
                    style={{ fontSize: 9, fill: "#64748b", fontFamily: "monospace" }}>
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Left strip */}
            <rect x={0} y={0} width={RULER_PX} height="100%"
              style={rulerStyle}
              onMouseDown={(e) => {
                if (e.button !== 0 || !onMove) return;
                e.stopPropagation();
                const rect = (e.currentTarget.ownerSVGElement!).getBoundingClientRect();
                const pt = toSvg(e.clientX - rect.left, e.clientY - rect.top);
                guideDragRef.current = { id: null, axis: "h", startPos: pt.y };
                setDraggingGuide({ axis: "h", pos: pt.y, deleting: false });
              }}
            />
            {ticksY.map((v) => {
              const sy = v * z + viewT.panY;
              if (sy < RULER_PX) return null;
              return (
                <g key={`ty-${v}`} style={{ pointerEvents: "none" }}>
                  <line x1={RULER_PX - 5} y1={sy} x2={RULER_PX} y2={sy} stroke="#64748b" strokeWidth={1} />
                  <text x={2} y={sy + 8} transform={`rotate(-90 ${10} ${sy})`}
                    style={{ fontSize: 9, fill: "#64748b", fontFamily: "monospace" }}>
                    {v}
                  </text>
                </g>
              );
            })}
            {/* Corner square */}
            <rect x={0} y={0} width={RULER_PX} height={RULER_PX}
              fill="#1e293b" stroke="#334155" strokeWidth={1}
              style={{ cursor: "pointer" }}
              onClick={(e) => { e.stopPropagation(); toggleRulers(); }}
            >
              <title>Nascondi righelli</title>
            </rect>
            <text x={RULER_PX / 2} y={RULER_PX / 2 + 3} textAnchor="middle"
              style={{ fontSize: 10, fill: "#64748b", pointerEvents: "none", fontFamily: "monospace" }}>
              ⟂
            </text>
          </g>
        );
      })()}

      {/* Ruler toggle button when rulers are hidden — small icon top-left. */}
      {onMove && !showRulers && (
        <g style={{ cursor: "pointer" }} onClick={(e) => { e.stopPropagation(); toggleRulers(); }}>
          <rect x={2} y={2} width={20} height={20} fill="#1e293b" stroke="#334155" />
          <text x={12} y={16} textAnchor="middle"
            style={{ fontSize: 11, fill: "#64748b", fontFamily: "monospace", pointerEvents: "none" }}>⟂</text>
          <title>Mostra righelli</title>
        </g>
      )}

      {/* Zoom level badge + fit button — top-right corner, outside the transform */}
      {onMove && (
        <g>
          <text x="100%" y={18} textAnchor="end" dx={viewT.zoom !== 1 ? -30 : -6}
            style={{ fontSize: 11, fill: "#64748b", pointerEvents: "none", fontFamily: "monospace" }}>
            {Math.round(viewT.zoom * 100)}%
          </text>
          <text x="100%" y={18} textAnchor="end" dx={-6}
            style={{ fontSize: 11, fill: "#475569", cursor: "pointer", fontFamily: "monospace" }}
            onClick={fitView}>
            <title>Adatta alla vista (Ctrl+Shift+0)</title>
            ⊡
          </text>
        </g>
      )}

      {/* Mouse position indicator — bottom-left, outside the transform */}
      {onMove && mousePos && (
        <text x={6} y="100%" dy={-6}
          style={{ fontSize: 10, fill: "#475569", pointerEvents: "none", fontFamily: "monospace" }}>
          X:{Math.round(mousePos.x)} Y:{Math.round(mousePos.y)}
        </text>
      )}
    </svg>
  );
}

// ── Per-object props ──────────────────────────────────────────────────────────

interface ObjProps {
  obj: SynopticObject;
  tagValues: Record<string, TagState>;
  selected: boolean;
  isEditMode: boolean;
  customSymbols: CustomSymbol[];
  selectedCell?: { objectId: string; row: number; col: number } | null;
  selectedCellChild?: { objectId: string; row: number; col: number } | null;
  selectedCellRange?: { objectId: string; r1: number; c1: number; r2: number; c2: number } | null;
  selectedSubCell?: { objectId: string; row: number; col: number; path: ("a" | "b")[] } | null;
  onSelect?: (id: string | null, shift?: boolean) => void;
  onStartDrag?: (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
  onSelectCell?: (objectId: string, row: number, col: number) => void;
  onSelectCellChild?: (objectId: string, row: number, col: number) => void;
  onSelectCellRange?: (objectId: string, r1: number, c1: number, r2: number, c2: number) => void;
  onSelectSubCell?: (objectId: string, row: number, col: number, path: ("a" | "b")[]) => void;
}

function SvgObject(p: ObjProps) {
  const { tagValues, selected, isEditMode, customSymbols, selectedCell, selectedCellChild, selectedCellRange, onSelect, onStartDrag, onWriteTag, onScript, onNavigate, onSelectCell, onSelectCellChild, onSelectCellRange } = p;
  const obj = resolveObject(p.obj, tagValues);

  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
    if (obj.locked && isEditMode) return;
    e.stopPropagation();
    onSelect?.(obj.id, e.shiftKey);
    // Don't start a drag when the user is just shift-clicking to extend
    // a multi-selection; otherwise the position would jump on the very
    // first click in the additive flow.
    if (!e.shiftKey) onStartDrag?.(e, obj);
  };

  const editCursor = selected ? "grab" : "pointer";

  /** Selection bounding rect for edit mode */
  const selRect = (x: number, y: number, w: number, h: number) =>
    selected
      ? <rect x={x - 3} y={y - 3} width={w + 6} height={h + 6}
          fill="none" stroke="#facc15" strokeWidth={1} strokeDasharray="4 2"
          style={{ pointerEvents: "none" }} />
      : null;

  /** Recursively render the contents of a split cell area. Walks `cell.sub`
   *  (and any nested `entry.sub`) down to leaf entries, drawing the bg
   *  rect + image + child for leaves and recursing for sub-divided slots.
   *  `pathPrefix` is empty at the top-level call (cell.sub) and grows by
   *  one "a"/"b" each recursion level. */
  const renderSubArea = (
    sg: import("@/types").SubGrid,
    x: number, y: number, w: number, h: number,
    pathPrefix: ("a" | "b")[],
    cellRow: number, cellCol: number, gridObjId: string,
  ): React.ReactNode => {
    const ratio = Math.max(0.05, Math.min(0.95, sg.ratio ?? 0.5));
    let aX = x, aY = y, aW = w, aH = h;
    let bX = x, bY = y, bW = w, bH = h;
    if (sg.orientation === "rows") {
      aH = h * ratio;
      bX = x; bY = y + aH; bW = w; bH = h - aH;
    } else {
      aW = w * ratio;
      bX = x + aW; bY = y; bW = w - aW; bH = h;
    }
    const slots: { key: "a" | "b"; entry: import("@/types").SubCellEntry | undefined; x: number; y: number; w: number; h: number }[] = [
      { key: "a", entry: sg.a, x: aX, y: aY, w: aW, h: aH },
      { key: "b", entry: sg.b, x: bX, y: bY, w: bW, h: bH },
    ];
    return (
      <>
        {slots.map(({ key: slot, entry, x: sx, y: sy, w: sw, h: sh }) => {
          const slotPath = [...pathPrefix, slot];
          const sel = p.selectedSubCell;
          const isSlotSel = isEditMode
            && sel?.objectId === gridObjId
            && sel.row === cellRow
            && sel.col === cellCol
            && sel.path.length === slotPath.length
            && sel.path.every((s, i) => s === slotPath[i]);
          // If this slot is itself split, recurse — the sub-sub-cells will
          // catch their own clicks (and stop propagation), so this slot's
          // bg rect underneath them is only reached on the (currently
          // impossible) "click on a non-existent gap" path. The bg rect
          // still renders so a future "select parent slot" affordance can
          // be added without restructuring.
          if (entry?.sub) {
            return (
              <g key={`sub-${slotPath.join("")}`}>
                {renderSubArea(entry.sub, sx, sy, sw, sh, slotPath, cellRow, cellCol, gridObjId)}
              </g>
            );
          }
          return (
            <g key={`sub-${slotPath.join("")}`}>
              <rect
                x={sx} y={sy} width={sw} height={sh}
                fill={entry?.bg_color ?? "transparent"}
                stroke="none"
                style={{ cursor: isEditMode ? "pointer" : "default" }}
                onMouseDown={(e) => {
                  if (!isEditMode) return;
                  e.stopPropagation();
                  // Select the grid object first so the right panel renders
                  // the object-properties branch (otherwise selectedObjectId
                  // would stay null and the panel would show page properties
                  // even while the sub-slot looks highlighted).
                  p.onSelect?.(gridObjId, false);
                  p.onSelectSubCell?.(gridObjId, cellRow, cellCol, slotPath);
                }}
                onClick={(e) => e.stopPropagation()}
              />
              {entry?.bg_image && (
                <image href={entry.bg_image}
                  x={sx} y={sy} width={sw} height={sh}
                  preserveAspectRatio="xMidYMid slice"
                  style={{ pointerEvents: "none" }} />
              )}
              {entry?.child && (() => {
                const ch2 = entry.child!;
                const cw = ch2.width ?? 100;
                const chh = ch2.height ?? 50;
                const childX = sx + (sw - cw) / 2;
                const childY = sy + (sh - chh) / 2;
                const placed = ch2.type === "line"
                  ? { ...ch2, x: childX, y: childY,
                      x2: childX + ((ch2.x2 ?? ch2.x + 100) - ch2.x),
                      y2: childY + ((ch2.y2 ?? ch2.y) - ch2.y) }
                  : { ...ch2, x: childX, y: childY };
                return (
                  <>
                    {/* Child visual — non-interactive in edit mode; the
                        overlay rect below catches clicks for selection. */}
                    <g style={{ pointerEvents: isEditMode ? "none" : "auto" }}>
                      <SvgObject
                        obj={placed}
                        tagValues={tagValues}
                        selected={false}
                        isEditMode={false}
                        customSymbols={customSymbols}
                        onWriteTag={onWriteTag}
                        onScript={onScript}
                        onNavigate={onNavigate}
                      />
                    </g>
                    {/* Click target — selects the parent sub-slot so the
                        panel surfaces the child's ObjectProps (and stops the
                        click from re-selecting through the slot rect
                        underneath, which is the same selection anyway but
                        the explicit stopPropagation keeps event flow tidy). */}
                    {isEditMode && (
                      <rect
                        x={childX} y={childY} width={cw} height={chh}
                        fill="transparent"
                        style={{ cursor: "pointer" }}
                        onMouseDown={(e) => {
                          e.stopPropagation();
                          // Same reason as the sub-slot rect above: select
                          // the grid first so the panel routes to the
                          // object-properties branch, then nail down which
                          // sub-cell is being edited.
                          p.onSelect?.(gridObjId, false);
                          p.onSelectSubCell?.(gridObjId, cellRow, cellCol, slotPath);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    )}
                    {/* Selection rect around the child — visible whenever
                        the slot holding it is selected, so the user can
                        confirm which object the panel is editing. */}
                    {isEditMode && isSlotSel && (
                      <rect
                        x={childX - 2} y={childY - 2}
                        width={cw + 4} height={chh + 4}
                        fill="none" stroke="#0d9488"
                        strokeWidth={1.5} strokeDasharray="4 2"
                        style={{ pointerEvents: "none" }}
                      />
                    )}
                  </>
                );
              })()}
              {isSlotSel && (
                <rect
                  x={sx + 1} y={sy + 1} width={sw - 2} height={sh - 2}
                  fill="none" stroke="#14b8a6"
                  strokeWidth={1.5} strokeDasharray="4 2"
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}
        {/* Divider line — visual only. Drag interaction handled by a wider
            transparent corridor rendered at SvgCanvas top level. */}
        {isEditMode && (() => {
          const divX1 = sg.orientation === "rows" ? aX : bX;
          const divY1 = sg.orientation === "rows" ? bY : aY;
          const divX2 = sg.orientation === "rows" ? aX + aW : bX;
          const divY2 = sg.orientation === "rows" ? bY : aY + aH;
          return (
            <line x1={divX1} y1={divY1} x2={divX2} y2={divY2}
              stroke="#475569" strokeWidth={1} strokeDasharray="3 3"
              style={{ pointerEvents: "none" }} />
          );
        })()}
      </>
    );
  };

  // ── RECT ────────────────────────────────────────────────────────────────────

  if (obj.type === "rect") {
    const w = obj.width ?? 100; const h = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        {applyTransform(obj, w, h,
          <rect x={obj.x} y={obj.y} width={w} height={h}
            fill={obj.fill ?? "#555"}
            stroke={selected ? "#facc15" : (obj.stroke ?? "none")}
            strokeWidth={selected ? 2 : (obj.stroke_width ?? 0)}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        )}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── ELLIPSE ─────────────────────────────────────────────────────────────────

  if (obj.type === "ellipse") {
    const w = obj.width ?? 100; const h = obj.height ?? 60;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h,
          <ellipse cx={obj.x + w / 2} cy={obj.y + h / 2} rx={w / 2} ry={h / 2}
            fill={obj.fill ?? "#4a90d9"}
            stroke={obj.stroke ?? "none"} strokeWidth={obj.stroke_width ?? 0}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        )}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── LINE ────────────────────────────────────────────────────────────────────

  if (obj.type === "line") {
    const x2 = obj.x2 ?? obj.x + 100; const y2 = obj.y2 ?? obj.y;
    return (
      <>
        <line x1={obj.x} y1={obj.y} x2={x2} y2={y2}
          stroke={obj.stroke ?? "#e2e8f0"} strokeWidth={obj.stroke_width ?? 2}
          style={{ cursor: editCursor, ...transitionStyle(obj) }}
          onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        {selected && <>
          <circle cx={obj.x} cy={obj.y} r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
          <circle cx={x2} cy={y2} r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
        </>}
      </>
    );
  }

  // ── TEXT ────────────────────────────────────────────────────────────────────

  if (obj.type === "text") {
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    // Precedence: bound tag → format template (default "{value}");
    //             otherwise → static `text` field; otherwise → placeholder.
    const content = tv != null
      ? formatValue(tv.value, obj.format ?? "{value}")
      : (obj.text ?? obj.tag ?? "Testo");
    const size      = obj.font_size ?? 14;
    const family    = obj.font_family ?? undefined;
    const weight    = obj.font_weight ?? "normal";
    const style     = obj.font_style ?? "normal";
    const anchor    = obj.text_anchor ?? "start";
    const colour    = obj.color ?? obj.fill ?? "#e2e8f0";
    // Selection rect is a rough estimate — SVG text has no width attr without measuring.
    const approxW   = Math.max(40, content.length * size * 0.6);
    const dx        = anchor === "middle" ? -approxW / 2 : anchor === "end" ? -approxW : 0;
    return (
      <>
        {selRect(obj.x + dx - 2, obj.y - size + 2, approxW + 4, size + 6)}
        {applyTransform(obj, approxW, size,
          <text
            x={obj.x}
            y={obj.y}
            fill={colour}
            fontSize={size}
            fontFamily={family}
            fontWeight={weight as any}
            fontStyle={style}
            textAnchor={anchor}
            style={{ cursor: editCursor, ...transitionStyle(obj) }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </text>
        )}
        {tv && obj.quality_dot !== false && <QDot x={obj.x - 10} y={obj.y - size / 2} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </>
    );
  }

  // ── BUTTON ──────────────────────────────────────────────────────────────────

  if (obj.type === "button") {
    const w = obj.width ?? 120; const h = obj.height ?? 40;
    return (
      <g style={{ cursor: isEditMode ? editCursor : "pointer" }}
        onMouseDown={isEditMode ? handleMouseDown : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditMode && obj.tag) onWriteTag?.(obj.tag, obj.write_value ?? true);
          else if (isEditMode) onSelect?.(obj.id);
        }}>
        {applyTransform(obj, w, h, <>
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={6}
            fill={obj.fill ?? "#3b82f6"}
            stroke={selected ? "#facc15" : "#2563eb"} strokeWidth={selected ? 2 : 1}
            style={transitionStyle(obj)} />
          <text x={obj.x + w / 2} y={obj.y + h / 2 + 5}
            textAnchor="middle" fill="#fff" fontSize={14} fontWeight={600}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "Button"}
          </text>
        </>)}
      </g>
    );
  }

  // ── NAVBUTTON ───────────────────────────────────────────────────────────────

  if (obj.type === "navbutton") {
    const w = obj.width ?? 140; const h = obj.height ?? 36;
    return (
      <g style={{ cursor: isEditMode ? editCursor : "pointer" }}
        onMouseDown={isEditMode ? handleMouseDown : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (!isEditMode && obj.target_page) onNavigate?.(obj.target_page);
          else if (isEditMode) onSelect?.(obj.id);
        }}>
        {applyTransform(obj, w, h, <>
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill={obj.fill ?? "#0f172a"}
            stroke={selected ? "#facc15" : "#3b82f6"} strokeWidth={selected ? 2 : 1.5}
            style={transitionStyle(obj)} />
          <text x={obj.x + 10} y={obj.y + h / 2 + 5} fill="#3b82f6" fontSize={14}
            style={{ pointerEvents: "none" }}>▶</text>
          <text x={obj.x + 28} y={obj.y + h / 2 + 5} fill="#e2e8f0" fontSize={13}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "Go to page"}
          </text>
        </>)}
      </g>
    );
  }

  // ── LED INDICATOR ───────────────────────────────────────────────────────────

  if (obj.type === "led") {
    const r = (obj.width ?? 24) / 2;
    const cx = obj.x + r; const cy = obj.y + r;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const onVal = obj.on_value ?? true;
    const isOn = tv != null && (
      typeof onVal === "boolean" ? Boolean(tv.value) === onVal
      : String(tv.value) === String(onVal)
    );
    const ledColor = tv == null
      ? "#334155"
      : tv.quality === "Bad"
        ? "#ef4444"
        : isOn ? (obj.on_color ?? "#22c55e") : (obj.off_color ?? "#334155");
    const glowColor = isOn ? (obj.on_color ?? "#22c55e") : "transparent";

    const ledW = r * 2;
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selected && <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke="#facc15" strokeWidth={1} />}
        {applyTransform(obj, ledW, ledW, <>
          {/* Glow ring */}
          {isOn && <circle cx={cx} cy={cy} r={r + 3} fill={glowColor} opacity={0.25} style={{ pointerEvents: "none" }} />}
          {/* LED body */}
          <circle cx={cx} cy={cy} r={r} fill={ledColor} style={transitionStyle(obj)} />
          {/* Highlight */}
          <circle cx={cx - r * 0.25} cy={cy - r * 0.25} r={r * 0.3} fill="white" opacity={0.3}
            style={{ pointerEvents: "none" }} />
          {/* Label */}
          {obj.label && (
            <text x={cx} y={obj.y + r * 2 + 14} textAnchor="middle" fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>
              {obj.label}
            </text>
          )}
        </>)}
      </g>
    );
  }

  // ── PROGRESS BAR ────────────────────────────────────────────────────────────

  if (obj.type === "progress_bar") {
    const w = obj.width ?? 200; const h = obj.height ?? 28;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const pct = clamp((rawVal - min) / (max - min), 0, 1);
    const barColor =
      thresholdColor(rawVal, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
      ?? (obj.fill ?? "#3b82f6");
    const barW = Math.round(pct * w);

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {/* Track */}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4} fill="#1e293b" />
          {/* Fill */}
          {barW > 0 && (
            <rect x={obj.x} y={obj.y} width={barW} height={h} rx={4} fill={barColor}
              style={transitionStyle(obj)} />
          )}
          {/* Border */}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill="none" stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          {/* Value text */}
          {obj.show_value !== false && (
            <text x={obj.x + w / 2} y={obj.y + h / 2 + 4}
              textAnchor="middle" fill="#e2e8f0" fontSize={11} fontWeight={600}
              style={{ pointerEvents: "none" }}>
              {rawVal.toFixed(1)}{obj.unit ? ` ${obj.unit}` : ""}
            </text>
          )}
          {/* Warn/alarm markers */}
          {obj.warn_high !== undefined && (
            <line
              x1={obj.x + ((obj.warn_high - min) / (max - min)) * w}
              y1={obj.y} x2={obj.x + ((obj.warn_high - min) / (max - min)) * w} y2={obj.y + h}
              stroke="#eab308" strokeWidth={1.5} strokeDasharray="3 2"
              style={{ pointerEvents: "none" }} />
          )}
          {obj.alarm_high !== undefined && (
            <line
              x1={obj.x + ((obj.alarm_high - min) / (max - min)) * w}
              y1={obj.y} x2={obj.x + ((obj.alarm_high - min) / (max - min)) * w} y2={obj.y + h}
              stroke="#ef4444" strokeWidth={1.5} strokeDasharray="3 2"
              style={{ pointerEvents: "none" }} />
          )}
          {/* Label */}
          {obj.label && (
            <text x={obj.x} y={obj.y - 4} fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>
              {obj.label}
            </text>
          )}
        </>)}
        {/* Quality dot — axis-aligned */}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </g>
    );
  }

  // ── GAUGE ───────────────────────────────────────────────────────────────────

  if (obj.type === "gauge") {
    const w = obj.width ?? 160; const h = obj.height ?? 140;
    const cx = obj.x + w / 2;
    const cy = obj.y + h * 0.62;
    const R = Math.min(w * 0.38, h * 0.52);
    const START = -135; const END = 135; // degrees from North, clockwise
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const pct = clamp((rawVal - min) / (max - min), 0, 1);
    const valueAngle = START + pct * 270;
    const arcColor =
      thresholdColor(rawVal, obj.alarm_low, obj.warn_low, obj.warn_high, obj.alarm_high)
      ?? (obj.fill ?? "#22c55e");

    const needleTip  = polar(cx, cy, R * 0.82, valueAngle);
    const needleBase = polar(cx, cy, R * 0.12, valueAngle + 180);

    // Threshold tick helpers
    const thresholdTick = (value: number, color: string) => {
      const pct2 = clamp((value - min) / (max - min), 0, 1);
      const angle = START + pct2 * 270;
      const inner = polar(cx, cy, R - 8, angle);
      const outer = polar(cx, cy, R + 2, angle);
      return <line key={`t${value}`} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y}
        stroke={color} strokeWidth={2} style={{ pointerEvents: "none" }} />;
    };

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h, <>
          {/* Invisible hit-area: <g> has no own geometry — without this rect clicks fall through */}
          <rect x={obj.x} y={obj.y} width={w} height={h} fill="transparent" />
          {/* Background arc */}
          <path d={arcPath(cx, cy, R, START, END)}
            fill="none" stroke="#334155" strokeWidth={10} strokeLinecap="round"
            style={{ pointerEvents: "none" }} />
          {/* Value arc */}
          {pct > 0 && (
            <path d={arcPath(cx, cy, R, START, valueAngle)}
              fill="none" stroke={arcColor} strokeWidth={10} strokeLinecap="round"
              style={{ pointerEvents: "none", ...transitionStyle(obj) }} />
          )}
          {/* Threshold ticks */}
          {obj.warn_low  !== undefined && thresholdTick(obj.warn_low,  "#eab308")}
          {obj.warn_high !== undefined && thresholdTick(obj.warn_high, "#eab308")}
          {obj.alarm_low  !== undefined && thresholdTick(obj.alarm_low,  "#ef4444")}
          {obj.alarm_high !== undefined && thresholdTick(obj.alarm_high, "#ef4444")}
          {/* Needle */}
          <line x1={needleBase.x} y1={needleBase.y} x2={needleTip.x} y2={needleTip.y}
            stroke="#e2e8f0" strokeWidth={2} strokeLinecap="round"
            style={{ pointerEvents: "none" }} />
          {/* Hub */}
          <circle cx={cx} cy={cy} r={6} fill="#e2e8f0" style={{ pointerEvents: "none" }} />
          <circle cx={cx} cy={cy} r={3} fill="#0f172a" style={{ pointerEvents: "none" }} />
          {/* Min / max labels */}
          {(() => {
            const minP = polar(cx, cy, R + 14, START);
            const maxP = polar(cx, cy, R + 14, END);
            return <>
              <text x={minP.x} y={minP.y + 4} textAnchor="middle" fill="#64748b" fontSize={10}
                style={{ pointerEvents: "none" }}>{min}</text>
              <text x={maxP.x} y={maxP.y + 4} textAnchor="middle" fill="#64748b" fontSize={10}
                style={{ pointerEvents: "none" }}>{max}</text>
            </>;
          })()}
          {/* Value display */}
          <text x={cx} y={cy + R * 0.35} textAnchor="middle"
            fill="#e2e8f0" fontSize={20} fontWeight={700}
            style={{ pointerEvents: "none" }}>
            {typeof rawVal === "number" ? rawVal.toFixed(1) : rawVal}
          </text>
          {obj.unit && (
            <text x={cx} y={cy + R * 0.35 + 16} textAnchor="middle" fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>{obj.unit}</text>
          )}
          {/* Label */}
          {obj.label && (
            <text x={cx} y={obj.y + 14} textAnchor="middle" fill="#94a3b8" fontSize={11}
              style={{ pointerEvents: "none" }}>{obj.label}</text>
          )}
        </>)}
        {/* Quality dot — axis-aligned */}
        {tv && obj.quality_dot !== false && <QDot x={obj.x + w - 10} y={obj.y + 10} quality={tv.quality} goodColor={obj.quality_dot_good_color} badColor={obj.quality_dot_bad_color} uncertainColor={obj.quality_dot_uncertain_color} />}
      </g>
    );
  }

  // ── SLIDER ──────────────────────────────────────────────────────────────────

  if (obj.type === "slider") {
    const w = obj.width ?? 200; const h = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const min = obj.min ?? 0; const max = obj.max ?? 100;
    const rawVal = tv ? Number(tv.value) : min;
    const trackY = obj.y + h / 2;

    if (isEditMode) {
      // Edit mode: static SVG preview, draggable
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          {obj.label && <text x={obj.x + w / 2} y={obj.y + 12} textAnchor="middle"
            fill="#94a3b8" fontSize={11} style={{ pointerEvents: "none" }}>{obj.label}</text>}
          <rect x={obj.x} y={trackY - 3} width={w} height={6} rx={3} fill="#334155" />
          <rect x={obj.x} y={trackY - 3} width={w * 0.5} height={6} rx={3} fill="#3b82f6" />
          <circle cx={obj.x + w * 0.5} cy={trackY} r={10}
            fill="#3b82f6" stroke="#1d4ed8" strokeWidth={2} />
          <text x={obj.x} y={obj.y + h + 2} fill="#64748b" fontSize={10}
            style={{ pointerEvents: "none" }}>{min}</text>
          <text x={obj.x + w} y={obj.y + h + 2} textAnchor="end" fill="#64748b" fontSize={10}
            style={{ pointerEvents: "none" }}>{max}</text>
        </g>
      );
    }

    // View mode: foreignObject with native range input
    const foH = h + (obj.label ? 20 : 0);
    return (
      <foreignObject x={obj.x} y={obj.y} width={w} height={foH}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 2, padding: "4px 0" }}
        >
          {obj.label && (
            <span style={{ color: "#94a3b8", fontSize: 11, textAlign: "center" }}>
              {obj.label}
            </span>
          )}
          <input
            type="range"
            min={min} max={max} step={obj.step ?? 1} value={rawVal}
            onChange={(e) => onWriteTag?.(obj.tag!, Number(e.target.value))}
            style={{ width: "100%", accentColor: obj.fill ?? "#3b82f6", cursor: "pointer" }}
          />
          {obj.show_value !== false && (
            <span style={{ color: "#e2e8f0", fontSize: 12, textAlign: "center" }}>
              {rawVal.toFixed(obj.step && obj.step < 1 ? 2 : 0)}{obj.unit ? ` ${obj.unit}` : ""}
            </span>
          )}
        </div>
      </foreignObject>
    );
  }

  // ── CHECKBOX ────────────────────────────────────────────────────────────────

  if (obj.type === "checkbox") {
    const w = obj.width ?? 180; const h = obj.height ?? 32;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const checkedVal = obj.checked_value ?? true;
    const isChecked = tv != null && String(tv.value) === String(checkedVal);

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x + 2} y={obj.y + h / 2 - 9} width={18} height={18} rx={3}
            fill="#334155" stroke="#64748b" strokeWidth={1.5} />
          <path d={`M ${obj.x + 6} ${obj.y + h / 2} L ${obj.x + 10} ${obj.y + h / 2 + 4} L ${obj.x + 16} ${obj.y + h / 2 - 4}`}
            stroke="#64748b" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <text x={obj.x + 28} y={obj.y + h / 2 + 5} fill="#e2e8f0" fontSize={13}>
            {obj.label ?? "Checkbox"}
          </text>
        </g>
      );
    }

    // View mode: foreignObject
    return (
      <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
        <div
          style={{ display: "flex", alignItems: "center", gap: 8, height: "100%", cursor: obj.read_only ? "default" : "pointer" }}
          onClick={() => {
            if (obj.read_only || !obj.tag) return;
            onWriteTag?.(obj.tag, isChecked ? (obj.unchecked_value ?? false) : checkedVal);
          }}
        >
          <div style={{
            width: 18, height: 18, borderRadius: 3, flexShrink: 0,
            background: isChecked ? (obj.fill ?? "#3b82f6") : "transparent",
            border: `2px solid ${isChecked ? (obj.fill ?? "#3b82f6") : "#64748b"}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            {isChecked && (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M2 6 L5 9 L10 3" stroke="white" strokeWidth="2" fill="none"
                  strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          <span style={{ color: "#e2e8f0", fontSize: 13, userSelect: "none" }}>
            {obj.label ?? ""}
          </span>
          {tv && tv.quality !== "Good" && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              background: qualityColor(tv.quality), display: "inline-block" }} />
          )}
        </div>
      </foreignObject>
    );
  }

  // ── RADIO ───────────────────────────────────────────────────────────────────

  if (obj.type === "radio") {
    const opts = obj.options ?? [];
    const w = obj.width ?? 180;
    const isH = obj.orientation === "horizontal";
    const itemW = isH ? Math.floor(w / Math.max(opts.length, 1)) : w;
    const itemH = 28;
    const totalH = obj.height ?? (isH ? itemH + (obj.label ? 20 : 0) : opts.length * itemH + (obj.label ? 20 : 0));
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const currentVal = tv ? tv.value : null;

    if (isEditMode) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, totalH)}
          {obj.label && <text x={obj.x} y={obj.y + 12} fill="#94a3b8" fontSize={11}>{obj.label}</text>}
          {opts.map((opt, i) => {
            const ox = isH ? obj.x + i * itemW : obj.x;
            const oy = obj.y + (obj.label ? 20 : 0) + (isH ? 0 : i * itemH);
            return (
              <g key={i}>
                <circle cx={ox + 9} cy={oy + 9} r={8} fill="transparent" stroke="#64748b" strokeWidth={1.5} />
                {i === 0 && <circle cx={ox + 9} cy={oy + 9} r={4} fill="#3b82f6" />}
                <text x={ox + 24} y={oy + 14} fill="#e2e8f0" fontSize={13}>{opt.label}</text>
              </g>
            );
          })}
        </g>
      );
    }

    // View mode: foreignObject
    return (
      <foreignObject x={obj.x} y={obj.y} width={w} height={totalH}>
        <div
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          {obj.label && (
            <span style={{ color: "#94a3b8", fontSize: 11, marginBottom: 4 }}>{obj.label}</span>
          )}
          <div style={{ display: "flex", flexDirection: isH ? "row" : "column", gap: isH ? 12 : 4 }}>
            {opts.map((opt, i) => (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input
                  type="radio"
                  name={obj.id}
                  checked={currentVal !== null && String(currentVal) === String(opt.value)}
                  onChange={() => onWriteTag?.(obj.tag!, opt.value as string | number | boolean)}
                  style={{ accentColor: obj.fill ?? "#3b82f6", cursor: "pointer" }}
                />
                <span style={{ color: "#e2e8f0", fontSize: 13, userSelect: "none" }}>
                  {opt.label}
                </span>
              </label>
            ))}
          </div>
        </div>
      </foreignObject>
    );
  }

  // ── DATA TABLE ──────────────────────────────────────────────────────────────

  if (obj.type === "table") {
    const rows = obj.table_rows ?? [];
    const w = obj.width ?? 300;
    const rowH = 24;
    const headerH = 26;
    const totalH = obj.height ?? (headerH + rows.length * rowH + 2);
    const colLabel = w * 0.42;
    const colValue = w * 0.43;

    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, totalH)}
        {applyTransform(obj, w, totalH, <>
          {/* Outer border */}
          <rect x={obj.x} y={obj.y} width={w} height={totalH} rx={4}
            fill="#1e293b" stroke={selected ? "#facc15" : "#334155"} strokeWidth={selected ? 2 : 1} />
          {/* Header */}
          <rect x={obj.x} y={obj.y} width={w} height={headerH} rx={4}
            fill="#0f172a" style={{ pointerEvents: "none" }} />
          <rect x={obj.x} y={obj.y + 4} width={w} height={headerH - 4}
            fill="#0f172a" style={{ pointerEvents: "none" }} />
          <text x={obj.x + 10} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700} letterSpacing={0.5}
            style={{ pointerEvents: "none" }}>
            {obj.label ?? "DATI"}
          </text>
          <text x={obj.x + colLabel + 10} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700}
            style={{ pointerEvents: "none" }}>
            VALORE
          </text>
          <text x={obj.x + colLabel + colValue + 4} y={obj.y + 17}
            fill="#64748b" fontSize={11} fontWeight={700}
            style={{ pointerEvents: "none" }}>
            Q
          </text>
          {/* Column dividers */}
          <line x1={obj.x + colLabel} y1={obj.y} x2={obj.x + colLabel} y2={obj.y + totalH}
            stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          <line x1={obj.x + colLabel + colValue} y1={obj.y}
            x2={obj.x + colLabel + colValue} y2={obj.y + totalH}
            stroke="#334155" strokeWidth={1} style={{ pointerEvents: "none" }} />
          {/* Rows */}
          {rows.map((row, i) => {
            const ry = obj.y + headerH + i * rowH;
            const tv = tagValues[row.tag];
            const valText = tv != null ? formatValue(tv.value, row.format) : "—";
            const isEven = i % 2 === 0;
            return (
              <g key={i}>
                {isEven && (
                  <rect x={obj.x + 1} y={ry} width={w - 2} height={rowH}
                    fill="#ffffff08" style={{ pointerEvents: "none" }} />
                )}
                <text x={obj.x + 8} y={ry + 16} fill="#cbd5e1" fontSize={12}
                  style={{ pointerEvents: "none" }}>
                  {row.label}
                </text>
                <text x={obj.x + colLabel + 8} y={ry + 16}
                  fill={tv ? (tv.quality === "Good" ? "#e2e8f0" : tv.quality === "Bad" ? "#ef4444" : "#eab308") : "#475569"}
                  fontSize={12} style={{ pointerEvents: "none" }}>
                  {valText}
                </text>
                {tv && (
                  <circle cx={obj.x + colLabel + colValue + 10} cy={ry + rowH / 2} r={4}
                    fill={qualityColor(tv.quality)} style={{ pointerEvents: "none" }} />
                )}
                {i < rows.length - 1 && (
                  <line x1={obj.x} y1={ry + rowH} x2={obj.x + w} y2={ry + rowH}
                    stroke="#1e293b" strokeWidth={1} style={{ pointerEvents: "none" }} />
                )}
              </g>
            );
          })}
          {/* Empty state */}
          {rows.length === 0 && (
            <text x={obj.x + w / 2} y={obj.y + headerH + 20}
              textAnchor="middle" fill="#475569" fontSize={12}
              style={{ pointerEvents: "none" }}>
              Nessuna riga — configura nelle proprietà
            </text>
          )}
        </>)}
      </g>
    );
  }

  // ── TREND ───────────────────────────────────────────────────────────────────

  if (obj.type === "trend") {
    const w = obj.width ?? 360;
    const h = obj.height ?? 180;
    // Edit mode: static placeholder (no polling, no canvas — drag-friendly).
    // View mode: full TrendCanvas with polling. The handleMouseDown captures
    // clicks even in view mode so the operator can still "select" if needed.
    return (
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {isEditMode ? (
          <>
            <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
              fill="#0f172a" stroke={selected ? "#facc15" : "#334155"}
              strokeWidth={selected ? 2 : 1} />
            <text x={obj.x + w / 2} y={obj.y + h / 2 - 6}
              textAnchor="middle" fill="#64748b" fontSize={12}
              style={{ pointerEvents: "none" }}>
              Trend{obj.tag ? ` — ${obj.tag}` : ""}
            </text>
            <text x={obj.x + w / 2} y={obj.y + h / 2 + 10}
              textAnchor="middle" fill="#475569" fontSize={10}
              style={{ pointerEvents: "none" }}>
              {obj.window_s ?? 60}s · autofit
            </text>
          </>
        ) : (
          <foreignObject x={obj.x} y={obj.y} width={w} height={h}>
            <TrendCanvas
              tags={[obj.tag ?? "", ...(obj.extra_tags ?? [])].filter(Boolean)}
              windowS={obj.window_s ?? 60}
              width={w}
              height={h}
              lineColor={obj.line_color ?? "#3b82f6"}
              yMin={obj.y_min}
              yMax={obj.y_max}
              opcuaBackfill={obj.opcua_backfill}
            />
          </foreignObject>
        )}
      </g>
    );
  }

  // ── SYMBOL ──────────────────────────────────────────────────────────────────
  // Built-in SCADA symbol rendered inside a 100×100 design viewBox, scaled to
  // the object's width × height. State (off/on/alarm) is derived from tags:
  //   - alarm_tag truthy → alarm
  //   - state_tag truthy → on
  //   - otherwise        → off

  if (obj.type === "symbol") {
    const isCustom = obj.symbol_id?.startsWith("custom:");
    const customEntry = isCustom
      ? customSymbols.find((s) => s.id === obj.symbol_id!.slice(7))
      : undefined;
    const meta = !isCustom && obj.symbol_id ? SYMBOLS[obj.symbol_id] : undefined;
    const w = obj.width  ?? meta?.defaultWidth  ?? 80;
    const h = obj.height ?? meta?.defaultHeight ?? 80;

    if (!meta && !customEntry) {
      return (
        <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
           style={{ cursor: editCursor }}>
          {selRect(obj.x, obj.y, w, h)}
          <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
            fill="#0f172a" stroke={selected ? "#facc15" : "#7f1d1d"} strokeWidth={selected ? 2 : 1} />
          <text x={obj.x + w / 2} y={obj.y + h / 2 + 4}
            textAnchor="middle" fill="#fca5a5" fontSize={11}
            style={{ pointerEvents: "none" }}>
            simbolo?
          </text>
        </g>
      );
    }

    const truthy = (id?: string) => {
      if (!id) return false;
      const tv = tagValues[id];
      if (!tv) return false;
      const v = tv.value;
      if (typeof v === "boolean") return v;
      if (typeof v === "number")  return v !== 0;
      if (typeof v === "string")  return v.trim().length > 0;
      return Boolean(v);
    };
    const state =
      truthy(obj.alarm_tag) ? "alarm" :
      truthy(obj.state_tag) ? "on" : "off";

    const badgeColor =
      state === "alarm" ? (obj.state_alarm_color ?? "#ef4444") :
      state === "on"    ? (obj.state_on_color    ?? "#22c55e") :
                          (obj.state_off_color   ?? "#64748b");

    return (
      <g style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
        {/* Transparent hit-area so the symbol is always clickable/draggable even when
            all visual children have pointerEvents:"none" (same fix as gauge). */}
        <rect x={obj.x} y={obj.y} width={w} height={h} fill="transparent"
          onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
          style={{ cursor: editCursor }} />
        {applyTransform(obj, w, h,
          customEntry ? (
            <image href={customEntry.url} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />
          ) : meta!.kind === "builtin" && meta!.render ? (
            <svg x={obj.x} y={obj.y} width={w} height={h} viewBox="0 0 100 100">
              {meta!.render({
                state,
                off:   obj.state_off_color   ?? "#64748b",
                on:    obj.state_on_color    ?? "#22c55e",
                alarm: obj.state_alarm_color ?? "#ef4444",
              })}
            </svg>
          ) : (
            <image href={meta!.path} x={obj.x} y={obj.y} width={w} height={h}
              preserveAspectRatio="xMidYMid meet" style={{ pointerEvents: "none" }} />
          )
        )}
        {/* Status badge — axis-aligned, outside transform so it stays top-right
            regardless of rotation/flip orientation. */}
        {(obj.state_tag || obj.alarm_tag) && (
          <circle cx={obj.x + w - 7} cy={obj.y + 7} r={6}
            fill={badgeColor} stroke="#0f172a" strokeWidth={1}
            style={{ pointerEvents: "none", ...transitionStyle(obj) }} />
        )}
      </g>
    );
  }

  // ── GRID ────────────────────────────────────────────────────────────────────

  if (obj.type === "grid") {
    const w = obj.width ?? 400;
    const h = obj.height ?? 300;
    const nRows = obj.grid_rows ?? 2;
    const nCols = obj.grid_cols ?? 2;
    const showBorders = obj.grid_show_borders !== false;
    const borderColor = obj.grid_border_color ?? "#64748b";

    // Compute column widths
    const colWidthsDef = (obj.col_widths as number[] | undefined) ?? [];
    const colW: number[] = [];
    for (let c = 0; c < nCols; c++) {
      colW.push(c < colWidthsDef.length ? colWidthsDef[c] : w / nCols);
    }
    // Compute row heights
    const rowHeightsDef = (obj.row_heights as number[] | undefined) ?? [];
    const rowH: number[] = [];
    for (let r = 0; r < nRows; r++) {
      rowH.push(r < rowHeightsDef.length ? rowHeightsDef[r] : h / nRows);
    }
    // Cumulative offsets
    const colX: number[] = [];
    let cx = obj.x;
    for (let c = 0; c < nCols; c++) { colX.push(cx); cx += colW[c]; }
    const rowY: number[] = [];
    let ry = obj.y;
    for (let r = 0; r < nRows; r++) { rowY.push(ry); ry += rowH[r]; }

    // Map from "r-c" to cell definition
    const definedCells = (obj.grid_cells ?? []) as GridCell[];
    const cellMap = new Map<string, GridCell>();
    for (const cell of definedCells) cellMap.set(`${cell.row}-${cell.col}`, cell);

    // Track positions covered by a span (non-origin)
    const covered = new Set<string>();
    for (const cell of definedCells) {
      const rs = cell.rowspan ?? 1;
      const cs = cell.colspan ?? 1;
      for (let rr = cell.row; rr < Math.min(cell.row + rs, nRows); rr++) {
        for (let cc = cell.col; cc < Math.min(cell.col + cs, nCols); cc++) {
          if (rr !== cell.row || cc !== cell.col) covered.add(`${rr}-${cc}`);
        }
      }
    }

    return (
      <g>
        {/* Transparent hit rect for grid-level drag/select */}
        <rect
          x={obj.x} y={obj.y} width={w} height={h}
          fill="transparent"
          stroke={selected ? "#facc15" : showBorders ? borderColor : "none"}
          strokeWidth={selected ? 2 : 1}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
          style={{ cursor: editCursor }}
        />
        {Array.from({ length: nRows }, (_, r) =>
          Array.from({ length: nCols }, (_, c) => {
            const key = `${r}-${c}`;
            if (covered.has(key)) return null;

            const cellDef = cellMap.get(key);
            const rs = cellDef?.rowspan ?? 1;
            const cs = cellDef?.colspan ?? 1;
            let cellW = 0;
            for (let cc = c; cc < Math.min(c + cs, nCols); cc++) cellW += colW[cc];
            let cellH = 0;
            for (let rr = r; rr < Math.min(r + rs, nRows); rr++) cellH += rowH[rr];

            const cellVisible = (() => {
              if (!cellDef) return true;
              if (cellDef.visible_tag && tagValues[cellDef.visible_tag]) {
                const v = tagValues[cellDef.visible_tag].value;
                return typeof v === "boolean" ? v : typeof v === "number" ? v !== 0 : String(v).trim().length > 0;
              }
              return cellDef.visible !== false;
            })();
            if (!cellVisible && !isEditMode) return null;

            const isCellSel = isEditMode && selectedCell?.objectId === obj.id
              && selectedCell.row === r && selectedCell.col === c;

            return (
              <g
                key={key}
                style={{ opacity: !cellVisible && isEditMode ? 0.35 : 1 }}
                onMouseDown={(e) => {
                  if (isEditMode) {
                    e.stopPropagation();
                    // Shift+click on a cell of the already-selected grid
                    // extends the cell selection to a rectangular range
                    // anchored on the previously-selected cell. Does NOT
                    // start an object drag (would be confusing while
                    // building a range).
                    if (e.shiftKey && selectedCell?.objectId === obj.id) {
                      onSelectCellRange?.(obj.id, selectedCell.row, selectedCell.col, r, c);
                      return;
                    }
                    onSelect?.(obj.id, e.shiftKey);
                    if (!e.shiftKey) onStartDrag?.(e, obj);
                    onSelectCell?.(obj.id, r, c);
                  } else if (cellDef?.on_press_fn && onScript) {
                    e.stopPropagation();
                    onScript(cellDef.on_press_fn, {});
                  }
                }}
                onMouseEnter={(e) => {
                  // Shift+drag: primary button held + shift → extend range live
                  if (isEditMode && e.shiftKey && e.buttons === 1 && selectedCell?.objectId === obj.id) {
                    onSelectCellRange?.(obj.id, selectedCell.row, selectedCell.col, r, c);
                  }
                }}
                onMouseUp={(e) => {
                  if (!isEditMode && cellDef?.on_release_fn && onScript) {
                    e.stopPropagation();
                    onScript(cellDef.on_release_fn, {});
                  }
                }}
                onClick={(e) => e.stopPropagation()}
              >
                <rect
                  x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                  fill={cellDef?.bg_color ?? "transparent"}
                  stroke={showBorders ? (isCellSel ? "#facc15" : borderColor) : "none"}
                  strokeWidth={isCellSel ? 2 : 1}
                  style={{
                    cursor: isEditMode ? "pointer"
                      : (cellDef?.on_press_fn ? "pointer" : "default"),
                  }}
                />
                {isEditMode && (
                  <rect
                    x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                    fill="none"
                    stroke={isCellSel ? "#facc15" : "#475569"}
                    strokeWidth={isCellSel ? 1.5 : 1}
                    strokeDasharray="4 3"
                    opacity={isCellSel ? 0.9 : 0.5}
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {!cellDef?.sub && cellDef?.bg_image && (
                  <image
                    href={cellDef.bg_image}
                    x={colX[c]} y={rowY[r]} width={cellW} height={cellH}
                    preserveAspectRatio="xMidYMid slice"
                    style={{ pointerEvents: "none" }}
                  />
                )}
                {cellDef?.sub && renderSubArea(cellDef.sub, colX[c], rowY[r], cellW, cellH, [], r, c, obj.id)}
                {!cellDef?.sub && cellDef?.child && (() => {
                  const child = cellDef.child!;
                  const cw = child.width ?? 100;
                  const ch = child.height ?? 50;
                  const childX = colX[c] + (cellW - cw) / 2;
                  const childY = rowY[r] + (cellH - ch) / 2;
                  const placed = child.type === "line"
                    ? { ...child, x: childX, y: childY,
                        x2: childX + ((child.x2 ?? child.x + 100) - child.x),
                        y2: childY + ((child.y2 ?? child.y) - child.y) }
                    : { ...child, x: childX, y: childY };
                  const isChildSel = isEditMode
                    && selectedCellChild?.objectId === obj.id
                    && selectedCellChild.row === r
                    && selectedCellChild.col === c;
                  return (
                    <>
                      {/* Child visual — always non-interactive in edit mode */}
                      <g style={{ pointerEvents: isEditMode ? "none" : "auto" }}>
                        <SvgObject
                          obj={placed}
                          tagValues={tagValues}
                          selected={false}
                          isEditMode={false}
                          customSymbols={customSymbols}
                          onWriteTag={onWriteTag}
                          onScript={onScript}
                          onNavigate={onNavigate}
                        />
                      </g>
                      {/* Transparent overlay — enables clicking the child when the cell is already selected */}
                      {isEditMode && isCellSel && (
                        <rect
                          x={childX} y={childY} width={cw} height={ch}
                          fill="transparent"
                          style={{ cursor: "pointer" }}
                          onMouseDown={(e) => {
                            e.stopPropagation();
                            onSelectCellChild?.(obj.id, r, c);
                          }}
                          onClick={(e) => e.stopPropagation()}
                        />
                      )}
                      {/* Teal selection rect around the child when it is the active sub-selection */}
                      {isEditMode && isChildSel && (
                        <rect
                          x={childX - 2} y={childY - 2}
                          width={cw + 4} height={ch + 4}
                          fill="none" stroke="#0d9488"
                          strokeWidth={1.5} strokeDasharray="4 2"
                          style={{ pointerEvents: "none" }}
                        />
                      )}
                    </>
                  );
                })()}
              </g>
            );
          })
        )}

        {/* Multi-cell range overlay — teal dashed rect around the union of
            selected cells. Non-interactive so cells underneath remain clickable. */}
        {isEditMode && selectedCellRange?.objectId === obj.id && (() => {
          const { r1, c1, r2, c2 } = selectedCellRange;
          const safeR1 = Math.max(0, Math.min(nRows - 1, r1));
          const safeR2 = Math.max(0, Math.min(nRows - 1, r2));
          const safeC1 = Math.max(0, Math.min(nCols - 1, c1));
          const safeC2 = Math.max(0, Math.min(nCols - 1, c2));
          const rx = colX[safeC1];
          const ry = rowY[safeR1];
          let rw = 0;
          for (let cc = safeC1; cc <= safeC2; cc++) rw += colW[cc];
          let rh = 0;
          for (let rr = safeR1; rr <= safeR2; rr++) rh += rowH[rr];
          return (
            <rect
              x={rx} y={ry} width={rw} height={rh}
              fill="rgba(20,184,166,0.08)" stroke="#14b8a6"
              strokeWidth={2} strokeDasharray="6 4"
              style={{ pointerEvents: "none" }}
            />
          );
        })()}
      </g>
    );
  }

  // ── IMAGE ───────────────────────────────────────────────────────────────────

  if (obj.type === "image" && obj.src) {
    const w = obj.width ?? 100; const h = obj.height ?? 100;
    return (
      <>
        {selRect(obj.x, obj.y, w, h)}
        {applyTransform(obj, w, h,
          <image href={obj.src} x={obj.x} y={obj.y} width={w} height={h}
            style={{ cursor: editCursor }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        )}
      </>
    );
  }

  return null;
}
