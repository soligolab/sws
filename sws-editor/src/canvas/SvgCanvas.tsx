import { useRef } from "react";
import type { SynopticObject, TagState } from "@/types";

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagState>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  onMove?: (id: string, x: number, y: number) => void;
}

interface DragState {
  objId: string;
  offsetX: number;
  offsetY: number;
}

export function SvgCanvas({ objects, tagValues = {}, selectedId, onSelect, onMove }: SvgCanvasProps) {
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
}

function SvgObject({ obj, tagValues, selected, onSelect, onStartDrag }: SvgObjectProps) {
  const handleMouseDown = (e: React.MouseEvent<SVGElement>) => {
    e.stopPropagation();
    onSelect?.(obj.id);
    onStartDrag?.(e, obj);
  };

  const cursor = selected ? "grab" : "pointer";

  if (obj.type === "rect") {
    return (
      <rect
        x={obj.x} y={obj.y}
        width={obj.width ?? 100} height={obj.height ?? 50}
        fill={obj.fill ?? "#555"}
        stroke={selected ? "#facc15" : "none"}
        strokeWidth={selected ? 2 : 0}
        style={{ cursor }}
        onMouseDown={handleMouseDown}
        onClick={(e) => e.stopPropagation()}
      />
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
      </>
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
