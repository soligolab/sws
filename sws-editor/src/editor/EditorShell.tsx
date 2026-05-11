import { useAppStore } from "@/store";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import type { SynopticObject } from "@/types";

const PANEL: React.CSSProperties = {
  background: "#1e293b", color: "#cbd5e1",
  display: "flex", flexDirection: "column", gap: 8, padding: 12, overflowY: "auto",
};
const LABEL: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%", background: "#0f172a", color: "#e2e8f0",
  border: "1px solid #334155", borderRadius: 4, padding: "3px 6px", fontSize: 13,
  boxSizing: "border-box",
};

export function EditorShell() {
  const pages         = useAppStore((s) => s.pages);
  const currentPageId = useAppStore((s) => s.currentPageId);
  const selectedId    = useAppStore((s) => s.selectedObjectId);
  const tagValues     = useAppStore((s) => s.tagValues);
  const addObject     = useAppStore((s) => s.addObject);
  const updateObject  = useAppStore((s) => s.updateObject);
  const deleteObject  = useAppStore((s) => s.deleteObject);
  const selectObject  = useAppStore((s) => s.selectObject);

  const objects = pages.find((p) => p.id === currentPageId)?.objects ?? [];
  const selected = objects.find((o) => o.id === selectedId) ?? null;

  const nextPos = () => {
    const n = objects.length;
    return { x: 60 + (n % 6) * 25, y: 60 + Math.floor(n / 6) * 25 };
  };

  const handleAdd = (type: SynopticObject["type"]) => {
    const { x, y } = nextPos();
    if (type === "rect") addObject({ type, x, y, width: 150, height: 80, fill: "#4a90d9" });
    if (type === "text") addObject({ type, x, y: y + 14, tag: "", format: "{value}" });
  };

  return (
    <div
      style={{ display: "flex", flex: 1, overflow: "hidden" }}
      tabIndex={-1}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if (e.key === "Delete" && selectedId && tag !== "INPUT" && tag !== "TEXTAREA") {
          deleteObject(selectedId);
        }
      }}
    >
      {/* Toolbox */}
      <aside style={{ ...PANEL, width: 160, borderRight: "1px solid #334155", gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>
          OBJECTS
        </span>
        {(["rect", "text"] as const).map((t) => (
          <button
            key={t}
            onClick={() => handleAdd(t)}
            style={{
              background: "#0f172a", color: "#cbd5e1", border: "1px solid #334155",
              borderRadius: 4, padding: "5px 8px", cursor: "pointer", fontSize: 13,
              textAlign: "left",
            }}
          >
            + {t}
          </button>
        ))}
        <button
          disabled
          title="Image upload — coming later"
          style={{
            background: "#0f172a", color: "#475569", border: "1px solid #1e293b",
            borderRadius: 4, padding: "5px 8px", cursor: "not-allowed", fontSize: 13,
            textAlign: "left",
          }}
        >
          + image
        </button>
      </aside>

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          selectedId={selectedId}
          onSelect={selectObject}
          onMove={(id, x, y) => updateObject(id, { x, y })}
        />
      </div>

      {/* Properties */}
      <aside style={{ ...PANEL, width: 240, borderLeft: "1px solid #334155" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>
          PROPERTIES
        </span>
        {selected ? (
          <PropertiesForm
            obj={selected}
            onChange={(patch) => updateObject(selected.id, patch)}
            onDelete={() => deleteObject(selected.id)}
          />
        ) : (
          <p style={{ fontSize: 12, color: "#475569", margin: 0 }}>
            Select an object on the canvas.
          </p>
        )}
      </aside>
    </div>
  );
}

function PropertiesForm({
  obj, onChange, onDelete,
}: { obj: SynopticObject; onChange: (p: Partial<SynopticObject>) => void; onDelete: () => void }) {
  const field = (label: string, content: React.ReactNode) => (
    <div key={label}>
      <div style={LABEL}>{label}</div>
      {content}
    </div>
  );

  const numInput = (key: keyof SynopticObject, fallback: number) => (
    <input
      type="number"
      style={INPUT}
      value={obj[key] !== undefined ? (obj[key] as number) : fallback}
      onChange={(e) => onChange({ [key]: Number(e.target.value) } as Partial<SynopticObject>)}
    />
  );

  const textInput = (key: keyof SynopticObject, placeholder?: string) => (
    <input
      type="text"
      style={INPUT}
      placeholder={placeholder}
      value={(obj[key] as string) ?? ""}
      onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
    />
  );

  return (
    <>
      {field("ID",   <span style={{ fontSize: 11, color: "#64748b" }}>{obj.id}</span>)}
      {field("Type", <span style={{ fontSize: 11, color: "#64748b" }}>{obj.type}</span>)}
      {field("X", numInput("x", 0))}
      {field("Y", numInput("y", 0))}
      {obj.type === "rect" && <>
        {field("Width",  numInput("width",  100))}
        {field("Height", numInput("height",  50))}
        {field("Fill",
          <input
            type="color"
            style={{ ...INPUT, padding: 2, height: 28, cursor: "pointer" }}
            value={obj.fill ?? "#555555"}
            onChange={(e) => onChange({ fill: e.target.value })}
          />
        )}
      </>}
      {field("Tag binding", textInput("tag", "e.g. pump1.speed"))}
      {obj.type === "text" && field("Format", textInput("format", "{value:.1f} unit"))}
      <button
        onClick={onDelete}
        style={{
          marginTop: 4, background: "#7f1d1d", color: "#fca5a5",
          border: "1px solid #991b1b", borderRadius: 4,
          padding: "5px 10px", cursor: "pointer", fontSize: 13,
        }}
      >
        Delete object
      </button>
    </>
  );
}
