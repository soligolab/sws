import { useTranslation } from "react-i18next";
import { TagInput } from "@/components/TagInput";
import { validateExpr } from "@/expr/engine";
import type { BindingSpec, SynopticObject } from "@/types";

const BTN: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text-muted, #94a3b8)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 13,
  cursor: "pointer",
  flexShrink: 0,
  lineHeight: 1,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
  padding: "3px 6px",
  fontSize: 13,
  boxSizing: "border-box",
};

const MINI: React.CSSProperties = { ...INPUT, width: 64, fontSize: 11, padding: "2px 4px" };

interface Props {
  obj: SynopticObject;
  propName: string;
  onChange: (patch: Partial<SynopticObject>) => void;
  children: React.ReactNode;
}

type Mode = "tag" | "scale" | "expr";

function modeOf(spec: string | BindingSpec | undefined): Mode {
  if (spec === undefined || typeof spec === "string") return "tag";
  if (spec.expr !== undefined) return "expr";
  return spec.in_min !== undefined || spec.out_min !== undefined || spec.in_max !== undefined || spec.out_max !== undefined
    ? "scale" : "tag";
}

/**
 * Wraps a static property editor with a tag-binding toggle (F2.3).
 * 🔓 → binding OFF (editor statico). 🔗 → binding ON, con tre modalità:
 *   tag   — copia 1:1 del valore del tag (forma storica, stringa nuda)
 *   scala — tag + mappatura lineare in_min..in_max → out_min..out_max
 *   espr  — espressione client-side (vedi expr/engine.ts), validata live
 */
export function BindableInput({ obj, propName, onChange, children }: Props) {
  const { t } = useTranslation();
  const bound = obj.bindings?.[propName];
  const isBound = bound !== undefined;
  const mode = modeOf(bound);
  const spec: BindingSpec = typeof bound === "string" ? { tag: bound } : (bound ?? {});

  const setBinding = (value: string | BindingSpec | undefined) => {
    const next: Record<string, string | BindingSpec> = { ...(obj.bindings ?? {}) };
    if (value === undefined) delete next[propName];
    else next[propName] = value;
    onChange({ bindings: Object.keys(next).length > 0 ? next : undefined });
  };

  const handleToggle = () => setBinding(isBound ? undefined : "");

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    if (m === "tag") setBinding(spec.tag ?? "");
    else if (m === "scale") setBinding({ tag: spec.tag ?? "", in_min: 0, in_max: 100, out_min: 0, out_max: 100 });
    else setBinding({ expr: spec.tag ? `{${spec.tag}}` : "" });
  };

  const patchSpec = (p: Partial<BindingSpec>) => setBinding({ ...spec, ...p });

  const exprError = mode === "expr" && spec.expr ? validateExpr(spec.expr) : null;

  return (
    <div style={{ display: "flex", gap: 4, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {!isBound ? children : (
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["tag", "scale", "expr"] as Mode[]).map((m) => (
                <button key={m}
                  style={{
                    ...BTN, fontSize: 10, padding: "2px 6px",
                    color: mode === m ? "var(--brand-primary, #3b82f6)" : "var(--brand-text-subtle, #64748b)",
                    borderColor: mode === m ? "#1d4ed8" : "var(--brand-surface-2, #334155)",
                  }}
                  onClick={() => switchMode(m)}>
                  {t(`tagInput.mode.${m}`)}
                </button>
              ))}
            </div>
            {mode !== "expr" && (
              <TagInput
                style={{ ...INPUT, borderColor: "var(--brand-primary, #3b82f6)" }}
                placeholder={t("tagInput.bindPlaceholder")}
                value={spec.tag ?? ""}
                onChange={(tagId) => (mode === "tag" ? setBinding(tagId) : patchSpec({ tag: tagId }))}
              />
            )}
            {mode === "scale" && (
              <div style={{ display: "flex", gap: 3, alignItems: "center", flexWrap: "wrap" }}>
                <input style={MINI} type="number" placeholder="in min" title="in min"
                  value={spec.in_min ?? ""} onChange={(e) => patchSpec({ in_min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <input style={MINI} type="number" placeholder="in max" title="in max"
                  value={spec.in_max ?? ""} onChange={(e) => patchSpec({ in_max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>→</span>
                <input style={MINI} type="number" placeholder="out min" title="out min"
                  value={spec.out_min ?? ""} onChange={(e) => patchSpec({ out_min: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <input style={MINI} type="number" placeholder="out max" title="out max"
                  value={spec.out_max ?? ""} onChange={(e) => patchSpec({ out_max: e.target.value === "" ? undefined : Number(e.target.value) })} />
                <label style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", display: "flex", gap: 2, alignItems: "center" }}>
                  <input type="checkbox" checked={spec.clamp !== false}
                    onChange={(e) => patchSpec({ clamp: e.target.checked ? undefined : false })} />
                  clamp
                </label>
              </div>
            )}
            {mode === "expr" && (
              <>
                <input
                  style={{ ...INPUT, fontFamily: "monospace", fontSize: 12,
                           borderColor: exprError ? "var(--brand-danger, #ef4444)" : "var(--brand-primary, #3b82f6)" }}
                  placeholder={"{tank.level} * 100 / {tank.cap}"}
                  value={spec.expr ?? ""}
                  onChange={(e) => patchSpec({ expr: e.target.value })}
                  spellCheck={false}
                />
                {exprError && (
                  <div style={{ fontSize: 10, color: "var(--brand-danger-soft, #fca5a5)" }}>{exprError}</div>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <button
        style={{
          ...BTN,
          color: isBound ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)",
          borderColor: isBound ? "#1d4ed8" : "var(--brand-surface-2, #334155)",
        }}
        title={isBound ? t("tagInput.unbind") : t("tagInput.bindTo")}
        onClick={handleToggle}
      >
        {isBound ? "🔗" : "🔓"}
      </button>
    </div>
  );
}
