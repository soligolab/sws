// The sheet of a symbol in the assistant's chat (plan
// docs/plans/2026-11-23-assistente-dei-simboli.md, session 2): what the
// interview decided, editable until «Confirm» (decision of the maintainer,
// 23-11-2026: corrected in the card, not by writing). The server checks it
// again when it arrives (`symbol_sheet.rs`); here only what keeps the card
// usable: names, lists, the choices of each field.
import { useTranslation } from "react-i18next";
import type React from "react";
import type { SymbolSheet } from "@/types/ai";
import { CampoNumero } from "@/components/CampoNumero";

const MOTIONS = ["rotor", "slide", "level", "needle", "lever", "lamp", "vibrate", "pulse", "signal"] as const;
const SIDES = ["left", "right", "top", "bottom"] as const;
const EFFECTS = ["flame", "smoke", "glow", "bubbles"] as const;
const ID = /^[a-z0-9-]{2,30}$/;

/** What keeps the card from being confirmed: the empty or malformed names,
 *  the same name twice, a reference to nothing. */
export function sheetProblems(s: SymbolSheet): string[] {
  const out: string[] = [];
  const names = [...s.inputs.map((i) => i.id), ...s.parts.map((p) => p.id), ...s.ports.map((p) => p.id)];
  for (const n of names) if (!ID.test(n)) out.push(n || "—");
  const seen = new Set<string>();
  for (const n of names) { if (seen.has(n)) out.push(n); seen.add(n); }
  const inputs = new Set(s.inputs.map((i) => i.id));
  const parts = new Set(s.parts.map((p) => p.id));
  for (const f of s.effects) {
    if (!parts.has(f.part)) out.push(f.part || "—");
    if (!inputs.has(f.input)) out.push(f.input || "—");
  }
  for (const p of s.parts) if (p.motion && (!p.input || !inputs.has(p.input))) out.push(p.id);
  return [...new Set(out)];
}

