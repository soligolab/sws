import { useRef } from "react";
import type { SynopticObject, TagState } from "@/types";

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagState>;
  background?: string;
  selectedId?: string | null;
  gridSize?: number;
  snapEnabled?: boolean;
  onSelect?: (id: string | null) => void;
  /** Patch an object's properties (used for drag-move). */
  onMove?: (id: string, patch: Partial<SynopticObject>) => void;
  /** Called when a button/navbutton is clicked in view mode. */
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  /** Called when a navbutton is clicked in view mode. */
  onNavigate?: (pageId: string) => void;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
  /** For lines: preserve the delta from (x,y) to (x2,y2) while dragging. */
  dx2?: number;
  dy2?: number;
}

export function SvgCanvas({
  objects,
  tagValues = {},
  background = "#1a1a2e",
  selectedId,
  gridSize = 10,
  snapEnabled = true,
  onSelect,
  onMove,
  onWriteTag,
  onNavigate,
}: SvgCanvasProps) {
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
      {/* Canvas grid */}
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

      {objects.map((obj) => (
        <SvgObject
          key={obj.id}
          obj={obj}
          tagValues={tagValues}
          selected={selectedId === obj.id}
          onSelect={onSelect}
          onStartDrag={onMove ? startDrag : undefined}
          onWriteTag={onWriteTag}
          onNavigate={onNavigate}
        />
      ))}
    </svg>
  );
}

// ── Per-object renderer ───────────────────────────────────────────────────────

interface SvgObjectProps {
  obj: SynopticObject;
  tagValues: Record<string, TagState>;
  selected: boolean;
  onSelect?: (id: string | null) => void;
  onStartDrag?: (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
  onNavigate?: (pageId: string) => void;
}

function qualityColor(quality: TagState["quality"]): string {
  if (quality === "Good") return "#22c55e";
  if (quality === "Bad")  return "#ef4444";
  return "#eab308";
}

function SvgObject({ obj, tagValues, selected, onSelect, onStartDrag, onWriteTag, onNavigate }: SvgObjectProps) {
  const isViewMode = !onStartDrag;

  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
    e.stopPropagation();
    onSelect?.(obj.id);
    onStartDrag?.(e, obj);
  };

  const editCursor = selected ? "grab" : "pointer";

  // ── rect ─────────────────────────────────────────────────────────────────

