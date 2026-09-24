import React, { useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { applyStateColor, listSvgIds, parseSvg, sanitizeSvg } from "@/symbols/customSvg";
import { useAppStore } from "@/store";
import { TRANS_COMP } from "@/config/comuni";

// ── ResourcesTab ─────────────────────────────────────────────────────────────

const LICENSE_OPTIONS = ["CC0 1.0", "CC-BY 4.0", "Apache-2.0", "MIT", "BSD-2-Clause", "Public domain"];

const EMPTY_FORM = { label: "", url: "", author: "", source: "", license: "CC0 1.0" };

export function ResourcesTab() {
  const { t } = useTranslation();
  const customSymbols          = useAppStore((s) => s.customSymbols);
  const updateProjectCustomSymbols = useAppStore((s) => s.updateProjectCustomSymbols);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);
  // F6.9: editor multi-stato — id del simbolo in modifica.
  const [svgEditId, setSvgEditId] = useState<string | null>(null);
  const svgFileRef = useRef<HTMLInputElement>(null);

  const persist = async (next: typeof customSymbols) => {
    setSaving(true); setError(null);
    try {
      await api.updateCustomSymbols(next);
      updateProjectCustomSymbols(next);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const add = async () => {
    if (!form.label.trim() || !form.url.trim()) return;
    const id = form.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (customSymbols.some((s) => s.id === id)) {
      setError(t("cfgUi.symbolExists", { id }));
      return;
    }
    const next = [
      ...customSymbols,
      { id, label: form.label.trim(), url: form.url.trim(),
        attribution: { author: form.author.trim(), source: form.source.trim(), license: form.license } },
    ];
    await persist(next);
    if (!error) setForm(EMPTY_FORM);
  };

  const remove = (id: string) => persist(customSymbols.filter((s) => s.id !== id));

  const inp: React.CSSProperties = {
    background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
    color: "var(--brand-text, #e2e8f0)", padding: "4px 8px", fontSize: 13, width: "100%", boxSizing: "border-box",
  };
  const lbl: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 2 };

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 24, maxWidth: 700 }}>

      {/* Simboli già aggiunti */}
      <section>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12 }}>
          SIMBOLI PROGETTO ({customSymbols.length})
        </div>
        {customSymbols.length === 0 ? (
          <div style={{ color: "var(--brand-text-subtle, #94a3b8)", fontSize: 13 }}>{t("cfgUi.noCustomSymbolsAdded")}</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ color: "var(--brand-text-subtle, #64748b)", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
                {["Etichetta", "URL", "Licenza", "Autore / fonte", ""].map((h) => (
                  <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {customSymbols.map((s) => (
                <tr key={s.id} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text, #e2e8f0)" }}>{s.label}</td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand-primary, #3b82f6)" }}>{s.url}</a>
                  </td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)" }}>{s.attribution.license}</td>
                  <td style={{ padding: "6px 8px", color: "var(--brand-text-subtle, #64748b)" }}>{s.attribution.author}{s.attribution.source ? ` / ${s.attribution.source}` : ""}</td>
                  <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>
                    <button
                      onClick={() => setSvgEditId(svgEditId === s.id ? null : s.id)}
                      title={t("cfg.multiStateSvgTitle")}
                      style={{ background: "transparent", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: s.svg ? "#38bdf8" : "var(--brand-text-subtle, #64748b)", cursor: "pointer", padding: "2px 8px", fontSize: 12, marginRight: 4 }}
                    >⚙</button>
                    <button
                      onClick={() => remove(s.id)}
                      style={{ background: "transparent", border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 4, color: "var(--brand-danger-soft, #fca5a5)", cursor: "pointer", padding: "2px 8px", fontSize: 12 }}
                    >{t("props.remove")}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* F6.9: editor multi-stato del simbolo selezionato */}
      {svgEditId && (() => {
        const sym = customSymbols.find((cs) => cs.id === svgEditId);
        if (!sym) return null;
        const ids = sym.svg ? listSvgIds(sym.svg) : [];
        const setSym = (patch: Partial<typeof sym>) =>
          void persist(customSymbols.map((cs) => (cs.id === sym.id ? { ...cs, ...patch } : cs)));
        const toggleColorable = (elId: string) => {
          const cur = new Set(sym.colorable_ids ?? []);
          if (cur.has(elId)) cur.delete(elId); else cur.add(elId);
          setSym({ colorable_ids: cur.size > 0 ? [...cur] : undefined });
        };
        return (
          <section style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid #38bdf8", borderRadius: 6, padding: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#38bdf8", marginBottom: 8 }}>
              MULTI-STATO — {sym.label}
            </div>
            <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", margin: "0 0 8px" }}>
              <Trans i18nKey="cfgUi.svgSymbolHelp" components={TRANS_COMP} />
            </p>
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input ref={svgFileRef} type="file" accept=".svg,image/svg+xml" style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  void f.text().then((text) => setSym({ svg: sanitizeSvg(text), colorable_ids: undefined }));
                  e.target.value = "";
                }} />
              <button onClick={() => svgFileRef.current?.click()}
                style={{ ...inp, width: "auto", cursor: "pointer" }}>{t("cfgUi.importSvg")}</button>
              {sym.svg && (
                <button onClick={() => setSym({ svg: undefined, colorable_ids: undefined })}
                  style={{ ...inp, width: "auto", cursor: "pointer", color: "var(--brand-danger-soft, #fca5a5)" }}>
                  {t("cfgUi.removeSvgBackToUrl")}
                </button>
              )}
            </div>
            {sym.svg && (
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={lbl}>Elementi colorabili ({ids.length} id trovati)</div>
                  {ids.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>
                      {t("cfgUi.noIdInTheSvg")}
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {ids.map((elId) => (
                        <label key={elId} style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "2px 8px", cursor: "pointer" }}>
                          <input type="checkbox" checked={(sym.colorable_ids ?? []).includes(elId)}
                            onChange={() => toggleColorable(elId)} />
                          {elId}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  {(["#64748b", "#22c55e", "#ef4444"] as const).map((color, i) => {
                      // Stessa sanificazione del canvas: questo pannello la saltava, e un
                      // simbolo appena incollato finiva nel DOM così com'era.
                    const { viewBox, inner } = parseSvg(sanitizeSvg(sym.svg!));
                    const colored = (sym.colorable_ids ?? []).length > 0
                      ? applyStateColor(inner, sym.colorable_ids!, color) : inner;
                    return (
                      <div key={i} style={{ textAlign: "center" }}>
                        <svg width={72} height={72} viewBox={viewBox} preserveAspectRatio="xMidYMid meet"
                          style={{ background: "var(--brand-bg, #0f172a)", borderRadius: 4, border: "1px solid var(--brand-surface-2, #334155)" }}>
                          <g dangerouslySetInnerHTML={{ __html: colored }} />
                        </svg>
                        <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>{["off", "on", "alarm"][i]}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </section>
        );
      })()}

      {/* Form aggiunta */}
      <section style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 12 }}>
          {t("cfgUi.addSvgSymbol")}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "8px 12px", alignItems: "start" }}>
          <div>
            <div style={lbl}>Etichetta *</div>
            <input style={inp} placeholder="es. Pompa centrifuga" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} />
          </div>
          <div>
            <div style={lbl}>URL SVG * (https://… oppure /symbols/…)</div>
            <input style={inp} placeholder="https://example.com/pump.svg" value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} />
          </div>
          <div>
            <div style={lbl}>Licenza *</div>
            <select style={{ ...inp, cursor: "pointer" }} value={form.license} onChange={(e) => setForm((f) => ({ ...f, license: e.target.value }))}>
              {LICENSE_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
          </div>
          <div>
            <div style={lbl}>{t("cfg.author")}</div>
            <input style={inp} placeholder="es. Wikimedia Commons / Mario Rossi" value={form.author} onChange={(e) => setForm((f) => ({ ...f, author: e.target.value }))} />
          </div>
          <div style={{ gridColumn: "1 / -1" }}>
            <div style={lbl}>URL fonte (per attribuzione CC-BY)</div>
            <input style={inp} placeholder="https://commons.wikimedia.org/wiki/…" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))} />
          </div>
        </div>
        {error && <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginTop: 8 }}>{error}</div>}
        <div style={{ marginTop: 12, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            onClick={add}
            disabled={saving || !form.label.trim() || !form.url.trim()}
            style={{
              background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4, color: "var(--brand-on-primary, #fff)",
              cursor: saving ? "wait" : "pointer", padding: "6px 20px", fontSize: 13,
              opacity: (!form.label.trim() || !form.url.trim()) ? 0.5 : 1,
            }}
          >{saving ? t("cfgUi.saving") : t("cfgUi.addToProject")}</button>
          <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>
            {t("cfgUi.byConfirmingYouAgreeTo")}
          </span>
        </div>
      </section>
    </div>
  );
}
