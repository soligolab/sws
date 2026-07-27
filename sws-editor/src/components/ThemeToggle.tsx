import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import type { ThemeMode } from "@/theme";

// Tri-state theme control: System → Light → Dark → System.
// Reads/writes the persisted preference via the store (which calls
// applyAppearance under the hood). Styled with brand tokens so it themes itself.

const ORDER: ThemeMode[] = ["system", "light", "dark"];

const ICON: Record<ThemeMode, string> = {
  system: "🖥️",
  light:  "☀️",
  dark:   "🌙",
};

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation();
  const themeMode    = useAppStore((s) => s.themeMode);
  const setThemeMode = useAppStore((s) => s.setThemeMode);

  const next = () => {
    const i = ORDER.indexOf(themeMode);
    setThemeMode(ORDER[(i + 1) % ORDER.length]);
  };

  const label = t(`theme.${themeMode}`);
  return (
    <button
      onClick={next}
      title={t("theme.title", { label })}
      aria-label={t("theme.title", { label })}
      style={{
        padding: compact ? "4px 8px" : "4px 10px",
        background: "var(--brand-surface-2, #334155)",
        color: "var(--brand-text-2, #cbd5e1)",
        border: "1px solid var(--brand-border, #475569)",
        borderRadius: 4,
        cursor: "pointer",
        fontSize: 12,
        whiteSpace: "nowrap",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span aria-hidden>{ICON[themeMode]}</span>
      {!compact && <span>{label}</span>}
    </button>
  );
}