  if (obj.type === "rect") {
    const w  = obj.width  ?? 100;
    const h  = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        <rect
          x={obj.x} y={obj.y} width={w} height={h}
          fill={obj.fill ?? "#555"}
          stroke={selected ? "#facc15" : (obj.stroke ?? "none")}
          strokeWidth={selected ? 2 : (obj.stroke_width ?? 0)}
          style={{ cursor: editCursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
        />
        {tv && (
          <circle cx={obj.x + w - 8} cy={obj.y + 8} r={5}
            fill={qualityColor(tv.quality)} style={{ pointerEvents: "none" }} />
        )}
      </>
    );
  }

  // ── ellipse ───────────────────────────────────────────────────────────────

  if (obj.type === "ellipse") {
    const w  = obj.width  ?? 100;
    const h  = obj.height ?? 60;
    const rx = w / 2;
    const ry = h / 2;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        {selected && (
          <rect x={obj.x} y={obj.y} width={w} height={h}
            fill="none" stroke="#facc15" strokeWidth={1} strokeDasharray="4 2"
            style={{ pointerEvents: "none" }} />
        )}
        <ellipse
          cx={obj.x + rx} cy={obj.y + ry} rx={rx} ry={ry}
          fill={obj.fill ?? "#4a90d9"}
          stroke={obj.stroke ?? "none"} strokeWidth={obj.stroke_width ?? 0}
          style={{ cursor: editCursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
        />
        {tv && (
          <circle cx={obj.x + w - 8} cy={obj.y + 8} r={5}
            fill={qualityColor(tv.quality)} style={{ pointerEvents: "none" }} />
        )}
      </>
    );
  }

  // ── text ──────────────────────────────────────────────────────────────────

  if (obj.type === "text") {
    const tv    = obj.tag ? tagValues[obj.tag] : undefined;
    const label = tv != null ? formatValue(tv.value, obj.format) : (obj.tag ?? "text");
    return (
      <>
        {selected && (
          <rect x={obj.x - 4} y={obj.y - 14} width={120} height={20}
            fill="none" stroke="#facc15" strokeWidth={1}
            style={{ pointerEvents: "none" }} />
        )}
        <text x={obj.x} y={obj.y} fill="#fff" fontSize={14}
          style={{ cursor: editCursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}>
          {label}
        </text>
        {tv && (
          <circle cx={obj.x - 8} cy={obj.y - 4} r={5}
            fill={qualityColor(tv.quality)} style={{ pointerEvents: "none" }} />
        )}
      </>
    );
  }

  // ── line ──────────────────────────────────────────────────────────────────

  if (obj.type === "line") {
    const x2 = obj.x2 ?? obj.x + 100;
    const y2 = obj.y2 ?? obj.y;
    return (
      <>
        <line
          x1={obj.x} y1={obj.y} x2={x2} y2={y2}
          stroke={obj.stroke ?? "#e2e8f0"} strokeWidth={obj.stroke_width ?? 2}
          style={{ cursor: editCursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
        />
        {selected && (
          <>
            <circle cx={obj.x} cy={obj.y}  r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
            <circle cx={x2}    cy={y2}      r={4} fill="#facc15" style={{ pointerEvents: "none" }} />
          </>
        )}
      </>
    );
  }

  // ── button ────────────────────────────────────────────────────────────────

  if (obj.type === "button") {
    const w = obj.width  ?? 120;
    const h = obj.height ?? 40;
    return (
      <g
        style={{ cursor: isViewMode ? "pointer" : editCursor }}
        onMouseDown={isViewMode ? undefined : handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          if (isViewMode && obj.tag) {
            onWriteTag?.(obj.tag, obj.write_value ?? true);
          } else if (!isViewMode) {
            onSelect?.(obj.id);
          }
        }}
      >
        <rect x={obj.x} y={obj.y} width={w} height={h} rx={6}
          fill={obj.fill ?? "#3b82f6"}
          stroke={selected ? "#facc15" : "#2563eb"}
          strokeWidth={selected ? 2 : 1} />
        <text x={obj.x + w / 2} y={obj.y + h / 2 + 5}
          textAnchor="middle" fill="#fff" fontSize={14} fontWeight={600}
          style={{ pointerEvents: "none" }}>
          {obj.label ?? "Button"}
        </text>
      </g>
    );
  }

  // ── navbutton ─────────────────────────────────────────────────────────────

  if (obj.type === "navbutton") {
    const w = obj.width  ?? 140;
    const h = obj.height ?? 36;
    return (
      <g
        style={{ cursor: isViewMode ? "pointer" : editCursor }}
        onMouseDown={isViewMode ? undefined : handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          if (isViewMode && obj.target_page) {
            onNavigate?.(obj.target_page);
          } else if (!isViewMode) {
            onSelect?.(obj.id);
          }
        }}
      >
        <rect x={obj.x} y={obj.y} width={w} height={h} rx={4}
          fill={obj.fill ?? "#0f172a"}
          stroke={selected ? "#facc15" : "#3b82f6"}
          strokeWidth={selected ? 2 : 1.5} />
        {/* Arrow icon */}
        <text x={obj.x + 10} y={obj.y + h / 2 + 5}
          fill="#3b82f6" fontSize={14}
          style={{ pointerEvents: "none" }}>
          ▶
        </text>
        <text x={obj.x + 28} y={obj.y + h / 2 + 5}
          fill="#e2e8f0" fontSize={13}
          style={{ pointerEvents: "none" }}>
          {obj.label ?? "Go to page"}
        </text>
      </g>
    );
  }

  // ── image ─────────────────────────────────────────────────────────────────

  if (obj.type === "image" && obj.src) {
    return (
      <image
        href={obj.src} x={obj.x} y={obj.y}
        width={obj.width ?? 100} height={obj.height ?? 100}
        style={{ cursor: editCursor }}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return null;
}

function formatValue(value: number | string | boolean, format?: string): string {
  if (format && typeof value === "number") {
    const m = format.match(/\{value:\.(\d+)f\}/);
    if (m) return format.replace(/\{value:[^}]+\}/, value.toFixed(Number(m[1])));
  }
  return String(value);
}
