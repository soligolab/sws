import { useTranslation } from "react-i18next";

/**
 * The model of an AI provider, from a drop-down: «the default» first, then the
 * provider's models in alphabetical order (maintainer, 16-11-2026). A model
 * chosen before and no longer in the list stays, marked. Before the list is
 * known (no key, or not tested yet) only the default and the current choice.
 */
export function ModelSelect({ value, models, defaultModel, onChange, disabled, testId, style }: {
  value: string | null | undefined;
  models: string[] | null;
  defaultModel?: string;
  onChange: (model: string | null) => void;
  disabled?: boolean;
  testId?: string;
  style?: React.CSSProperties;
}) {
  const { t } = useTranslation();
  const list = [...new Set(models ?? [])].sort((a, b) => a.localeCompare(b));
  const missing = value && !list.includes(value);
  return (
    <select value={value ?? ""} disabled={disabled} data-testid={testId} style={style}
      onChange={(e) => onChange(e.target.value || null)}>
      <option value="">{defaultModel ? t("aiModel.defaultNamed", { model: defaultModel }) : t("aiModel.default")}</option>
      {missing && <option value={value}>{models ? t("aiModel.notListed", { model: value }) : value}</option>}
      {list.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}