const field: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3, padding: "2px 4px", fontSize: 11,
  minWidth: 0, fontFamily: "inherit",
};
const small: React.CSSProperties = { ...field, width: 42 };
const btn: React.CSSProperties = {
  background: "transparent", color: "var(--brand-text-muted, #94a3b8)", border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 3, padding: "0 6px", fontSize: 11, cursor: "pointer",
};
const heading: React.CSSProperties = {
  fontSize: 10, fontWeight: 600, letterSpacing: 0.5, textTransform: "uppercase",
  color: "var(--brand-text-subtle, #64748b)", marginTop: 8, marginBottom: 3,
};
// Rows wrap: the chat column is narrow (380 px), the fields must not run out of it.
const row: React.CSSProperties = { display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", marginBottom: 3 };

export function SymbolSheetCard({ sheet, confirmed, disabled, onChange, onConfirm }: {
  sheet: SymbolSheet;
  confirmed: boolean;
  /** The assistant is working: nothing to confirm yet. */
  disabled?: boolean;
  onChange: (s: SymbolSheet) => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const ro = confirmed;
  const set = (patch: Partial<SymbolSheet>) => onChange({ ...sheet, ...patch });
  const setAt = <K extends "inputs" | "parts" | "ports" | "effects">(k: K, i: number, patch: Partial<SymbolSheet[K][number]>) =>
    set({ [k]: sheet[k].map((x, j) => (j === i ? { ...x, ...patch } : x)) } as Partial<SymbolSheet>);
  const removeAt = (k: "inputs" | "parts" | "ports" | "effects", i: number) =>
    set({ [k]: sheet[k].filter((_, j) => j !== i) } as Partial<SymbolSheet>);
  const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const inputIds = sheet.inputs.map((i) => i.id);
  const partIds = sheet.parts.map((p) => p.id);
  const problems = sheetProblems(sheet);
  const del = (k: "inputs" | "parts" | "ports" | "effects", i: number) =>
    !ro && <button type="button" style={btn} title={t("symbolSheet.remove")} onClick={() => removeAt(k, i)}>✕</button>;

  return (
    <div data-testid="chat-symbol-sheet" style={{
      margin: "4px 10px", padding: 10, minWidth: 0, overflow: "hidden", borderRadius: 6, fontSize: 11, color: "var(--brand-text, #e2e8f0)",
      background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
    }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t("symbolSheet.title")}</div>
      <fieldset disabled={ro} style={{ border: "none", padding: 0, margin: 0 }}>
        <div style={row}>
          <input style={{ ...field, flex: "1 1 120px" }} value={sheet.name} aria-label={t("symbolSheet.name")}
            data-testid="sheet-name" onChange={(e) => set({ name: e.target.value })} />
          <CampoNumero style={small} step={10} value={sheet.size.w} aria-label="w"
            onTesto={(v) => set({ size: { ...sheet.size, w: Number(v) } })} />
          ×
          <CampoNumero style={small} step={10} value={sheet.size.h} aria-label="h"
            onTesto={(v) => set({ size: { ...sheet.size, h: Number(v) } })} />
        </div>
        <div style={row}>
          <select style={field} value={sheet.style} data-testid="sheet-style"
            onChange={(e) => set({ style: e.target.value as SymbolSheet["style"] })}>
            {(["vector", "photo", "mixed"] as const).map((s) => <option key={s} value={s}>{t(`symbolSheet.style.${s}`)}</option>)}
          </select>
          {sheet.style === "vector" && (
            <label style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <input type="checkbox" checked={!!sheet.state_colors} onChange={(e) => set({ state_colors: e.target.checked })} />
              {t("symbolSheet.stateColors")}
            </label>
          )}
        </div>

        <div style={heading}>{t("symbolSheet.inputs")}</div>
        {sheet.inputs.map((x, i) => (
          <div key={i} style={row} data-testid={`sheet-input-${i}`}>
            <input style={{ ...field, width: 80 }} value={x.id} aria-label={t("symbolSheet.id")}
              onChange={(e) => setAt("inputs", i, { id: e.target.value })} />
            <select style={field} value={x.type} onChange={(e) => setAt("inputs", i, { type: e.target.value as "bool" })}>
              {(["bool", "number", "states"] as const).map((k) => <option key={k} value={k}>{t(`symbolSheet.inputType.${k}`)}</option>)}
            </select>
            {x.type === "number" && <>
              <CampoNumero style={small} value={x.min} placeholder="min" onTesto={(v) => setAt("inputs", i, { min: num(v) })} />
              <CampoNumero style={small} value={x.max} placeholder="max" onTesto={(v) => setAt("inputs", i, { max: num(v) })} />
              <input style={{ ...small, width: 36 }} value={x.unit ?? ""} placeholder="%" onChange={(e) => setAt("inputs", i, { unit: e.target.value || undefined })} />
            </>}
            {x.type === "states" && (
              <input style={{ ...field, flex: "1 1 120px" }} value={(x.states ?? []).join(", ")} placeholder={t("symbolSheet.statesHint")}
                onChange={(e) => setAt("inputs", i, { states: e.target.value.split(",").map((v) => v.trim()).filter(Boolean) })} />
            )}
            {del("inputs", i)}
          </div>
        ))}
        {!ro && <button type="button" style={btn} onClick={() => set({ inputs: [...sheet.inputs, { id: "", type: "bool" }] })}>+ {t("symbolSheet.addInput")}</button>}

        <div style={heading}>{t("symbolSheet.parts")}</div>
        {sheet.parts.map((x, i) => (
          <div key={i} style={row} data-testid={`sheet-part-${i}`}>
            <input style={{ ...field, width: 80 }} value={x.id} aria-label={t("symbolSheet.id")}
              onChange={(e) => setAt("parts", i, { id: e.target.value })} />
            <input style={{ ...field, flex: "1 1 60px" }} value={x.what} aria-label={t("symbolSheet.what")}
              onChange={(e) => setAt("parts", i, { what: e.target.value })} />
            <select style={field} value={x.motion ?? ""} aria-label={t("symbolSheet.motion")}
              onChange={(e) => setAt("parts", i, { motion: e.target.value || undefined })}>
              <option value="">{t("symbolSheet.still")}</option>
              {MOTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            {x.motion && (
              <select style={field} value={x.input ?? ""} onChange={(e) => setAt("parts", i, { input: e.target.value || undefined })}>
                <option value="">—</option>
                {inputIds.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            )}
            {del("parts", i)}
          </div>
        ))}
        {!ro && <button type="button" style={btn} onClick={() => set({ parts: [...sheet.parts, { id: "", what: "" }] })}>+ {t("symbolSheet.addPart")}</button>}

        <div style={heading}>{t("symbolSheet.ports")}</div>
        {sheet.ports.map((x, i) => (
          <div key={i} style={row}>
            <input style={{ ...field, width: 90 }} value={x.id} aria-label={t("symbolSheet.id")}
              onChange={(e) => setAt("ports", i, { id: e.target.value })} />
            <select style={field} value={x.side} onChange={(e) => setAt("ports", i, { side: e.target.value as "left" })}>
              {SIDES.map((s) => <option key={s} value={s}>{t(`symbolSheet.side.${s}`)}</option>)}
            </select>
            {del("ports", i)}
          </div>
        ))}
        {!ro && <button type="button" style={btn} onClick={() => set({ ports: [...sheet.ports, { id: "", side: "left" }] })}>+ {t("symbolSheet.addPort")}</button>}

        <div style={heading}>{t("symbolSheet.effects")}</div>
        {sheet.effects.map((x, i) => (
          <div key={i} style={row} data-testid={`sheet-effect-${i}`}>
            <select style={field} value={x.kind} onChange={(e) => setAt("effects", i, { kind: e.target.value as "flame" })}>
              {EFFECTS.map((k) => <option key={k} value={k}>{t(`symbolEditor.fx.kind.${k}`)}</option>)}
            </select>
            {t("symbolSheet.on")}
            <select style={field} value={x.part} onChange={(e) => setAt("effects", i, { part: e.target.value })}>
              <option value="">—</option>
              {partIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            {t("symbolSheet.with")}
            <select style={field} value={x.input} onChange={(e) => setAt("effects", i, { input: e.target.value })}>
              <option value="">—</option>
              {inputIds.map((id) => <option key={id} value={id}>{id}</option>)}
            </select>
            {del("effects", i)}
          </div>
        ))}
        {!ro && <button type="button" style={btn}
          onClick={() => set({ effects: [...sheet.effects, { kind: "flame", part: partIds[0] ?? "", input: inputIds[0] ?? "" }] })}>
          + {t("symbolSheet.addEffect")}</button>}

        {sheet.style !== "vector" && (
          <>
            <div style={heading}>{t("symbolSheet.photo")}</div>
            <textarea style={{ ...field, width: "100%", boxSizing: "border-box" }} rows={2} value={sheet.photo?.description ?? ""}
              onChange={(e) => set({ photo: { ...sheet.photo, description: e.target.value } })} />
            {sheet.photo?.varies_with && (
              <div style={{ color: "var(--brand-text-subtle, #64748b)" }}>
                {t("symbolSheet.photoVaries", { input: sheet.photo.varies_with.input, n: sheet.photo.varies_with.steps?.length ?? 2 })}
              </div>
            )}
          </>
        )}
      </fieldset>

      {confirmed ? (
        <div style={{ marginTop: 8, color: "var(--brand-success, #22c55e)" }}>{t("symbolSheet.confirmed")}</div>
      ) : (
        <div style={{ marginTop: 8, display: "flex", gap: 6, alignItems: "center" }}>
          <button type="button" data-testid="sheet-confirm" disabled={disabled || problems.length > 0}
            style={{ ...btn, background: "var(--sws-accent, #1d4ed8)", color: "var(--sws-on-accent, #fff)", padding: "3px 10px",
                     opacity: disabled || problems.length > 0 ? 0.5 : 1 }}
            onClick={onConfirm}>{t("symbolSheet.confirm")}</button>
          {problems.length > 0 && (
            <span style={{ color: "var(--brand-warning, #f59e0b)" }} data-testid="sheet-problems">
              {t("symbolSheet.problems", { names: problems.join(", ") })}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
