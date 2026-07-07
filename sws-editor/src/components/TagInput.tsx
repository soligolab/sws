import { useEffect, useRef, useState } from "react";
import { useAppStore } from "@/store";

interface TagInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

/**
 * Text input with a ▾ button that opens a filterable tag-picker dropdown.
 * Free-text entry is always allowed.
 */
export function TagInput({ value, onChange, placeholder, style }: TagInputProps) {
  const tags         = useAppStore((s) => s.project?.tags ?? []);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef     = useRef<HTMLInputElement>(null);
  const filterRef    = useRef<HTMLInputElement>(null);
  const [open, setOpen]     = useState(false);
  const [filter, setFilter] = useState("");

  // Close when focus leaves the component entirely.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus the filter input after the dropdown mounts (avoids autoFocus blur race).
  useEffect(() => {
    if (open) filterRef.current?.focus();
  }, [open]);

  const filtered = tags.filter(
    (t) => !filter || t.id.toLowerCase().includes(filter.toLowerCase())
              || (t.description ?? "").toLowerCase().includes(filter.toLowerCase())
  );

  const select = (id: string) => {
    onChange(id);
    setOpen(false);
    setFilter("");
    inputRef.current?.focus();
  };

  return (
    <div ref={containerRef} style={{ position: "relative", display: "flex", gap: 2 }}>
      <input
        ref={inputRef}
        type="text"
        style={{ ...style, flex: 1, minWidth: 0 }}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      {tags.length > 0 && (
        <button
          type="button"
          style={{
            flexShrink: 0,
            background: "var(--brand-surface, #1e293b)",
            border: "1px solid var(--brand-border, #475569)",
            borderRadius: 4,
            color: "var(--brand-text-muted, #94a3b8)",
            cursor: "pointer",
            padding: "0 6px",
            fontSize: 11,
            lineHeight: 1,
          }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => { setFilter(""); setOpen((o) => !o); }}
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
            background: "var(--brand-bg, #0f172a)",
            border: "1px solid var(--brand-surface-2, #334155)",
            borderRadius: 4,
            maxHeight: 200,
            overflowY: "auto",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
            marginTop: 2,
          }}
        >
          <input
            ref={filterRef}
            type="text"
            placeholder="Filtra tag…"
            style={{
              width: "100%",
              background: "var(--brand-surface, #1e293b)",
              border: "none",
              borderBottom: "1px solid var(--brand-surface-2, #334155)",
              color: "var(--brand-text, #e2e8f0)",
              padding: "5px 8px",
              fontSize: 11,
              boxSizing: "border-box",
              outline: "none",
            }}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          />
          {filtered.map((t) => (
            <div
              key={t.id}
              style={{ padding: "5px 8px", cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline" }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--brand-surface, #1e293b)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = ""; }}
              onMouseDown={() => select(t.id)}
            >
              <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace", fontSize: 12 }}>{t.id}</span>
              {t.description && (
                <span style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 11, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {t.description}
                </span>
              )}
            </div>
          ))}
          {filtered.length === 0 && (
            <div style={{ padding: "6px 8px", fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>Nessun tag trovato</div>
          )}
        </div>
      )}
    </div>
  );
}
