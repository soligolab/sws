import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, getRuntimeBaseUrl, setRuntimeBaseUrl } from "@/api/client";
import type { BrowseDirEntry, ProjectListEntry, TemplateEntry } from "@/types";

// ── styles ────────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 8,
  padding: "12px 16px",
  display: "flex",
  alignItems: "center",
  gap: 12,
  cursor: "pointer",
  transition: "border-color 0.15s",
};

const BTN_PRIMARY: React.CSSProperties = {
  padding: "8px 20px",
  background: "var(--brand-primary, #3b82f6)",
  color: "var(--brand-on-primary, #fff)",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
};

const BTN_GHOST: React.CSSProperties = {
  padding: "8px 20px",
  background: "transparent",
  color: "var(--brand-text-muted, #94a3b8)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "var(--brand-bg, #0f172a)",
  color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 6,
  fontSize: 14,
  boxSizing: "border-box",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("it-IT", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** JS-side mirror of the server's `safe_project_name` — display-only preview
 *  of the final folder name; the real validation always happens server-side. */
function previewSafeName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "." || trimmed === "..") return "";
  return trimmed.replace(/[/\\:*?"<>|\x00]/g, "");
}

// ── DirectoryBrowser ──────────────────────────────────────────────────────────
//
// Mini file-browser backing the "destination folder" picker: navigates the
// runtime's filesystem via GET /api/fs/browse-dirs (no whitelist — the
// maintainer archives projects in Documents/backup shares outside the
// editor's own projects_root).

function DirectoryBrowser({
  initialPath,
  onSelect,
  onClose,
}: {
  initialPath?: string;
  onSelect: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState<string>(initialPath ?? "");
  const [parent, setParent]   = useState<string | null>(null);
  const [dirs, setDirs]       = useState<BrowseDirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  // null = the "new folder" input row is hidden.
  const [newName, setNewName] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async (path?: string) => {
    setLoading(true); setError(null);
    try {
      const res = await api.browseDirs(path || undefined);
      setCurrent(res.path);
      setParent(res.parent);
      setDirs(res.dirs);
    } catch (e: any) {
      setError(t("welcome.browseError", { err: e?.message ?? e }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(initialPath); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  // Not optimistic: mkdir is a local filesystem call, and showing a folder
  // that failed to be created would be worse than the round trip. On success
  // we navigate INTO the new folder — the next click is "use this folder".
  const handleCreateDir = async () => {
    const name = (newName ?? "").trim();
    if (!name || creating) return;
    setCreating(true); setError(null);
    try {
      const res = await api.createDir(current, name);
      setNewName(null);
      await load(res.path);
    } catch (e: any) {
      setError(t("welcome.mkdirError", { err: e?.message ?? e }));
    } finally {
      setCreating(false);
    }
  };

  const ROW: React.CSSProperties = {
    padding: "8px 12px",
    cursor: "pointer",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
    fontSize: 13,
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(0,0,0,0.7)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 300,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "var(--brand-surface, #1e293b)",
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 10,
        padding: 20,
        width: 460, maxWidth: "90vw",
        maxHeight: "70vh",
        display: "flex", flexDirection: "column",
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 10 }}>
          {t("welcome.directoryBrowserTitle")}
        </div>
        <div style={{
          fontSize: 12, fontFamily: "monospace", color: "var(--brand-text-muted, #94a3b8)",
          marginBottom: 10, wordBreak: "break-all",
        }}>
          {current}
        </div>
        <div style={{
          flex: 1, overflowY: "auto", minHeight: 160,
          border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6, marginBottom: 12,
        }}>
          {newName !== null && (
            <div style={{ ...ROW, cursor: "default", display: "flex", gap: 6, alignItems: "center" }}>
              <span>📁</span>
              <input
                autoFocus
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); handleCreateDir(); }
                  if (e.key === "Escape") { e.preventDefault(); setNewName(null); setError(null); }
                }}
                placeholder={t("welcome.newFolderPlaceholder")}
                style={{
                  flex: 1, background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
                  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
                  padding: "3px 6px", fontSize: 13,
                }}
              />
              <button style={BTN_GHOST} disabled={creating} onClick={handleCreateDir}>✓</button>
              <button style={BTN_GHOST} onClick={() => { setNewName(null); setError(null); }}>✕</button>
            </div>
          )}
          {parent !== null && (
            <div
              style={{ ...ROW, color: "var(--brand-text-muted, #94a3b8)" }}
              onClick={() => load(parent)}
            >
              ⬆ ..
            </div>
          )}
          {loading && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--brand-text-subtle, #64748b)" }}>
              {t("welcome.loading")}
            </div>
          )}
          {!loading && dirs.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "var(--brand-text-subtle, #64748b)" }}>
              {t("welcome.noSubfolders")}
            </div>
          )}
          {!loading && dirs.map((d) => (
            <div
              key={d.path}
              style={{ ...ROW, color: "var(--brand-text, #e2e8f0)" }}
              onClick={() => load(d.path)}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--brand-surface-2, #334155)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >
              📁 {d.name}
            </div>
          ))}
        </div>
        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button style={BTN_GHOST} disabled={!current || newName !== null}
            onClick={() => { setNewName(""); setError(null); }}>
            ＋ {t("welcome.newFolder")}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={BTN_GHOST} onClick={onClose}>{t("common.cancel")}</button>
            <button style={BTN_PRIMARY} onClick={() => onSelect(current)} disabled={!current}>
              {t("welcome.useThisFolder")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── NewProjectModal ───────────────────────────────────────────────────────────

type NewProjectTab = "empty" | "template" | "zip";

function NewProjectModal({
  onClose,
  onCreate,
  initialTab = "empty",
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
  /** Tab to open on. "zip" is used by the "open from a ZIP on my PC" entry. */
  initialTab?: NewProjectTab;
}) {
  const { t } = useTranslation();
  const [tab, setTab]                 = useState<NewProjectTab>(initialTab);
  const [name, setName]               = useState("");
  const [templates, setTemplates]     = useState<TemplateEntry[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>("");
  const [zipFile, setZipFile]         = useState<File | null>(null);
  const [parentPath, setParentPath]   = useState("");
  const [showBrowser, setShowBrowser] = useState(false);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const nameRef                       = useRef<HTMLInputElement>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    api.listTemplates()
      .then((list) => {
        setTemplates(list);
        if (list.length > 0) setSelectedTpl(list[0].id);
      })
      .catch(() => { /* templates are optional — fail silently */ });
  }, []);

  const handleCreate = async () => {
    setBusy(true); setError(null);
    const trimmedParent = parentPath.trim() || undefined;
    try {
      if (tab === "zip") {
        if (!zipFile) { setError(t("welcome.errNoZip")); setBusy(false); return; }
        // name is optional — backend reads it from manifest.json if blank
        const nameOverride = name.trim() || undefined;
        const result = await api.uploadProjectZip(zipFile, nameOverride, trimmedParent);
        onCreate(result.name);
      } else {
        const trimmed = name.trim();
        if (!trimmed) { setError(t("welcome.errNoName")); setBusy(false); return; }
        await api.createProject({ name: trimmed, template: tab === "template" ? selectedTpl : undefined, parent_path: trimmedParent });
        onCreate(trimmed);
      }
    } catch (e: any) {
      setError(e?.message ?? t("welcome.errCreate"));
    } finally {
      setBusy(false);
    }
  };

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "6px 18px",
    background: active ? "var(--brand-primary, #3b82f6)" : "transparent",
    color: active ? "#fff" : "var(--brand-text-muted, #94a3b8)",
    border: "1px solid " + (active ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)"),
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  });

  const createLabel = busy ? t("welcome.creating") : tab === "zip" ? t("welcome.uploadCreate") : t("welcome.createProject");

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "var(--brand-surface, #1e293b)",
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 12,
        padding: 28,
        width: 440,
        maxWidth: "90vw",
      }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18, color: "var(--brand-text, #e2e8f0)" }}>{t("welcome.newProject")}</h2>

        {/* tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button style={TAB_STYLE(tab === "empty")} onClick={() => setTab("empty")}>{t("welcome.empty")}</button>
          <button
            style={TAB_STYLE(tab === "template")}
            onClick={() => setTab("template")}
            disabled={templates.length === 0}
            title={templates.length === 0 ? t("welcome.noTemplates") : undefined}
          >
            {t("welcome.fromTemplate")}
          </button>
          <button style={TAB_STYLE(tab === "zip")} onClick={() => setTab("zip")}>
            {t("welcome.fromZip")}
          </button>
        </div>

        {/* ZIP tab */}
        {tab === "zip" && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
                {t("welcome.zipFileLabel")}
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  style={{ ...BTN_GHOST, padding: "6px 14px", fontSize: 13 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  {t("welcome.chooseFile")}
                </button>
                <span style={{ fontSize: 13, color: zipFile ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {zipFile ? zipFile.name : t("welcome.noFileSelected")}
                </span>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,application/zip"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  e.target.value = "";
                  setZipFile(f);
                  setError(null);
                  // Auto-fill name from filename (strip extension, replace spaces)
                  if (f && !name.trim()) {
                    setName(f.name.replace(/\.zip$/i, "").replace(/\s+/g, "-"));
                  }
                }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
                {t("welcome.projectNameLabel")} <span style={{ color: "var(--brand-border, #475569)" }}>{t("welcome.projectNameZipOptional")}</span>
              </label>
              <input
                style={INPUT}
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder={t("welcome.zipNamePlaceholder")}
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
              />
            </div>
          </>
        )}

        {/* Vuoto / template tab: shared name field */}
        {tab !== "zip" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
              {t("welcome.projectNameLabel")}
            </label>
            <input
              ref={nameRef}
              style={INPUT}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder={t("welcome.namePlaceholder")}
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            />
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 }}>
              {t("welcome.folderNameHint")}
            </div>
          </div>
        )}

        {/* template selector */}
        {tab === "template" && templates.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
              {t("welcome.template")}
            </label>
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={selectedTpl}
              onChange={(e) => setSelectedTpl(e.target.value)}
            >
              {templates.map((tpl) => (
                <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
              ))}
            </select>
            {templates.find((tpl) => tpl.id === selectedTpl)?.description && (
              <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
                {templates.find((tpl) => tpl.id === selectedTpl)!.description}
              </div>
            )}
          </div>
        )}

        {/* destination folder — shared across all 3 tabs */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
            {t("welcome.destinationFolder")}
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              style={{ ...INPUT, flex: 1, fontFamily: "monospace", fontSize: 13 }}
              value={parentPath}
              onChange={(e) => { setParentPath(e.target.value); setError(null); }}
              placeholder={t("welcome.destinationDefault")}
            />
            <button
              style={{ ...BTN_GHOST, padding: "6px 14px", fontSize: 13, whiteSpace: "nowrap" }}
              onClick={() => setShowBrowser(true)}
              disabled={busy}
            >
              {t("welcome.browse")}
            </button>
          </div>
          <div style={{
            fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 4,
            fontFamily: "monospace", wordBreak: "break-all",
          }}>
            {t("welcome.finalPathPreview", {
              path: `${parentPath.trim() || t("welcome.destinationDefault")}/${
                previewSafeName(name) || (tab === "zip" ? t("welcome.nameFromZipPlaceholder") : "…")
              }`,
            })}
          </div>
        </div>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={BTN_GHOST} onClick={onClose} disabled={busy}>{t("common.cancel")}</button>
          <button style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }} onClick={handleCreate} disabled={busy}>
            {createLabel}
          </button>
        </div>
      </div>

      {showBrowser && (
        <DirectoryBrowser
          initialPath={parentPath.trim() || undefined}
          onSelect={(path) => { setParentPath(path); setShowBrowser(false); }}
          onClose={() => setShowBrowser(false)}
        />
      )}
    </div>
  );
}

