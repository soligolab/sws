// Proprietà di una pagina che si apre come finestra (P1, 17-10-2026).

import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import type { FaceplateParamDef, SynopticPage } from "@/types";

const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 6px", fontSize: 13,
  boxSizing: "border-box",
};
const NOTA: React.CSSProperties = { fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "4px 0 0" };

export function ProprietaFinestra({ pagina }: { pagina: SynopticPage }) {
  const { t } = useTranslation();
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const f = pagina.finestra;
  const parametri = pagina.finestra_parametri ?? [];
  const ro = !!pagina.locked;
  const scriviParametri = (ps: FaceplateParamDef[]) =>
    updatePageProps(pagina.id, { finestra_parametri: ps.length > 0 ? ps : undefined });

  return (
    <div style={{ marginTop: 8 }} data-testid="proprieta-finestra">
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
        <input type="checkbox" checked={!!f} disabled={ro} data-testid="si-apre-come-finestra"
          onChange={(e) => updatePageProps(pagina.id, {
            finestra: e.target.checked ? { modale: true } : undefined,
            ...(e.target.checked ? {} : { finestra_parametri: undefined }),
          })} />
        {t("finestraPopup.siApre")}
      </label>
      {!f && <p style={NOTA}>{t("finestraPopup.spiegazione")}</p>}
      {f && (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            {[true, false].map((m) => (
              <label key={String(m)} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", cursor: "pointer" }}>
                <input type="radio" name={`modale-${pagina.id}`} checked={(f.modale !== false) === m} disabled={ro}
                  onChange={() => updatePageProps(pagina.id, { finestra: { ...f, modale: m } })} />
                {m ? t("finestraPopup.modale") : t("finestraPopup.nonModale")}
              </label>
            ))}
          </div>
          <p style={NOTA}>{f.modale !== false ? t("finestraPopup.modaleSpiega") : t("finestraPopup.nonModaleSpiega")}</p>
          <div style={{ marginTop: 6 }}>
            <div style={LABEL}>{t("finestraPopup.titolo")}</div>
            <input type="text" style={INPUT} disabled={ro} placeholder={pagina.name} value={f.titolo ?? ""}
              onChange={(e) => updatePageProps(pagina.id, { finestra: { ...f, titolo: e.target.value || undefined } })} />
          </div>
          <div style={{ marginTop: 6 }}>
            <div style={LABEL}>{t("finestraPopup.parametri")}</div>
            {parametri.map((p, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 70px 22px", gap: 4, marginBottom: 4 }}>
                <input type="text" style={INPUT} disabled={ro} placeholder={t("finestraPopup.nomeParametro")} value={p.name}
                  onChange={(e) => scriviParametri(parametri.map((x, j) => (j === i ? { ...x, name: e.target.value.replace(/\W/g, "") } : x)))} />
                <input type="text" style={INPUT} disabled={ro} placeholder={t("finestraPopup.predefinito")} value={p.default ?? ""}
                  onChange={(e) => scriviParametri(parametri.map((x, j) => (j === i ? { ...x, default: e.target.value || undefined } : x)))} />
                <select style={{ ...INPUT, padding: "3px 2px" }} disabled={ro} value={p.type === "tag" ? "tag" : "string"}
                  onChange={(e) => scriviParametri(parametri.map((x, j) => (j === i ? { ...x, type: e.target.value as "tag" | "string" } : x)))}>
                  <option value="tag">{t("finestraPopup.tipoTag")}</option>
                  <option value="string">{t("finestraPopup.tipoTesto")}</option>
                </select>
                <button type="button" disabled={ro} title={t("finestraPopup.togli")}
                  style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}
                  onClick={() => scriviParametri(parametri.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
            <button type="button" disabled={ro} data-testid="aggiungi-parametro"
              style={{ fontSize: 11, background: "none", border: "1px dashed var(--brand-border, #475569)", borderRadius: 4,
                color: "var(--brand-text-subtle, #94a3b8)", padding: "2px 8px", cursor: "pointer" }}
              onClick={() => scriviParametri([...parametri, { name: `p${parametri.length + 1}`, type: "tag" }])}>
              {t("finestraPopup.aggiungiParametro")}
            </button>
            <p style={NOTA}>{t("finestraPopup.parametriSpiega")}</p>
          </div>
        </>
      )}
    </div>
  );
}
