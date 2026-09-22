// Rinominare una variabile ovunque (Fase 0c): il nuovo id, l'anteprima dei
// punti che cambieranno, e la conferma. Si applica **subito**, a progetto
// salvato: a progetto sporco la finestra dice di salvare prima, perché una
// rinomina fusa con nove bozze aperte sarebbe un rompicapo da riconciliare.

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { selectIsDirty, useAppStore } from "@/store";
import { motivoIdNonValido, rinomina, type EsitoRinomina } from "@/tag/rinominaTag";
import type { RecipeDef } from "@/types";

const INPUT: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  color: "var(--brand-text, #e2e8f0)", padding: "6px 8px", fontSize: 12, fontFamily: "monospace",
};
const BTN = (primario: boolean): React.CSSProperties => ({
  padding: "6px 14px", borderRadius: 4, fontSize: 12, cursor: "pointer",
  border: "1px solid " + (primario ? "var(--brand-primary, #3b82f6)" : "var(--brand-border, #475569)"),
  background: primario ? "var(--brand-primary, #3b82f6)" : "transparent",
  color: primario ? "var(--brand-on-primary, #0f172a)" : "var(--brand-text, #e2e8f0)",
});

export function RinominaTagModal({ vecchio, onDone, onClose }: {
  vecchio: string;
  /** Chiamata dopo una rinomina riuscita, con l'esito, prima di chiudere. */
  onDone: (e: EsitoRinomina) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const pages = useAppStore((s) => s.pages);
  const faceplates = useAppStore((s) => s.faceplates);
  const sporco = useAppStore(selectIsDirty);
  const rinominaTag = useAppStore((s) => s.rinominaTag);
  const [nuovo, setNuovo] = useState(vecchio);
  const [recipes, setRecipes] = useState<RecipeDef[] | null>(null);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);

  // Le ricette sono file: si leggono una volta all'apertura.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const lista = await api.listRecipes();
        const tutte = await Promise.all(lista.map((r) => api.getRecipe(r.id)));
        if (vivo) setRecipes(tutte);
      } catch {
        if (vivo) setRecipes([]);
      }
    })();
    return () => { vivo = false; };
  }, []);

  const esistenti = useMemo(() => new Set((project?.tags ?? []).map((x) => x.id)), [project]);
  const motivo = motivoIdNonValido(nuovo, esistenti, vecchio);

  // L'anteprima è lo stesso walker della rinomina, senza scrivere: dice dove.
  const anteprima = useMemo(() => {
    if (!project || recipes === null) return null;
    return rinomina(vecchio, nuovo.trim() || vecchio, {
      pages, faceplates, tags: project.tags, sources: project.sources,
      alarms: project.alarms ?? [], globalScripts: project.global_scripts ?? [], recipes,
    });
  }, [project, pages, faceplates, recipes, vecchio, nuovo]);
  const totale = anteprima?.punti.reduce((a, p) => a + p.n, 0) ?? 0;

  const conferma = async () => {
    if (motivo || sporco || recipes === null) return;
    setInCorso(true); setErrore(null);
    try {
      const e = await rinominaTag(vecchio, nuovo.trim(), recipes);
      onDone(e);
      onClose();
    } catch (err) {
      setErrore(t("rinomina.errore", { message: err instanceof Error ? err.message : String(err) }));
    } finally {
      setInCorso(false);
    }
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000 }}
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 8, padding: 20, width: 520, maxWidth: "95vw", maxHeight: "85vh", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>
          {t("rinomina.title")} · <span style={{ fontFamily: "monospace", fontWeight: 400 }}>{vecchio}</span>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block", marginBottom: 3 }}>{t("rinomina.nuovoId")}</label>
          <input style={{ ...INPUT, ...(motivo && nuovo !== vecchio ? { borderColor: "var(--brand-danger, #ef4444)" } : {}) }} value={nuovo}
                 onChange={(e) => setNuovo(e.target.value)} autoFocus spellCheck={false}
                 onKeyDown={(e) => { if (e.key === "Enter") void conferma(); if (e.key === "Escape") onClose(); }} />
          {motivo && nuovo !== vecchio && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)", marginTop: 3 }}>{motivo}</div>}
        </div>
        {sporco && (
          <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)", border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4, padding: "6px 8px" }}>
            {t("rinomina.salvaPrima")}
          </div>
        )}
        <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", overflowY: "auto", flex: 1 }}>
          {anteprima === null ? t("rinomina.caricamento")
            : anteprima.punti.length === 0 && anteprima.nonRinominabili.length === 0 ? t("rinomina.nessunUso")
            : (
              <>
                {anteprima.punti.length > 0 && <div style={{ marginBottom: 4 }}>{t("rinomina.punti", { n: totale })}</div>}
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {anteprima.punti.map((p, i) => (
                    <li key={i}>{p.dove}{p.n > 1 ? ` · ${t("rinomina.occorrenze", { n: p.n })}` : ""}</li>
                  ))}
                </ul>
                {anteprima.nonRinominabili.length > 0 && (
                  <>
                    <div style={{ marginTop: 8, color: "var(--brand-warning, #f59e0b)" }}>{t("rinomina.nonRinominabili")}</div>
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--brand-warning, #f59e0b)" }}>
                      {anteprima.nonRinominabili.map((p, i) => <li key={i}>{p.dove}</li>)}
                    </ul>
                  </>
                )}
              </>
            )}
        </div>
        {errore && <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button style={BTN(false)} onClick={onClose}>{t("common.cancel")}</button>
          <button style={{ ...BTN(true), opacity: motivo || sporco || inCorso || recipes === null ? 0.5 : 1 }}
                  onClick={() => void conferma()} disabled={!!motivo || sporco || inCorso || recipes === null}>
            {inCorso ? t("rinomina.inCorso") : t("rinomina.conferma")}
          </button>
        </div>
      </div>
    </div>
  );
}
