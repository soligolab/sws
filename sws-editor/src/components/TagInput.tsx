import { useId } from "react";
import { useAppStore } from "@/store";

interface TagInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}

/**
 * Text input that suggests project-defined tag IDs via a <datalist>.
 * Falls back to a plain text field if the project has no tags loaded.
 * Free-text entry is still allowed — datalist provides suggestions, not constraint.
 */
export function TagInput({ value, onChange, placeholder, style }: TagInputProps) {
  const listId = useId();
  const tags = useAppStore((s) => s.project?.tags ?? []);

  return (
    <>
      <input
        type="text"
        list={listId}
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoComplete="off"
      />
      <datalist id={listId}>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.description}
          </option>
        ))}
      </datalist>
    </>
  );
}
