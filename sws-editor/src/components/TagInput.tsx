import { useId, useRef, useState } from "react";
import { useAppStore } from "@/store";

interface TagInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

/**
 * Text input with autocomplete suggestions for project-defined tag IDs.
 * Shows a ▾ button that opens a filterable dropdown when tags are available.
 * Free-text entry is always allowed.
 */
export function TagInput({ value, onChange, placeholder, style }: TagInputProps) {
  const listId   = useId();
  const tags     = useAppStore((s) => s.project?.tags ?? []);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen]     = useState(false);
  const [filter, setFilter] = useState("");

  const filtered = tags.filter(
    (t) => !filter || t.id.toLowerCase().includes(filter.toLowerCase())
              || (t.description ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setFilter("");
  };

  return (
    <div style={{ position: "relative", display: "flex", gap: 2 }}>
      <input
        ref={inputRef}
        type="text"
        list={listId}
        style={{ ...style, flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => { onChange(e.target.value); setFilter(e.target.value); }}
        onFocus={() => setFilter(value)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        spellCheck={false}
        autoComplete="off"
      />
      {tags.length > 0 && (
        <button
          type="button"
          style={{
            flexShrink: 0,
            background: "#1e293b",
            border: "1px solid #475569",
            borderRadius: 4,
            color: "#94a3b8",
            cursor: "pointer",
            padding: "0 6px",
            fontSize: 11,
            lineHeight: 1,
          }}
          onClick={() => { setFilter(""); setOpen((o) => !o); inputRef.current?.focus(); }}
          onMouseDown={(e) => e.preventDefault()}
          tabIndex={-1}
          title="Seleziona tag"
        >
          ▾
        </button>
      )}
      {open && tags.length > 0 && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 9999,
            background: "#0f172a",
            border: "1px solid #334155",
            borderRadius: 4,
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            marginTop: 2,
          }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <input
            type="text"
            placeholder="Filtra tag…"
            style={{
              width: "100%",
              background: "#1e293b",
              border: "none",
              borderBottom: "1px solid #334155",
              color: "#e2e8f0",
              padding: "5px 8px",
              fontSize: 11,
              boxSizing: "border-box",
              outline: "none",
            }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            autoFocus
          />
          {filtered.map((t) => (
            <div
              key={t.id}
              style={{ padding: "5px 8px", cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#1e293b"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
              onClick={() => select(t.id)}
            >
              <span style={{ color: "#e2e8f0", fontFamily: "monospace", fontSize: 12 }}>{t.id}</span>
              {t.description && (
                <span style={{ color: "#64748b", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.description}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "#64748b" }}>Nessun tag trovato</div>
          )}
        </div>
      )}
      <datalist id={listId}>
        {tags.map((t) => <option key={t.id} value={t.id}>{t.description}</option>)}
      </datalist>
    </div>
  );
}
