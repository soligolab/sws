// «+ New symbol» asks first (test of 2.26.0-rc.23, 21-11-2026): the name and the
// size of the symbol, before the editor opens. Before, a new symbol was born as
// «New symbol», 100 × 100, and a first «Save» kept that name.

import { useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { CampoNumero } from "@/components/CampoNumero";
import { validSize } from "./model";

export interface NewSymbolAnswer { name: string; w: number; h: number }

/** Same rule as «Save as»: 1 to 60 characters, none of `< > " &`. */
export function validSymbolName(v: string): boolean {
  const s = v.trim();
  return !!s && s.length <= 60 && !/[<>"&]/.test(s);
}

/** Asks the name and the size of a new symbol; `null` if cancelled. */
export function askNewSymbol(): Promise<NewSymbolAnswer | null> {
  return modulo<NewSymbolAnswer>({
    titolo: i18n.t("symbolEditor.newDialog.title"),
    corpo: (fine) => <NewSymbolForm fine={fine} />,
  });
}

function NewSymbolForm({ fine }: { fine: (v: NewSymbolAnswer | null) => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [w, setW] = useState("100");
  const [h, setH] = useState("100");
  const okName = validSymbolName(name);
  const size = (s: string) => (Number.isFinite(Number(s)) && s.trim() !== "" ? validSize(Number(s)) : null);
  const ok = okName && size(w) !== null && size(h) !== null;
  const create = () => { if (ok) fine({ name: name.trim(), w: size(w)!, h: size(h)! }); };
  const onKey = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); create(); } };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 340 }}>
      <p style={{ margin: 0, fontSize: 12, color: MUTED }}>{t("symbolEditor.newDialog.text")}</p>
      <label style={LABEL}>
        {t("symbolEditor.newDialog.name")}
        <input data-testid="new-symbol-name" autoFocus value={name} maxLength={60} style={FIELD}
          onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
      </label>
      {name.trim() !== "" && !okName && <div style={{ fontSize: 11, color: "var(--brand-danger, #ef4444)" }}>{t("symbolEditor.badName")}</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <label style={{ ...LABEL, flex: 1 }}>
          {t("symbolEditor.newDialog.width")}
          <CampoNumero data-testid="new-symbol-w" min={10} max={510} step={10} value={w} style={FIELD}
            onTesto={setW} onKeyDown={onKey} />
        </label>
        <label style={{ ...LABEL, flex: 1 }}>
          {t("symbolEditor.newDialog.height")}
          <CampoNumero data-testid="new-symbol-h" min={10} max={510} step={10} value={h} style={FIELD}
            onTesto={setH} onKeyDown={onKey} />
        </label>
      </div>
      <div style={{ fontSize: 11, color: MUTED }}>{t("symbolEditor.newDialog.sizeHint")}</div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button type="button" onClick={() => fine(null)} style={BUTTON}>{t("common.cancel")}</button>
        <button type="button" data-testid="new-symbol-create" disabled={!ok} onClick={create}
          style={{ ...BUTTON, fontWeight: 600, opacity: ok ? 1 : 0.5, cursor: ok ? "pointer" : "default" }}>
          {t("symbolEditor.newDialog.create")}
        </button>
      </div>
    </div>
  );
}

const MUTED = "var(--brand-text-muted, #94a3b8)";
const LABEL: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: MUTED };
const FIELD: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
};
const BUTTON: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontSize: 13,
};