// ── RemoteRuntimeModal ────────────────────────────────────────────────────────
//
// ARCH-004: switch the SPA to a different runtime URL without rebuilding.
// Probes `/health` over the supplied origin (CORS allows it since the
// runtime ships a permissive CorsLayer). On success, persists the URL in
// localStorage and triggers a full window reload so the api client + WS
// helpers pick the new base, and so stale auth tokens / project state
// from the previous runtime are cleared cleanly.

// ── DeploySection ─────────────────────────────────────────────────────────────

const DEPLOY_KEY = (host: string) => `sws.deploy.${host}`;

function loadDeployCreds(host: string) {
  try {
    const raw = localStorage.getItem(DEPLOY_KEY(host));
    if (raw) return JSON.parse(raw) as { port: number; user: string; password: string };
  } catch { /* ignore */ }
  return null;
}

function saveDeployCreds(host: string, creds: { port: number; user: string; password: string }) {
  try { localStorage.setItem(DEPLOY_KEY(host), JSON.stringify(creds)); } catch { /* ignore */ }
}

function DeploySection() {
  const { t } = useTranslation();
  const [arch, setArch]           = useState<"amd64" | "arm64">("arm64");
  const [host, setHost]           = useState("");
  const [port, setPort]           = useState(22);
  const [user, setUser]           = useState("root");
  const [password, setPassword]   = useState("");
  const [remotePath, setRemotePath] = useState("/data/user/sws");
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs]           = useState<string[]>([]);
  const logsRef                   = useRef<HTMLDivElement>(null);

  // Restore saved credentials when host changes
  useEffect(() => {
    if (!host) return;
    const saved = loadDeployCreds(host);
    if (saved) { setPort(saved.port); setUser(saved.user); setPassword(saved.password); }
  }, [host]);

  // Auto-scroll log panel
  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleDeploy = async () => {
    if (!host || !user) return;
    saveDeployCreds(host, { port, user, password });
    setDeploying(true);
    setLogs([`Avvio deploy → ${user}@${host}:${port} (${arch}) ${remotePath}`]);

    try {
      const res = await api.deployRemote({ arch, host, port, user, password, remote_path: remotePath });
      if (!res.ok) {
        setLogs((l) => [...l, `ERROR: HTTP ${res.status} ${res.statusText}`]);
        setDeploying(false);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setLogs((l) => [...l, "ERROR: streaming non supportato"]); setDeploying(false); return; }
      const dec = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const text = dec.decode(value);
          const lines = text.split("\n").filter((s) => s.trim());
          setLogs((l) => [...l, ...lines]);
        }
      }
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setDeploying(false);
    }
  };

  const done = logs.some((l) => l === "DONE");
  const hasError = logs.some((l) => l.startsWith("ERROR:"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        Scarica il binario <code>sws-runtime</code> da GitHub Releases e lo
        installa sul dispositivo remoto via SCP. Richiede <code>sshpass</code>
        e <code>scp</code> installati sulla macchina locale.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.targetArch")}</label>
          <select
            style={{ ...INPUT, cursor: "pointer" }}
            value={arch}
            onChange={(e) => setArch(e.target.value as "amd64" | "arm64")}
          >
            <option value="arm64">linux/arm64 (PX30, Pi)</option>
            <option value="amd64">linux/amd64 (x86-64)</option>
          </select>
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.remotePath")}</label>
          <input
            style={INPUT}
            placeholder="/data/user/sws"
            value={remotePath}
            onChange={(e) => setRemotePath(e.target.value)}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshHost")}</label>
          <input
            style={INPUT}
            placeholder="192.168.1.59"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.port")}</label>
          <input
            style={{ ...INPUT, width: 60 }}
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(Number(e.target.value))}
          />
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshUser")}</label>
          <input style={INPUT} placeholder="root" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshPassword")}</label>
          <input style={INPUT} type="password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>

      {logs.length > 0 && (
        <div
          ref={logsRef}
          style={{
            background: "#0a0f1a", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6,
            padding: "8px 10px", maxHeight: 140, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
          }}
        >
          {logs.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith("ERROR:") ? "var(--brand-danger-soft, #fca5a5)"
                  : line.startsWith("WARN:") ? "var(--brand-warning-soft, #fbbf24)"
                  : line === "DONE" ? "var(--brand-success, #22c55e)"
                  : "var(--brand-text-muted, #94a3b8)",
              }}
            >
              {line}
            </div>
          ))}
          {deploying && <div style={{ color: "#60a5fa" }}>…</div>}
        </div>
      )}

      <button
        style={{ ...BTN_PRIMARY, opacity: (!host || !user || deploying) ? 0.5 : 1 }}
        disabled={!host || !user || deploying}
        onClick={handleDeploy}
      >
        {deploying ? t("welcome.deploying") : done ? t("welcome.deployDone") : hasError ? t("welcome.retryDeploy") : t("welcome.deploy")}
      </button>
    </div>
  );
}

