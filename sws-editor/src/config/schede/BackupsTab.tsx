import React, { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { useAppStore } from "@/store";
import { TRANS_COMP } from "@/config/comuni";

// ── Backups tab ──────────────────────────────────────────────────────────────
//
// Admin-only list / create / restore / delete on `/api/backups`. Backups are
// snapshots of `project.yaml`, `synoptics/`, and `users.yaml` under
// `<project>/backups/<UTC-timestamp>/`. The runtime also takes them
// automatically when `--auto-backup-interval-minutes` is set.

type BackupInfo = { name: string; created_at_ms: number; size_bytes: number };

function fmtBackupSize(b: number) {
  return b < 1024 ? `${b} B`
    : b < 1024 * 1024 ? `${(b / 1024).toFixed(1)} KB`
    : `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function fmtBackupDate(ms: number) {
  return ms > 0 ? new Date(ms).toLocaleString() : "—";
}
function triggerBlobDownload(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/** Riquadro elenco+azioni per un set di backup — usato due volte in
 *  `BackupsTab` (progetto locale, dispositivo remoto connesso): stesso set
 *  di azioni per entrambi (Backup adesso/Aggiorna/Ripristina/Scarica/
 *  Elimina), la logica/i confirm restano nel chiamante. */
function BackupSection({
  title, list, busy, err, emptyHint,
  onRefresh, onCreate, onDownload, onRestore, onDelete,
}: {
  title: string;
  list: BackupInfo[] | null;
  busy: boolean;
  err: string | null;
  emptyHint: string;
  onRefresh: () => void;
  onCreate: () => void;
  onDownload: (name: string) => void;
  onRestore: (name: string) => void;
  onDelete: (name: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
          {title}
        </span>
        <button
          onClick={onCreate}
          disabled={busy}
          style={{
            padding: "6px 14px", background: "#16a34a", color: "#f0fdf4",
            border: "none", borderRadius: 4, cursor: busy ? "wait" : "pointer",
            fontSize: 13, fontWeight: 600,
          }}
        >
          + Backup adesso
        </button>
        <button
          onClick={onRefresh}
          disabled={busy}
          style={{
            padding: "6px 14px", background: "var(--brand-surface, #1e293b)", color: "var(--brand-text-2, #cbd5e1)",
            border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
            cursor: busy ? "wait" : "pointer", fontSize: 13,
          }}
        >
          ↻ Aggiorna
        </button>
      </div>
      {err && (
        <div style={{ background: "var(--brand-danger-bg, #7f1d1d)", color: "#fecaca", padding: "8px 12px", borderRadius: 4, fontSize: 12, marginBottom: 8 }}>
          Errore: {err}
        </div>
      )}
      {list === null ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13 }}>{t("cfgUi.loading2")}</div>
      ) : list.length === 0 ? (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, fontStyle: "italic", padding: "16px 0" }}>
          {emptyHint}
        </div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--brand-surface-2, #334155)" }}>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.name")}</th>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.created")}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.size")}</th>
              <th style={{ textAlign: "right", padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", fontWeight: 600 }}>{t("cfg.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {list.map((b) => (
              <tr key={b.name} style={{ borderBottom: "1px solid var(--brand-surface, #1e293b)" }}>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-2, #cbd5e1)", fontFamily: "monospace" }}>{b.name}</td>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)" }}>{fmtBackupDate(b.created_at_ms)}</td>
                <td style={{ padding: "6px 8px", color: "var(--brand-text-muted, #94a3b8)", textAlign: "right" }}>{fmtBackupSize(b.size_bytes)}</td>
                <td style={{ padding: "6px 8px", textAlign: "right" }}>
                  <button
                    onClick={() => onRestore(b.name)}
                    disabled={busy}
                    style={{
                      marginRight: 4, padding: "3px 10px",
                      background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)",
                      border: "none", borderRadius: 3, cursor: busy ? "wait" : "pointer",
                      fontSize: 12,
                    }}
                  >Ripristina</button>
                  <button
                    onClick={() => onDownload(b.name)}
                    disabled={busy}
                    style={{
                      marginRight: 4, padding: "3px 10px",
                      background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
                      border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 3,
                      cursor: busy ? "wait" : "pointer", fontSize: 12,
                    }}
                  >{t("cfgUi.download")}</button>
                  <button
                    onClick={() => onDelete(b.name)}
                    disabled={busy}
                    style={{
                      padding: "3px 10px",
                      background: "transparent", color: "var(--brand-danger-soft, #fca5a5)",
                      border: "1px solid var(--brand-danger-bg, #7f1d1d)", borderRadius: 3,
                      cursor: busy ? "wait" : "pointer", fontSize: 12,
                    }}
                  >{t("common.delete")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function BackupsTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);

  // ── Backup locali (progetto in editing in questo editor) ──────────────────
  const [list, setList] = useState<BackupInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr]   = useState<string | null>(null);

  const refresh = async () => {
    setErr(null);
    try {
      setList(await api.listBackups());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => { refresh(); }, []);

  const createNow = async () => {
    setBusy(true); setErr(null);
    try {
      await api.createBackup();
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = async (name: string) => {
    setBusy(true); setErr(null);
    try {
      triggerBlobDownload(await (await api.downloadBackup(name)).blob(), `${name}.zip`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (name: string) => {
    if (!window.confirm(t("cfg.backupRestoreConfirm", { name }))) return;
    setBusy(true); setErr(null);
    try {
      await api.restoreBackup(name);
      // Reload the project so the UI reflects the restored state.
      const p = await api.getProject();
      useAppStore.getState().setProject(p);
      const names = await api.listSynoptics();
      const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
      useAppStore.getState().setPages(pages);
      await refresh();
      window.alert(t("cfg.backupRestoredAlert", { name }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const drop = async (name: string) => {
    if (!window.confirm(t("cfg.backupDeleteConfirm", { name }))) return;
    setBusy(true); setErr(null);
    try {
      await api.deleteBackup(name);
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // ── Backup sul dispositivo remoto connesso — cartella backups/ distinta da
  // quella locale; un ripristino/eliminazione qui non tocca il progetto
  // aperto in questo editor, solo lo stato del device connesso.
  const [remoteList, setRemoteList] = useState<BackupInfo[] | null>(null);
  const [remoteBusy, setRemoteBusy] = useState(false);
  const [remoteErr, setRemoteErr]   = useState<string | null>(null);

  const refreshRemote = async () => {
    setRemoteErr(null);
    try {
      setRemoteList(await api.remoteListBackups());
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    }
  };
  useEffect(() => {
    if (remoteConnected) void refreshRemote(); else setRemoteList(null);
  }, [remoteConnected]);

  const createRemote = async () => {
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteCreateBackup();
      await refreshRemote();
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const downloadRemote = async (name: string) => {
    setRemoteBusy(true); setRemoteErr(null);
    try {
      triggerBlobDownload(await (await api.remoteDownloadBackup(name)).blob(), `${name}-remoto.zip`);
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const restoreRemote = async (name: string) => {
    if (!window.confirm(t("cfg.backupRestoreRemoteConfirm", { name }))) return;
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteRestoreBackup(name);
      await refreshRemote();
      window.alert(t("cfg.backupRestoredRemoteAlert", { name }));
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  const dropRemote = async (name: string) => {
    if (!window.confirm(t("cfg.backupDeleteRemoteConfirm", { name }))) return;
    setRemoteBusy(true); setRemoteErr(null);
    try {
      await api.remoteDeleteBackup(name);
      await refreshRemote();
    } catch (e) {
      setRemoteErr(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoteBusy(false);
    }
  };

  // Override per-progetto dell'intervallo/retention di auto-backup (prima
  // era solo un flag di avvio --auto-backup-interval-minutes, non
  // controllabile a progetto). Campo vuoto = eredita il default di processo.
  const [intervalMin, setIntervalMin] = useState("");
  const [retention, setRetention]     = useState("");
  const [cfgSaving, setCfgSaving]     = useState(false);
  const [cfgSaved, setCfgSaved]       = useState(false);
  const [cfgErr, setCfgErr]           = useState<string | null>(null);

  useEffect(() => {
    setIntervalMin(project?.auto_backup_interval_minutes != null ? String(project.auto_backup_interval_minutes) : "");
    setRetention(project?.auto_backup_retention != null ? String(project.auto_backup_retention) : "");
  }, [project]);

  const saveBackupConfig = async () => {
    setCfgSaving(true);
    setCfgErr(null);
    try {
      await api.updateBackupConfig({
        interval_minutes: intervalMin.trim() === "" ? null : Number(intervalMin),
        retention: retention.trim() === "" ? null : Number(retention),
      });
      const p = await api.getProject();
      useAppStore.getState().setProject(p);
      setCfgSaved(true);
      setTimeout(() => setCfgSaved(false), 2000);
    } catch (e) {
      setCfgErr(e instanceof Error ? e.message : String(e));
    } finally {
      setCfgSaving(false);
    }
  };

  const labelStyleBak: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 2 };
  const inputStyleBak: React.CSSProperties = { background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "#f1f5f9", borderRadius: 4, padding: "5px 8px", fontSize: 13 };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.5 }}>
        <Trans i18nKey="cfgUi.backupsIntro" values={{ dir: "<project>/backups/" }} components={TRANS_COMP} />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 8 }}>
        <div>
          <span style={labelStyleBak}>Intervallo auto-backup (minuti)</span>
          <input type="number" min={0} value={intervalMin}
            onChange={(e) => setIntervalMin(e.target.value)}
            placeholder="eredita dal runtime"
            style={{ ...inputStyleBak, width: 160 }} />
        </div>
        <div>
          <span style={labelStyleBak}>Backup da tenere</span>
          <input type="number" min={0} value={retention}
            onChange={(e) => setRetention(e.target.value)}
            placeholder="eredita dal runtime"
            style={{ ...inputStyleBak, width: 140 }} />
        </div>
        <button onClick={saveBackupConfig} disabled={cfgSaving}
          style={{ padding: "6px 14px", background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 4, cursor: cfgSaving ? "wait" : "pointer", fontSize: 13 }}>
          {cfgSaved ? t("cfgUi.saved2") : t("cfgUi.save")}
        </button>
        {cfgErr && <span style={{ fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{cfgErr}</span>}
      </div>

      <BackupSection
        title={t("cfg.backupLocalSectionTitle")}
        list={list} busy={busy} err={err}
        emptyHint={t("cfgUi.noBackupsClickBackupNow")}
        onRefresh={refresh} onCreate={createNow}
        onDownload={download} onRestore={restore} onDelete={drop}
      />

      {remoteConnected && (
        <BackupSection
          title={t("cfg.backupRemoteSectionTitle")}
          list={remoteList} busy={remoteBusy} err={remoteErr}
          emptyHint={t("cfgUi.noBackupsOnTheRemote")}
          onRefresh={refreshRemote} onCreate={createRemote}
          onDownload={downloadRemote} onRestore={restoreRemote} onDelete={dropRemote}
        />
      )}
    </div>
  );
}
