import { TagInput } from "@/components/TagInput";
import type { SynopticObject } from "@/types";

const BTN: React.CSSProperties = {
  background: "#0f172a",
  color: "#94a3b8",
  border: "1px solid #334155",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 13,
  cursor: "pointer",
  flexShrink: 0,
  lineHeight: 1,
};

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

interface Props {
  obj: SynopticObject;
  propName: string;
  onChange: (patch: Partial<SynopticObject>) => void;
  children: React.ReactNode;
}

/**
 * Wraps a static property editor with a tag-binding toggle.
 * 🔓 button → creates a binding entry for this prop (shows TagInput).
 * 🔗 button → removes the binding (restores static editor).
 */
export function BindableInput({ obj, propName, onChange, children }: Props) {
  const bound = obj.bindings?.[propName];
  const isBound = bound !== undefined;

  const handleToggle = () => {
    if (isBound) {
      // Remove binding
      const next = { ...(obj.bindings ?? {}) };
      delete next[propName];
      onChange({ bindings: Object.keys(next).length > 0 ? next : undefined });
    } else {
      // Add empty binding (user types the tag id)
      onChange({ bindings: { ...(obj.bindings ?? {}), [propName]: "" } });
    }
  };

  const handleTagChange = (tagId: string) => {
    onChange({ bindings: { ...(obj.bindings ?? {}), [propName]: tagId } });
  };

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {isBound ? (
          <TagInput
            style={{ ...INPUT, borderColor: "#3b82f6" }}
            placeholder="es. demo.rotation"
            value={bound}
            onChange={handleTagChange}
          />
        ) : (
          children
        )}
      </div>
      <button
        style={{
          ...BTN,
          position: "relative",
          zIndex: 1,
          color: isBound ? "#3b82f6" : "#475569",
          borderColor: isBound ? "#1d4ed8" : "#334155",
        }}
        title={isBound ? `Bound a "${bound}" — clicca per scollegare` : "Lega a un tag"}
        onClick={handleToggle}
      >
        {isBound ? "🔗" : "🔓"}
      </button>
    </div>
  );
}
