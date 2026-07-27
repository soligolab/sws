import { useTranslation } from "react-i18next";
import { UI_LANGS, setUiLang } from "@/i18n";

// Selettore della lingua UI (chrome IDE/viewer). Indipendente dalla lingua dei
// contenuti di progetto. Stile compatto adatto all'header.

export function UiLangSelect({ compact = false }: { compact?: boolean }) {
  const { i18n } = useTranslation();
  const current = i18n.language;
  return (
    <select
      value={current}
      onChange={(e) => setUiLang(e.target.value)}
      title="Lingua interfaccia / Interface language"
      aria-label="Lingua interfaccia"
      style={{
        background: "var(--brand-surface-2, #334155)",
        color: "var(--brand-text-2, #cbd5e1)",
        border: "1px solid var(--brand-border, #475569)",
        borderRadius: 4,
        padding: compact ? "3px 6px" : "4px 8px",
        fontSize: 12,
        cursor: "pointer",
      }}
    >
      {UI_LANGS.map((l) => (
        <option key={l.code} value={l.code}>{compact ? l.code.toUpperCase() : l.label}</option>
      ))}
    </select>
  );
}
