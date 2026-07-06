import { useEffect, useRef, useState } from "react";
import { PythonEditor, type PythonEditorHandle } from "@/components/PythonEditor";
import type { FunctionDef } from "@/types";

interface FunctionEditorProps {
  fn: FunctionDef;
  onPatch: (patch: Partial<FunctionDef>) => void;
  onPersist: () => Promise<void> | void;
  /** Close the editor and return to the canvas view (clears selectedFunctionId). */
  onClose: () => void;
}

/**
 * Full-screen pane for editing a project-level Python FunctionDef.
 * Sits at the bottom of EditorShell when `selectedFunctionId` is set,
 * taking over the canvas + right-properties area.
 *
 * Tracks a "dirty" flag locally (last saved snapshot) so the Save button
 * reflects whether there are pending changes. The actual function state
 * still lives in the Zustand store — onPatch updates it on every keystroke
 * and onPersist (Salva) flushes the whole project.functions list to the
 * server. We also debounce the body changes into the store at a moderate
 * cadence to avoid an update-per-keystroke storm.
 */
export function FunctionEditor({ fn, onPatch, onPersist, onClose }: FunctionEditorProps) {
  const editorRef = useRef<PythonEditorHandle | null>(null);

  // Snapshot of the function as last saved to the server. Stored as a
  // JSON string so deep comparison is cheap and survives params reorder.
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => JSON.stringify(fn));
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  // When the user picks a different function from the sidebar, reset the
  // dirty baseline so we don't show the new one as already-modified.
  useEffect(() => {
    setSavedSnapshot(JSON.stringify(fn));
    setError(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fn.id]);

  const isDirty = savedSnapshot !== JSON.stringify(fn);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onPersist();
      setSavedSnapshot(JSON.stringify(fn));
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setSaving(false);
    }
  };

  const setParam = (idx: number, patch: Partial<{ name: string; default: string | number | boolean | undefined }>) => {
    const next = fn.params.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    onPatch({ params: next });
  };
  const addParam    = () => onPatch({ params: [...fn.params, { name: `arg${fn.params.length + 1}` }] });
  const removeParam = (idx: number) => onPatch({ params: fn.params.filter((_, i) => i !== idx) });

  const insertSnippet = (key: keyof typeof SNIPPETS) => {
    editorRef.current?.insertAtCursor(SNIPPETS[key]);
  };

  return (
    <div style={{
      flex: 1,
      display: "flex",
      flexDirection: "column",
      background: "var(--brand-bg, #0f172a)",
      color: "var(--brand-text, #e2e8f0)",
      minWidth: 0,
    }}>
      {/* Header: title + close */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "var(--brand-surface, #1e293b)",
        borderBottom: "1px solid var(--brand-surface-2, #334155)",
        flexShrink: 0,
      }}>
        <strong style={{ fontSize: 14, letterSpacing: 0.3 }}>Funzione Python</strong>
        <code style={{ color: "#22c55e", fontSize: 12 }}>{fn.name || "(senza nome)"}</code>
        {isDirty && (
          <span style={{ color: "#fbbf24", fontSize: 11, fontWeight: 600 }}>● modifiche non salvate</span>
        )}
        <div style={{ flex: 1 }} />
        <select
          style={SELECT_STYLE}
          value=""
          onChange={(e) => {
            const k = e.target.value as keyof typeof SNIPPETS | "";
            if (k) insertSnippet(k);
            e.target.value = "";
          }}
        >
          <option value="">Inserisci template…</option>
          <option value="increment">Incremento tag</option>
          <option value="toggle">Toggle booleano</option>
          <option value="conditional">Scrittura condizionale</option>
          <option value="reset_many">Reset multi-tag</option>
          <option value="diagnostic">Diagnostico (print)</option>
          <option value="skeleton">Scheletro con parametri</option>
        </select>
        <button
          onClick={handleSave}
          disabled={saving || !isDirty}
          style={{
            background: isDirty ? "#166534" : "var(--brand-surface-2, #334155)",
            color:      isDirty ? "#bbf7d0" : "var(--brand-text-muted, #94a3b8)",
            border: `1px solid ${isDirty ? "#15803d" : "var(--brand-border, #475569)"}`,
            borderRadius: 4,
            padding: "5px 14px",
            cursor: saving || !isDirty ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {saving ? "Salvataggio…" : "Salva funzioni"}
        </button>
        <button
          onClick={onClose}
          title="Chiudi (torna al canvas)"
          style={{
            background: "var(--brand-surface-2, #334155)",
            color: "var(--brand-text-2, #cbd5e1)",
            border: "1px solid var(--brand-border, #475569)",
            borderRadius: 4,
            padding: "5px 10px",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Chiudi
        </button>
      </div>

      {/* Inline error banner */}
      {error && (
        <div style={{
          padding: "6px 16px",
          background: "#7f1d1d33",
          borderBottom: "1px solid #7f1d1d",
          color: "#fca5a5",
          fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Two-column body: metadata + params on the left, code on the right */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        {/* Left: metadata + params */}
        <aside style={{
          width: 280,
          padding: 14,
          borderRight: "1px solid var(--brand-surface-2, #334155)",
          background: "var(--brand-bg, #0f172a)",
          overflowY: "auto",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}>
          <div>
            <label style={LABEL_STYLE}>Nome</label>
            <input
              type="text"
              style={INPUT_STYLE}
              value={fn.name}
              onChange={(e) => onPatch({ name: e.target.value })}
              spellCheck={false}
            />
          </div>
          <div>
            <label style={LABEL_STYLE}>Descrizione (opz.)</label>
            <input
              type="text"
              style={INPUT_STYLE}
              value={fn.description ?? ""}
              onChange={(e) => onPatch({ description: e.target.value || undefined })}
            />
          </div>

          <div style={{ marginTop: 4, fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5 }}>
            PARAMETRI
          </div>
          {fn.params.length === 0 && (
            <p style={{ fontSize: 11, color: "var(--brand-border, #475569)", margin: 0 }}>
              Nessun parametro. La funzione si chiama "nuda".
            </p>
          )}
          {fn.params.map((p, i) => {
            const defStr = p.default === undefined ? "" : String(p.default);
            return (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 4 }}>
                <input
                  type="text"
                  placeholder="nome"
                  style={{ ...INPUT_STYLE, fontSize: 12 }}
                  value={p.name}
                  onChange={(e) => setParam(i, { name: e.target.value })}
                  spellCheck={false}
                />
                <input
                  type="text"
                  placeholder="default (opz.)"
                  style={{ ...INPUT_STYLE, fontSize: 12 }}
                  value={defStr}
                  onChange={(e) => {
                    const raw = e.target.value;
                    if (raw === "") { setParam(i, { default: undefined }); return; }
                    const v: string | number | boolean =
                      raw === "true"  ? true :
                      raw === "false" ? false :
                      raw.trim() !== "" && !isNaN(Number(raw)) ? Number(raw) :
                      raw;
                    setParam(i, { default: v });
                  }}
                />
                <button
                  style={{
                    background: "transparent", border: "none",
                    color: "#ef4444", cursor: "pointer", fontSize: 14, padding: "0 4px",
                  }}
                  onClick={() => removeParam(i)}
                  title="Rimuovi parametro"
                >×</button>
              </div>
            );
          })}
          <button
            style={{ ...INPUT_STYLE, cursor: "pointer", color: "#64748b", borderStyle: "dashed", textAlign: "left" }}
            onClick={addParam}
          >
            + Aggiungi parametro
          </button>

          <p style={{ fontSize: 10, color: "var(--brand-border, #475569)", margin: "8px 0 0" }}>
            Bindings: <code>tags.read(id)</code>, <code>tags.write(id, value)</code>, <code>print(...)</code>.
            I parametri della funzione sono disponibili come variabili globali nel corpo Python.
          </p>
        </aside>

        {/* Right: Python editor takes the rest */}
        <div style={{ flex: 1, padding: 14, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <label style={{ ...LABEL_STYLE, marginBottom: 6 }}>Codice Python</label>
          <div style={{ flex: 1, minHeight: 0 }}>
            <PythonEditor
              ref={editorRef}
              value={fn.code}
              onChange={(next) => onPatch({ code: next })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4,
};
const INPUT_STYLE: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "5px 8px",
  fontSize: 13,
  boxSizing: "border-box",
};
const SELECT_STYLE: React.CSSProperties = {
  ...INPUT_STYLE,
  width: "auto",
  padding: "4px 8px",
  cursor: "pointer",
  fontSize: 12,
};

/**
 * Pre-baked Python snippets. The "Inserisci template…" dropdown drops these
 * at the current cursor position. Keep them short, sandbox-friendly
 * (RestrictedPython rejects imports, exec/eval, dunders), and demo-relevant.
 */
const SNIPPETS = {
  increment:
`# Increment a numeric tag by 1.
v = tags.read("counter") or 0
tags.write("counter", v + 1)
`,
  toggle:
`# Toggle a boolean tag.
tags.write("light", not (tags.read("light") or False))
`,
  conditional:
`# Write B only when A is over the threshold.
a = tags.read("input_a") or 0
if a > 50:
    tags.write("alarm_active", True)
else:
    tags.write("alarm_active", False)
`,
  reset_many:
`# Reset a list of tags to 0.
for t in ("counter", "errors", "downtime_min"):
    tags.write(t, 0)
`,
  diagnostic:
`# Diagnostic: print current values to the runtime stdout / browser console.
for t in ("counter", "pump.running"):
    print(t, "=", tags.read(t))
`,
  skeleton:
`# Function skeleton with declared parameters.
# Declare params in the left panel (e.g. tag="counter", step=1) and they
# show up as plain Python globals here.
v = tags.read(tag) or 0
tags.write(tag, v + step)
print(f"{tag}: {v} -> {v + step}")
`,
};
