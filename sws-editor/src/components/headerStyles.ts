import { useEffect } from "react";

// Shared chrome for the app header and its dropdown menus. Extracted from
// App.tsx when the header was split into its own components.

export const HDR_BTN: React.CSSProperties = {
  padding: "4px 10px",
  background: "var(--brand-surface-2, #334155)",
  color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  whiteSpace: "nowrap",
};

export const DROP_PANEL: React.CSSProperties = {
  position: "absolute",
  right: 0,
  top: "calc(100% + 4px)",
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
  padding: "4px 0",
  minWidth: 180,
  zIndex: 100,
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};

export const DROP_ITEM: React.CSSProperties = {
  display: "block",
  width: "100%",
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "var(--brand-text-2, #cbd5e1)",
  padding: "7px 14px",
  fontSize: 13,
  cursor: "pointer",
};

export const DROP_SEP: React.CSSProperties = {
  height: 1,
  background: "var(--brand-surface-2, #334155)",
  margin: "4px 0",
};

/** Small section heading inside a dropdown panel. */
export const DROP_LABEL: React.CSSProperties = {
  padding: "6px 14px 2px",
  fontSize: 11,
  color: "var(--brand-text-subtle, #64748b)",
  fontWeight: 700,
  letterSpacing: 0.5,
};

/** Close an open dropdown when the user clicks anywhere outside `ref`. */
export function useOutsideClose(
  ref: React.RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [ref, open, onClose]);
}
