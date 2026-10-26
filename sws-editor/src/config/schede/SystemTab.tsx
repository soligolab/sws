import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SystemStatus } from "@/api/client";
import type { AuditEntry, AuditVerifyReport } from "@/types";
import { useAppStore } from "@/store";
import { S } from "@/config/comuni";
import { prefissoGateway } from "@/api/prefisso";
import { etichettaDispositivo } from "@/ws/remoteLogStream";

// ── SYSTEM tab ───────────────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", borderRadius: 4, height: 8, overflow: "hidden", flex: 1 }}>
      <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 4, transition: "width 0.3s" }} />
    </div>
  );
}

function MetricCard({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{value}</div>
    </div>
  );
}

export function SystemTab() {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async (remote: boolean) => {
    try {
      const s = remote ? await api.remoteGetSystemStatus() : await api.getSystemStatus();
      setStatus(s);
      setError(null);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  };

  // "Il runtime" a cui riferirsi è quello connesso quando c'è una connessione
  // remota attiva — non un secondo riquadro affiancato come per Datastore/
  // Backup: qui è un concetto singolare. Azzera lo stato al cambio di
  // sorgente così non si vede per un istante il dato del backend sbagliato.
  useEffect(() => {
    setStatus(null);
    setError(null);
    void fetchStatus(remoteConnected);
    intervalRef.current = setInterval(() => void fetchStatus(remoteConnected), 10_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [remoteConnected]);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const fmtSamples = (n: number) => {
    if (n >= 1_000_000) return t("cfgUi.samplesM", { n: (n / 1_000_000).toFixed(1) });
    if (n >= 1_000)     return t("cfgUi.samplesK", { n: (n / 1_000).toFixed(0) });
    return `${n} campioni`;
  };

  if (error) {
    return (
      <div style={{ color: "var(--brand-danger-soft, #fca5a5)", background: "#450a0a", border: "1px solid #991b1b", borderRadius: 6, padding: "12px 16px", fontSize: 13 }}>
        {t("cfgUi.erroreStatoSistema", { errore: error })}
      </div>
    );
  }

  if (!status) {
    return <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>{t("cfgUi.loading2")}</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
          RUNTIME
          {remoteConnected && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--brand-primary, #3b82f6)" }}> {t("cfgUi.connectedRemoteDevice")}</span>}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <MetricCard icon="🖥" label={t("cfgUi.versione")} value={status.runtime_version} />
          {/* Quale ruolo serve l'istanza interrogata — e con un dispositivo
              connesso questa scheda interroga *lui*, quindi la card dice la
              modalità del device. È il modo per accorgersi di aver collegato
              un editor a un altro editor, che prima era invisibile.
              `mode` assente = runtime più vecchio: non si afferma niente. */}
          <MetricCard
            icon={status.mode === "runtime" ? "🏭" : "✏️"}
            label={t("cfgUi.mode")}
            value={status.mode === "runtime" ? t("cfgUi.modoRuntime")
                 : status.mode === "ide"     ? t("cfgUi.modoIde")
                 :                             t("cfgUi.modoNonDichiarata")}
          />
          <MetricCard icon="📦" label={t("cfgUi.project")} value={status.active_project ?? "—"} />
          <MetricCard icon="⏱" label="Uptime" value={fmtUptime(status.uptime_s)} />
          <MetricCard icon="🏷" label="Tag" value={String(status.tag_count)} />
          <MetricCard icon="📡" label={t("cfgUi.sources")} value={String(status.source_count)} />
          <MetricCard icon="🔔" label={t("cfgUi.activeAlarms")} value={String(status.alarm_active_count)} />
        </div>
        <div style={{ marginTop: 8, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 4 }}>{t("cfgUi.history")}</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{fmtSamples(status.historian_samples)}</div>
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
          SISTEMA
          {remoteConnected && <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--brand-primary, #3b82f6)" }}> {t("cfgUi.connectedRemoteDevice")}</span>}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>⚙ CPU</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.cpu_usage_pct.toFixed(1)}%</span>
            </div>
            <ProgressBar value={status.cpu_usage_pct} max={100} color="#60a5fa" />
          </div>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>💾 RAM</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.mem_used_mb} MB / {status.mem_total_mb} MB</span>
            </div>
            <ProgressBar value={status.mem_used_mb} max={status.mem_total_mb} color="#34d399" />
          </div>
          <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>💿 {t("cfgUi.disco")}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.disk_used_gb} GB / {status.disk_total_gb} GB</span>
            </div>
            <ProgressBar value={status.disk_used_gb} max={status.disk_total_gb} color="#fb923c" />
          </div>
        </div>
      </div>
      {/* Il certificato TLS si governa da Sicurezza → Certificati (25-10-2026,
          «una sezione per dato»): qui solo la strada per arrivarci. */}
      <VaiACertificati />
      <AuditSection />
    </div>
  );
}

// ── Audit log section (inside SystemTab, Admin-only, OPEN_QUESTIONS Q8) ──────
// Read-only view of the append-only, hash-chained audit trail: who did what
// (login, tag writes, script exec, project config changes) + a one-click
// integrity check against the on-disk hash chain.

function AuditSection() {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verify, setVerify] = useState<AuditVerifyReport | null>(null);
  const [verifying, setVerifying] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try { setEntries(await api.getAuditTail(200)); }
    catch (e: unknown) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const runVerify = async () => {
    setVerifying(true); setVerify(null);
    try { setVerify(await api.getAuditVerify()); }
    catch (e: unknown) { setVerify({ ok: false, entries: 0, reason: e instanceof Error ? e.message : String(e) }); }
    finally { setVerifying(false); }
  };

  const fmtTs = (ms: number) => new Date(ms).toLocaleString();

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, flex: 1 }}>
          AUDIT LOG
        </span>
        <button style={S.btn("ghost")} onClick={load} disabled={loading}>{loading ? t("common.aggiorno") : t("common.aggiorna")}</button>
        <button style={S.btn("ghost")} onClick={runVerify} disabled={verifying}>{verifying ? t("cfgUi.verifico") : t("cfgUi.verifyIntegrity")}</button>
      </div>

      {verify && (
        <div style={{
          marginBottom: 10, fontSize: 12, borderRadius: 6, padding: "8px 12px",
          background: verify.ok ? "var(--brand-success-bg, #166534)" : "#450a0a",
          border: `1px solid ${verify.ok ? "#15803d" : "#991b1b"}`,
          color: verify.ok ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #fca5a5)",
        }}>
          {verify.ok
            ? t("cfgUi.catenaIntegra", { n: verify.entries })
            : t("cfgUi.catenaCompromessa", { n: verify.broken_at ?? "?", motivo: verify.reason ?? t("cfgUi.motivoSconosciuto") })}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginBottom: 8 }}>{t("common.errore")}: {error}</div>
      )}

      <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6 }}>
        <table style={{ ...S.table, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 150 }}>{t("cfgUi.quando")}</th>
              <th style={{ ...S.th, width: 110 }}>{t("cfgUi.chi")}</th>
              <th style={{ ...S.th, width: 140 }}>{t("cfgUi.azione")}</th>
              <th style={S.th}>{t("cfgUi.dettaglio")}</th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && !loading && (
              <tr><td colSpan={4} style={{ ...S.td, textAlign: "center", color: "var(--brand-text-subtle, #94a3b8)", padding: 16 }}>{t("cfgUi.noEntries")}</td></tr>
            )}
            {[...entries].reverse().map((e) => (
              <tr key={e.seq}>
                <td style={{ ...S.td, fontSize: 11 }}>{fmtTs(e.ts_ms)}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace" }}>{e.actor ?? "—"}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace" }}>{e.action}</td>
                <td style={{ ...S.td, fontSize: 11, fontFamily: "monospace", color: "var(--brand-text-muted, #94a3b8)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  title={JSON.stringify(e.detail)}>
                  {JSON.stringify(e.detail)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Il rimando alla vista dei certificati, dove ora sta la card TLS. */
function VaiACertificati() {
  const { t } = useTranslation();
  const authRole = useAppStore((s) => s.authRole);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  if (authRole !== "Admin") return null;
  return (
    <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
      🔏 {t("certificati.daStato")}{" "}
      <button type="button" onClick={() => navigateToConfig("certificati")}
        style={{ background: "none", border: "none", padding: 0, color: "var(--brand-primary, #3b82f6)", cursor: "pointer", fontSize: 12 }}>
        {t("certificati.apri")}
      </button>
    </div>
  );
}

// ── TLS management section (inside SystemTab, Admin-only) ─────────────────────
export function TlsSection({ remoto }: {
  /** Quale lato mostrare (25-10-2026): la vista dei certificati ne mette due
   *  affiancate. Senza, segue il pannello collegato come prima. */
  remoto?: boolean;
} = {}) {
  const { t } = useTranslation();
  const authRole = useAppStore((s) => s.authRole);
  // Con un pannello collegato, «il runtime» è il pannello — come per il resto
  // della scheda Device. Fino al 23-10-2026 questa card era l'unica a non
  // saperlo: leggeva e scriveva il certificato del PC su cui gira l'IDE mentre
  // lo schermo accanto diceva «dispositivo connesso». Decisione 2 del piano
  // `docs/archive/2026-10-15-certificati-in-un-posto-solo.md`.
  const pannelloCollegato = useAppStore((s) => s.remoteConnected);
  const remoteConnected = remoto ?? pannelloCollegato;
  const remoteUrl = useAppStore((s) => s.remoteUrl);
  const [tlsEnabled, setTlsEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");
  // La proposta dell'HTTPS col certificato del dispositivo (C4, pezzo 3,
  // 25-10-2026): la manda il pannello, solo quando ha senso.
  const [proposta, setProposta] = useState<{ comando: string } | null>(null);

  // Nel cloud l'indirizzo è quello del gateway (`…/dev/<pannello>`): il nome
  // da mostrare è il pannello, non `sws.soligo.net` (collaudo del 25-10-2026).
  const host = etichettaDispositivo(remoteUrl, []);
  // Nel cloud l'HTTPS lo termina il proxy davanti al gateway: il container del
  // progetto non ha un certificato suo, e generarne uno non servirebbe a nessuno.
  const nelCloud = !remoteConnected && !!prefissoGateway();

  useEffect(() => {
    // Azzerare al cambio di sorgente, così non si vede per un istante lo stato
    // della macchina sbagliata (stesso motivo di `SystemTab`).
    setTlsEnabled(null);
    setMsg(null);
    setBusy(false);
    setShowUpload(false);
    setProposta(null);
    const leggi = remoteConnected ? api.remoteGetTlsStatus() : api.getTlsStatus();
    leggi.then(s => { setTlsEnabled(s.enabled); setProposta(s.proposta ?? null); }).catch(() => setTlsEnabled(false));
  }, [remoteConnected]);

  if (authRole !== "Admin") return null;
  if (tlsEnabled === null) return null;

  const handleGenerate = async () => {
    if (!confirm(t("cfg.tlsGenerateConfirm"))) return;
    setBusy(true);
    setMsg(null);
    try {
      await (remoteConnected ? api.remoteGenerateTlsCert() : api.generateTlsCert());
      setMsg(t("cfgUi.certificateGeneratedTheRuntimeIs"));
    } catch (e: any) {
      setMsg(t("cfgUi.errorMsg", { message: String(e?.message ?? e) }));
      setBusy(false);
    }
  };

  const readFileInto = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    f.text().then(setter).catch(() => setMsg(t("cfgUi.errorCannotReadTheFile")));
  };

  const handleUpload = async () => {
    if (!certPem.trim() || !keyPem.trim()) {
      setMsg(t("cfgUi.errorPasteOrUploadBoth"));
      return;
    }
    if (!confirm(t("cfg.tlsUploadConfirm"))) return;
    setBusy(true);
    setMsg(null);
    try {
      await (remoteConnected ? api.remoteUploadTlsCert(certPem, keyPem) : api.uploadTlsCert(certPem, keyPem));
      setMsg(t("cfgUi.certificateUploadedTheRuntimeIs"));
    } catch (e: any) {
      setMsg(t("cfgUi.errorMsg", { message: String(e?.message ?? e) }));
      setBusy(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm(t("cfg.tlsDisableConfirm"))) return;
    setBusy(true);
    setMsg(null);
    try {
      await (remoteConnected ? api.remoteRemoveTlsCert() : api.removeTlsCert());
      setMsg(t("cfgUi.tlsDisabledTheRuntimeIs"));
    } catch (e: any) {
      setMsg(t("cfgUi.errorMsg", { message: String(e?.message ?? e) }));
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
        {t("cfgUi.tlsTitolo")}
      </div>
      {nelCloud ? (
        <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 16px", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.5 }}>
          {t("cfgUi.tlsNelCloud")}
        </div>
      ) : (
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 16px" }}>
        <div style={{ fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 10 }}>
          {remoteConnected ? t("cfgUi.tlsSulDispositivo", { host }) : t("cfgUi.tlsSuQuestaIstanza")}
        </div>
        {remoteConnected && (
          // Non si dimentica l'impronta da qui: il «dimentica» non è mai
          // automatico (gemello di /api/device/hostkey/forget), e il pulsante
          // giusto compare da solo in Connessione quando il pinning rifiuta.
          // Qui si dice soltanto che succederà, prima di premere.
          <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #fcd34d)", marginBottom: 10, lineHeight: 1.5 }}>
            <div>{t("cfgUi.tlsRiavvioDispositivo")}</div>
            <div>{t("cfgUi.tlsImprontaCambia")}</div>
            <div>{t("cfgUi.tlsSchemaCambia")}</div>
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: tlsEnabled ? "#34d399" : "var(--brand-text-subtle, #64748b)",
          }} />
          <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            {tlsEnabled ? t("cfgUi.tlsHttpsAttivo") : t("cfgUi.plainHttpNoCertificate")}
          </span>
        </div>
        {!tlsEnabled && proposta && (
          <div data-testid="proposta-tls" style={{ marginBottom: 12, padding: "10px 12px", borderRadius: 6, border: "1px solid var(--brand-primary, #3b82f6)", background: "var(--brand-surface, #1e293b)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
              {t("cfgUi.tlsPropostaTitolo")}
            </div>
            <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.5, marginBottom: 8 }}>
              {t("cfgUi.tlsPropostaTesto")}
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 8 }}>
              <code style={{ flex: 1, fontSize: 11, padding: "4px 8px", borderRadius: 4, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", overflowX: "auto", whiteSpace: "nowrap" }}>
                {proposta.comando}
              </code>
              <button style={{ ...S.btn("ghost"), padding: "3px 8px", fontSize: 11 }}
                onClick={() => { void navigator.clipboard?.writeText(proposta.comando); }}>
                {t("cfgUi.copia")}
              </button>
            </div>
            <button data-testid="proposta-tls-no" style={{ ...S.btn("ghost"), fontSize: 12 }} disabled={busy}
              onClick={async () => {
                try {
                  await (remoteConnected ? api.sceltaTls(true, "no") : api.sceltaTls(false, "no"));
                  setProposta(null);
                } catch (e: unknown) {
                  setMsg(t("cfgUi.errorMsg", { message: e instanceof Error ? e.message : String(e) }));
                }
              }}>
              {t("cfgUi.tlsPropostaNo")}
            </button>
          </div>
        )}
        {!tlsEnabled && (
          <div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              {t("cfgUi.generateASelfSignedCertificate")}
            </p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={handleGenerate}
                disabled={busy}
                style={{ padding: "6px 14px", background: "var(--brand-primary-hover, #2563eb)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
              >
                {t("cfgUi.tlsGenera")}
              </button>
              <button
                onClick={() => setShowUpload(v => !v)}
                disabled={busy}
                style={{ padding: "6px 14px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
              >
                {showUpload ? t("cfgUi.cancelUpload") : t("cfgUi.uploadCertificateCertKey")}
              </button>
            </div>
            {showUpload && (
              <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                <p style={{ margin: 0, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
                  {t("cfgUi.uploadACertificateSignedBy")}
                </p>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 4 }}>
                    {t("cfgUi.tlsCertificatoPem")}
                  </label>
                  <input type="file" accept=".crt,.pem,.cer" onChange={readFileInto(setCertPem)}
                    style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }} />
                  <textarea value={certPem} onChange={(e) => setCertPem(e.target.value)}
                    placeholder="-----BEGIN CERTIFICATE-----"
                    rows={4} spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: 8 }} />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, color: "var(--brand-text-2, #cbd5e1)", marginBottom: 4 }}>
                    {t("cfgUi.privateKeyTlsKeyPem")}
                  </label>
                  <input type="file" accept=".key,.pem" onChange={readFileInto(setKeyPem)}
                    style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }} />
                  <textarea value={keyPem} onChange={(e) => setKeyPem(e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    rows={4} spellCheck={false}
                    style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 11, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: 8 }} />
                </div>
                <button
                  onClick={handleUpload}
                  disabled={busy}
                  style={{ justifySelf: "start", padding: "6px 14px", background: "var(--brand-primary-hover, #2563eb)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
                >
                  {t("cfgUi.uploadAndEnableHttps")}
                </button>
              </div>
            )}
          </div>
        )}
        {tlsEnabled && (
          <div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              {t("cfgUi.theRuntimeServesHttpsTo")}
            </p>
            <button
              onClick={handleRemove}
              disabled={busy}
              style={{ padding: "6px 14px", background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)", borderRadius: 6, cursor: busy ? "default" : "pointer", fontSize: 13 }}
            >
              {t("cfgUi.tlsDisabilita")}
            </button>
          </div>
        )}
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith(t("cfgUi.error")) ? "var(--brand-danger-soft, #fca5a5)" : "#34d399" }}>
            {msg}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