function RemoteRuntimeModal({
  current,
  onClose,
}: {
  current: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab]         = useState<"connect" | "deploy">("connect");
  const [url, setUrl]         = useState(current);
  const [probing, setProbing] = useState(false);
  const [probed, setProbed]   = useState<"ok" | "fail" | null>(null);
  const [error, setError]     = useState<string | null>(null);

  const normalised = url.trim().replace(/\/$/, "");

  const probe = async () => {
    if (!normalised) return;
    setProbing(true); setProbed(null); setError(null);
    try {
      const res = await fetch(`${normalised}/health`, { method: "GET" });
      if (res.ok) {
        setProbed("ok");
      } else {
        setProbed("fail");
        setError(`Il runtime ha risposto ${res.status} ${res.statusText}. URL valido ma /health non OK.`);
      }
    } catch (e: any) {
      setProbed("fail");
      const msg = String(e?.message ?? e);
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setError(`Connessione fallita. Possibili cause: runtime spento, URL errato, oppure certificato self-signed mai accettato in questo browser. Apri ${normalised}/health in una nuova scheda e accetta il certificato, poi riprova.`);
      } else {
        setError(msg);
      }
    } finally {
      setProbing(false);
    }
  };

  const connect = () => {
    setRuntimeBaseUrl(normalised);
    window.location.reload();
  };

  const reset = () => {
    setRuntimeBaseUrl(null);
    window.location.reload();
  };

  const TAB_BTN = (active: boolean): React.CSSProperties => ({
    padding: "6px 16px",
    background: active ? "#1e3a8a" : "transparent",
    color: active ? "#bfdbfe" : "var(--brand-text-muted, #94a3b8)",
    border: active ? "1px solid var(--brand-primary-hover, #2563eb)" : "1px solid transparent",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  });

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 10, padding: 24,
        width: 520, maxWidth: "92vw",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 12 }}>
          {t("welcome.remoteRuntimeTitle")}
        </div>

        {/* Tab selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button style={TAB_BTN(tab === "connect")} onClick={() => setTab("connect")}>{t("welcome.connect")}</button>
          <button style={TAB_BTN(tab === "deploy")} onClick={() => setTab("deploy")}>{t("welcome.deployBinary")}</button>
        </div>

        {tab === "connect" && (
          <>
            <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginBottom: 16 }}>
              Connetti l'editor a un runtime SWS in esecuzione su un'altra macchina
              (tipicamente il PX30 sul campo). L'URL viene salvato nel browser
              (localStorage) e usato da tutte le chiamate API/WS finché non lo
              ripristini al locale.
            </div>

            <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 4 }}>
              {t("welcome.runtimeUrl")}
            </label>
            <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
              <input
                style={{ ...INPUT, flex: 1 }}
                placeholder="https://px30.local:8443"
                value={url}
                onChange={(e) => { setUrl(e.target.value); setProbed(null); setError(null); }}
                autoFocus
              />
              <button
                style={{ ...BTN_GHOST, padding: "8px 14px" }}
                onClick={probe}
                disabled={!normalised || probing}
              >
                {probing ? t("welcome.testing") : t("common.test")}
              </button>
            </div>
            {probed === "ok" && (
              <div style={{ fontSize: 12, color: "var(--brand-success, #22c55e)", marginBottom: 8 }}>
                {t("welcome.healthOk")}
              </div>
            )}
            {probed === "fail" && error && (
              <div style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)", marginBottom: 8, lineHeight: 1.4 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              {current && (
                <button
                  style={{ ...BTN_GHOST, marginRight: "auto" }}
                  onClick={reset}
                  title={t("welcome.restoreLocal")}
                >
                  {t("welcome.backToLocal")}
                </button>
              )}
              <button style={BTN_GHOST} onClick={onClose}>{t("common.cancel")}</button>
              <button
                style={{ ...BTN_PRIMARY, opacity: probed === "ok" ? 1 : 0.5 }}
                onClick={connect}
                disabled={probed !== "ok"}
              >{t("welcome.connect")}</button>
            </div>
          </>
        )}

        {tab === "deploy" && (
          <>
            <DeploySection />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button style={BTN_GHOST} onClick={onClose}>{t("common.close")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── WelcomeScreen ─────────────────────────────────────────────────────────────

interface WelcomeScreenProps {
  /** Called once a project has been opened and the user must log in. */
  onProjectOpened: () => void;
}

