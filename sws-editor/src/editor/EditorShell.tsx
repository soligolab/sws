import { useEffect } from "react";
import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { LeftPanel } from "@/editor/LeftPanel";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import type { AlignMode } from "@/store";
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
  const selectedIds     = useAppStore((s) => s.selectedObjectIds);
  const tagValues       = useAppStore((s) => s.tagValues);
  const gridSize        = useAppStore((s) => s.gridSize);
  const snapEnabled     = useAppStore((s) => s.snapEnabled);
  const addObject       = useAppStore((s) => s.addObject);
  const updateObject    = useAppStore((s) => s.updateObject);
  const deleteObject    = useAppStore((s) => s.deleteObject);
  const deleteSelection = useAppStore((s) => s.deleteSelection);
  const selectObject    = useAppStore((s) => s.selectObject);
  const toggleSelection = useAppStore((s) => s.toggleSelection);
  const duplicateSelection = useAppStore((s) => s.duplicateSelection);
  const copySelection   = useAppStore((s) => s.copySelection);
  const pasteClipboard  = useAppStore((s) => s.pasteClipboard);
  const alignSelection  = useAppStore((s) => s.alignSelection);
  const undo            = useAppStore((s) => s.undo);
  const redo            = useAppStore((s) => s.redo);
  const updatePageProps = useAppStore((s) => s.updatePageProps);

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];
  const selected    = objects.find((o) => o.id === selectedId) ?? null;
  const multi       = selectedIds.length > 1;

  const handleSelect = (id: string | null, shift?: boolean) => {
    if (id === null) { selectObject(null); return; }
    if (shift) toggleSelection(id);
    else       selectObject(id);
  };

  // Document-level keyboard shortcuts. Skipped when typing in a form field
  // so renaming an object doesn't trigger delete-on-backspace.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? "";
      const inField = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
      if (inField) return;
      const ctrl = e.ctrlKey || e.metaKey;
      const ids  = useAppStore.getState().selectedObjectIds;
      if ((e.key === "Delete" || e.key === "Backspace") && ids.length > 0) {
        e.preventDefault(); deleteSelection();
      } else if (ctrl && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
        e.preventDefault(); undo();
      } else if ((ctrl && (e.key === "y" || e.key === "Y")) ||
                 (ctrl && e.shiftKey && (e.key === "z" || e.key === "Z"))) {
        e.preventDefault(); redo();
      } else if (ctrl && (e.key === "c" || e.key === "C") && ids.length > 0) {
        e.preventDefault(); copySelection();
      } else if (ctrl && (e.key === "v" || e.key === "V")) {
        e.preventDefault(); pasteClipboard();
      } else if (ctrl && (e.key === "d" || e.key === "D") && ids.length > 0) {
        e.preventDefault(); duplicateSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [deleteSelection, undo, redo, copySelection, pasteClipboard, duplicateSelection]);

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
        addObject({ type, x, y: y + 14, text: "Testo", font_size: 14, color: "#e2e8f0", text_anchor: "start" });
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
      case "symbol":
        addObject({ type, x, y, width: 80, height: 80,
          symbol_id: "pump",
          state_off_color: "#64748b", state_on_color: "#22c55e", state_alarm_color: "#ef4444" });
        break;
    }
  };

  const handleSave = () => {
    if (currentPage) api.saveSynoptic(currentPage).catch(console.error);
  };

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left panel: project tree + object palette + settings */}
      <LeftPanel onAddObject={handleAddObject} onSave={handleSave} />

      {/* Canvas */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        <SvgCanvas
          objects={objects}
          tagValues={tagValues}
          background={currentPage?.background}
          selectedId={selectedId}
          selectedIds={selectedIds}
          gridSize={gridSize}
          snapEnabled={snapEnabled}
          onSelect={handleSelect}
          onMove={(id, patch) => updateObject(id, patch)}
        />
      </div>

      {/* Properties panel */}
      <aside style={{ ...PANEL, width: 240, borderLeft: "1px solid #334155" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>
          PROPRIETÀ
        </span>
        {multi ? (
          <MultiSelectionProps
            count={selectedIds.length}
            onAlign={alignSelection}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
          />
        ) : selected ? (
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

// ── Multi-selection properties (alignment toolbar) ────────────────────────────

function MultiSelectionProps({
  count,
  onAlign,
  onDuplicate,
  onDelete,
}: {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const btn: React.CSSProperties = {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: 4,
    color: "#cbd5e1",
    cursor: "pointer",
    fontSize: 13,
    padding: "6px 0",
    flex: 1,
  };
  return (
    <>
      <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>
        Selezione multipla
      </div>
      <div style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 4 }}>
        {count} oggetti selezionati
      </div>

      <div style={{ fontSize: 10, color: "#475569", marginTop: 4, fontWeight: 700, letterSpacing: 0.5 }}>
        ALLINEA ORIZZONTALE
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title="Allinea a sinistra"   onClick={() => onAlign("left")}>⇤</button>
        <button style={btn} title="Centra orizzontale"   onClick={() => onAlign("center-x")}>↔</button>
        <button style={btn} title="Allinea a destra"     onClick={() => onAlign("right")}>⇥</button>
      </div>

      <div style={{ fontSize: 10, color: "#475569", marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>
        ALLINEA VERTICALE
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title="Allinea in alto"      onClick={() => onAlign("top")}>⤒</button>
        <button style={btn} title="Centra verticale"     onClick={() => onAlign("middle-y")}>↕</button>
        <button style={btn} title="Allinea in basso"     onClick={() => onAlign("bottom")}>⤓</button>
      </div>

      <div style={{ fontSize: 10, color: "#475569", marginTop: 6, fontWeight: 700, letterSpacing: 0.5 }}>
        DISTRIBUISCI (≥3 oggetti)
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button style={btn} title="Distribuisci orizzontale" onClick={() => onAlign("distribute-x")}>⇔</button>
        <button style={btn} title="Distribuisci verticale"   onClick={() => onAlign("distribute-y")}>⇕</button>
      </div>

      <div style={{ height: 1, background: "#334155", margin: "8px 0" }} />

      <div style={{ display: "flex", gap: 4 }}>
        <button style={{ ...btn, background: "#1e3a8a", color: "#bfdbfe" }} onClick={onDuplicate}>
          Duplica
        </button>
        <button style={{ ...btn, background: "#7f1d1d", color: "#fca5a5", borderColor: "#991b1b" }} onClick={onDelete}>
          Elimina
        </button>
      </div>

      <p style={{ fontSize: 10, color: "#475569", marginTop: 8 }}>
        Shift+click per aggiungere/togliere dalla selezione. Ctrl-C/V, Ctrl-D,
        Ctrl-Z/Y, Canc come scorciatoie.
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

  const BOX_TYPES = ["rect", "ellipse", "button", "navbutton", "checkbox", "radio", "slider", "gauge", "led", "progress_bar", "table", "trend", "symbol"];
  const isShape = BOX_TYPES.includes(obj.type);
  const hasStroke = obj.type === "rect" || obj.type === "ellipse" || obj.type === "line";

  return (
    <>
      {field("Nome",
        <input
          type="text" style={INPUT}
          placeholder={obj.type}
          value={obj.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value || undefined })}
        />
      )}
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

      {/* Text object: static content + typography */}
      {obj.type === "text" && (
        <>
          {field("Testo (statico)", textInput("text", "Es. Temperatura caldaia"))}
          {field("Formato (se bound)", textInput("format", "{value:.1f} °C"))}
          <p style={{ fontSize: 10, color: "#475569", margin: "0 0 4px" }}>
            Se è impostato un Tag, vince il formato (usa <code>{"{value}"}</code>); altrimenti viene
            mostrato il testo statico.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Dimensione (px)</div>{numInput("font_size", 14)}</div>
            <div>
              <div style={LABEL}>Allineamento</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.text_anchor ?? "start"}
                onChange={(e) => onChange({ text_anchor: e.target.value as "start" | "middle" | "end" })}
              >
                <option value="start">Sinistra</option>
                <option value="middle">Centro</option>
                <option value="end">Destra</option>
              </select>
            </div>
          </div>
          {field("Font family",
            <input
              type="text" style={INPUT}
              placeholder="es. system-ui, sans-serif"
              value={obj.font_family ?? ""}
              onChange={(e) => onChange({ font_family: e.target.value || undefined })}
              spellCheck={false}
            />
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div>
              <div style={LABEL}>Peso</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={String(obj.font_weight ?? "normal")}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = Number(v);
                  onChange({ font_weight: Number.isFinite(n) && v.match(/^\d+$/) ? n : v });
                }}
              >
                <option value="normal">Normal (400)</option>
                <option value="bold">Bold (700)</option>
                <option value="300">300</option>
                <option value="500">500</option>
                <option value="600">600</option>
                <option value="800">800</option>
              </select>
            </div>
            <div>
              <div style={LABEL}>Stile</div>
              <select
                style={{ ...INPUT, cursor: "pointer" }}
                value={obj.font_style ?? "normal"}
                onChange={(e) => onChange({ font_style: e.target.value as "normal" | "italic" })}
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>
          {field("Colore testo", colorInput("color", "#e2e8f0"))}
        </>
      )}

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
          {field("Colore linea principale", colorInput("line_color", "#3b82f6"))}

          {/* Multi-tag overlay: extra series share the same axes */}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 6, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            ALTRI TAG (OVERLAY)
          </div>
          {(obj.extra_tags ?? []).map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
              <TagInput
                style={{ ...INPUT, flex: 1 }}
                placeholder="es. boiler.pressure"
                value={t}
                onChange={(v) => {
                  const next = [...(obj.extra_tags ?? [])];
                  next[i] = v;
                  onChange({ extra_tags: next });
                }}
              />
              <button
                title="Rimuovi"
                style={{ background: "transparent", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "0 4px" }}
                onClick={() => {
                  const next = (obj.extra_tags ?? []).filter((_, j) => j !== i);
                  onChange({ extra_tags: next.length ? next : undefined });
                }}
              >×</button>
            </div>
          ))}
          <button
            style={{ ...INPUT, cursor: "pointer", color: "#64748b", borderStyle: "dashed", width: "100%" }}
            onClick={() => onChange({ extra_tags: [...(obj.extra_tags ?? []), ""] })}
          >
            + Aggiungi tag
          </button>
        </>
      )}

      {/* Symbol (built-in SCADA library) */}
      {obj.type === "symbol" && (
        <>
          {field("Simbolo",
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={obj.symbol_id ?? "pump"}
              onChange={(e) => onChange({ symbol_id: e.target.value as any })}
            >
              <option value="pump">Pompa</option>
              <option value="valve">Valvola</option>
              <option value="motor">Motore</option>
              <option value="tank">Serbatoio</option>
              <option value="fan">Ventola</option>
            </select>
          )}
          {field("Tag stato (truthy → ON)",
            <TagInput
              style={INPUT} placeholder="es. pump1.running"
              value={obj.state_tag ?? ""}
              onChange={(v) => onChange({ state_tag: v || undefined })}
            />
          )}
          {field("Tag allarme (truthy → ALARM)",
            <TagInput
              style={INPUT} placeholder="es. pump1.fault"
              value={obj.alarm_tag ?? ""}
              onChange={(v) => onChange({ alarm_tag: v || undefined })}
            />
          )}
          {field("Colore OFF",   colorInput("state_off_color",   "#64748b"))}
          {field("Colore ON",    colorInput("state_on_color",    "#22c55e"))}
          {field("Colore ALARM", colorInput("state_alarm_color", "#ef4444"))}
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
