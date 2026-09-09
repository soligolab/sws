// La lista di controlli che il sondaggio (Q52) riporta dal dispositivo: una
// riga per controllo, ✓/⚠/✗, il rimedio sotto in piccolo. Componente puro:
// riceve la risposta del server e la disegna, niente stato, niente rete.
import { useTranslation } from "react-i18next";
import type { EsitoControllo, SondaggioDispositivo } from "@/api/client";
import { esitoComplessivo, etichettaDispositivo } from "./sondaggio";

const COLORE: Record<EsitoControllo, string> = {
  ok: "var(--brand-success-soft, #4ade80)",
  avviso: "var(--brand-warning-soft, #fbbf24)",
  errore: "var(--brand-danger-soft, #f87171)",
};
const SIMBOLO: Record<EsitoControllo, string> = { ok: "✓", avviso: "⚠", errore: "✗" };
const BORDO: Record<EsitoControllo, string> = {
  ok: "var(--brand-success, #22c55e)",
  avviso: "var(--brand-warning, #f59e0b)",
  errore: "var(--brand-danger, #ef4444)",
};

export function ListaControlli({ sondaggio }: { sondaggio: SondaggioDispositivo }) {
  const { t } = useTranslation();
  const complessivo: EsitoControllo = sondaggio.ok_ssh ? esitoComplessivo(sondaggio.controlli) : "errore";
  const sws = sondaggio.sws;
  return (
    <div style={{
      border: `1px solid ${BORDO[complessivo]}`, borderRadius: 4, padding: "8px 10px",
      display: "flex", flexDirection: "column", gap: 6, fontSize: 12,
    }}>
      {sondaggio.dispositivo ? (
        <div style={{ color: "var(--brand-text, #e2e8f0)", fontWeight: 600 }}>
          {etichettaDispositivo(sondaggio.dispositivo)}
        </div>
      ) : (
        <div style={{ color: COLORE.errore, fontWeight: 600 }}>{t("cfg.probeNoSsh")}</div>
      )}
      {sondaggio.ok_ssh && (
        <div style={{ color: "var(--brand-text-muted, #94a3b8)" }}>
          {sws.installato
            ? t("cfg.probeSwsInstalled", {
                ver: sws.versione ?? sws.immagine ?? "?",
                stato: sws.attivo === null ? "?" : sws.attivo ? t("cfg.probeSwsActive") : t("cfg.probeSwsStopped"),
              })
            : t("cfg.probeSwsAbsent")}
        </div>
      )}
      {sondaggio.controlli.map((c) => (
        <div key={c.id}>
          <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
            <span style={{ color: COLORE[c.esito], fontWeight: 700, width: 14, flexShrink: 0 }}>{SIMBOLO[c.esito]}</span>
            <span style={{ color: "var(--brand-text, #e2e8f0)" }}>{c.titolo}</span>
            <span style={{ color: "var(--brand-text-muted, #94a3b8)" }}>— {c.dettaglio}</span>
          </div>
          {c.rimedio && (
            <div style={{ marginLeft: 20, fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{c.rimedio}</div>
          )}
        </div>
      ))}
      {!sondaggio.ok_ssh && sondaggio.diagnostica.length > 0 && (
        <div style={{ fontFamily: "monospace", fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>
          {sondaggio.diagnostica.slice(0, 4).map((r, i) => <div key={i}>{r}</div>)}
        </div>
      )}
    </div>
  );
}
