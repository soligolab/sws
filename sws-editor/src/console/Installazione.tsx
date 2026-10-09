import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { avviso, scheda, titoletto } from "./stile";
import { identitaPagina, paginaVecchia } from "@/versione";

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
  const [sistema, setSistema] = useState<import("@/api/client").SystemStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getSystemStatus()
      .then((s) => { setSistema(s); setStato(s as unknown as Record<string, unknown>); })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  if (err) return <div style={scheda}>{err}</div>;
  if (!stato) return <div style={scheda}>{t("console.verifica")}</div>;

  const pagina = identitaPagina();
  const vecchia = paginaVecchia(sistema);
  const quando = (ms: unknown) =>
    typeof ms === "number" && ms > 0 ? new Date(ms).toLocaleString() : "—";
  /** «2.12.0 · a19d1c4a · 09/10/2026, 11:24» — versione, revisione, quando. */
  const firma = (v: unknown, git: unknown, ms: unknown) =>
    `${String(v ?? "—")} · ${String(git ?? "—")} · ${quando(ms)}`;

  const voci: [string, unknown][] = [
    // Le due build, una sopra l'altra: sono due artefatti distinti, e fino al
    // 09-10-2026 se ne vedeva uno solo. Il caso che conta e quando divergono.
    [t("console.installazione.buildRuntime"),
      firma(stato.runtime_version, stato.runtime_git, stato.runtime_build_ms)],
    [t("console.installazione.buildPagina"),
      firma(pagina.versione, pagina.git, pagina.costruitoMs)],
    [t("console.installazione.modo"), stato.mode],
    [t("console.installazione.progetto"), stato.active_project ?? "—"],
    [t("console.installazione.autenticazione"), stato.auth_required ? t("console.si") : t("console.no")],
    [t("console.installazione.container"), stato.container ? t("console.si") : t("console.no")],
    [t("console.installazione.host"), stato.hostname],
    [t("console.installazione.arch"), stato.arch],
  ];

  return (
    <div style={{ ...scheda, maxWidth: 620 }}>
      {/* L'avviso solo quando serve: il bundle sul disco e piu recente della
          pagina in esecuzione, cioe il browser ne sta servendo una vecchia. */}
      {vecchia && (
        <div style={{ ...avviso, marginBottom: 10 }}>
          ⚠ {t("console.installazione.paginaVecchia")}
        </div>
      )}
      {voci.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
          <span style={{ ...titoletto, marginBottom: 0, width: 200, flexShrink: 0 }}>{k}</span>
          <span style={{ fontSize: 13 }}>{String(v ?? "—")}</span>
        </div>
      ))}
    </div>
  );
}
