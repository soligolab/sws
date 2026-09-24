import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, type SystemStatus } from "@/api/client";
import type { AuditEntry, AuditVerifyReport } from "@/types";
import { useAppStore } from "@/store";
import { TRANS_COMP, S } from "@/config/comuni";

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

function GitOpsPanel() {
  const { t } = useTranslation();
  const [gitStatus, setGitStatus] = useState<import("@/types").GitStatus | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opMsg, setOpMsg] = useState<string | null>(null);
  const [showCommitForm, setShowCommitForm] = useState(false);
  const [commitMsg, setCommitMsg] = useState("");

  // Progetto non ancora agganciato a un repository: prima non c'era alcun
  // percorso per iniziare da qui (il pannello restava vuoto). `checkedRepo`
  // distingue "non ancora controllato" da "controllato, non è un repo" così
  // non si mostra il form di aggancio per uno sfarfallio durante il primo
  // caricamento.
  const [checkedRepo, setCheckedRepo] = useState(false);
  const [attachUrl, setAttachUrl] = useState("");
  const [attaching, setAttaching] = useState(false);
  const [attachErr, setAttachErr] = useState<string | null>(null);

  // Tag — elenco/crea/push/elimina, assente prima d'ora sia lato backend sia UI.
  const [tags, setTags] = useState<string[] | null>(null);
  const [tagBusy, setTagBusy] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [showTagForm, setShowTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [newTagMsg, setNewTagMsg] = useState("");

  const fetchGitStatus = async () => {
    try {
      const gs = await api.getGitStatus();
      setGitStatus(gs);
      setGitError(null);
    } catch (e: any) {
      if (e?.status === 404 || String(e?.message).includes("404")) {
        setGitStatus(null);
        setGitError(null);
      } else {
        setGitError(String(e?.message ?? e));
      }
    } finally {
      setCheckedRepo(true);
    }
  };

  useEffect(() => { void fetchGitStatus(); }, []);

  const fetchTags = async () => {
    try {
      setTags(await api.listGitTags());
      setTagErr(null);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    }
  };

  useEffect(() => {
    if (gitStatus) void fetchTags(); else setTags(null);
  }, [gitStatus]);

  const runOp = async (op: () => Promise<{ message: string }>, label: string) => {
    setBusy(true);
    setOpMsg(null);
    try {
      const r = await op();
      setOpMsg(`${label}: ${r.message || "ok"}`);
      await fetchGitStatus();
    } catch (e: any) {
      setOpMsg(t("cfgUi.errorLabel", { label, message: String(e?.message ?? e) }));
    } finally {
      setBusy(false);
    }
  };

  const attachRepo = async () => {
    setAttaching(true);
    setAttachErr(null);
    try {
      await api.initProjectGit(attachUrl.trim() || undefined);
      setAttachUrl("");
      await fetchGitStatus();
    } catch (e: any) {
      setAttachErr(String(e?.message ?? e));
    } finally {
      setAttaching(false);
    }
  };

  const createTag = async () => {
    const name = newTagName.trim();
    if (!name) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.createGitTag(name, newTagMsg.trim() || undefined);
      setShowTagForm(false);
      setNewTagName("");
      setNewTagMsg("");
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const pushTag = async (name: string) => {
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.pushGitTag(name);
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const deleteTag = async (name: string) => {
    if (!window.confirm(t("cfg.deleteTagConfirm", { name }))) return;
    setTagBusy(true);
    setTagErr(null);
    try {
      await api.deleteGitTag(name);
      await fetchTags();
    } catch (e: any) {
      setTagErr(String(e?.message ?? e));
    } finally {
      setTagBusy(false);
    }
  };

  const header = (
    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 6 }}>
      {t("cfgUi.projectVersioning")}
    </div>
  );
  const intro = (
    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginBottom: 10, lineHeight: 1.5 }}>
      <Trans i18nKey="cfgUi.versioningIntro" components={TRANS_COMP} />
    </div>
  );

  if (gitError) {
    return (
      <div>{header}{intro}<div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12 }}>Git: {gitError}</div></div>
    );
  }

  if (!gitStatus) {
    if (!checkedRepo) return null; // primo caricamento, non ancora sappiamo
    return (
      <div>
        {header}
        {intro}
        <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
            {t("cfgUi.thisProjectIsNotYet")}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              value={attachUrl}
              onChange={(e) => setAttachUrl(e.target.value)}
              placeholder={t("cfgUi.repositoryUrlOptionalEmptyFor")}
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={attaching}
              onClick={attachRepo}
              style={{ padding: "5px 12px", background: "var(--brand-primary, #3b82f6)", border: "none", borderRadius: 4, color: "var(--brand-on-primary, #fff)", fontSize: 12, cursor: attaching ? "wait" : "pointer" }}
            >
              Aggancia a un repository
            </button>
          </div>
          {attachErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{attachErr}</div>}
        </div>
      </div>
    );
  }

  const dateStr = gitStatus.commit_date
    ? new Date(gitStatus.commit_date).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" })
    : "—";

  return (
    <div>
      {header}
      {intro}
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>Branch:</span>
          <span style={{ color: "#93c5fd", fontWeight: 700 }}>{gitStatus.branch}</span>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>SHA:</span>
          <span style={{ color: "var(--brand-text, #e2e8f0)", fontFamily: "monospace" }}>{gitStatus.sha}</span>
          <span style={{ color: gitStatus.clean ? "#34d399" : "#fb923c" }}>
            {gitStatus.clean ? "✓ clean" : t("cfgUi.modified")}
          </span>
        </div>
        <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
          <span style={{ color: "var(--brand-text-subtle, #64748b)" }}>{dateStr} — </span>
          {gitStatus.author}: {gitStatus.message}
        </div>
        {gitStatus.remote_url && (
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", wordBreak: "break-all" }}>{gitStatus.remote_url}</div>
        )}
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <button
            disabled={busy}
            onClick={() => runOp(() => api.triggerDeploy(), "Deploy")}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#1e40af", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↑ Deploy (git pull)
          </button>
          <button
            disabled={busy}
            onClick={() => { if (confirm(t("cfg.gitResetConfirm"))) runOp(() => api.triggerRollback(), "Rollback"); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-danger, #ef4444)", border: "none", borderRadius: 4, color: "var(--brand-on-danger, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            ↓ Rollback (HEAD~1)
          </button>
          <button
            disabled={busy}
            onClick={() => { setShowCommitForm((v) => !v); setOpMsg(null); }}
            style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
          >
            💾 Commit
          </button>
          {gitStatus?.remote_url && (
            <button
              disabled={busy}
              onClick={() => {
                if (confirm(t("cfg.gitPushConfirm"))) {
                  runOp(() => api.pushProject(), "Push");
                }
              }}
              style={{ flex: 1, minWidth: 100, padding: "6px 10px", background: "#7c3aed", border: "none", borderRadius: 4, color: "#fff", fontSize: 12, cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.6 : 1 }}
            >
              ↑ Push{gitStatus.unpushed_commits > 0 ? ` (${gitStatus.unpushed_commits})` : ""}
            </button>
          )}
        </div>
        {showCommitForm && (
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <input
              value={commitMsg}
              onChange={(e) => setCommitMsg(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && commitMsg.trim()) {
                  setShowCommitForm(false);
                  runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                  setCommitMsg("");
                }
              }}
              placeholder={t("cfg.commitMessage")}
              style={{ flex: 1, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
              autoFocus
            />
            <button
              disabled={busy || !commitMsg.trim()}
              onClick={() => {
                setShowCommitForm(false);
                runOp(() => api.commitProject(commitMsg.trim()), "Commit");
                setCommitMsg("");
              }}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowCommitForm(false); setCommitMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {opMsg && (
          <div style={{ fontSize: 11, color: opMsg.startsWith(t("cfgUi.error")) ? "var(--brand-danger-soft, #fca5a5)" : "#34d399", marginTop: 2, whiteSpace: "pre-wrap" }}>
            {opMsg}
          </div>
        )}
      </div>

      <div style={{ marginTop: 10, background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, flex: 1 }}>TAG</span>
          <button
            disabled={tagBusy}
            onClick={() => setShowTagForm((v) => !v)}
            style={{ padding: "4px 10px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, cursor: tagBusy ? "wait" : "pointer", fontSize: 12 }}
          >
            {t("cfgUi.newTag")}
          </button>
        </div>
        {showTagForm && (
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <input
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              placeholder="nome (es. v1.2.0)"
              style={{ flex: 1, minWidth: 120, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <input
              value={newTagMsg}
              onChange={(e) => setNewTagMsg(e.target.value)}
              placeholder="messaggio (opzionale)"
              style={{ flex: 2, minWidth: 160, background: "var(--brand-bg, #020617)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "5px 8px", fontSize: 12 }}
            />
            <button
              disabled={tagBusy || !newTagName.trim()}
              onClick={createTag}
              style={{ padding: "5px 10px", background: "var(--brand-success, #22c55e)", border: "none", borderRadius: 4, color: "var(--brand-on-success, #fff)", fontSize: 12, cursor: "pointer" }}
            >{t("common.save")}</button>
            <button
              onClick={() => { setShowTagForm(false); setNewTagName(""); setNewTagMsg(""); }}
              style={{ padding: "5px 10px", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, color: "var(--brand-text-muted, #94a3b8)", fontSize: 12, cursor: "pointer" }}
            >✕</button>
          </div>
        )}
        {tagErr && <div style={{ fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)" }}>{tagErr}</div>}
        {tags === null ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.loading2")}</div>
        ) : tags.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", fontStyle: "italic" }}>{t("cfgUi.noTags")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {tags.map((name) => (
              <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code style={{ flex: 1, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>{name}</code>
                {gitStatus.remote_url && (
                  <button
                    disabled={tagBusy}
                    onClick={() => pushTag(name)}
                    style={{ padding: "3px 10px", background: "#7c3aed", border: "none", borderRadius: 3, color: "#fff", fontSize: 11, cursor: tagBusy ? "wait" : "pointer" }}
                  >↑ Push</button>
                )}
                <button
                  disabled={tagBusy}
                  onClick={() => deleteTag(name)}
                  style={{ padding: "3px 10px", background: "transparent", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 3, cursor: tagBusy ? "wait" : "pointer", fontSize: 11 }}
                >{t("common.delete")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
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
        Errore caricamento stato sistema: {error}
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
          <MetricCard icon="🖥" label="Versione" value={status.runtime_version} />
          {/* Quale ruolo serve l'istanza interrogata — e con un dispositivo
              connesso questa scheda interroga *lui*, quindi la card dice la
              modalità del device. È il modo per accorgersi di aver collegato
              un editor a un altro editor, che prima era invisibile.
              `mode` assente = runtime più vecchio: non si afferma niente. */}
          <MetricCard
            icon={status.mode === "runtime" ? "🏭" : "✏️"}
            label={t("cfgUi.mode")}
            value={status.mode === "runtime" ? "Runtime (serve un impianto)"
                 : status.mode === "ide"     ? "IDE (sola progettazione)"
                 :                             "non dichiarata"}
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
              <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>💿 Disco</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--brand-text, #e2e8f0)" }}>{status.disk_used_gb} GB / {status.disk_total_gb} GB</span>
            </div>
            <ProgressBar value={status.disk_used_gb} max={status.disk_total_gb} color="#fb923c" />
          </div>
        </div>
      </div>
      <TlsSection />
      <GitOpsPanel />
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
        <button style={S.btn("ghost")} onClick={load} disabled={loading}>{loading ? "Aggiorno…" : "Aggiorna"}</button>
        <button style={S.btn("ghost")} onClick={runVerify} disabled={verifying}>{verifying ? "Verifico…" : t("cfgUi.verifyIntegrity")}</button>
      </div>

      {verify && (
        <div style={{
          marginBottom: 10, fontSize: 12, borderRadius: 6, padding: "8px 12px",
          background: verify.ok ? "var(--brand-success-bg, #166534)" : "#450a0a",
          border: `1px solid ${verify.ok ? "#15803d" : "#991b1b"}`,
          color: verify.ok ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #fca5a5)",
        }}>
          {verify.ok
            ? `✓ Catena integra — ${verify.entries} entry verificate.`
            : `✗ Catena compromessa alla entry #${verify.broken_at ?? "?"} — ${verify.reason ?? "motivo sconosciuto"}`}
        </div>
      )}

      {error && (
        <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginBottom: 8 }}>Errore: {error}</div>
      )}

      <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6 }}>
        <table style={{ ...S.table, tableLayout: "fixed" }}>
          <thead>
            <tr>
              <th style={{ ...S.th, width: 150 }}>Quando</th>
              <th style={{ ...S.th, width: 110 }}>Chi</th>
              <th style={{ ...S.th, width: 140 }}>Azione</th>
              <th style={S.th}>Dettaglio</th>
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

// ── TLS management section (inside SystemTab, Admin-only) ─────────────────────
export function TlsSection() {
  const { t } = useTranslation();
  const authRole = useAppStore((s) => s.authRole);
  const [tlsEnabled, setTlsEnabled] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [certPem, setCertPem] = useState("");
  const [keyPem, setKeyPem] = useState("");

  useEffect(() => {
    api.getTlsStatus().then(s => setTlsEnabled(s.enabled)).catch(() => setTlsEnabled(false));
  }, []);

  if (authRole !== "Admin") return null;
  if (tlsEnabled === null) return null;

  const handleGenerate = async () => {
    if (!confirm(t("cfg.tlsGenerateConfirm"))) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.generateTlsCert();
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
      await api.uploadTlsCert(certPem, keyPem);
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
      await api.removeTlsCert();
      setMsg(t("cfgUi.tlsDisabledTheRuntimeIs"));
    } catch (e: any) {
      setMsg(t("cfgUi.errorMsg", { message: String(e?.message ?? e) }));
      setBusy(false);
    }
  };

  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-subtle, #64748b)", letterSpacing: 1, marginBottom: 10 }}>
        CERTIFICATO TLS
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "12px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={{
            display: "inline-block", width: 8, height: 8, borderRadius: "50%",
            background: tlsEnabled ? "#34d399" : "var(--brand-text-subtle, #64748b)",
          }} />
          <span style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            {tlsEnabled ? "HTTPS attivo" : t("cfgUi.plainHttpNoCertificate")}
          </span>
        </div>
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
                Genera certificato self-signed
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
                    Certificato (tls.crt, PEM)
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
              Disabilita TLS
            </button>
          </div>
        )}
        {msg && (
          <div style={{ marginTop: 10, fontSize: 12, color: msg.startsWith(t("cfgUi.error")) ? "var(--brand-danger-soft, #fca5a5)" : "#34d399" }}>
            {msg}
          </div>
        )}
      </div>
    </div>
  );
}