type EditingState = { name: string; mode: "rename" | "duplicate"; value: string };

export function WelcomeScreen({ onProjectOpened }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [projects, setProjects]   = useState<ProjectListEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openingName, setOpening] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [newTab, setNewTab]       = useState<NewProjectTab>("empty");
  const [showRuntime, setShowRuntime] = useState(false);
  const [editing, setEditing]     = useState<EditingState | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const remoteRuntime             = getRuntimeBaseUrl();

  const loadProjects = async () => {
    setLoading(true);
    try {
      const list = await api.listProjects();
      setProjects(list);
    } catch (e: any) {
      setError(e?.message ?? t("welcome.loadListError"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadProjects(); }, []);

  const handleOpen = async (name: string) => {
    setOpening(name); setError(null);
    try {
      await api.openProject(name);
      onProjectOpened();
    } catch (e: any) {
      setError(t("welcome.errOpen", { name, err: e?.message ?? e }));
    } finally {
      setOpening(null);
    }
  };

  const handleCreated = async (name: string) => {
    setShowNew(false);
    await loadProjects();
    await handleOpen(name);
  };

  const handleDelete = async (p: ProjectListEntry) => {
    const confirmMsg = p.external
      ? t("welcome.confirmRemoveExternal", { name: p.name })
      : t("welcome.confirmDelete", { name: p.name });
    if (!window.confirm(confirmMsg)) return;
    setActionBusy(p.name); setError(null);
    try {
      await api.deleteProject(p.name);
      await loadProjects();
    } catch (e: any) {
      setError(t(p.external ? "welcome.errRemove" : "welcome.errDelete", { name: p.name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitRename = async () => {
    if (!editing || editing.mode !== "rename") return;
    const { name, value } = editing;
    const newName = value.trim();
    if (!newName || newName === name) { setEditing(null); return; }
    setActionBusy(name); setEditing(null); setError(null);
    try {
      await api.renameProject(name, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errRename", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitDuplicate = async () => {
    if (!editing || editing.mode !== "duplicate") return;
    const { name, value } = editing;
    const newName = value.trim();
    if (!newName) { setEditing(null); return; }
    setActionBusy(name); setEditing(null); setError(null);
    try {
      await api.duplicateProject(name, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errDuplicate", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
      fontFamily: "system-ui, sans-serif",
    }}>
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreated}
          initialTab={newTab}
        />
      )}
      {showRuntime && (
        <RemoteRuntimeModal
          current={remoteRuntime}
          onClose={() => setShowRuntime(false)}
        />
      )}

      <div style={{ width: 480, maxWidth: "90vw" }}>
        {/* logo / title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 2, color: "var(--brand-text, #e2e8f0)" }}>SWS</div>
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 14, marginTop: 4 }}>
            {t("welcome.selectOrCreate")}
          </div>
        </div>

        {/* project list */}
        <div style={{ marginBottom: 16 }}>
          {loading && (
            <div style={{ textAlign: "center", color: "var(--brand-text-subtle, #64748b)", padding: 24 }}>{t("welcome.loading")}</div>
          )}
          {!loading && projects.length === 0 && (
            <div style={{
              textAlign: "center", color: "var(--brand-text-subtle, #64748b)", padding: 32,
              border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 8,
            }}>
              {t("welcome.noProjects")}
            </div>
          )}
          {!loading && projects.map((p) => {
            const isOpening  = openingName === p.name;
            const isBusy     = actionBusy  === p.name;
            const isEditing  = editing?.name === p.name;
            const isRenaming = isEditing && editing?.mode === "rename";
            const isDuping   = isEditing && editing?.mode === "duplicate";
            const dimmed     = (openingName || actionBusy) && !isOpening && !isBusy;

            const ACT_BTN: React.CSSProperties = {
              background: "none", border: "none", cursor: "pointer",
              color: "var(--brand-text-muted, #94a3b8)", fontSize: 15, padding: "2px 5px",
              borderRadius: 4, lineHeight: 1,
            };

            return (
              <div key={p.name} style={{ marginBottom: 8 }}>
                {/* main card row */}
                <div
                  style={{
                    ...CARD,
                    opacity: dimmed ? 0.45 : 1,
                    borderColor: isOpening ? "var(--brand-primary, #3b82f6)" : isBusy ? "var(--brand-warning, #f59e0b)" : "var(--brand-surface-2, #334155)",
                    cursor: (openingName || actionBusy || isEditing) ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (!openingName && !actionBusy && !isEditing) handleOpen(p.name);
                  }}
                >
                  {/* icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, background: "var(--brand-surface-2, #334155)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, flexShrink: 0,
                  }}>📁</div>

                  {/* name + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? (
                      <input
                        autoFocus
                        style={{ ...INPUT, padding: "3px 8px", fontSize: 14, width: "100%" }}
                        value={editing!.value}
                        onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
                          if (e.key === "Escape") setEditing(null);
                        }}
                        onBlur={commitRename}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--brand-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 6 }}>
                        {p.name}
                        {p.external && (
                          <span style={{
                            fontSize: 10, fontWeight: 500, color: "var(--brand-text-subtle, #64748b)",
                            border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "1px 5px",
                          }}>
                            {t("welcome.externalBadge")}
                          </span>
                        )}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>
                      {p.last_opened_ms
                        ? t("welcome.lastOpened", { date: formatDate(p.last_opened_ms) })
                        : t("welcome.lastModified", { date: formatDate(p.last_modified_ms) })}
                    </div>
                    <div
                      style={{
                        fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 1,
                        fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      }}
                      title={p.path}
                    >
                      {p.path}
                    </div>
                  </div>

                  {/* action buttons */}
                  {!isOpening && !isBusy && (
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        title={t("editor.rename")}
                        style={{ ...ACT_BTN, color: isRenaming ? "var(--brand-primary, #3b82f6)" : "var(--brand-text-muted, #94a3b8)" }}
                        onClick={() => setEditing({ name: p.name, mode: "rename", value: p.name })}
                      >✎</button>
                      <button
                        title={t("editor.duplicate")}
                        style={{ ...ACT_BTN, color: isDuping ? "#a855f7" : "var(--brand-text-muted, #94a3b8)" }}
                        onClick={() => setEditing({ name: p.name, mode: "duplicate", value: p.name + " (copia)" })}
                      >⧉</button>
                      <button
                        title={p.external ? t("welcome.removeFromList") : t("editor.delete")}
                        style={{ ...ACT_BTN }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand-danger, #ef4444)")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--brand-text-muted, #94a3b8)")}
                        onClick={() => handleDelete(p)}
                      >✕</button>
                    </div>
                  )}

                  {/* status label */}
                  {isOpening && <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", flexShrink: 0 }}>{t("welcome.opening")}</div>}
                  {isBusy   && <div style={{ fontSize: 13, color: "var(--brand-warning, #f59e0b)", flexShrink: 0 }}>…</div>}
                  {!isOpening && !isBusy && (
                    <div style={{ fontSize: 13, color: "var(--brand-primary, #3b82f6)", fontWeight: 500, flexShrink: 0, marginLeft: 4 }}>{t("welcome.open")}</div>
                  )}
                </div>

                {/* duplicate name input — shown below card */}
                {isDuping && (
                  <div
                    style={{
                      display: "flex", gap: 8, alignItems: "center",
                      padding: "8px 12px", background: "var(--brand-surface, #1e293b)",
                      border: "1px solid #a855f7", borderTop: "none",
                      borderRadius: "0 0 8px 8px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "nowrap" }}>{t("welcome.copyName")}</span>
                    <input
                      autoFocus
                      style={{ ...INPUT, padding: "4px 8px", fontSize: 13, flex: 1 }}
                      value={editing!.value}
                      onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === "Enter")  { e.preventDefault(); commitDuplicate(); }
                        if (e.key === "Escape") setEditing(null);
                      }}
                    />
                    <button style={{ ...BTN_PRIMARY, padding: "4px 12px", fontSize: 13 }}
                      onClick={commitDuplicate}>✓</button>
                    <button style={{ ...BTN_GHOST, padding: "4px 10px", fontSize: 13 }}
                      onClick={() => setEditing(null)}>✗</button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div style={{ color: "var(--brand-danger-soft, #fca5a5)", fontSize: 13, marginBottom: 14, textAlign: "center" }}>
            {error}
          </div>
        )}

        {/* new project + open a copy that lives on the user's PC. The ZIP
            path is non-destructive (POST /api/projects/upload creates a new
            project) — unlike ☰ → "Sostituisci da copia sul PC". */}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            style={{ ...BTN_PRIMARY, flex: 1, padding: "12px 0", fontSize: 15 }}
            onClick={() => { setNewTab("empty"); setShowNew(true); }}
            disabled={!!openingName}
          >
            {t("welcome.newProjectBtn")}
          </button>
          <button
            style={{ ...BTN_GHOST, padding: "12px 16px", fontSize: 14 }}
            onClick={() => { setNewTab("zip"); setShowNew(true); }}
            disabled={!!openingName}
            title={t("welcome.openFromZipTitle")}
          >
            {t("welcome.openFromZip")}
          </button>
        </div>

        {/* runtime selector — small footer row */}
        <div style={{
          marginTop: 20, paddingTop: 14,
          borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: 12, color: "var(--brand-text-subtle, #64748b)",
        }}>
          {remoteRuntime ? (
            <>
              <span style={{ fontSize: 14 }}>📡</span>
              <span>{t("welcome.connectedTo")}</span>
              <span style={{ color: "var(--brand-primary, #3b82f6)", fontFamily: "monospace" }}>{remoteRuntime}</span>
              <button
                style={{ background: "transparent", border: "none", color: "var(--brand-text-muted, #94a3b8)", cursor: "pointer", fontSize: 11, textDecoration: "underline dotted" }}
                onClick={() => setShowRuntime(true)}
              >
                cambia
              </button>
            </>
          ) : (
            <>
              <span>{t("welcome.localRuntime")}</span>
              <button
                style={{ background: "transparent", border: "none", color: "var(--brand-primary, #3b82f6)", cursor: "pointer", fontSize: 12, textDecoration: "underline dotted" }}
                onClick={() => setShowRuntime(true)}
              >
                {t("welcome.connectRemote")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
