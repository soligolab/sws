// «Nuovo da modello» (10-11-2026, piano della logica unificata, L3): un
// `modulo` della Finestra di avviso in due passi. Prima si sceglie cosa deve
// fare il codice, poi i tag del progetto con `TagInput`: le funzioni e gli
// script nascono coi tag veri e nella lingua dell'IDE, invece che coi nomi
// inventati dei vecchi frammenti, da correggere a mano uno per uno.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { modulo } from "@/finestraAvviso/finestraAvviso";
import { TagInput } from "@/components/TagInput";
import { useAppStore } from "@/store";
import { genId } from "@/id";
import { MODELLI, istanzia, type Istanza, type Modello } from "./modelli";

/** Apre il modulo; `null` se si annulla. */
export function nuovoDaModello(): Promise<Istanza | null> {
  return modulo<Istanza>({
    titolo: i18n.t("logica.modelloTitolo"),
    corpo: (fine) => <CorpoModello fine={fine} />,
  });
}

/** Una chiave del modello nella lingua dell'IDE. */
export const testoModello = (m: Modello) => (chiave: string) => i18n.t(`logicaModelli.${m.id}.${chiave}`);

function CorpoModello({ fine }: { fine: (v: Istanza | null) => void }) {
  const { t } = useTranslation();
  const [scelto, setScelto] = useState<Modello | null>(null);
  const [tag, setTag] = useState<Record<string, string>>({});

  if (!scelto) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 420 }}>
        <p style={{ margin: "0 0 4px", fontSize: 13 }}>{t("logica.modelloScegli")}</p>
        {MODELLI.map((m) => (
          <button key={m.id} type="button" data-testid={`modello-${m.id}`} onClick={() => { setScelto(m); setTag({}); }}
            style={{ ...VOCE, textAlign: "left" }}>
            <strong style={{ fontSize: 13 }}>{t(`logicaModelli.${m.id}.titolo`)}</strong>
            <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginTop: 2 }}>{t(`logicaModelli.${m.id}.descrizione`)}</div>
          </button>
        ))}
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
          <button type="button" onClick={() => fine(null)} style={BOTTONE}>{t("common.cancel")}</button>
        </div>
      </div>
    );
  }

  const tx = testoModello(scelto);
  const completo = scelto.tag.every((s) => (tag[s.nome] ?? "").trim() !== "");
  const crea = () => {
    const progetto = useAppStore.getState().project;
    fine(istanzia(scelto, Object.fromEntries(Object.entries(tag).map(([k, v]) => [k, v.trim()])), tx,
      { funzioni: (progetto?.functions ?? []).map((f) => f.name), script: (progetto?.global_scripts ?? []).map((g) => g.id) },
      () => genId()));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 420 }}>
      <strong style={{ fontSize: 13 }}>{tx("titolo")}</strong>
      <p style={{ margin: 0, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>{t("logica.modelloTagAiuto")}</p>
      {scelto.tag.map((s) => (
        <div key={s.nome} data-testid={`modello-tag-${s.nome}`}>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>
            {tx(`tag.${s.nome}`)} · {t(s.scrittura ? "logica.modelloScritto" : "logica.modelloLetto")}
          </label>
          <TagInput value={tag[s.nome] ?? ""} onChange={(v) => setTag((p) => ({ ...p, [s.nome]: v }))} style={CAMPO} />
        </div>
      ))}
      <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>
        {t("logica.modelloNasce")}{" "}
        {scelto.pezzi.map((p) => t(p.tipo === "funzione" ? "logica.modelloFunzione" : "logica.modelloScript", { nome: tx(`nomi.${p.chiaveNome}`) })).join(", ")}
        {scelto.pezzi.some((p) => p.tipo === "script") && <>. {t("logica.modelloSalva")}</>}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
        <button type="button" onClick={() => setScelto(null)} style={BOTTONE}>{t("logica.modelloIndietro")}</button>
        <button type="button" onClick={() => fine(null)} style={BOTTONE}>{t("common.cancel")}</button>
        <button type="button" data-testid="modello-crea" disabled={!completo} onClick={crea}
          style={{ ...BOTTONE, fontWeight: 600, opacity: completo ? 1 : 0.5, cursor: completo ? "pointer" : "default" }}>
          {t("logica.modelloCrea")}
        </button>
      </div>
    </div>
  );
}

const VOCE: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "6px 10px", cursor: "pointer",
};
const BOTTONE: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", cursor: "pointer", fontSize: 13,
};
const CAMPO: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 13, boxSizing: "border-box",
};
