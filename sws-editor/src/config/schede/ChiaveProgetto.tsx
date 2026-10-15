// La chiave SSH del progetto (15-10-2026, piano docs/plans/2026-10-15-git-nel-cloud.md).
//
// Nel cloud il container del progetto non ha un `~/.ssh` suo, e si ricrea a ogni
// apertura: la chiave vive in `.git/sws-ssh/` del progetto, la genera il runtime,
// e qui si vede solo la parte **pubblica**, da incollare come deploy key.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";

export const CHIAVE_PROGETTO = "@sws";

export function ChiaveProgetto({ inUso, onUsa, onGenerata, disabled }: {
  /** La chiave del progetto è già quella del repository. */
  inUso: boolean;
  /** Assente = non c'è ancora un repository a cui assegnarla (form di aggancio). */
  onUsa?: () => void;
  onGenerata: () => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [pubblica, setPubblica] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  const [copiata, setCopiata] = useState(false);
  useEffect(() => { api.getChiaveProgetto().then((r) => setPubblica(r.pubblica)).catch(() => setPubblica(null)); }, []);

  const genera = async () => {
    setBusy(true); setErrore(null);
    try {
      const r = await api.generaChiaveProgetto();
      setPubblica(r.pubblica);
      onGenerata();
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const copia = async () => {
    if (!pubblica) return;
    try { await navigator.clipboard.writeText(pubblica); setCopiata(true); setTimeout(() => setCopiata(false), 1500); } catch { /* il testo resta selezionabile */ }
  };
  const bottone = { padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, fontSize: 11, cursor: "pointer" } as const;

  return (
    <div data-testid="chiave-progetto" style={{ display: "flex", flexDirection: "column", gap: 6, padding: 8, border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>
      <div style={{ fontWeight: 600, color: "var(--brand-text-2, #cbd5e1)" }}>{t("cfgUi.chiaveProgetto")}</div>
      {pubblica === null ? (
        <>
          <span style={{ lineHeight: 1.4 }}>{t("cfgUi.chiaveProgettoSpiega")}</span>
          <div><button style={bottone} disabled={disabled || busy} onClick={genera} data-testid="genera-chiave-progetto">
            {busy ? "…" : t("cfgUi.chiaveProgettoGenera")}
          </button></div>
        </>
      ) : (
        <>
          <textarea readOnly value={pubblica} rows={3} data-testid="chiave-pubblica"
            onFocus={(e) => e.currentTarget.select()}
            style={{ width: "100%", boxSizing: "border-box", resize: "vertical", fontFamily: "monospace", fontSize: 11, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: 6 }} />
          <span style={{ lineHeight: 1.4 }}>{t("cfgUi.chiaveProgettoDeployKey")}</span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button style={bottone} onClick={copia}>{copiata ? t("cfgUi.chiaveProgettoCopiata") : t("cfgUi.chiaveProgettoCopia")}</button>
            {onUsa && !inUso && <button style={bottone} disabled={disabled} onClick={onUsa}>{t("cfgUi.chiaveProgettoUsa")}</button>}
            {inUso && <span style={{ color: "var(--brand-success-soft, #4ade80)", alignSelf: "center" }}>✓ {t("cfgUi.chiaveProgettoInUso")}</span>}
          </div>
        </>
      )}
      {errore && <span style={{ color: "var(--brand-danger-soft, #f87171)" }}>{errore}</span>}
    </div>
  );
}
