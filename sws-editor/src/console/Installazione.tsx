import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { scheda, titoletto } from "./stile";

/**
 * «Cos'è questa macchina».
 *
 * Sembra la pagina meno utile ed è quella che si cerca per prima quando
 * qualcosa non torna: versione, modalità, dove stanno i progetti. Le stesse
 * domande a cui risponde `STATO.md` sul VPS, ma da dentro.
 */
export function Installazione() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<Record<string, unknown> | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSystemStatus()
      .then((s) => setStato(s as unknown as Record<string, unknown>))
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) return <div style={scheda}>{err}</div>;
  if (!stato) return <div style={scheda}>{t("console.verifica")}</div>;

  const voci: [string, unknown][] = [
    [t("console.installazione.versione"), stato.runtime_version],
    [t("console.installazione.modo"), stato.mode],
    [t("console.installazione.progetto"), stato.active_project ?? "—"],
    [t("console.installazione.autenticazione"), stato.auth_required ? t("console.si") : t("console.no")],
    [t("console.installazione.container"), stato.container ? t("console.si") : t("console.no")],
    [t("console.installazione.host"), stato.hostname],
    [t("console.installazione.arch"), stato.arch],
  ];

  return (
    <div style={{ ...scheda, maxWidth: 620 }}>
      {voci.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
          <span style={{ ...titoletto, marginBottom: 0, width: 200, flexShrink: 0 }}>{k}</span>
          <span style={{ fontSize: 13 }}>{String(v ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}
