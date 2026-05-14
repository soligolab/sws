import { useRef } from "react";
import { TrendCanvas } from "@/canvas/TrendCanvas";
import { SYMBOLS } from "@/symbols/library";
import type { CustomSymbol, SynopticObject, TagState } from "@/types";

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
  /** Single-select (replace) when shift is false; toggle into the set when true. */
  onSelect?: (id: string | null, shift?: boolean) => void;
  onMove?: (id: string, patch: Partial<SynopticObject>) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  /** View-mode dispatcher for on_press / on_release function bindings.
   *  Called with the function NAME and the per-binding argument overrides
   *  (possibly empty). Returns void; the caller is responsible for the
   *  fetch + console logging. */
  onScript?: (fn: string, args: Record<string, string | number | boolean>) => void;
  onNavigate?: (pageId: string) => void;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
  dx2?: number;
  dy2?: number;
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

function qualityColor(quality: TagState["quality"]): string {
  if (quality === "Good") return "#22c55e";
  if (quality === "Bad")  return "#ef4444";
  return "#eab308";
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
  if (!hasRotFlip && !hasOpacity) return content;
  const cx = obj.x + w / 2;
  const cy = obj.y + h / 2;
  const transform = hasRotFlip
    ? `rotate(${rot} ${cx} ${cy}) translate(${cx} ${cy}) scale(${sx} ${sy}) translate(${-cx} ${-cy})`
    : undefined;
  return (
    <g transform={transform} opacity={hasOpacity ? opacity : undefined}>
      {content}
    </g>
  );
}

// ── Quality dot overlay ───────────────────────────────────────────────────────

function QDot({ x, y, quality }: { x: number; y: number; quality: TagState["quality"] }) {
  return <circle cx={x} cy={y} r={5} fill={qualityColor(quality)} style={{ pointerEvents: "none" }} />;
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
  onSelect,
  onMove,
  onWriteTag,
  onScript,
  onNavigate,
}: SvgCanvasProps) {
  // Resolved selection set: prefer the explicit array, fall back to the
  // legacy single-id prop, then to "nothing selected".
  const selIds = selectedIds ?? (selectedId ? [selectedId] : []);
  const selSet = new Set(selIds);
  const dragRef = useRef<DragState | null>(null);

  const snap = (v: number) =>
    snapEnabled && gridSize > 0 ? Math.round(v / gridSize) * gridSize : v;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current || !onMove) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const newX = snap(e.clientX - rect.left - dragRef.current.offsetX);
    const newY = snap(e.clientY - rect.top  - dragRef.current.offsetY);
    const patch: Partial<SynopticObject> = { x: newX, y: newY };
    if (dragRef.current.dx2 !== undefined) {
      patch.x2 = newX + dragRef.current.dx2!;
      patch.y2 = newY + dragRef.current.dy2!;
    }
    onMove(dragRef.current.objId, patch);
  };

  const endDrag = () => { dragRef.current = null; };

  const startDrag = (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => {
    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svgEl.getBoundingClientRect();
    const ds: DragState = {
      objId:   obj.id,
      offsetX: e.clientX - rect.left - obj.x,
      offsetY: e.clientY - rect.top  - obj.y,
    };
    if (obj.type === "line") {
      ds.dx2 = (obj.x2 ?? obj.x + 100) - obj.x;
      ds.dy2 = (obj.y2 ?? obj.y)        - obj.y;
    }
    dragRef.current = ds;
  };

  return (
    <svg
      width="100%" height="100%"
      style={{ background, display: "block", userSelect: "none" }}
      onClick={() => onSelect?.(null)}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
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
      {gridSize > 0 && <rect width="100%" height="100%" fill="url(#sws-grid)" />}

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
          <g key={obj.id} style={gStyle} onMouseDown={onPress} onMouseUp={onRelease}>
            <SvgObject
              obj={obj}
              tagValues={tagValues}
              selected={selSet.has(obj.id)}
              isEditMode={inEdit}
              customSymbols={customSymbols}
              onSelect={onSelect}
              onStartDrag={onMove ? startDrag : undefined}
              onWriteTag={onWriteTag}
              onNavigate={onNavigate}
            />
          </g>
        );
      })}
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
  onSelect?: (id: string | null, shift?: boolean) => void;
  onStartDrag?: (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  onNavigate?: (pageId: string) => void;
}

function SvgObject(p: ObjProps) {
  const { tagValues, selected, isEditMode, customSymbols, onSelect, onStartDrag, onWriteTag, onNavigate } = p;
  const obj = resolveObject(p.obj, tagValues);

  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
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
            style={{ cursor: editCursor }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        )}
        {tv && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} />}
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
            style={{ cursor: editCursor }}
            onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()} />
        )}
        {tv && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} />}
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
          style={{ cursor: editCursor }}
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
            style={{ cursor: editCursor }}
            onMouseDown={handleMouseDown}
            onClick={(e) => e.stopPropagation()}
          >
            {content}
          </text>
        )}
        {tv && <QDot x={obj.x - 10} y={obj.y - size / 2} quality={tv.quality} />}
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
            stroke={selected ? "#facc15" : "#2563eb"} strokeWidth={selected ? 2 : 1} />
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
            stroke={selected ? "#facc15" : "#3b82f6"} strokeWidth={selected ? 2 : 1.5} />
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
          <circle cx={cx} cy={cy} r={r} fill={ledColor} />
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
            <rect x={obj.x} y={obj.y} width={barW} height={h} rx={4} fill={barColor} />
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
        {tv && <QDot x={obj.x + w - 8} y={obj.y + 8} quality={tv.quality} />}
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
              style={{ pointerEvents: "none" }} />
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
        {tv && <QDot x={obj.x + w - 10} y={obj.y + 10} quality={tv.quality} />}
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
      <g onMouseDown={handleMouseDown} onClick={(e) => e.stopPropagation()}
         style={{ cursor: editCursor }}>
        {selRect(obj.x, obj.y, w, h)}
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
            style={{ pointerEvents: "none" }} />
        )}
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
