// Gli avvisi del validatore in testata (Fase 0d): quanti sono e, al clic,
// quali. Sono **avvisi**: il progetto è salvato e funziona, ma probabilmente
// non fa quel che si voleva — un tag mappato e mai dichiarato, un allarme su
// un tag che non esiste, un comando MQTT senza `publish_topic`. Fino al
// 22-09-2026 `validate::semantic` lo leggevano solo l'assistente IA e i test.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { destinazioneRilievo, type Destinazione } from "./rilievoDestinazione";

export function RilieviProgetto() {
  const { t } = useTranslation();
  const rilievi = useAppStore((s) => s.rilieviProgetto);
  const aggiornaRilievi = useAppStore((s) => s.aggiornaRilievi);
  const nomeProgetto = useAppStore((s) => s.project?.meta.name);
  const [aperto, setAperto] = useState(false);
  const pages = useAppStore((s) => s.pages);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const setAppMode = useAppStore((s) => s.setAppMode);
  const setCurrentPage = useAppStore((s) => s.setCurrentPage);
  const selectObject = useAppStore((s) => s.selectObject);

  // Il clic porta dove sta il problema e chiude la tendina: aperta, coprirebbe
  // proprio il modulo da correggere. Riaprirla per il rilievo dopo è un clic.
  const vai = (d: Destinazione) => {
    if (d.kind === "config") navigateToConfig(d.tab, d.focus);
    else {
      setAppMode("edit");
      setCurrentPage(d.pageId);
      if (d.objectId) selectObject(d.objectId);
    }
    setAperto(false);
  };
  const ref = useRef<HTMLDivElement>(null);

  // Alla prima apertura di un progetto: i rilievi di com'è, prima di toccarlo.
  useEffect(() => { if (nomeProgetto) void aggiornaRilievi(); }, [nomeProgetto, aggiornaRilievi]);

  useEffect(() => {
    if (!aperto) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setAperto(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [aperto]);

  if (rilievi.length === 0) return null;
  const errori = rilievi.filter((r) => r.severity === "error").length;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setAperto((v) => !v)}
        title={t("rilievi.hint")}
        style={{
          display: "flex", alignItems: "center", gap: 5, background: "transparent", border: "none",
          cursor: "pointer", padding: "2px 4px", fontSize: 12, whiteSpace: "nowrap",
          color: errori > 0 ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-warning, #f59e0b)",
        }}
      >
        {errori > 0 ? "⚠" : "△"} {t("rilievi.conteggio", { n: rilievi.length })}
      </button>
      {aperto && (
        <div style={{
          position: "absolute", top: "100%", left: 0, zIndex: 9000, marginTop: 4, width: 460, maxHeight: 360, overflowY: "auto",
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6,
          boxShadow: "0 4px 16px rgba(0,0,0,0.5)", padding: 10, fontSize: 12,
        }}>
          <div style={{ color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8 }}>{t("rilievi.intro")}</div>
          {rilievi.map((r, i) => {
            const dest = destinazioneRilievo(r.path, pages);
            return (
            <div
              key={i}
              role={dest ? "button" : undefined}
              tabIndex={dest ? 0 : undefined}
              title={dest ? t("rilievi.vai") : undefined}
              onClick={dest ? () => vai(dest) : undefined}
              onKeyDown={dest ? (e) => { if (e.key === "Enter") vai(dest); } : undefined}
              onMouseEnter={dest ? (e) => { e.currentTarget.style.background = "var(--brand-surface-2, #334155)"; } : undefined}
              onMouseLeave={dest ? (e) => { e.currentTarget.style.background = "transparent"; } : undefined}
              style={{ padding: "6px 4px", borderRadius: 4, cursor: dest ? "pointer" : "default", borderTop: i ? "1px solid var(--brand-surface-2, #334155)" : "none" }}
            >
              <div style={{ color: r.severity === "error" ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-text, #e2e8f0)" }}>
                {r.severity === "error" ? "⚠" : "△"} {r.message}
              </div>
              {r.hint && <div style={{ color: "var(--brand-text-muted, #94a3b8)", marginTop: 2 }}>{r.hint}</div>}
              <div style={{ color: "var(--brand-text-subtle, #64748b)", fontFamily: "monospace", fontSize: 11, marginTop: 2 }}>{dest ? "→ " : ""}{r.path}</div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
