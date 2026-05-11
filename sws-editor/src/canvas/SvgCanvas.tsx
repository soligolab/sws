import { useRef } from "react";
import type { SynopticObject, TagState } from "@/types";

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagState>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
}

export function SvgCanvas({ objects, tagValues = {}, selectedId, onSelect, onMove, onWriteTag }: SvgCanvasProps) {
  const dragRef = useRef<DragState | null>(null);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!dragRef.current || !onMove) return;
    const rect = e.currentTarget.getBoundingClientRect();
    onMove(
      dragRef.current.objId,
      Math.round(e.clientX - rect.left - dragRef.current.offsetX),
      Math.round(e.clientY - rect.top - dragRef.current.offsetY),
    );
  };

  const endDrag = () => { dragRef.current = null; };

  const startDrag = (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => {
    const svgEl = (e.currentTarget as SVGElement).ownerSVGElement!;
    const rect = svgEl.getBoundingClientRect();
    dragRef.current = {
      objId: obj.id,
      offsetX: e.clientX - rect.left - obj.x,
      offsetY: e.clientY - rect.top - obj.y,
    };
  };

  return (
    <svg
      width="100%" height="100%"
      style={{ background: "#1a1a2e", display: "block", userSelect: "none" }}
      onClick={() => onSelect?.(null)}
      onMouseMove={handleMouseMove}
      onMouseUp={endDrag}
      onMouseLeave={endDrag}
    >
      {objects.map((obj) => (
        <SvgObject
          key={obj.id}
          obj={obj}
          tagValues={tagValues}
          selected={selectedId === obj.id}
          onSelect={onSelect}
          onStartDrag={startDrag}
          onWriteTag={onWriteTag}
        />
      ))}
    </svg>
  );
}

interface SvgObjectProps {
  obj: SynopticObject;
  tagValues: Record<string, TagState>;
  selected: boolean;
  onSelect?: (id: string | null) => void;
  onStartDrag?: (e: React.MouseEvent<SVGElement>, obj: SynopticObject) => void;
  onWriteTag?: (tagId: string, value: string | number | boolean) => void;
}

function qualityColor(quality: TagState["quality"]): string {
  if (quality === "Good") return "#22c55e";
  if (quality === "Bad")  return "#ef4444";
  return "#eab308";
}

function SvgObject({ obj, tagValues, selected, onSelect, onStartDrag, onWriteTag }: SvgObjectProps) {
  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
    e.stopPropagation();
    onSelect?.(obj.id);
    onStartDrag?.(e, obj);
  };

  const cursor = onWriteTag ? "default" : (selected ? "grab" : "pointer");

  if (obj.type === "rect") {
    const w = obj.width ?? 100;
    const h = obj.height ?? 50;
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    return (
      <>
        <rect
          x={obj.x} y={obj.y}
          width={w} height={h}
          fill={obj.fill ?? "#555"}
          stroke={selected ? "#facc15" : "none"}
          strokeWidth={selected ? 2 : 0}
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
        />
        {tv && (
          <circle
            cx={obj.x + w - 8} cy={obj.y + 8} r={5}
            fill={qualityColor(tv.quality)}
            style={{ pointerEvents: "none" }}
          />
        )}
      </>
    );
  }

  if (obj.type === "text") {
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const label = tv != null ? formatValue(tv.value, obj.format) : (obj.tag ?? "text");
    return (
      <>
        {selected && (
          <rect
            x={obj.x - 4} y={obj.y - 14}
            width={120} height={20}
            fill="none" stroke="#facc15" strokeWidth={1}
            style={{ pointerEvents: "none" }}
          />
        )}
        <text
          x={obj.x} y={obj.y}
          fill="#fff" fontSize={14}
          style={{ cursor }}
          onMouseDown={handleMouseDown}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </text>
        {tv && (
          <circle
            cx={obj.x - 8} cy={obj.y - 4} r={5}
            fill={qualityColor(tv.quality)}
            style={{ pointerEvents: "none" }}
          />
        )}
      </>
    );
  }

  if (obj.type === "button") {
    const w = obj.width ?? 120;
    const h = obj.height ?? 40;
    const isView = !!onWriteTag;
    return (
      <g
        style={{ cursor: isView ? "pointer" : (selected ? "grab" : "pointer") }}
        onMouseDown={isView ? undefined : handleMouseDown}
        onClick={(e) => {
          e.stopPropagation();
          if (isView && obj.tag) {
            onWriteTag!(obj.tag, obj.write_value ?? true);
          } else if (!isView) {
            onSelect?.(obj.id);
          }
        }}
      >
        <rect
          x={obj.x} y={obj.y}
          width={w} height={h} rx={6}
          fill={obj.fill ?? "#3b82f6"}
          stroke={selected ? "#facc15" : "#2563eb"}
          strokeWidth={selected ? 2 : 1}
        />
        <text
          x={obj.x + w / 2} y={obj.y + h / 2 + 5}
          textAnchor="middle"
          fill="#fff" fontSize={14} fontWeight={600}
          style={{ pointerEvents: "none" }}
        >
          {obj.label ?? "Button"}
        </text>
      </g>
    );
  }

  if (obj.type === "image" && obj.src) {
    return (
      <image
        href={obj.src}
        x={obj.x} y={obj.y}
        width={obj.width ?? 100} height={obj.height ?? 100}
        style={{ cursor }}
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
