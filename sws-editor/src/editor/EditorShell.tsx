import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { SvgCanvas } from "@/canvas/SvgCanvas";
import { LeftPanel } from "@/editor/LeftPanel";
import { FunctionEditor } from "@/editor/FunctionEditor";
import { TagInput } from "@/components/TagInput";
import { BindableInput } from "@/components/BindableInput";
import { useAppStore } from "@/store";
import type { AlignMode } from "@/store";
import type { FunctionDef, RadioOption, SynopticObject, TableRow } from "@/types";

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

// ── SymbolSelect ─────────────────────────────────────────────────────────────
// Dropdown che mostra sia i simboli built-in sia i simboli custom del progetto.

const BUILTIN_SYMBOLS = [
  { id: "pump",              label: "Pompa" },
  { id: "valve",             label: "Valvola" },
  { id: "motor",             label: "Motore" },
  { id: "tank",              label: "Serbatoio" },
  { id: "fan",               label: "Ventola" },
  { id: "compressor",        label: "Compressore" },
  { id: "level_sensor",      label: "Sensore livello" },
  { id: "flow_meter",        label: "Misuratore portata" },
  { id: "pressure_indicator",label: "Indicatore pressione" },
  { id: "breaker",           label: "Interruttore" },
  { id: "mixer",             label: "Miscelatore" },
  { id: "heat_exchanger",    label: "Scambiatore" },
  { id: "separator",         label: "Separatore" },
  { id: "reactor",           label: "Reattore" },
  { id: "filter",            label: "Filtro" },
];

/** Object types that support rotation/flip/opacity in the canvas. */
const SUPPORTS_TRANSFORM = new Set([
  "rect", "ellipse", "text", "image",
  "gauge", "led", "progress_bar", "table",
  "button", "navbutton", "symbol",
]);

function SymbolSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const customSymbols = useAppStore((s) => s.customSymbols);
  return (
    <select style={{ ...INPUT, cursor: "pointer" }} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Libreria built-in">
        {BUILTIN_SYMBOLS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
      </optgroup>
      {customSymbols.length > 0 && (
        <optgroup label="Simboli progetto">
          {customSymbols.map((s) => <option key={s.id} value={`custom:${s.id}`}>{s.label}</option>)}
        </optgroup>
      )}
    </select>
  );
}

// ── EditorShell ───────────────────────────────────────────────────────────────

