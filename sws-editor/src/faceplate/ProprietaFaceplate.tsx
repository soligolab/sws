// Le proprietà di un faceplate aperto sul canvas (29-10-2026, piano
// docs/plans/2026-10-27-faceplate-disegnato-sul-canvas.md): l'id, i parametri,
// dove è usato, la definizione intera in JSON e, per i predefiniti
// personalizzati, il ripristino. Nome e misura stanno in PageProps, come per
// le cornici.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import type { FaceplateDef, FaceplateParamDef, SynopticPage } from "@/types";
import { contieneFaceplate, idFaceplate, paginaAFaceplate, usiDelFaceplate } from "./modello";

const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 2 };
const INPUT: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "3px 6px", fontSize: 12,
  boxSizing: "border-box", minWidth: 0,
};
const NOTA: React.CSSProperties = { fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", margin: "4px 0 0", lineHeight: 1.4 };
const PULSANTE: React.CSSProperties = {
  fontSize: 11, background: "none", border: "1px dashed var(--brand-border, #475569)", borderRadius: 4,
  color: "var(--brand-text-subtle, #94a3b8)", padding: "2px 8px", cursor: "pointer",
};

const TIPI: NonNullable<FaceplateParamDef["type"]>[] = ["istanza", "tag", "string", "number", "color"];

/** La riga di un parametro: nome, tipo (col tipo di struttura per «istanza»),
 *  predefinito, obbligatorio. Prima era la grammatica `nome:tipo(rif)=predefinito!`
 *  scritta in una textarea. */
function RigaParametro({ p, ro, onChange, onTogli }: {
  p: FaceplateParamDef; ro: boolean;
  onChange: (p: FaceplateParamDef) => void; onTogli: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: 6, marginBottom: 6 }}
      data-testid={`parametro-${p.name}`}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 92px 22px", gap: 4 }}>
        <input type="text" style={{ ...INPUT, fontFamily: "monospace" }} disabled={ro} value={p.name}
          placeholder={t("faceplate.nomeParametro")} spellCheck={false}
          onChange={(e) => onChange({ ...p, name: e.target.value.replace(/\W/g, "") })} />
        <select style={{ ...INPUT, padding: "3px 2px" }} disabled={ro} value={p.type ?? ""}
          onChange={(e) => {
            const type = (e.target.value || undefined) as FaceplateParamDef["type"];
            onChange({ ...p, type, ...(type === "istanza" ? {} : { type_ref: undefined }) });
          }}>
          <option value="">—</option>
          {TIPI.map((k) => <option key={k} value={k}>{t(`faceplate.tipo.${k}`)}</option>)}
        </select>
        <button type="button" disabled={ro} title={t("faceplate.togliParametro")}
          style={{ background: "none", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer" }}
          onClick={onTogli}>×</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: p.type === "istanza" ? "1fr 1fr" : "1fr", gap: 4, marginTop: 4 }}>
        <input type="text" style={INPUT} disabled={ro} value={p.default ?? ""} placeholder={t("faceplate.predefinito")}
          onChange={(e) => onChange({ ...p, default: e.target.value === "" ? undefined : e.target.value })} />
        {p.type === "istanza" && (
          <input type="text" style={INPUT} disabled={ro} value={p.type_ref ?? ""} placeholder={t("faceplate.tipoStruttura")}
            title={t("faceplate.tipoStrutturaAiuto")} spellCheck={false}
            onChange={(e) => onChange({ ...p, type_ref: e.target.value.trim() || undefined })} />
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--brand-text-2, #cbd5e1)", marginTop: 4, cursor: "pointer" }}>
        <input type="checkbox" disabled={ro} checked={!!p.required}
          onChange={(e) => onChange({ ...p, required: e.target.checked || undefined })} />
        {t("faceplate.obbligatorio")}
      </label>
    </div>
  );
}

/** La definizione intera, da leggere e da scrivere a mano. «Applica» solo con
 *  un JSON valido e senza faceplate dentro; riscrive la pagina in un passo. */
function ModaleJson({ pagina, onClose }: { pagina: SynopticPage; onClose: () => void }) {
  const { t } = useTranslation();
  const applica = useAppStore((s) => s.applicaDefinizioneFaceplate);
  const [testo, setTesto] = useState(() => JSON.stringify(paginaAFaceplate(pagina), null, 2));
  let errore: string | null = null;
  let def: FaceplateDef | null = null;
  try {
    const v = JSON.parse(testo) as FaceplateDef;
    if (!v || typeof v !== "object" || !Array.isArray(v.objects)) errore = t("faceplate.json.senzaOggetti");
    else if (contieneFaceplate(v.objects)) errore = t("faceplate.json.annidato");
    else def = { ...v, params: Array.isArray(v.params) ? v.params : [] };
  } catch (e) {
    errore = e instanceof Error ? e.message : String(e);
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div data-testid="faceplate-json"
        style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-border, #475569)", borderRadius: 8, padding: 16, width: 720, maxWidth: "95vw", height: "80vh", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>
          {t("faceplate.json.titolo")} · <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{idFaceplate(pagina)}</span>
        </div>
        <p style={{ ...NOTA, fontSize: 11, margin: 0 }}>{t("faceplate.json.spiega")}</p>
        <textarea value={testo} onChange={(e) => setTesto(e.target.value)} spellCheck={false}
          style={{ ...INPUT, flex: 1, resize: "none", fontFamily: "monospace", fontSize: 12, lineHeight: 1.45 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ flex: 1, fontSize: 11, color: "var(--brand-danger-soft, #f87171)", minWidth: 0 }}>{errore}</span>
          <button type="button" onClick={onClose}
            style={{ ...PULSANTE, borderStyle: "solid", padding: "4px 12px", fontSize: 12 }}>{t("common.cancel")}</button>
          <button type="button" disabled={!def} data-testid="faceplate-json-applica"
            onClick={() => { if (def) { applica(pagina.id, def); onClose(); } }}
            style={{ fontSize: 12, padding: "4px 12px", borderRadius: 4, border: "none", fontWeight: 600,
              background: def ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)",
              color: def ? "var(--brand-on-primary, #0f172a)" : "var(--brand-text-subtle, #94a3b8)",
              cursor: def ? "pointer" : "not-allowed" }}>
            {t("faceplate.json.applica")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProprietaFaceplate({ pagina }: { pagina: SynopticPage }) {
  const { t } = useTranslation();
  const updatePageProps = useAppStore((s) => s.updatePageProps);
  const ripristina = useAppStore((s) => s.ripristinaFaceplate);
  const pages = useAppStore((s) => s.pages);
  const [jsonAperto, setJsonAperto] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const ro = !!pagina.locked;
  const id = idFaceplate(pagina);
  const parametri = pagina.faceplate_parametri ?? [];
  const scrivi = (ps: FaceplateParamDef[]) => updatePageProps(pagina.id, { faceplate_parametri: ps });
  const usi = usiDelFaceplate(pages, id);

  return (
    <div style={{ marginTop: 10 }} data-testid="proprieta-faceplate">
      <div style={LABEL}>{t("faceplate.id")}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <code style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{id}</code>
        {pagina.faceplate_predefinito && (
          <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)", border: "1px solid var(--brand-border, #475569)", borderRadius: 3, padding: "0 4px" }}>
            {t(`faceplate.origine.${pagina.faceplate_predefinito}`)}
          </span>
        )}
      </div>
      <p style={NOTA}>{t("faceplate.idSpiega")}</p>

      <div style={{ ...LABEL, marginTop: 10 }}>{t("faceplate.parametri")}</div>
      {parametri.map((p, i) => (
        <RigaParametro key={i} p={p} ro={ro}
          onChange={(np) => scrivi(parametri.map((x, j) => (j === i ? np : x)))}
          onTogli={() => scrivi(parametri.filter((_, j) => j !== i))} />
      ))}
      <button type="button" disabled={ro} style={PULSANTE} data-testid="faceplate-aggiungi-parametro"
        onClick={() => scrivi([...parametri, { name: `p${parametri.length + 1}`, type: "tag" }])}>
        {t("faceplate.aggiungiParametro")}
      </button>
      <p style={NOTA}>{t("faceplate.parametriSpiega")}</p>

      <div style={{ ...LABEL, marginTop: 10 }}>{t("faceplate.usatoIn")}</div>
      <div style={{ fontSize: 11, color: usi.istanze + usi.popup > 0 ? "var(--brand-text-2, #cbd5e1)" : "var(--brand-text-subtle, #94a3b8)" }}
        data-testid="faceplate-usi">
        {usi.istanze + usi.popup === 0
          ? t("faceplate.maiUsato")
          : t("faceplate.usi", { istanze: usi.istanze, popup: usi.popup, pagine: usi.pagine.join(", ") })}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <button type="button" style={{ ...PULSANTE, borderStyle: "solid" }} data-testid="faceplate-apri-json"
          onClick={() => setJsonAperto(true)} disabled={ro}>{t("faceplate.json.pulsante")}</button>
        {pagina.faceplate_predefinito === "personalizzato" && (
          <button type="button" style={{ ...PULSANTE, borderStyle: "solid" }} data-testid="faceplate-ripristina" disabled={ro}
            onClick={() => {
              if (!window.confirm(t("faceplate.ripristinaConferma", { nome: pagina.name }))) return;
              setErrore(null);
              ripristina(pagina.id).catch((e) => setErrore(e instanceof Error ? e.message : String(e)));
            }}>{t("faceplate.ripristina")}</button>
        )}
      </div>
      {errore && <p style={{ ...NOTA, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</p>}
      {jsonAperto && <ModaleJson pagina={pagina} onClose={() => setJsonAperto(false)} />}
    </div>
  );
}
