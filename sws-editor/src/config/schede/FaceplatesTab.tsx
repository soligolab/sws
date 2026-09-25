import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { genId } from "@/id";
import { SvgObject, substituteFaceplateParams } from "@/canvas/SvgCanvas";
import type { FaceplateParamDef, FaceplateDef, SynopticObject } from "@/types";
import { useAppStore } from "@/store";
import { useFocus, usePubblicaElenco } from "@/config/fogliaConfig";
import { TRANS_COMP, S, SaveBar } from "@/config/comuni";

// ── Faceplate live preview ──────────────────────────────────────────────────
//
// Renders a faceplate DEFINITION's `objects` the same way a placed `faceplate`
// instance renders them (SvgCanvas.tsx's `faceplate` branch) — same
// `substituteFaceplateParams` + `SvgObject` per child — but with no real
// instance params (there is none here, we're editing the definition itself),
// so each declared param substitutes to its own name as a visible placeholder
// (e.g. `{tag_prefix}` → "tag_prefix"), and no live tag data (`tagValues={}}`).
function FaceplatePreview({
  objects, params, faceplates,
}: { objects: SynopticObject[]; params: (string | FaceplateParamDef)[]; faceplates: FaceplateDef[] }) {
  const { t } = useTranslation();
  const dummyParams = Object.fromEntries(params.map((p) =>
    typeof p === "string" ? [p, p] : [p.name, p.default ?? p.name]));

  const PADDING = 12;
  const bbox = objects.reduce((acc, o) => {
    const w = o.width ?? 60, h = o.height ?? 40;
    return {
      minX: Math.min(acc.minX, o.x), minY: Math.min(acc.minY, o.y),
      maxX: Math.max(acc.maxX, o.x + w), maxY: Math.max(acc.maxY, o.y + h),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
  const hasObjects = Number.isFinite(bbox.minX);
  const viewBox = hasObjects
    ? `${bbox.minX - PADDING} ${bbox.minY - PADDING} ${bbox.maxX - bbox.minX + 2 * PADDING} ${bbox.maxY - bbox.minY + 2 * PADDING}`
    : "0 0 300 220";

  if (!hasObjects) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", height: 200,
        border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 4,
        color: "var(--brand-text-subtle, #64748b)", fontSize: 12,
      }}>
        {t("cfgUi.noObjects")}
      </div>
    );
  }

  return (
    <svg
      width="100%" height={240} viewBox={viewBox}
      style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4 }}
    >
      {objects.map((child, i) => (
        <SvgObject
          key={child.id ?? i}
          obj={substituteFaceplateParams(child, dummyParams)}
          objects={objects}
          tagValues={{}}
          selected={false}
          isEditMode={false}
          customSymbols={[]}
          faceplates={faceplates}
        />
      ))}
    </svg>
  );
}

// ── FACEPLATES tab ────────────────────────────────────────────────────────────

