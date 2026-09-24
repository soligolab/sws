import React, { useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { DatastoreBackendConfig, DatastoreConfig, DatastoreStats } from "@/types";
import { useAppStore } from "@/store";
import { TRANS_COMP, SaveBar } from "@/config/comuni";

// ── DATASTORES tab ────────────────────────────────────────────────────────────

function newSqliteConfig(): DatastoreBackendConfig {
  return { kind: "sqlite", path: "history/historian.db" };
}
function newPostgresConfig(): DatastoreBackendConfig {
  return { kind: "postgres", host: "localhost", port: 5432, database: "sws", username: "sws", password: "", ssl_mode: "disable", schema: "public" };
}
function newOdbcConfig(): DatastoreBackendConfig {
  return { kind: "odbc", dsn: "", connection_string: "", table: "sws_samples", col_tag: "tag_id", col_value: "value", col_ts: "ts_ms" };
}

export function DatastoresTab() {
  const { t } = useTranslation();
  const project = useAppStore((s) => s.project);
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const [datastores, setDatastores] = useState<DatastoreConfig[]>(project?.datastores ?? []);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [statusMap, setStatusMap] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [statsMap, setStatsMap]   = useState<Record<string, DatastoreStats | null>>({});

  // Keep local copy in sync when project reloads.
  useEffect(() => {
    setDatastores(project?.datastores ?? []);
    setDirty(false);
  }, [project]);

  const update = (ds: DatastoreConfig[]) => { setDatastores(ds); setDirty(true); };

  const addDatastore = () => {
    const id = `ds_${Date.now()}`;
    update([...datastores, { id, label: "Nuovo datastore", backend: newSqliteConfig(), retention_rows: undefined, retention_days: undefined }]);
  };

  const removeDatastore = (id: string) => update(datastores.filter((d) => d.id !== id));

  const setBackendKind = (id: string, kind: "sqlite" | "postgres" | "odbc") => {
    update(datastores.map((d) =>
      d.id === id ? { ...d, backend: kind === "sqlite" ? newSqliteConfig() : kind === "postgres" ? newPostgresConfig() : newOdbcConfig() } : d
    ));
  };

  const patchDs = (id: string, patch: Partial<DatastoreConfig>) =>
    update(datastores.map((d) => d.id === id ? { ...d, ...patch } : d));

  const patchBackend = (id: string, patch: Partial<DatastoreBackendConfig>) =>
    update(datastores.map((d) => d.id === id ? { ...d, backend: { ...d.backend, ...patch } as DatastoreBackendConfig } : d));

  const save = async () => {
    setSaving(true); setSaveError(null);
    try {
      await api.saveDatastores(datastores);
      setDirty(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setSaveError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const testDs = async (id: string) => {
    setStatusMap((m) => ({ ...m, [id]: { ok: false, msg: "Test…" } }));
    try {
      const msg = await api.testDatastore(id);
      setStatusMap((m) => ({ ...m, [id]: { ok: true, msg } }));
    } catch (e) {
      setStatusMap((m) => ({ ...m, [id]: { ok: false, msg: String(e) } }));
    }
  };

  const loadStats = async (id: string) => {
    setStatsMap((m) => ({ ...m, [id]: null }));
    try {
      const stats = await api.datastoreStats(id);
      setStatsMap((m) => ({ ...m, [id]: stats }));
    } catch { /* ignore */ }
  };

  // ── Gestione database ──────────────────────────────────────────────────────
  // `purge` ed `export` esistevano già nel backend e nel client da tempo, senza
  // che nessun pulsante li chiamasse. Qui vengono collegati, insieme ai due
  // nuovi (tag orfani, vacuum). Il backup completo NON si duplica: la tab
  // "Backup" già include `history/`.
  const [mgmtMsg, setMgmtMsg] = useState<Record<string, string>>({});
  const [tagsMap, setTagsMap] = useState<Record<string, { db_tags: string[]; orphan_tags: string[] } | null>>({});
  const [busyMgmt, setBusyMgmt] = useState<Record<string, boolean>>({});

  const withBusy = async (id: string, fn: () => Promise<string>) => {
    setBusyMgmt((m) => ({ ...m, [id]: true }));
    setMgmtMsg((m) => ({ ...m, [id]: "" }));
    try {
      const msg = await fn();
      setMgmtMsg((m) => ({ ...m, [id]: msg }));
    } catch (e: any) {
      setMgmtMsg((m) => ({ ...m, [id]: `✗ ${e?.message ?? String(e)}` }));
    } finally {
      setBusyMgmt((m) => ({ ...m, [id]: false }));
    }
  };

  const doPurge = (ds: DatastoreConfig) => {
    // Si riusa la retention già configurata per il backend: una pulizia manuale
    // che applicasse regole diverse da quelle automatiche sarebbe una sorpresa.
    const rows = ds.retention_rows, days = ds.retention_days;
    if (!rows && !days) {
      setMgmtMsg((m) => ({ ...m, [ds.id]: t("cfgUi.noRetentionConfiguredSetRows") }));
      return;
    }
    const desc = [rows ? `${rows} righe per tag` : null, days ? `${days} giorni` : null].filter(Boolean).join(" · ");
    if (!window.confirm(t("cfg.purgeHistoryConfirm", { id: ds.id, desc }))) return;
    void withBusy(ds.id, async () => {
      const r = await api.purgeDatastore(ds.id, { retention_rows: rows, retention_days: days });
      await loadStats(ds.id);
      return t("cfgUi.samplesDeleted", { n: r.deleted.toLocaleString() });
    });
  };

  const doExport = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const tags = (await api.listDatastoreTags(ds.id)).db_tags;
      if (tags.length === 0) return t("cfgUi.noDataToExport");
      const data = await api.exportDatastore(ds.id, { tags });
      // CSV: una riga per campione. Formato scelto perché è quello che si apre
      // senza attrezzi, che è il punto di un export manuale.
      const rows = ["tag,timestamp_ms,value,quality"];
      for (const t of data) {
        for (const smp of t.samples) {
          rows.push(`${t.tag_id},${(smp as any).ts_ms ?? ""},${String((smp as any).value ?? "")},${(smp as any).quality ?? ""}`);
        }
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${ds.id}-history.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
      return t("cfgUi.samplesExported", { samples: rows.length - 1, tags: data.length });
    });

  const loadTags = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const r = await api.listDatastoreTags(ds.id);
      setTagsMap((m) => ({ ...m, [ds.id]: r }));
      return r.orphan_tags.length === 0
        ? t("cfgUi.noOrphanTags", { count: r.db_tags.length })
        : `${r.orphan_tags.length} tag orfani su ${r.db_tags.length} nel database.`;
    });

  const doDeleteTag = (ds: DatastoreConfig, tag: string) => {
    if (!window.confirm(t("cfg.deleteTagHistoryConfirm", { tag }))) return;
    void withBusy(ds.id, async () => {
      const r = await api.deleteTagHistory(ds.id, tag);
      const fresh = await api.listDatastoreTags(ds.id);
      setTagsMap((m) => ({ ...m, [ds.id]: fresh }));
      await loadStats(ds.id);
      return t("cfgUi.tagSamplesDeleted", { tag, n: r.deleted.toLocaleString() });
    });
  };

  const doVacuum = (ds: DatastoreConfig) =>
    void withBusy(ds.id, async () => {
      const r = await api.vacuumDatastore(ds.id);
      await loadStats(ds.id);
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
      return r.bytes_freed > 0
        ? `✓ Liberati ${mb(r.bytes_freed)} MB (da ${mb(r.bytes_before)} a ${mb(r.bytes_after)} MB).`
        : t("cfgUi.noSpaceToReclaim", { mb: mb(r.bytes_after) });
    });

  // ── Download/upload del file database — locale (progetto a cui l'editor è
  // attaccato) o del dispositivo remoto connesso. Le altre azioni sopra
  // (purge/export/tags/vacuum) agiscono già solo sul backend corrente per
  // costruzione (`request()`/`getBaseUrl()`) — qui invece serve poter
  // scegliere esplicitamente, perché "il database del dispositivo" è
  // proprio il caso che ha motivato questa feature.
  const doDownloadDb = (ds: DatastoreConfig, remote: boolean) =>
    void withBusy(ds.id, async () => {
      const res = remote
        ? await api.remoteDownloadDatastoreDb(ds.id)
        : await api.downloadDatastoreDb(ds.id);
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${ds.id}${remote ? "-remoto" : ""}.db`;
      a.click();
      URL.revokeObjectURL(a.href);
      return `✓ Database scaricato (${(blob.size / 1024 / 1024).toFixed(2)} MB)${remote ? " dal dispositivo remoto" : ""}.`;
    });

  const [uploadTarget, setUploadTarget] = useState<{ id: string; remote: boolean } | null>(null);
  const dbFileRef = useRef<HTMLInputElement | null>(null);

  const askUploadDb = (ds: DatastoreConfig, remote: boolean) => {
    if (!window.confirm(
      remote ? t("cfg.uploadDbConfirmRemote", { id: ds.id }) : t("cfg.uploadDbConfirm", { id: ds.id })
    )) return;
    setUploadTarget({ id: ds.id, remote });
    dbFileRef.current?.click();
  };

  const doUploadDb = (file: File) => {
    const target = uploadTarget;
    setUploadTarget(null);
    if (!target) return;
    void withBusy(target.id, async () => {
      const r = target.remote
        ? await api.remoteUploadDatastoreDb(target.id, file)
        : await api.uploadDatastoreDb(target.id, file);
      const mb = (n: number) => (n / 1024 / 1024).toFixed(2);
      return `✓ Caricati ${mb(r.bytes_written)} MB${target.remote ? " sul dispositivo remoto" : ""}. ` +
        t("cfgUi.previousBackup", { path: r.backup_path });
    });
  };

  const cellStyle: React.CSSProperties = { padding: "4px 8px", borderBottom: "1px solid var(--brand-surface, #1e293b)", verticalAlign: "top" };
  const labelStyle: React.CSSProperties = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 2 };
  const inputStyle: React.CSSProperties = { width: "100%", background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)", color: "#f1f5f9", borderRadius: 4, padding: "3px 6px", fontSize: 12 };

  return (
    <div style={{ padding: 16 }}>
      <SaveBar onSave={save} saving={saving} saved={saved} disabled={!dirty}
        section="datastores" dirty={dirty} />
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", flex: 1 }}>
          Configura i backend di persistenza dati storici. Ogni variabile con &quot;history&quot; attivo
          viene scritta nel datastore assegnato.
        </span>
        <button onClick={addDatastore} style={{ background: "#0ea5e9", color: "#0f172a", border: "none", borderRadius: 4, padding: "4px 10px", cursor: "pointer", fontSize: 12 }}>
          {t("cfgUi.add")}
        </button>
      </div>
      {saveError && <div style={{ color: "var(--brand-danger-soft, #f87171)", fontSize: 12, marginBottom: 8 }}>{saveError}</div>}

      {datastores.length === 0 && (
        <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 13, padding: 24, textAlign: "center" }}>
          {t("cfgUi.noDatastoreConfiguredUseThe")}
        </div>
      )}

      {datastores.map((ds) => {
        const status = statusMap[ds.id];
        const stats  = statsMap[ds.id];
        return (
          <div key={ds.id} style={{ background: "var(--brand-surface, #1e293b)", borderRadius: 6, padding: 12, marginBottom: 12, border: "1px solid var(--brand-surface-2, #334155)" }}>
            {/* Header row */}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input
                value={ds.label}
                onChange={(e) => patchDs(ds.id, { label: e.target.value })}
                placeholder={t("cfg.labelField")}
                style={{ ...inputStyle, flex: 1, fontWeight: 600, fontSize: 13 }}
              />
              <input
                value={ds.id}
                onChange={(e) => patchDs(ds.id, { id: e.target.value })}
                placeholder="id (slug)"
                style={{ ...inputStyle, width: 140, fontFamily: "monospace" }}
              />
              <select
                value={ds.backend.kind}
                onChange={(e) => setBackendKind(ds.id, e.target.value as "sqlite" | "postgres" | "odbc")}
                style={{ ...inputStyle, width: 110 }}>
                <option value="sqlite">SQLite</option>
                <option value="postgres">PostgreSQL</option>
                {/* Q-nota 2026-08-25: il backend ODBC è uno stub — ogni metodo
                    risponde "not compiled in". Resta selezionabile (l'architettura a
                    backend lo prevede e serve da segnaposto) ma deve dirlo PRIMA,
                    non alla prima scrittura andata a vuoto. */}
                <option value="odbc">ODBC — non implementato</option>
              </select>
              <button onClick={() => testDs(ds.id)} style={{ background: "#0ea5e9", color: "#0f172a", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>{t("common.test")}</button>
              <button onClick={() => loadStats(ds.id)} style={{ background: "var(--brand-border, #475569)", color: "var(--brand-text, #e2e8f0)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>{t("common.stats")}</button>
              <button onClick={() => removeDatastore(ds.id)} style={{ background: "var(--brand-danger, #ef4444)", color: "var(--brand-on-danger, #fff)", border: "none", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>X</button>
            </div>

            {/* Status + stats row */}
            {status && (
              <div style={{ fontSize: 11, color: status.ok ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)", marginBottom: 8 }}>
                {status.msg}
              </div>
            )}
            {stats !== undefined && (
              <div style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, display: "flex", gap: 16 }}>
                {stats === null ? t("cfgUi.loadingStats") : (
                  <>
                    <span>Campioni: {stats.sample_count.toLocaleString()}</span>
                    <span>Tag: {stats.tag_count}</span>
                    {stats.size_bytes != null && <span>Dim: {(stats.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
                    <span style={{ color: stats.connected ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #f87171)" }}>{stats.connected ? "Connesso" : stats.error ?? "Disconnesso"}</span>
                  </>
                )}
              </div>
            )}

            {/* ── Gestione database ────────────────────────────────────────
                Purge ed export esistevano nel backend da tempo senza che nessun
                pulsante li chiamasse; tag orfani e recupero spazio sono nuovi.
                Il backup completo non si duplica qui: la tab "Backup" include
                già `history/`. */}
            <div style={{ border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 5, padding: 8, marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 6 }}>
                GESTIONE DATABASE
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => doPurge(ds)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.purgeNowTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Pulisci ora
                </button>
                <button onClick={() => doExport(ds)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.exportHistoryCsvTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  {t("cfgUi.exportCsv2")}
                </button>
                <button onClick={() => loadTags(ds)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.orphanHistoryTagsTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  {t("cfgUi.findOrphanTags")}
                </button>
                <button onClick={() => doVacuum(ds)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.vacuumTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  Recupera spazio
                </button>
                <button onClick={() => doDownloadDb(ds, false)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.downloadDbTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  {t("cfgUi.downloadDatabase")}
                </button>
                <button onClick={() => askUploadDb(ds, false)} disabled={busyMgmt[ds.id]}
                  title={t("cfg.uploadDbTitle")}
                  style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                  {t("cfgUi.uploadDatabase")}
                </button>
                {remoteConnected && (
                  <>
                    <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.remoteDevice")}</span>
                    <button onClick={() => doDownloadDb(ds, true)} disabled={busyMgmt[ds.id]}
                      title={t("cfg.downloadRemoteDbTitle")}
                      style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                      {t("cfgUi.downloadRemote")}
                    </button>
                    <button onClick={() => askUploadDb(ds, true)} disabled={busyMgmt[ds.id]}
                      title={t("cfg.uploadRemoteDbTitle")}
                      style={{ background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "3px 8px", cursor: "pointer", fontSize: 11 }}>
                      {t("cfgUi.uploadRemote")}
                    </button>
                  </>
                )}
                {busyMgmt[ds.id] && <span style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>in corso…</span>}
              </div>

              {mgmtMsg[ds.id] && (
                <div style={{ fontSize: 11, marginTop: 6, color: mgmtMsg[ds.id].startsWith("✗") ? "var(--brand-danger-soft, #f87171)" : "var(--brand-text-muted, #94a3b8)" }}>
                  {mgmtMsg[ds.id]}
                </div>
              )}

              {tagsMap[ds.id] && tagsMap[ds.id]!.orphan_tags.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div style={{ fontSize: 11, color: "var(--brand-warning, #eab308)", marginBottom: 4 }}>
                    {t("cfgUi.orphanTagsTheyHaveHistory")}
                  </div>
                  {tagsMap[ds.id]!.orphan_tags.map((tag) => (
                    <div key={tag} style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
                      <code style={{ fontSize: 11, color: "var(--brand-text, #e2e8f0)" }}>{tag}</code>
                      <button onClick={() => doDeleteTag(ds, tag)} disabled={busyMgmt[ds.id]}
                        style={{ background: "var(--brand-danger, #ef4444)", color: "var(--brand-on-danger, #fff)", border: "none", borderRadius: 4, padding: "1px 6px", cursor: "pointer", fontSize: 10 }}>
                        {t("cfgUi.deleteHistory")}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
                <Trans i18nKey="cfgUi.dbBackupInTab" components={TRANS_COMP} />
              </div>
            </div>

            {/* Backend-specific fields */}
            {ds.backend.kind === "sqlite" && (
              <div style={cellStyle}>
                <span style={labelStyle}>{t("cfg.filePath")}</span>
                <input value={ds.backend.path} onChange={(e) => patchBackend(ds.id, { path: e.target.value })} style={inputStyle} placeholder="history/historian.db" />
              </div>
            )}

            {ds.backend.kind === "postgres" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["host", "port", "database", "username", "password", "ssl_mode", "schema"] as const).map((field) => (
                  <div key={field} style={cellStyle}>
                    <span style={labelStyle}>{field}</span>
                    <input
                      type={field === "password" ? "password" : "text"}
                      value={String((ds.backend as unknown as Record<string, unknown>)[field] ?? "")}
                      onChange={(e) => patchBackend(ds.id, { [field]: field === "port" ? Number(e.target.value) : e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            )}

            {ds.backend.kind === "odbc" && (
              <div style={{ fontSize: 11, color: "var(--brand-warning-soft, #fbbf24)",
                            background: "var(--brand-warning-bg, #78350f)",
                            border: "1px solid var(--brand-warning, #f59e0b)",
                            borderRadius: 4, padding: "6px 8px", marginBottom: 8 }}>
                <Trans i18nKey="cfgUi.odbcNotImplemented" components={TRANS_COMP} />
              </div>
            )}
            {ds.backend.kind === "odbc" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {(["dsn", "connection_string", "table", "col_tag", "col_value", "col_ts"] as const).map((field) => (
                  <div key={field} style={cellStyle}>
                    <span style={labelStyle}>{field}</span>
                    <input
                      value={String((ds.backend as unknown as Record<string, unknown>)[field] ?? "")}
                      onChange={(e) => patchBackend(ds.id, { [field]: e.target.value })}
                      style={inputStyle}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Retention */}
            <div style={{ display: "flex", gap: 16, marginTop: 8 }}>
              <div>
                <span style={labelStyle}>{t("cfg.maxRowsPerTag")}</span>
                <input type="number" min={0}
                  value={ds.retention_rows ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_rows: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder={t("cfg.unlimited")} />
              </div>
              <div>
                <span style={labelStyle}>{t("cfg.retentionDays")}</span>
                <input type="number" min={0}
                  value={ds.retention_days ?? ""}
                  onChange={(e) => patchDs(ds.id, { retention_days: e.target.value ? Number(e.target.value) : undefined })}
                  style={{ ...inputStyle, width: 120 }} placeholder={t("cfg.unlimited")} />
              </div>
            </div>
          </div>
        );
      })}

      <input ref={dbFileRef} type="file" accept=".db,application/octet-stream" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) doUploadDb(f); }} />
    </div>
  );
}
