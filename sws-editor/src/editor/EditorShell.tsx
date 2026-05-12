import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { LeftPanel } from "@/editor/LeftPanel";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type { RadioOption, SynopticObject, TableRow } from "@/types";

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
      case "checkbox":
        addObject({ type, x, y, width: 120, height: 30, label: "Checkbox", checked_value: true, unchecked_value: false });
        break;
      case "radio":
        addObject({ type, x, y, width: 160, height: 80, label: "Radio", orientation: "vertical",
          options: [{ label: "Opzione 1", value: "1" }, { label: "Opzione 2", value: "2" }] });
        break;
      case "slider":
        addObject({ type, x, y, width: 200, height: 40, min: 0, max: 100, step: 1, orientation: "horizontal" });
        break;
      case "gauge":
        addObject({ type, x, y, width: 180, height: 180, min: 0, max: 100, label: "Gauge" });
        break;
      case "led":
        addObject({ type, x, y, width: 40, height: 40, on_value: true, on_color: "#22c55e", off_color: "#374151" });
        break;
      case "progress_bar":
        addObject({ type, x, y, width: 200, height: 30, min: 0, max: 100, fill: "#3b82f6", show_value: true });
        break;
      case "table":
        addObject({ type, x, y, width: 300, height: 120,
          table_rows: [{ label: "Tag 1", tag: "", format: "{value:.1f}" }] });
        break;
      case "trend":
        addObject({ type, x, y, width: 360, height: 180,
          tag: "", window_s: 60, line_color: "#3b82f6" });
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

  const tagInput = (placeholder?: string) => (
    <TagInput
      style={INPUT}
      placeholder={placeholder}
      value={obj.tag ?? ""}
      onChange={(v) => onChange({ tag: v })}
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

  const BOX_TYPES = ["rect", "ellipse", "button", "navbutton", "checkbox", "radio", "slider", "gauge", "led", "progress_bar", "table", "trend"];
  const isShape = BOX_TYPES.includes(obj.type);
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
      {obj.type !== "navbutton" && field("Tag", tagInput("es. pump1.speed"))}
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

      {/* Gauge */}
      {obj.type === "gauge" && (
        <>
          {field("Etichetta", textInput("label", "Gauge"))}
          {field("Tag", tagInput("es. pump1.speed"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div>{numInput("min", 0)}</div>
            <div><div style={LABEL}>Max</div>{numInput("max", 100)}</div>
          </div>
          {field("Unità", textInput("unit", ""))}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Warn Low</div>{numInput("warn_low", 0)}</div>
            <div><div style={LABEL}>Warn High</div>{numInput("warn_high", 0)}</div>
            <div><div style={LABEL}>Alarm Low</div>{numInput("alarm_low", 0)}</div>
            <div><div style={LABEL}>Alarm High</div>{numInput("alarm_high", 0)}</div>
          </div>
          {field("Mostra valore",
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
        </>
      )}

      {/* Slider */}
      {obj.type === "slider" && (
        <>
          {field("Tag", tagInput("es. pump1.speed"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div>{numInput("min", 0)}</div>
            <div><div style={LABEL}>Max</div>{numInput("max", 100)}</div>
            <div><div style={LABEL}>Step</div>{numInput("step", 1)}</div>
          </div>
          {field("Orientamento",
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.orientation ?? "horizontal"}
              onChange={(e) => onChange({ orientation: e.target.value as "horizontal" | "vertical" })}
            >
              <option value="horizontal">Orizzontale</option>
              <option value="vertical">Verticale</option>
            </select>
          )}
          {field("Mostra valore",
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
          {field("Solo lettura",
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
        </>
      )}

      {/* Checkbox */}
      {obj.type === "checkbox" && (
        <>
          {field("Etichetta", textInput("label", "Checkbox"))}
          {field("Tag", tagInput("es. pump1.run"))}
          {field("Valore ON",
            <input type="text" style={INPUT} placeholder="true / 1 / testo"
              value={obj.checked_value !== undefined ? String(obj.checked_value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "true" ? true : raw === "false" ? false
                  : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                onChange({ checked_value: v });
              }} />
          )}
          {field("Valore OFF",
            <input type="text" style={INPUT} placeholder="false / 0 / testo"
              value={obj.unchecked_value !== undefined ? String(obj.unchecked_value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "true" ? true : raw === "false" ? false
                  : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                onChange({ unchecked_value: v });
              }} />
          )}
          {field("Solo lettura",
            <input type="checkbox" checked={!!obj.read_only}
              onChange={(e) => onChange({ read_only: e.target.checked })} />
          )}
        </>
      )}

      {/* Radio */}
      {obj.type === "radio" && (
        <>
          {field("Etichetta", textInput("label", "Radio"))}
          {field("Tag", tagInput("es. pump1.mode"))}
          {field("Orientamento",
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.orientation ?? "vertical"}
              onChange={(e) => onChange({ orientation: e.target.value as "horizontal" | "vertical" })}
            >
              <option value="vertical">Verticale</option>
              <option value="horizontal">Orizzontale</option>
            </select>
          )}
          <RadioOptionsEditor
            options={(obj.options as RadioOption[] | undefined) ?? []}
            onChange={(opts) => onChange({ options: opts as SynopticObject["options"] })}
          />
        </>
      )}

      {/* LED */}
      {obj.type === "led" && (
        <>
          {field("Etichetta", textInput("label", ""))}
          {field("Tag", tagInput("es. pump1.run"))}
          {field("Valore ON",
            <input type="text" style={INPUT} placeholder="true / 1 / testo"
              value={obj.on_value !== undefined ? String(obj.on_value) : ""}
              onChange={(e) => {
                const raw = e.target.value;
                const v = raw === "true" ? true : raw === "false" ? false
                  : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                onChange({ on_value: v });
              }} />
          )}
          {field("Colore ON",  colorInput("on_color",  "#22c55e"))}
          {field("Colore OFF", colorInput("off_color", "#374151"))}
        </>
      )}

      {/* Progress bar */}
      {obj.type === "progress_bar" && (
        <>
          {field("Etichetta", textInput("label", ""))}
          {field("Tag", tagInput("es. tank1.level"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div>{numInput("min", 0)}</div>
            <div><div style={LABEL}>Max</div>{numInput("max", 100)}</div>
          </div>
          {field("Unità", textInput("unit", ""))}
          {field("Colore barra", colorInput("fill", "#3b82f6"))}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Warn Low</div>{numInput("warn_low", 0)}</div>
            <div><div style={LABEL}>Warn High</div>{numInput("warn_high", 0)}</div>
            <div><div style={LABEL}>Alarm Low</div>{numInput("alarm_low", 0)}</div>
            <div><div style={LABEL}>Alarm High</div>{numInput("alarm_high", 0)}</div>
          </div>
          {field("Mostra valore",
            <input type="checkbox" checked={!!obj.show_value}
              onChange={(e) => onChange({ show_value: e.target.checked })} />
          )}
        </>
      )}

      {/* Table */}
      {obj.type === "table" && (
        <TableRowsEditor
          rows={(obj.table_rows as TableRow[] | undefined) ?? []}
          onChange={(rows) => onChange({ table_rows: rows as SynopticObject["table_rows"] })}
        />
      )}

      {/* Trend */}
      {obj.type === "trend" && (
        <>
          {field("Tag", tagInput("es. boiler.t"))}
          {field("Finestra (s)", numInput("window_s", 60))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Y min</div>{numInput("y_min", 0)}</div>
            <div><div style={LABEL}>Y max</div>{numInput("y_max", 100)}</div>
          </div>
          <p style={{ fontSize: 10, color: "#475569", margin: "2px 0 0" }}>
            Lascia Y min/max a 0 per autofit.
          </p>
          {field("Colore linea", colorInput("line_color", "#3b82f6"))}
        </>
      )}

      {/* ── Cross-cutting: layer, visibility, event scripts ─────────── */}
      <div style={{ fontSize: 10, color: "#475569", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
        LIVELLO E VISIBILITÀ
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 4, alignItems: "end" }}>
        <div><div style={LABEL}>z-index</div>{numInput("z_index", 0)}</div>
        <button
          title="Porta indietro (-1)"
          onClick={() => onChange({ z_index: (obj.z_index ?? 0) - 1 })}
          style={{ ...INPUT, cursor: "pointer", padding: "3px 8px", height: 26 }}
        >▼</button>
        <button
          title="Porta avanti (+1)"
          onClick={() => onChange({ z_index: (obj.z_index ?? 0) + 1 })}
          style={{ ...INPUT, cursor: "pointer", padding: "3px 8px", height: 26 }}
        >▲</button>
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cbd5e1", marginTop: 4, cursor: "pointer" }}>
        <input
          type="checkbox"
          checked={obj.visible !== false}
          onChange={(e) => onChange({ visible: e.target.checked })}
          style={{ accentColor: "#3b82f6" }}
        />
        Visibile (statico)
      </label>
      <div>
        <div style={LABEL}>Tag visibilità (override)</div>
        <TagInput
          style={INPUT}
          placeholder="es. valvola.aperta"
          value={obj.visible_tag ?? ""}
          onChange={(v) => onChange({ visible_tag: v || undefined })}
        />
      </div>

      <div style={{ fontSize: 10, color: "#475569", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
        EVENTI (PYTHON)
      </div>
      <div>
        <div style={LABEL}>On press</div>
        <textarea
          style={{ ...INPUT, height: 56, fontFamily: "ui-monospace, monospace", fontSize: 11, resize: "vertical" }}
          placeholder='es. tags.write("pump1.run", True)'
          value={obj.on_press ?? ""}
          onChange={(e) => onChange({ on_press: e.target.value || undefined })}
          spellCheck={false}
        />
      </div>
      <div>
        <div style={LABEL}>On release</div>
        <textarea
          style={{ ...INPUT, height: 56, fontFamily: "ui-monospace, monospace", fontSize: 11, resize: "vertical" }}
          placeholder='es. tags.write("pump1.run", False)'
          value={obj.on_release ?? ""}
          onChange={(e) => onChange({ on_release: e.target.value || undefined })}
          spellCheck={false}
        />
      </div>
      <p style={{ fontSize: 10, color: "#475569", margin: "0 0 4px" }}>
        Bindings disponibili: <code>tags.read(id)</code>, <code>tags.write(id, value)</code>, <code>print(...)</code>.
      </p>

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

// ── RadioOptionsEditor ────────────────────────────────────────────────────────

function RadioOptionsEditor({
  options,
  onChange,
}: {
  options: RadioOption[];
  onChange: (opts: RadioOption[]) => void;
}) {
  const update = (i: number, patch: Partial<RadioOption>) =>
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));

  const parseVal = (raw: string): string | number | boolean =>
    raw === "true" ? true : raw === "false" ? false
      : raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) : raw;

  return (
    <div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 4, fontWeight: 700 }}>
        OPZIONI RADIO
      </div>
      {options.map((opt, i) => (
        <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
          <input
            type="text"
            placeholder="Etichetta"
            style={{ ...INPUT, flex: 1 }}
            value={opt.label}
            onChange={(e) => update(i, { label: e.target.value })}
          />
          <input
            type="text"
            placeholder="Valore"
            style={{ ...INPUT, flex: 1 }}
            value={String(opt.value)}
            onChange={(e) => update(i, { value: parseVal(e.target.value) })}
          />
          <button
            style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "0 2px" }}
            onClick={() => onChange(options.filter((_, idx) => idx !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        style={{ ...INPUT, cursor: "pointer", color: "#64748b", borderStyle: "dashed", width: "100%" }}
        onClick={() => onChange([...options, { label: `Opzione ${options.length + 1}`, value: String(options.length + 1) }])}
      >
        + Aggiungi opzione
      </button>
    </div>
  );
}

// ── TableRowsEditor ───────────────────────────────────────────────────────────

function TableRowsEditor({
  rows,
  onChange,
}: {
  rows: TableRow[];
  onChange: (rows: TableRow[]) => void;
}) {
  const update = (i: number, patch: Partial<TableRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 4, fontWeight: 700 }}>
        RIGHE TABELLA
      </div>
      {rows.map((row, i) => (
        <div key={i} style={{ background: "#0f172a", borderRadius: 4, padding: "6px 8px", marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Riga {i + 1}</span>
            <button
              style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 13 }}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
          <div style={LABEL}>Etichetta</div>
          <input type="text" style={{ ...INPUT, marginBottom: 4 }} value={row.label}
            onChange={(e) => update(i, { label: e.target.value })} />
          <div style={LABEL}>Tag</div>
          <div style={{ marginBottom: 4 }}>
            <TagInput
              style={INPUT}
              placeholder="es. pump1.speed"
              value={row.tag}
              onChange={(v) => update(i, { tag: v })}
            />
          </div>
          <div style={LABEL}>Formato</div>
          <input type="text" style={INPUT} placeholder="{value:.1f}" value={row.format ?? ""}
            onChange={(e) => update(i, { format: e.target.value || undefined })} />
        </div>
      ))}
      <button
        style={{ ...INPUT, cursor: "pointer", color: "#64748b", borderStyle: "dashed", width: "100%" }}
        onClick={() => onChange([...rows, { label: `Tag ${rows.length + 1}`, tag: "", format: "{value:.1f}" }])}
      >
        + Aggiungi riga
      </button>
    </div>
  );
}
