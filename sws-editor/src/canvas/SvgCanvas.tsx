import type { SynopticObject, TagValue } from "@/types";

interface SvgCanvasProps {
  objects: SynopticObject[];
  tagValues?: Record<string, TagValue>;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}

export function SvgCanvas({ objects, tagValues = {}, selectedId, onSelect }: SvgCanvasProps) {
  return (
    <svg
      width="100%"
      height="100%"
      style={{ background: "#1a1a2e", display: "block" }}
      onClick={() => onSelect?.(null)}
    >
      {objects.map((obj) => (
        <SvgObject
          key={obj.id}
          obj={obj}
          tagValues={tagValues}
          selected={selectedId === obj.id}
          onSelect={onSelect}
        />
      ))}
    </svg>
  );
}

interface SvgObjectProps {
  obj: SynopticObject;
  tagValues: Record<string, TagValue>;
  selected: boolean;
  onSelect?: (id: string | null) => void;
}

function SvgObject({ obj, tagValues, selected, onSelect }: SvgObjectProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(obj.id);
  };

  const outline = selected ? "2px solid #facc15" : undefined;

  if (obj.type === "rect") {
    return (
      <rect
        x={obj.x}
        y={obj.y}
        width={obj.width ?? 100}
        height={obj.height ?? 50}
        fill={obj.fill ?? "#555"}
        style={{ cursor: "pointer", outline }}
        onClick={handleClick}
      />
    );
  }

  if (obj.type === "text") {
    const tv = obj.tag ? tagValues[obj.tag] : undefined;
    const label = tv != null ? formatValue(tv.value, obj.format) : obj.tag ?? "";
    return (
      <text
        x={obj.x}
        y={obj.y}
        fill="#fff"
        fontSize={16}
        style={{ cursor: "pointer" }}
        onClick={handleClick}
      >
        {label}
      </text>
    );
  }

  if (obj.type === "image" && obj.src) {
    return (
      <image
        href={obj.src}
        x={obj.x}
        y={obj.y}
        width={obj.width ?? 100}
        height={obj.height ?? 100}
        style={{ cursor: "pointer" }}
        onClick={handleClick}
      />
    );
  }

  return null;
}

function formatValue(value: number | string | boolean, format?: string): string {
  if (format && typeof value === "number") {
    // Simple {value:.Nf} format support
    const match = format.match(/\{value:\.(\d+)f\}/);
    if (match) {
      return format.replace(/\{value:[^}]+\}/, value.toFixed(Number(match[1])));
    }
  }
  return String(value);
}
