// La tabella dei dispositivi in rete (Q52): tutto ciò che mDNS vede — ssh,
// sftp, workstation — e i runtime SWS già presenti, segnati come tali. Nessun
// filtro per produttore: la macchina la riconosce l'utente dal nome, e a dire
// se è pronta pensa il sondaggio, dopo, con le credenziali.
import React from "react";
import { useTranslation } from "react-i18next";
import type { DispositivoRete } from "@/api/client";

const PILL: React.CSSProperties = {
  display: "inline-block", padding: "1px 6px", borderRadius: 8, fontSize: 10,
  background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-muted, #94a3b8)",
  marginRight: 4,
};
const PILL_SWS: React.CSSProperties = {
  ...PILL, background: "#14532d", color: "var(--brand-success-soft, #4ade80)",
};

export function TabellaDispositivi(props: {
  dispositivi: DispositivoRete[] | null;
  inCorso: boolean;
  errore: "unreachable" | "generic" | null;
  onScegli: (host: string) => void;
}) {
  const { t } = useTranslation();
  const { dispositivi, inCorso, errore, onScegli } = props;
  if (errore) {
    return (
      <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #f87171)" }}>
        {errore === "unreachable" ? t("cfg.discoverUnreachable") : t("cfg.discoverFailed")}
      </div>
    );
  }
  if (dispositivi === null) return null;
  if (dispositivi.length === 0 && !inCorso) {
    return <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.devicesNone")}</div>;
  }
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)", color: "var(--brand-text-subtle, #64748b)" }}>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600, fontSize: 11 }}>{t("cfg.devicesColHost")}</th>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600, fontSize: 11 }}>{t("cfg.devicesColAddress")}</th>
            <th style={{ textAlign: "left", padding: "4px 6px", fontWeight: 600, fontSize: 11 }}>{t("cfg.devicesColServices")}</th>
          </tr>
        </thead>
        <tbody>
          {dispositivi.map((d) => (
            <tr key={d.hostname}
              onClick={() => onScegli(d.hostname || d.indirizzo)}
              title={t("cfg.devicesPick")}
              style={{ cursor: "pointer", borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
              <td style={{ padding: "5px 6px", color: "var(--brand-text, #e2e8f0)", fontWeight: 600 }}>{d.hostname}</td>
              <td style={{ padding: "5px 6px", color: "var(--brand-text-muted, #94a3b8)", fontFamily: "monospace", fontSize: 11 }}>{d.indirizzo}</td>
              <td style={{ padding: "5px 6px" }}>
                {d.servizi.filter((s) => s !== "sws").map((s) => <span key={s} style={PILL}>{s}</span>)}
                {d.sws.presente && (
                  <span style={PILL_SWS}>{t("cfg.devicesSwsPresent", { ver: d.sws.versione ?? "?" })}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
