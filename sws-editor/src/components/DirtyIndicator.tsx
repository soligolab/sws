import { useTranslation } from "react-i18next";
import { selectIsDirty, useAppStore } from "@/store";

/**
 * "Unsaved changes" marker for the app header.
 *
 * Deliberately separate from the ☰ menu's ⟳/✓/⚠ glyph: that one reports the
 * outcome of the last save (transient, auto-clears after 2s), this one reports
 * persistent state. Clicking it saves.
 *
 * Lives in the app-level header rather than in the editor chrome so it stays
 * visible in Configuration mode, where tab drafts can be pending too.
 */
export function DirtyIndicator() {
  const { t } = useTranslation();
  const isDirty    = useAppStore(selectIsDirty);
  const saveStatus = useAppStore((s) => s.saveStatus);
  const saveAll    = useAppStore((s) => s.saveAll);

  // While a save is in flight the ☰ button already shows ⟳; showing the dot
  // at the same time would read as "the save didn't take".
  if (!isDirty || saveStatus === "saving") return null;

  return (
    <button
      onClick={() => void saveAll()}
      title={t("app.unsavedHint")}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 5,
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: "2px 4px",
        fontSize: 12,
        color: "var(--brand-warning, #f59e0b)",
        whiteSpace: "nowrap",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>●</span>
      {t("app.unsavedShort")}
    </button>
  );
}