export function EditorShell() {
  const pages           = useAppStore((s) => s.pages);
  const currentPageId   = useAppStore((s) => s.currentPageId);
  const selectedId      = useAppStore((s) => s.selectedObjectId);
  const selectedIds     = useAppStore((s) => s.selectedObjectIds);
  const selectedFnId    = useAppStore((s) => s.selectedFunctionId);
  const project         = useAppStore((s) => s.project);
  const customSymbols   = useAppStore((s) => s.customSymbols);
  const updateFunction  = useAppStore((s) => s.updateFunction);
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
  const updatePageProps  = useAppStore((s) => s.updatePageProps);
  const saveSerial       = useAppStore((s) => s.saveSerial);
  const saveStatus       = useAppStore((s) => s.saveStatus);
  const storeSaveStatus  = useAppStore((s) => s.setSaveStatus);

  const currentPage = pages.find((p) => p.id === currentPageId);
  const objects     = currentPage?.objects ?? [];
  const selected    = objects.find((o) => o.id === selectedId) ?? null;
  const multi       = selectedIds.length > 1;
  const functions   = project?.functions ?? [];
  const selectedFn  = functions.find((f) => f.id === selectedFnId) ?? null;

  // Persist the whole `project.functions` list to the server. Called by the
  // FunctionEditor's save button and by FunctionsSection's CRUD verbs (so
  // add/rename/delete take effect for the run endpoint without a refresh).
  const persistFunctions = () => {
    const list = useAppStore.getState().project?.functions ?? [];
    api.updateFunctions(list).catch(console.error);
  };

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

  // Persist EVERYTHING in one shot: all synoptic pages + project sections
  // (tags / sources / alarms / functions / custom_symbols). Each section maps
  // to a separate `PUT /api/project/*` endpoint — patch-style on the backend
  // (loads from disk, overwrites one field, rewrites the YAML). Admin-only
  // endpoints are skipped for non-Admin so the call doesn't 403.
  const saveOkTimer = useRef<number | null>(null);

  const handleSave = async () => {
    if (saveStatus === "saving") return;
    if (saveOkTimer.current !== null) {
      window.clearTimeout(saveOkTimer.current);
      saveOkTimer.current = null;
    }
    storeSaveStatus("saving", null);

    const state = useAppStore.getState();
    const role  = state.authRole;
    const isAdmin = role === "Admin";

    const tasks: Promise<unknown>[] = [];
    // Synoptic pages: every page is persisted, not just the current one.
    // Operator+ can write synoptics; Viewer is gated upstream.
    for (const page of state.pages) {
      tasks.push(api.saveSynoptic(page));
    }
    // Project-level sections: admin-only on the server.
    if (isAdmin && state.project) {
      tasks.push(api.updateTags(state.project.tags ?? []));
      tasks.push(api.updateSources(state.project.sources ?? []));
      tasks.push(api.updateAlarms(state.project.alarms ?? []));
      tasks.push(api.updateFunctions(state.project.functions ?? []));
      tasks.push(api.updateCustomSymbols(state.customSymbols ?? []));
    }

    const results = await Promise.allSettled(tasks);
    const failed  = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    if (failed.length === 0) {
      storeSaveStatus("ok");
      saveOkTimer.current = window.setTimeout(() => storeSaveStatus("idle"), 2000);
    } else {
      const msg = failed
        .map((f) => (f.reason instanceof Error ? f.reason.message : String(f.reason)))
        .join("; ");
      storeSaveStatus("error", msg);
    }
  };

  // Respond to save requests from the header dropdown (incSaveSerial).
  useEffect(() => {
    if (saveSerial > 0) handleSave();
  }, [saveSerial]);

  // When a project-level function is selected, take over the whole main
  // area with the full-screen FunctionEditor. The LeftPanel stays on the
  // left (so the user can keep navigating between functions) but canvas
  // and properties panel are hidden.
  const persistFunctionsAsync = async () => {
    const list = useAppStore.getState().project?.functions ?? [];
    await api.updateFunctions(list);
  };

  if (selectedFn) {
    return (
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LeftPanel
          onAddObject={handleAddObject}
          onFunctionsChanged={persistFunctions}
        />
        <FunctionEditor
          fn={selectedFn}
          onPatch={(patch) => updateFunction(selectedFn.id, patch)}
          onPersist={persistFunctionsAsync}
          onClose={() => useAppStore.getState().selectFunction(null)}
        />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left panel: project tree + object palette + settings */}
      <LeftPanel
        onAddObject={handleAddObject}
        onFunctionsChanged={persistFunctions}
      />

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
          customSymbols={customSymbols}
          onSelect={handleSelect}
          onMove={(id, patch) => updateObject(id, patch)}
        />
      </div>

      {/* Properties panel — switches between three views depending on what's
          selected: multiple objects, a single object, or nothing (page). */}
      <aside style={{ ...PANEL, width: 280, borderLeft: "1px solid #334155" }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: 1 }}>
          PROPRIETÀ
        </span>
        {multi ? (
          <MultiSelectionProps
            count={selectedIds.length}
            onAlign={alignSelection}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
            onBind={(prop, tagId) => {
              selectedIds.forEach((id) => {
                const o = objects.find((ob) => ob.id === id);
                if (!o) return;
                if (!tagId) {
                  const next = { ...(o.bindings ?? {}) };
                  delete next[prop];
                  updateObject(id, { bindings: Object.keys(next).length > 0 ? next : undefined });
                } else {
                  updateObject(id, { bindings: { ...(o.bindings ?? {}), [prop]: tagId } });
                }
              });
            }}
            onSetTransitionDuration={(ms) => {
              selectedIds.forEach((id) => {
                updateObject(id, { transition_duration_ms: ms });
              });
            }}
          />
        ) : selected ? (
          <ObjectProps
            obj={selected}
            pages={pages.filter((p) => p.id !== currentPageId)}
            functions={functions}
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
  onBind,
  onSetTransitionDuration,
}: {
  count: number;
  onAlign: (mode: AlignMode) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onBind: (prop: string, tagId: string) => void;
  onSetTransitionDuration: (ms: number | undefined) => void;
}) {
  const [bindProp, setBindProp] = useState("opacity");
  const [bindTag,  setBindTag]  = useState("");
  const [batchTxMs, setBatchTxMs] = useState(300);

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

      <div style={{ height: 1, background: "#334155", margin: "8px 0" }} />

      <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: 0.5 }}>
        BINDING RAPIDO
      </div>
      <p style={{ fontSize: 10, color: "#475569", margin: "2px 0 4px" }}>
        Applica/rimuovi lo stesso binding su tutti gli oggetti selezionati.
      </p>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        <select
          value={bindProp}
          onChange={(e) => setBindProp(e.target.value)}
          style={{ ...btn, flex: "0 0 auto", width: 100, padding: "4px 4px", fontSize: 12 }}
        >
          <option value="opacity">opacity</option>
          <option value="rotation">rotation</option>
          <option value="fill">fill</option>
          <option value="visible">visible</option>
          <option value="x">x</option>
          <option value="y">y</option>
          <option value="width">width</option>
          <option value="height">height</option>
          <option value="label">label</option>
          <option value="color">color</option>
          <option value="text">text</option>
        </select>
        <TagInput
          style={{ flex: 1, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "3px 6px", fontSize: 12 }}
          placeholder="tag…"
          value={bindTag}
          onChange={setBindTag}
        />
      </div>
      <div style={{ display: "flex", gap: 4 }}>
        <button
          style={{ ...btn, background: "#1e3a5f", color: "#93c5fd", borderColor: "#1e40af" }}
          disabled={!bindProp || !bindTag}
          onClick={() => { if (bindProp && bindTag) onBind(bindProp, bindTag); }}
        >
          Applica
        </button>
        <button
          style={{ ...btn, background: "#1e293b", color: "#94a3b8" }}
          disabled={!bindProp}
          onClick={() => { if (bindProp) onBind(bindProp, ""); }}
        >
          Rimuovi
        </button>
      </div>

      <div style={{ height: 1, background: "#334155", margin: "8px 0" }} />

      <div style={{ fontSize: 10, color: "#475569", fontWeight: 700, letterSpacing: 0.5 }}>
        DURATA TRANSIZIONE
      </div>
      <p style={{ fontSize: 10, color: "#475569", margin: "2px 0 4px" }}>
        Applica la stessa durata di animazione (ms) a tutti gli oggetti selezionati. 0 = disattiva.
      </p>
      <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
        <input
          type="number"
          min={0} max={5000} step={50}
          value={batchTxMs}
          onChange={(e) => setBatchTxMs(Number(e.target.value) || 0)}
          style={{ flex: 1, background: "#0f172a", color: "#e2e8f0", border: "1px solid #334155", borderRadius: 4, padding: "3px 6px", fontSize: 12 }}
        />
        <button
          style={{ ...btn, background: "#1e3a5f", color: "#93c5fd", borderColor: "#1e40af", flex: "0 0 auto", padding: "4px 10px" }}
          onClick={() => onSetTransitionDuration(batchTxMs > 0 ? batchTxMs : undefined)}
        >
          Applica
        </button>
        <button
          style={{ ...btn, background: "#1e293b", color: "#94a3b8", flex: "0 0 auto", padding: "4px 10px" }}
          onClick={() => onSetTransitionDuration(undefined)}
        >
          Off
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
  functions,
  onChange,
  onDelete,
}: {
  obj: SynopticObject;
  pages: { id: string; name: string }[];
  functions: FunctionDef[];
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

      {/* Position + Size — usa field() a larghezza piena per evitare overflow
          del pulsante BindableInput nelle celle strette del grid 2-colonne. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
        <div>
          <div style={LABEL}>X</div>
          <BindableInput obj={obj} propName="x" onChange={onChange}>{numInput("x", 0)}</BindableInput>
        </div>
        <div>
          <div style={LABEL}>Y</div>
          <BindableInput obj={obj} propName="y" onChange={onChange}>{numInput("y", 0)}</BindableInput>
        </div>
        {isShape && (
          <>
            <div>
              <div style={LABEL}>W</div>
              <BindableInput obj={obj} propName="width" onChange={onChange}>{numInput("width", 100)}</BindableInput>
            </div>
            <div>
              <div style={LABEL}>H</div>
              <BindableInput obj={obj} propName="height" onChange={onChange}>{numInput("height", 50)}</BindableInput>
            </div>
          </>
        )}
      </div>

      {/* Line endpoint */}
      {obj.type === "line" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 6px" }}>
          <div>
            <div style={LABEL}>X2</div>
            <BindableInput obj={obj} propName="x2" onChange={onChange}>{numInput("x2", obj.x + 100)}</BindableInput>
          </div>
          <div>
            <div style={LABEL}>Y2</div>
            <BindableInput obj={obj} propName="y2" onChange={onChange}>{numInput("y2", obj.y)}</BindableInput>
          </div>
        </div>
      )}

      {/* Fill */}
      {(obj.type === "rect" || obj.type === "ellipse" || obj.type === "button" || obj.type === "navbutton") &&
        field("Colore", <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "#4a90d9")}</BindableInput>)}

      {/* Stroke */}
      {hasStroke && (
        <>
          {field("Bordo", <BindableInput obj={obj} propName="stroke" onChange={onChange}>{colorInput("stroke", "#e2e8f0")}</BindableInput>)}
          {field("Spessore bordo", <BindableInput obj={obj} propName="stroke_width" onChange={onChange}>{numInput("stroke_width", 1)}</BindableInput>)}
        </>
      )}

      {/* Tag binding */}
      {obj.type !== "navbutton" && field("Tag", tagInput("es. pump1.speed"))}

      {/* Text object: static content + typography */}
      {obj.type === "text" && (
        <>
          {field("Testo (statico)", <BindableInput obj={obj} propName="text" onChange={onChange}>{textInput("text", "Es. Temperatura caldaia")}</BindableInput>)}
          {field("Formato (se bound)", <BindableInput obj={obj} propName="format" onChange={onChange}>{textInput("format", "{value:.1f} °C")}</BindableInput>)}
          <p style={{ fontSize: 10, color: "#475569", margin: "0 0 4px" }}>
            Se è impostato un Tag, vince il formato (usa <code>{"{value}"}</code>); altrimenti viene
            mostrato il testo statico.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Dimensione (px)</div><BindableInput obj={obj} propName="font_size" onChange={onChange}>{numInput("font_size", 14)}</BindableInput></div>
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
            <BindableInput obj={obj} propName="font_family" onChange={onChange}>
              <input
                type="text" style={INPUT}
                placeholder="es. system-ui, sans-serif"
                value={obj.font_family ?? ""}
                onChange={(e) => onChange({ font_family: e.target.value || undefined })}
                spellCheck={false}
              />
            </BindableInput>
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
          {field("Colore testo", <BindableInput obj={obj} propName="color" onChange={onChange}>{colorInput("color", "#e2e8f0")}</BindableInput>)}
        </>
      )}

      {/* Button label + write value */}
      {obj.type === "button" && (
        <>
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Bottone")}</BindableInput>)}
          {field("Valore scrittura",
            <BindableInput obj={obj} propName="write_value" onChange={onChange}>
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
            </BindableInput>
          )}
        </>
      )}

      {/* NavButton */}
      {obj.type === "navbutton" && (() => {
        const targetMissing = !!obj.target_page && !pages.some((p) => p.id === obj.target_page);
        return (
          <>
            {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Vai alla pagina")}</BindableInput>)}
            {field("Pagina di destinazione",
              <select
                style={{
                  ...INPUT,
                  cursor: "pointer",
                  borderColor: targetMissing ? "#dc2626" : (INPUT.border ? undefined : "#334155"),
                }}
                value={obj.target_page ?? ""}
                onChange={(e) => onChange({ target_page: e.target.value || undefined })}
              >
                <option value="">— seleziona —</option>
                {pages.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
                {targetMissing && (
                  <option value={obj.target_page} disabled>
                    ⚠ pagina inesistente: {obj.target_page}
                  </option>
                )}
              </select>
            )}
            {targetMissing && (
              <div style={{ fontSize: 11, color: "#fca5a5", marginTop: -4 }}>
                La pagina di destinazione è stata eliminata. Seleziona un'altra pagina o rimuovi il navbutton.
              </div>
            )}
          </>
        );
      })()}

      {/* Gauge */}
      {obj.type === "gauge" && (
        <>
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Gauge")}</BindableInput>)}
          {field("Tag", tagInput("es. pump1.speed"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
          </div>
          {field("Unità", <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Warn Low</div><BindableInput obj={obj} propName="warn_low" onChange={onChange}>{numInput("warn_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>Warn High</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>Alarm Low</div><BindableInput obj={obj} propName="alarm_low" onChange={onChange}>{numInput("alarm_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>Alarm High</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
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
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
            <div><div style={LABEL}>Step</div><BindableInput obj={obj} propName="step" onChange={onChange}>{numInput("step", 1)}</BindableInput></div>
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
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Checkbox")}</BindableInput>)}
          {field("Tag", tagInput("es. pump1.run"))}
          {field("Valore ON",
            <BindableInput obj={obj} propName="checked_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder="true / 1 / testo"
                value={obj.checked_value !== undefined ? String(obj.checked_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ checked_value: v });
                }} />
            </BindableInput>
          )}
          {field("Valore OFF",
            <BindableInput obj={obj} propName="unchecked_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder="false / 0 / testo"
                value={obj.unchecked_value !== undefined ? String(obj.unchecked_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ unchecked_value: v });
                }} />
            </BindableInput>
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
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "Radio")}</BindableInput>)}
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
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "")}</BindableInput>)}
          {field("Tag", tagInput("es. pump1.run"))}
          {field("Valore ON",
            <BindableInput obj={obj} propName="on_value" onChange={onChange}>
              <input type="text" style={INPUT} placeholder="true / 1 / testo"
                value={obj.on_value !== undefined ? String(obj.on_value) : ""}
                onChange={(e) => {
                  const raw = e.target.value;
                  const v = raw === "true" ? true : raw === "false" ? false
                    : isNaN(Number(raw)) || raw.trim() === "" ? raw : Number(raw);
                  onChange({ on_value: v });
                }} />
            </BindableInput>
          )}
          {field("Colore ON",  <BindableInput obj={obj} propName="on_color" onChange={onChange}>{colorInput("on_color",  "#22c55e")}</BindableInput>)}
          {field("Colore OFF", <BindableInput obj={obj} propName="off_color" onChange={onChange}>{colorInput("off_color", "#374151")}</BindableInput>)}
        </>
      )}

      {/* Progress bar */}
      {obj.type === "progress_bar" && (
        <>
          {field("Etichetta", <BindableInput obj={obj} propName="label" onChange={onChange}>{textInput("label", "")}</BindableInput>)}
          {field("Tag", tagInput("es. tank1.level"))}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Min</div><BindableInput obj={obj} propName="min" onChange={onChange}>{numInput("min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Max</div><BindableInput obj={obj} propName="max" onChange={onChange}>{numInput("max", 100)}</BindableInput></div>
          </div>
          {field("Unità", <BindableInput obj={obj} propName="unit" onChange={onChange}>{textInput("unit", "")}</BindableInput>)}
          {field("Colore barra", <BindableInput obj={obj} propName="fill" onChange={onChange}>{colorInput("fill", "#3b82f6")}</BindableInput>)}
          <div style={{ fontSize: 10, color: "#475569", marginTop: 4, marginBottom: 2, fontWeight: 700 }}>SOGLIE</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Warn Low</div><BindableInput obj={obj} propName="warn_low" onChange={onChange}>{numInput("warn_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>Warn High</div><BindableInput obj={obj} propName="warn_high" onChange={onChange}>{numInput("warn_high", 0)}</BindableInput></div>
            <div><div style={LABEL}>Alarm Low</div><BindableInput obj={obj} propName="alarm_low" onChange={onChange}>{numInput("alarm_low", 0)}</BindableInput></div>
            <div><div style={LABEL}>Alarm High</div><BindableInput obj={obj} propName="alarm_high" onChange={onChange}>{numInput("alarm_high", 0)}</BindableInput></div>
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
          {field("Finestra (s)", <BindableInput obj={obj} propName="window_s" onChange={onChange}>{numInput("window_s", 60)}</BindableInput>)}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><div style={LABEL}>Y min</div><BindableInput obj={obj} propName="y_min" onChange={onChange}>{numInput("y_min", 0)}</BindableInput></div>
            <div><div style={LABEL}>Y max</div><BindableInput obj={obj} propName="y_max" onChange={onChange}>{numInput("y_max", 100)}</BindableInput></div>
          </div>
          <p style={{ fontSize: 10, color: "#475569", margin: "2px 0 0" }}>
            Lascia Y min/max a 0 per autofit.
          </p>
          {field("Colore linea principale", <BindableInput obj={obj} propName="line_color" onChange={onChange}>{colorInput("line_color", "#3b82f6")}</BindableInput>)}

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

      {/* Image (external URL) */}
      {obj.type === "image" && (
        <>
          {field("URL immagine",
            <BindableInput obj={obj} propName="src" onChange={onChange}>
              <input
                style={INPUT} placeholder="https://… o /symbols/…"
                value={obj.src ?? ""}
                onChange={(e) => onChange({ src: e.target.value || undefined })}
              />
            </BindableInput>
          )}
        </>
      )}

      {/* Symbol (built-in SCADA library + custom project symbols) */}
      {obj.type === "symbol" && (
        <>
          {field("Simbolo",
            <SymbolSelect value={obj.symbol_id ?? "pump"} onChange={(v) => onChange({ symbol_id: v as any })} />
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
          {field("Colore OFF",   <BindableInput obj={obj} propName="state_off_color"   onChange={onChange}>{colorInput("state_off_color",   "#64748b")}</BindableInput>)}
          {field("Colore ON",    <BindableInput obj={obj} propName="state_on_color"    onChange={onChange}>{colorInput("state_on_color",    "#22c55e")}</BindableInput>)}
          {field("Colore ALARM", <BindableInput obj={obj} propName="state_alarm_color" onChange={onChange}>{colorInput("state_alarm_color", "#ef4444")}</BindableInput>)}
        </>
      )}

      {/* ── Cross-cutting: rotation / flip / opacity ──────────────── */}
      {SUPPORTS_TRANSFORM.has(obj.type) && (
        <>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            TRASFORMAZIONE
          </div>
          {field("Rotazione (gradi)",
            <BindableInput obj={obj} propName="rotation" onChange={onChange}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="range"
                  min={-180} max={180} step={1}
                  value={obj.rotation ?? 0}
                  onChange={(e) => onChange({ rotation: Number(e.target.value) || 0 })}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  value={obj.rotation ?? 0}
                  onChange={(e) => onChange({ rotation: Number(e.target.value) || 0 })}
                  style={{ ...INPUT, width: 64 }}
                />
                <button
                  title="Resetta a 0°"
                  onClick={() => onChange({ rotation: undefined })}
                  style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
                >↺</button>
              </div>
            </BindableInput>
          )}
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!obj.flip_h}
                onChange={(e) => onChange({ flip_h: e.target.checked || undefined })}
                style={{ accentColor: "#3b82f6" }}
              />
              Flip orizzontale
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#cbd5e1", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={!!obj.flip_v}
                onChange={(e) => onChange({ flip_v: e.target.checked || undefined })}
                style={{ accentColor: "#3b82f6" }}
              />
              Flip verticale
            </label>
          </div>
          {field("Opacità (0–1)",
            <BindableInput obj={obj} propName="opacity" onChange={onChange}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                <input
                  type="range"
                  min={0} max={1} step={0.05}
                  value={obj.opacity ?? 1}
                  onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                  style={{ flex: 1 }}
                />
                <input
                  type="number"
                  min={0} max={1} step={0.05}
                  value={obj.opacity ?? 1}
                  onChange={(e) => onChange({ opacity: Number(e.target.value) })}
                  style={{ ...INPUT, width: 64 }}
                />
                <button
                  title="Resetta a 1"
                  onClick={() => onChange({ opacity: undefined })}
                  style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
                >↺</button>
              </div>
            </BindableInput>
          )}
          {field("Durata transizione (ms)",
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input
                type="range"
                min={0} max={2000} step={50}
                value={obj.transition_duration_ms ?? 0}
                onChange={(e) => onChange({ transition_duration_ms: Number(e.target.value) || undefined })}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                min={0} max={5000} step={50}
                value={obj.transition_duration_ms ?? 0}
                onChange={(e) => onChange({ transition_duration_ms: Number(e.target.value) || undefined })}
                style={{ ...INPUT, width: 64 }}
              />
              <button
                title="Disattiva animazione"
                onClick={() => onChange({ transition_duration_ms: undefined })}
                style={{ ...INPUT, cursor: "pointer", padding: "3px 6px", width: 28 }}
              >↺</button>
            </div>
          )}
          <p style={{ fontSize: 10, color: "#475569", margin: "0 0 4px" }}>
            0 = nessuna animazione. Anima fill/stroke/opacity/rotazione bindati. Testo, font-size, src e geometrie restano discreti.
          </p>
        </>
      )}

      {/* ── Cross-cutting: layer, visibility, event scripts ─────────── */}
      <div style={{ fontSize: 10, color: "#475569", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
        LIVELLO E VISIBILITÀ
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 4, alignItems: "end" }}>
        <div><div style={LABEL}>z-index</div><BindableInput obj={obj} propName="z_index" onChange={onChange}>{numInput("z_index", 0)}</BindableInput></div>
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
        EVENTI (FUNZIONI)
      </div>
      <EventFunctionPicker
        label="On press"
        fnName={obj.on_press_fn}
        args={obj.on_press_args}
        functions={functions}
        onChange={(fn, args) => onChange({ on_press_fn: fn, on_press_args: args })}
      />
      <EventFunctionPicker
        label="On release"
        fnName={obj.on_release_fn}
        args={obj.on_release_args}
        functions={functions}
        onChange={(fn, args) => onChange({ on_release_fn: fn, on_release_args: args })}
      />
      <p style={{ fontSize: 10, color: "#475569", margin: "0 0 4px" }}>
        Definisci le funzioni nel pannello laterale (sezione FUNZIONI). I valori
        dei parametri sono sostituiti per binding; lascia vuoto per usare il default.
      </p>

      {/* ── Binding attivi (audit) ───────────────────────────────────── */}
      {obj.bindings && Object.keys(obj.bindings).length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "#475569", marginTop: 8, marginBottom: 2, fontWeight: 700, letterSpacing: 0.5 }}>
            BINDING ATTIVI
          </div>
          {Object.entries(obj.bindings).map(([prop, tagId]) => (
            <div key={prop} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, marginBottom: 2 }}>
              <span style={{ color: "#64748b", flex: "0 0 auto" }}>{prop}</span>
              <span style={{ color: "#475569" }}>→</span>
              <span style={{ color: "#3b82f6", flex: 1 }}>{tagId || "(nessun tag)"}</span>
              <button
                title="Rimuovi binding"
                onClick={() => {
                  const next = { ...obj.bindings! };
                  delete next[prop];
                  onChange({ bindings: Object.keys(next).length > 0 ? next : undefined });
                }}
                style={{ ...LABEL, cursor: "pointer", background: "transparent", border: "none", color: "#ef4444", padding: "0 4px" }}
              >×</button>
            </div>
          ))}
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

// ── EventFunctionPicker ───────────────────────────────────────────────────────
// Per-event row in ObjectProps: a select for the function name + one input
// row per declared parameter, bound to the on_*_args record on the object.

function EventFunctionPicker({
  label,
  fnName,
  args,
  functions,
  onChange,
}: {
  label: string;
  fnName: string | undefined;
  args: Record<string, string | number | boolean> | undefined;
  functions: FunctionDef[];
  onChange: (
    fn: string | undefined,
    args: Record<string, string | number | boolean> | undefined,
  ) => void;
}) {
  const fn = functions.find((f) => f.name === fnName);

  const setArg = (paramName: string, raw: string) => {
    const v: string | number | boolean =
      raw === "true"  ? true :
      raw === "false" ? false :
      raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) :
      raw;
    const next = { ...(args ?? {}), [paramName]: v };
    onChange(fnName, next);
  };

  return (
    <div style={{ marginBottom: 6 }}>
      <div style={LABEL}>{label}</div>
      <select
        style={{ ...INPUT, cursor: "pointer" }}
        value={fnName ?? ""}
        onChange={(e) => {
          const v = e.target.value || undefined;
          // Clear args when the function changes — old keys probably don't apply.
          onChange(v, v ? undefined : undefined);
        }}
      >
        <option value="">— nessuna —</option>
        {functions.map((f) => (
          <option key={f.id} value={f.name}>{f.name}</option>
        ))}
      </select>
      {fn && fn.params.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 6, borderLeft: "2px solid #334155" }}>
          {fn.params.map((p) => {
            const v = (args ?? {})[p.name];
            return (
              <div key={p.name} style={{ marginTop: 2 }}>
                <div style={{ ...LABEL, fontSize: 10 }}>
                  {p.name}
                  {p.default !== undefined && (
                    <span style={{ color: "#475569" }}> (default: {String(p.default)})</span>
                  )}
                </div>
                <input
                  type="text"
                  style={{ ...INPUT, fontSize: 12 }}
                  placeholder={p.default !== undefined ? String(p.default) : ""}
                  value={v === undefined ? "" : String(v)}
                  onChange={(e) => setArg(p.name, e.target.value)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// FunctionEditor moved out to its own file. Imported at the top of this file.