export function FaceplatesTab() {
  const { t } = useTranslation();
  const storeFaceplates   = useAppStore((s) => s.faceplates);
  const setFaceplates     = useAppStore((s) => s.setFaceplates);
  // F6.5: trova-usi — istanze piazzate e pulsanti popup che referenziano
  // ogni definizione, cross-pagina.
  const allPages          = useAppStore((s) => s.pages);
  const usageOf = (defId: string) => {
    const pageNames = new Set<string>();
    let instances = 0;
    let popups = 0;
    for (const pg of allPages) {
      for (const o of pg.objects) {
        if (o.type === "faceplate" && o.faceplate_id === defId) { instances++; pageNames.add(pg.name); }
        if (o.button_action?.type === "open_faceplate" && o.button_action.faceplate_id === defId) { popups++; pageNames.add(pg.name); }
      }
    }
    return { instances, popups, pages: [...pageNames] };
  };
  const [faceplates, setLocal] = useState<FaceplateDef[]>(storeFaceplates);
  const [selected, setSelezionato] = useState<string | null>(
    storeFaceplates[0]?.id ?? null
  );
  // Il secondo livello dell'albero ⚙ (24-09-2026): una foglia per faceplate.
  // Ogni scelta fatta qui aggiorna anche la foglia evidenziata, e una foglia
  // scelta nell'albero sceglie il faceplate: le due selezioni sono una.
  const setConfigFocus = useAppStore((s) => s.setConfigFocus);
  const setSelected = (id: string | null) => {
    setSelezionato(id);
    if (id !== null) setConfigFocus(id);
  };
  // Gli id modificati e non ancora scritti: il Salva unico li scrive tutti.
  const [modificati, setModificati] = useState<Set<string>>(new Set());
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // Load all faceplates (including built-ins from the API) on mount.
  useEffect(() => {
    api.listFaceplates()
      .then(async (ids) => {
        const loaded = await Promise.all(ids.map((id) => api.getFaceplate(id)));
        setLocal(loaded);
        setFaceplates(loaded);
        if (!selected && loaded.length > 0) setSelected(loaded[0].id);
      })
      .catch((e) => setLoadErr(String(e)));
  }, []);

  const current = faceplates.find((f) => f.id === selected) ?? null;

  usePubblicaElenco("faceplates", faceplates.map((f) => ({ id: f.id, etichetta: f.label || f.id, modificato: modificati.has(f.id) })));
  const focus = useFocus("faceplates", faceplates.map((f) => f.id));
  useEffect(() => { if (focus !== null) setSelezionato(focus); }, [focus]);

  function updateCurrent(patch: Partial<FaceplateDef>) {
    if (!current) return;
    setModificati((m) => new Set(m).add(current.id));
    setLocal((prev) => prev.map((f) => f.id === current.id ? { ...f, ...patch } : f));
  }

  function addFaceplate() {
    const id = genId("fp-");
    const fp: FaceplateDef = { id, label: "Nuovo faceplate", params: ["tag_prefix", "label"], objects: [] };
    setModificati((m) => new Set(m).add(id));
    setLocal((prev) => [...prev, fp]);
    setSelected(id);
  }

  /** La bozza di questa scheda per il Salva unico: ogni faceplate toccato,
   *  uno per file (un faceplate è un file suo, non una sezione di
   *  project.yaml). */
  async function saveModificati() {
    const da = faceplates.filter((f) => modificati.has(f.id));
    for (const fp of da) await api.saveFaceplate(fp);
    setFaceplates(faceplates);
    setModificati(new Set());
  }

  async function deleteCurrent() {
    if (!current) return;
    if (!window.confirm(t("cfg.deleteFaceplateConfirm", { label: current.label }))) return;
    try {
      await api.deleteFaceplate(current.id);
      const updated = faceplates.filter((f) => f.id !== current.id);
      setModificati((m) => { const n = new Set(m); n.delete(current.id); return n; });
      setLocal(updated);
      setFaceplates(updated);
      setSelected(updated[0]?.id ?? null);
    } catch (e) {
      setLoadErr(String(e));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden", height: "100%" }}>
      <div style={{ padding: "0 12px", flexShrink: 0 }}>
        <SaveBar onSave={saveModificati} section="faceplates" dirty={modificati.size > 0} />
      </div>
      <div style={{
        padding: "10px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)",
        color: "var(--brand-text-muted, #94a3b8)", fontSize: 12.5, lineHeight: 1.5, flexShrink: 0,
      }}>
        <Trans i18nKey="cfgUi.faceplateIntro" components={TRANS_COMP} />
      </div>
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
      {/* Left: faceplate list */}
      <div style={{ width: 220, borderRight: "1px solid var(--brand-surface, #1e293b)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 12px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", letterSpacing: 0.5 }}>FACEPLATES</span>
          <button style={S.btn("ghost")} onClick={addFaceplate}>{t("cfgUi.new")}</button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {faceplates.map((fp) => (
            <div
              key={fp.id}
              onClick={() => setSelected(fp.id)}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: selected === fp.id ? "var(--brand-surface, #1e293b)" : "transparent",
                borderLeft: selected === fp.id ? "2px solid var(--brand-warning, #f59e0b)" : "2px solid transparent",
              }}
            >
              <div style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)", fontWeight: selected === fp.id ? 600 : 400 }}>{fp.label}</div>
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{fp.id}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: faceplate editor */}
      {current ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "10px 16px", borderBottom: "1px solid var(--brand-surface, #1e293b)", display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-warning, #f59e0b)" }}>{current.label}</span>
            <span style={{ flex: 1 }} />
            {loadErr && <span style={{ fontSize: 12, color: "var(--brand-danger, #ef4444)" }}>{loadErr}</span>}
            <button style={S.btn("danger")} onClick={deleteCurrent}>{t("common.delete")}</button>
          </div>
          <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "auto", padding: "16px" }}>
              {(() => {
                const u = usageOf(current.id);
                return (
                  <div style={{ fontSize: 11, color: u.instances + u.popups > 0 ? "var(--brand-warning, #f59e0b)" : "var(--brand-text-subtle, #64748b)", marginBottom: 10 }}>
                    {u.instances + u.popups === 0
                      ? t("cfgUi.noUsageInThisProject")
                      : t("cfgUi.usedBy", { instances: u.instances, popups: u.popups, pages: u.pages.join(", ") })}
                  </div>
                );
              })()}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>ID</label>
                  <input
                    style={S.input}
                    value={current.id}
                    onChange={(e) => updateCurrent({ id: e.target.value })}
                    spellCheck={false}
                  />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("cfg.labelWord")}</label>
                  <input
                    style={S.input}
                    value={current.label}
                    onChange={(e) => updateCurrent({ label: e.target.value })}
                    spellCheck={false}
                  />
                </div>
              </div>
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                  <Trans i18nKey="cfgUi.faceplateParams" components={TRANS_COMP} />
                </label>
                <textarea
                  value={current.params.map((p) => {
                    if (typeof p === "string") return p;
                    const tipo = p.type ? `:${p.type}${p.type === "istanza" && p.type_ref ? `(${p.type_ref})` : ""}` : "";
                    return `${p.name}${tipo}${p.default !== undefined ? `=${p.default}` : ""}${p.required ? "!" : ""}`;
                  }).join("\n")}
                  onChange={(e) => updateCurrent({ params: e.target.value.split("\n").map(s => s.trim()).filter(Boolean).map((line) => {
                    // `istanza(Motore)`: il tipo del progetto di cui il
                    // parametro vuole un'istanza, opzionale come tutto il resto.
                    const m = /^(\w+)(?::(tag|string|number|color|istanza)(?:\(([\w-]+)\))?)?(?:=([^!]*))?(!)?$/.exec(line);
                    if (!m) return line; // riga non parsabile: resta stringa nuda
                    const [, name, type, ref, dflt, req] = m;
                    if (!type && dflt === undefined && !req) return name;
                    return { name, ...(type ? { type: type as FaceplateParamDef["type"] } : {}),
                             ...(ref ? { type_ref: ref } : {}),
                             ...(dflt !== undefined ? { default: dflt } : {}), ...(req ? { required: true } : {}) };
                  }) })}
                  style={{ ...S.input, height: 80, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                  spellCheck={false}
                />
              </div>
              <div>
                <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>
                  <Trans i18nKey="cfgUi.faceplateObjects" values={{ ph: "{tag_prefix}" }} components={TRANS_COMP} />
                </label>
                <textarea
                  value={JSON.stringify(current.objects, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value);
                      if (Array.isArray(parsed)) updateCurrent({ objects: parsed });
                    } catch { /* invalid JSON — ignore until valid */ }
                  }}
                  style={{ ...S.input, height: 340, resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
                  spellCheck={false}
                />
              </div>
            </div>
            {/* Anteprima live: legge current.objects/current.params, gli stessi
                dati che la textarea "Oggetti" scrive a ogni tasto valido —
                nessuno stato nuovo, si aggiorna da sé prima ancora di Salva. */}
            <div style={{ width: 320, flexShrink: 0, borderLeft: "1px solid var(--brand-surface, #1e293b)", padding: "16px", overflow: "auto" }}>
              <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 6 }}>
                Anteprima
              </label>
              <FaceplatePreview objects={current.objects} params={current.params} faceplates={faceplates} />
            </div>
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--brand-text-subtle, #64748b)", fontSize: 14 }}>
          {t("cfgUi.selectOrCreateAFaceplate")}
        </div>
      )}
      </div>
    </div>
  );
}
