import { useAppStore } from "@/store";

/**
 * Synoptic page tab strip, shown under the editor toolbar.
 *
 * Self-contained on the store (it was previously inline in App.tsx, which had
 * to select `pages`/`currentPageId` only for this).
 */
export function PageTabs() {
  const pages          = useAppStore((s) => s.pages);
  const currentPageId  = useAppStore((s) => s.currentPageId);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      background: "var(--brand-bg, #0f172a)",
      borderBottom: "1px solid var(--brand-surface-2, #334155)",
      padding: "0 8px",
      gap: 2,
      flexShrink: 0,
      height: 32,
      overflowX: "auto",
    }}>
      {pages.map((p) => (
        <button
          key={p.id}
          onClick={() => setCurrentPage(p.id)}
          style={{
            background: p.id === currentPageId ? "var(--brand-surface, #1e293b)" : "transparent",
            color: p.id === currentPageId ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)",
            border: p.id === currentPageId ? "1px solid var(--brand-surface-2, #334155)" : "1px solid transparent",
            borderBottom: p.id === currentPageId ? "1px solid var(--brand-surface, #1e293b)" : "1px solid transparent",
            borderRadius: "4px 4px 0 0",
            padding: "3px 12px",
            cursor: "pointer",
            fontSize: 13,
            whiteSpace: "nowrap",
          }}
        >
          {p.name}
        </button>
      ))}
    </div>
  );
}
