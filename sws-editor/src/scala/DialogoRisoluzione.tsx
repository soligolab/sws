// «Cambia risoluzione del progetto…» (15-10-2026, piano
// docs/plans/2026-10-15-scalare-tra-risoluzioni.md): sceglie Da/A e le pagine da
// convertire, mostra il fattore e la fascia libera, converte con un annulla solo.

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { getDevicePresets, STANDARD_DEVICE_PRESETS } from "@/pageLayout";
import { eBoot } from "@/boot/tipi";
import { eCornice } from "@/cornici/modello";
import { salvaLayout } from "@/formatoProgettoAzioni";
import { fattore, misuraDaProporre, type Misura } from "./scalaPagina";

const INPUT: React.CSSProperties = {
  width: "100%", background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 6px", fontSize: 13,
  boxSizing: "border-box",
};
const LABEL: React.CSSProperties = { fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 2 };
const BOTTONE: React.CSSProperties = {
  background: "var(--brand-surface-2, #334155)", color: "var(--brand-text-2, #cbd5e1)",
  border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "5px 12px", fontSize: 13, cursor: "pointer",
};

const uguale = (a: Misura | null, w?: number, h?: number) => !!a && a.width === w && a.height === h;

export function DialogoRisoluzione({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const pages = useAppStore((s) => s.pages);
  const scalaProgetto = useAppStore((s) => s.scalaProgetto);
  const predefinita = useAppStore((s) => s.project?.page_layout);
  const proposta = useMemo(() => misuraDaProporre(pages, predefinita), [pages, predefinita]);
  const [da, setDa] = useState<Misura | null>(proposta);
  const [a, setA] = useState<Misura>({ width: 1280, height: 800 });
  const [scelte, setScelte] = useState<Set<string>>(
    () => new Set(pages.filter((p) => uguale(proposta, p.width, p.height)).map((p) => p.id)));
  const [errore, setErrore] = useState<string | null>(null);

  const misure = useMemo(() => {
    const m = new Map<string, Misura>();
    for (const p of pages) if (p.width && p.height) m.set(`${p.width}×${p.height}`, { width: p.width, height: p.height });
    return [...m.entries()];
  }, [pages]);
  const preset = [...STANDARD_DEVICE_PRESETS, ...getDevicePresets().filter((d) => !STANDARD_DEVICE_PRESETS.some((s) => s.label === d.label))];
  const t0 = da && a.width > 0 && a.height > 0 ? fattore(da, a) : null;
  const tipo = (p: (typeof pages)[number]) =>
    eCornice(p) ? t("scala.tipoCornice") : eBoot(p) ? t("scala.tipoBoot") : t("scala.tipoPagina");

  const scegliDa = (k: string) => {
    const m = misure.find(([kk]) => kk === k)?.[1] ?? null;
    setDa(m);
    setScelte(new Set(pages.filter((p) => uguale(m, p.width, p.height)).map((p) => p.id)));
  };

  const converti = async () => {
    if (!da || scelte.size === 0) return;
    // Solo le pagine della misura «Da»: una pagina d'altra misura scelta a mano
    // si converte dalla sua (la funzione legge la misura della pagina).
    scalaProgetto([...scelte], a);
    const layout = useAppStore.getState().project?.page_layout;
    if (layout && uguale(da, layout.default_width, layout.default_height)) {
      try {
        await salvaLayout({ ...layout, default_width: a.width, default_height: a.height });
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
        return;
      }
    }
    onClose();
  };

  return (
    <div role="dialog" aria-modal="true" data-testid="dialogo-risoluzione"
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)",
          borderRadius: 8, padding: 16, width: 460, maxWidth: "92vw", maxHeight: "86vh", overflow: "auto", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{t("scala.titolo")}</div>
        <p style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", margin: 0 }}>{t("scala.spiegazione")}</p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div>
            <div style={LABEL}>{t("scala.da")}</div>
            <select style={INPUT} data-testid="scala-da" value={da ? `${da.width}×${da.height}` : ""} onChange={(e) => scegliDa(e.target.value)}>
              {misure.map(([k]) => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <div>
            <div style={LABEL}>{t("scala.a")}</div>
            <select style={INPUT} data-testid="scala-a-preset" value=""
              onChange={(e) => { const p = preset.find((d) => d.label === e.target.value); if (p) setA({ width: p.width, height: p.height }); }}>
              <option value="">{t("scala.scegliPreset")}</option>
              {preset.map((d) => <option key={d.label} value={d.label}>{d.label}</option>)}
            </select>
            <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
              <input type="number" min={1} style={INPUT} data-testid="scala-a-w" value={a.width}
                onChange={(e) => setA({ ...a, width: Number(e.target.value) || 0 })} />
              <span style={{ alignSelf: "center" }}>×</span>
              <input type="number" min={1} style={INPUT} data-testid="scala-a-h" value={a.height}
                onChange={(e) => setA({ ...a, height: Number(e.target.value) || 0 })} />
            </div>
          </div>
        </div>
        {t0 && (
          <div data-testid="scala-anteprima" style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
            {t("scala.anteprima", {
              f: t0.f.toFixed(3),
              fascia: t0.dy > 0.5 ? t("scala.fasciaSopraSotto", { px: Math.round(t0.dy) })
                : t0.dx > 0.5 ? t("scala.fasciaLati", { px: Math.round(t0.dx) }) : t("scala.fasciaNessuna"),
            })}
          </div>
        )}
        <div>
          <div style={LABEL}>{t("scala.cosaConvertire")}</div>
          <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, maxHeight: 220, overflow: "auto", padding: 4 }}>
            {pages.map((p) => (
              <label key={p.id} style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, padding: "2px 4px", cursor: "pointer" }}>
                <input type="checkbox" checked={scelte.has(p.id)}
                  onChange={(e) => {
                    const n = new Set(scelte);
                    if (e.target.checked) n.add(p.id); else n.delete(p.id);
                    setScelte(n);
                  }} />
                <span style={{ flex: 1 }}>{p.name}</span>
                <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{tipo(p)} · {p.width && p.height ? `${p.width}×${p.height}` : t("scala.fluida")}</span>
              </label>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", margin: 0 }}>{t("scala.nota")}</p>
        {errore && <div style={{ color: "var(--brand-danger, #ef4444)", fontSize: 12 }}>{errore}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={BOTTONE} onClick={onClose}>{t("scala.annulla")}</button>
          <button type="button" data-testid="scala-converti" disabled={!da || scelte.size === 0 || !(a.width > 0 && a.height > 0)}
            style={{ ...BOTTONE, background: "var(--brand-primary, #3b82f6)", color: "#fff", border: "none" }}
            onClick={() => { void converti(); }}>
            {t("scala.converti", { count: scelte.size })}
          </button>
        </div>
      </div>
    </div>
  );
}
