import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { LeftPanel } from "@/editor/LeftPanel";
import { useAppStore } from "@/store";
import type { SynopticObject } from "@/types";

// ── Shared styles ─────────────────────────────────────────────────────────────

const PANEL: React.CSSProperties = {
  background: "#1e293b",
  color: "#cbd5e1",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  padding: 12,
  overflowY: "auto",
};
const LABEL: React.CSSProperties = { fontSize: 11, color: "#94a3b8", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%",
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 13,
  boxSizing: "border-box",
};

// ── EditorShell ───────────────────────────────────────────────────────────────

export function EditorShell() {
  const pages           = useAppStore((s) => s.pages);
  const currentPageId   = useAppStore((s) => s.currentPageId);
  const selectedId      = useAppStore((s) => s.selectedObjectId);
  const tagValues       = useAppStore((s) => s.tagValues);
  const gridSize        = useAppStore((s) => s.gridSize);
  const snapEnabled     = useAppStore((s) => s.snapEnabled);
  const addObject       = useAppStore((s) => s.addObject);
  const updateObject    = useAppStore((s) => s.updateObject);
  const deleteObject    = useAppStore((s) => s.deleteObject);
  const selectObject    = useAppStore((s) => s.selectObject);
  const updatePageProps = useAppStore((s) => s.updatePageProps);

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];
  const selected    = objects.find((o) => o.id === selectedId) ?? null;

  const nextPos = () => {
    const n = objects.length;
    return { x: 60 + (n % 6) * 25, y: 60 + Math.floor(n / 6) * 25 };
  };

  const handleAddObject = (type: SynopticObject["type"]) => {
    const { x, y } = nextPos();
    switch (type) {
      case "rect":
        addObject({ type, x, y, width: 150, height: 80, fill: "#4a90d9" });
        break;
      case "ellipse":
        addObject({ type, x, y, width: 120, height: 80, fill: "#4a90d9" });
        break;
      case "line":
        addObject({ type, x, y, x2: x + 120, y2: y, stroke: "#e2e8f0", stroke_width: 2 });
        break;
      case "text":
        addObject({ type, x, y: y + 14, tag: "", format: "{value}" });
        break;
      case "button":
        addObject({ type, x, y, width: 120, height: 40, fill: "#3b82f6", label: "Bottone", write_value: true });
        break;
      case "navbutton":
        addObject({ type, x, y, width: 140, height: 36, label: "Vai alla pagina" });
        break;
    }
  };

  const handleSave = () => {
    if (currentPage) api.saveSynoptic(currentPage).catch(console.error);
  };

  return (
    <div
      style={{ display: "flex", flex: 1, overflow: "hidden" }}
      tabIndex={-1}
      onKeyDown={(e) => {
        const tag = (e.target as HTMLElement).tagName;
        if ((e.key === "Delete" || e.key === "Backspace") && selectedId && tag !== "INPUT" && tag !== "TEXTAREA") {
          deleteObject(selectedId);
        }
      }}
    >
      {/* Left panel: project tree + object palette + settings */}
      <LeftPanel onAddObject={handleAddObject} onSave={handleSave} />

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          selectedId={selectedId}
          gridSize={gridSize}
          snapEnabled={snapEnabled}
          onSelect={selectObject}
          onMove={(id, patch) => updateObject(id, patch)}
        />
      </div>

      {/* Properties panel */}
      <aside style={{ ...PANEL, width: 240, borderLeft: "1px solid #334155" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>
          PROPRIETÀ
        </span>
        {selected ? (
          <ObjectProps
            obj={selected}
            pages={pages.filter((p) => p.id !== currentPageId)}
            onChange={(patch) => updateObject(selected.id, patch)}
            onDelete={() => deleteObject(selected.id)}
          />
        ) : (
          <PageProps
            name={currentPage?.name ?? ""}
            background={currentPage?.background ?? "#1a1a2e"}
            onChange={(patch) => updatePageProps(currentPageId, patch)}
          />
        )}
      </aside>
    </div>
  );
}

// ── Page properties (shown when nothing selected) ─────────────────────────────

function PageProps({
  name,
  background,
  onChange,
}: {
  name: string;
  background: string;
  onChange: (patch: Partial<{ name: string; background: string }>) => void;
}) {
  return (
    <>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>Pagina</div>
      <div>
        <div style={LABEL}>Nome</div>
        <input
          type="text"
          style={INPUT}
          value={name}
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </div>
      <div>
        <div style={LABEL}>Sfondo</div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type="color"
            style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
            value={background}
            onChange={(e) => onChange({ background: e.target.value })}
          />
          <input
            type="text"
            style={{ ...INPUT }}
            value={background}
            onChange={(e) => onChange({ background: e.target.value })}
          />
        </div>
      </div>
      <p style={{ fontSize: 11, color: "#475569", margin: 0 }}>
        Seleziona un oggetto sul canvas per modificarne le proprietà.
      </p>
    </>
  );
}

// ── Object properties ─────────────────────────────────────────────────────────

function ObjectProps({
  obj,
  pages,
  onChange,
  onDelete,
}: {
  obj: SynopticObject;
  pages: { id: string; name: string }[];
  onChange: (p: Partial<SynopticObject>) => void;
  onDelete: () => void;
}) {
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

  const colorInput = (key: keyof SynopticObject, fallback: string) => (
    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
      <input
        type="color"
        style={{ ...INPUT, padding: 2, height: 28, width: 44, cursor: "pointer", flex: "none" }}
        value={(obj[key] as string) ?? fallback}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
      />
      <input
        type="text"
        style={INPUT}
        value={(obj[key] as string) ?? fallback}
        onChange={(e) => onChange({ [key]: e.target.value } as Partial<SynopticObject>)}
      />
    </div>
  );

  const isShape = obj.type === "rect" || obj.type === "ellipse" || obj.type === "button" || obj.type === "navbutton";
  const hasStroke = obj.type === "rect" || obj.type === "ellipse" || obj.type === "line";

  return (
    <>
      {field("ID",   <span style={{ fontSize: 11, color: "#64748b" }}>{obj.id}</span>)}
      {field("Tipo", <span style={{ fontSize: 11, color: "#64748b" }}>{obj.type}</span>)}

      {/* Position */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        <div><div style={LABEL}>X</div>{numInput("x", 0)}</div>
        <div><div style={LABEL}>Y</div>{numInput("y", 0)}</div>
      </div>

      {/* Size (shapes) */}
      {isShape && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div><div style={LABEL}>W</div>{numInput("width", 100)}</div>
          <div><div style={LABEL}>H</div>{numInput("height", 50)}</div>
        </div>
      )}

      {/* Line endpoint */}
      {obj.type === "line" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <div><div style={LABEL}>X2</div>{numInput("x2", obj.x + 100)}</div>
          <div><div style={LABEL}>Y2</div>{numInput("y2", obj.y)}</div>
        </div>
      )}

      {/* Fill */}
      {(obj.type === "rect" || obj.type === "ellipse" || obj.type === "button" || obj.type === "navbutton") &&
        field("Colore", colorInput("fill", "#4a90d9"))}

      {/* Stroke */}
      {hasStroke && (
        <>
          {field("Bordo", colorInput("stroke", "#e2e8f0"))}
          {field("Spessore bordo", numInput("stroke_width", 1))}
        </>
      )}

      {/* Tag binding */}
      {obj.type !== "navbutton" && field("Tag", textInput("tag", "es. pump1.speed"))}
      {obj.type === "text" && field("Formato", textInput("format", "{value:.1f} unit"))}

      {/* Button label + write value */}
      {obj.type === "button" && (
        <>
          {field("Etichetta", textInput("label", "Bottone"))}
          {field("Valore scrittura",
            <input
              type="text"
              style={INPUT}
              placeholder="true / 1 / testo"
              value={obj.write_value !== undefined ? String(obj.write_value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "true" ? true : raw === "false" ? false
                  : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                onChange({ write_value: v });
              }}
            />
          )}
        </>
      )}

      {/* NavButton */}
      {obj.type === "navbutton" && (
        <>
          {field("Etichetta", textInput("label", "Vai alla pagina"))}
          {field("Pagina di destinazione",
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.target_page ?? ""}
              onChange={(e) => onChange({ target_page: e.target.value || undefined })}
            >
              <option value="">— seleziona —</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          )}
        </>
      )}

      <button
        onClick={onDelete}
        style={{
          marginTop: 4,
          background: "#7f1d1d", color: "#fca5a5",
          border: "1px solid #991b1b", borderRadius: 4,
          padding: "5px 10px", cursor: "pointer", fontSize: 13,
        }}
      >
        Elimina oggetto
      </button>
    </>
  );
}
