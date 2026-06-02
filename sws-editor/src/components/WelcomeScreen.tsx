import { useEffect, useRef, useState } from "react";
import { api, getRuntimeBaseUrl, setRuntimeBaseUrl } from "@/api/client";
import type { ProjectListEntry, TemplateEntry } from "@/types";

// ── styles ────────────────────────────────────────────────────────────────────

const CARD: React.CSSProperties = {
  background: "#1e293b",
  border: "1px solid #334155",
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
  background: "#3b82f6",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
};

const BTN_GHOST: React.CSSProperties = {
  padding: "8px 20px",
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid #334155",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 14,
};

const INPUT: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  background: "#0f172a",
  color: "#e2e8f0",
  border: "1px solid #334155",
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

// ── NewProjectModal ───────────────────────────────────────────────────────────

type NewProjectTab = "empty" | "template" | "zip";

function NewProjectModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [tab, setTab]                 = useState<NewProjectTab>("empty");
  const [name, setName]               = useState("");
  const [templates, setTemplates]     = useState<TemplateEntry[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>("");
  const [zipFile, setZipFile]         = useState<File | null>(null);
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
    try {
      if (tab === "zip") {
        if (!zipFile) { setError("Seleziona un file ZIP da importare."); setBusy(false); return; }
        // name is optional — backend reads it from manifest.json if blank
        const nameOverride = name.trim() || undefined;
        const result = await api.uploadProjectZip(zipFile, nameOverride);
        onCreate(result.name);
      } else {
        const trimmed = name.trim();
        if (!trimmed) { setError("Inserisci un nome per il progetto."); setBusy(false); return; }
        await api.createProject({ name: trimmed, template: tab === "template" ? selectedTpl : undefined });
        onCreate(trimmed);
      }
    } catch (e: any) {
      setError(e?.message ?? "Errore nella creazione.");
    } finally {
      setBusy(false);
    }
  };

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    padding: "6px 18px",
    background: active ? "#3b82f6" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    border: "1px solid " + (active ? "#3b82f6" : "#334155"),
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 600 : 400,
  });

  const createLabel = busy ? "Creo…" : tab === "zip" ? "Carica e crea" : "Crea progetto";

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200,
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "#1e293b",
        border: "1px solid #334155",
        borderRadius: 12,
        padding: 28,
        width: 440,
        maxWidth: "90vw",
      }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 18, color: "#e2e8f0" }}>Nuovo progetto</h2>

        {/* tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
          <button style={TAB_STYLE(tab === "empty")} onClick={() => setTab("empty")}>Vuoto</button>
          <button
            style={TAB_STYLE(tab === "template")}
            onClick={() => setTab("template")}
            disabled={templates.length === 0}
            title={templates.length === 0 ? "Nessun template disponibile" : undefined}
          >
            Da template
          </button>
          <button style={TAB_STYLE(tab === "zip")} onClick={() => setTab("zip")}>
            Da ZIP
          </button>
        </div>

        {/* ZIP tab */}
        {tab === "zip" && (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>
                File ZIP (esportazione SWS)
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  style={{ ...BTN_GHOST, padding: "6px 14px", fontSize: 13 }}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={busy}
                >
                  Scegli file…
                </button>
                <span style={{ fontSize: 13, color: zipFile ? "#e2e8f0" : "#64748b", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {zipFile ? zipFile.name : "Nessun file selezionato"}
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
              <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>
                Nome progetto <span style={{ color: "#475569" }}>(opzionale — usa il nome dal ZIP se vuoto)</span>
              </label>
              <input
                style={INPUT}
                value={name}
                onChange={(e) => { setName(e.target.value); setError(null); }}
                placeholder="Lascia vuoto per usare il nome dal ZIP"
                onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
              />
            </div>
          </>
        )}

        {/* Vuoto / template tab: shared name field */}
        {tab !== "zip" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>
              Nome progetto
            </label>
            <input
              ref={nameRef}
              style={INPUT}
              value={name}
              onChange={(e) => { setName(e.target.value); setError(null); }}
              placeholder="es. impianto-nord"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreate(); if (e.key === "Escape") onClose(); }}
            />
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
              Sarà usato come nome della cartella. Solo lettere, cifre, trattini e underscore.
            </div>
          </div>
        )}

        {/* template selector */}
        {tab === "template" && templates.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "#94a3b8", display: "block", marginBottom: 6 }}>
              Template
            </label>
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={selectedTpl}
              onChange={(e) => setSelectedTpl(e.target.value)}
            >
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
            {templates.find((t) => t.id === selectedTpl)?.description && (
              <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
                {templates.find((t) => t.id === selectedTpl)!.description}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 14 }}>{error}</div>
        )}

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button style={BTN_GHOST} onClick={onClose} disabled={busy}>Annulla</button>
          <button style={{ ...BTN_PRIMARY, opacity: busy ? 0.6 : 1 }} onClick={handleCreate} disabled={busy}>
            {createLabel}
          </button>
        </div>
      </div>
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
      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.5 }}>
        Scarica il binario <code>sws-runtime</code> da GitHub Releases e lo
        installa sul dispositivo remoto via SCP. Richiede <code>sshpass</code>
        e <code>scp</code> installati sulla macchina locale.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Architettura target</label>
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
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Path remoto</label>
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
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Host SSH</label>
          <input
            style={INPUT}
            placeholder="192.168.1.59"
            value={host}
            onChange={(e) => setHost(e.target.value)}
          />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Porta</label>
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
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Utente SSH</label>
          <input style={INPUT} placeholder="root" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 3 }}>Password SSH</label>
          <input style={INPUT} type="password" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>

      {logs.length > 0 && (
        <div
          ref={logsRef}
          style={{
            background: "#0a0f1a", border: "1px solid #1e293b", borderRadius: 6,
            padding: "8px 10px", maxHeight: 140, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
          }}
        >
          {logs.map((line, i) => (
            <div
              key={i}
              style={{
                color: line.startsWith("ERROR:") ? "#fca5a5"
                  : line.startsWith("WARN:") ? "#fbbf24"
                  : line === "DONE" ? "#22c55e"
                  : "#94a3b8",
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
        {deploying ? "Deploy in corso…" : done ? "✓ Deploy completato" : hasError ? "Riprova deploy" : "Deploy"}
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
    color: active ? "#bfdbfe" : "#94a3b8",
    border: active ? "1px solid #2563eb" : "1px solid transparent",
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
        background: "#0f172a", border: "1px solid #334155",
        borderRadius: 10, padding: 24,
        width: 520, maxWidth: "92vw",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 12 }}>
          📡 Runtime remoto
        </div>

        {/* Tab selector */}
        <div style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          <button style={TAB_BTN(tab === "connect")} onClick={() => setTab("connect")}>Connetti</button>
          <button style={TAB_BTN(tab === "deploy")} onClick={() => setTab("deploy")}>Deploy binario</button>
        </div>

        {tab === "connect" && (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
              Connetti l'editor a un runtime SWS in esecuzione su un'altra macchina
              (tipicamente il PX30 sul campo). L'URL viene salvato nel browser
              (localStorage) e usato da tutte le chiamate API/WS finché non lo
              ripristini al locale.
            </div>

            <label style={{ fontSize: 11, color: "#94a3b8", display: "block", marginBottom: 4 }}>
              URL del runtime
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
                {probing ? "Test…" : "Test"}
              </button>
            </div>
            {probed === "ok" && (
              <div style={{ fontSize: 12, color: "#22c55e", marginBottom: 8 }}>
                ✓ Il runtime risponde a /health. Pronto per connettersi.
              </div>
            )}
            {probed === "fail" && error && (
              <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 8, lineHeight: 1.4 }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
              {current && (
                <button
                  style={{ ...BTN_GHOST, marginRight: "auto" }}
                  onClick={reset}
                  title="Ripristina runtime locale (same-origin)"
                >
                  ↺ Torna al locale
                </button>
              )}
              <button style={BTN_GHOST} onClick={onClose}>Annulla</button>
              <button
                style={{ ...BTN_PRIMARY, opacity: probed === "ok" ? 1 : 0.5 }}
                onClick={connect}
                disabled={probed !== "ok"}
              >
                Connetti
              </button>
            </div>
          </>
        )}

        {tab === "deploy" && (
          <>
            <DeploySection />
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button style={BTN_GHOST} onClick={onClose}>Chiudi</button>
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
  const [projects, setProjects]   = useState<ProjectListEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openingName, setOpening] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
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
      setError(e?.message ?? "Impossibile caricare la lista dei progetti.");
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
      setError(`Errore apertura "${name}": ${e?.message ?? e}`);
    } finally {
      setOpening(null);
    }
  };

  const handleCreated = async (name: string) => {
    setShowNew(false);
    await loadProjects();
    await handleOpen(name);
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(`Eliminare il progetto "${name}"? L'operazione non è reversibile.`)) return;
    setActionBusy(name); setError(null);
    try {
      await api.deleteProject(name);
      await loadProjects();
    } catch (e: any) {
      setError(`Errore eliminazione "${name}": ${e?.message ?? e}`);
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
      setError(`Errore rinomina "${name}": ${e?.message ?? e}`);
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
      setError(`Errore duplicazione "${name}": ${e?.message ?? e}`);
    } finally {
      setActionBusy(null);
    }
  };

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", height: "100vh",
      background: "#0f172a", color: "#e2e8f0",
      fontFamily: "system-ui, sans-serif",
    }}>
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreated}
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
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 2, color: "#e2e8f0" }}>SWS</div>
          <div style={{ color: "#64748b", fontSize: 14, marginTop: 4 }}>
            Seleziona o crea un progetto per iniziare
          </div>
        </div>

        {/* project list */}
        <div style={{ marginBottom: 16 }}>
          {loading && (
            <div style={{ textAlign: "center", color: "#64748b", padding: 24 }}>Carico…</div>
          )}
          {!loading && projects.length === 0 && (
            <div style={{
              textAlign: "center", color: "#64748b", padding: 32,
              border: "1px dashed #334155", borderRadius: 8,
            }}>
              Nessun progetto trovato. Crea il tuo primo progetto.
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
              color: "#94a3b8", fontSize: 15, padding: "2px 5px",
              borderRadius: 4, lineHeight: 1,
            };

            return (
              <div key={p.name} style={{ marginBottom: 8 }}>
                {/* main card row */}
                <div
                  style={{
                    ...CARD,
                    opacity: dimmed ? 0.45 : 1,
                    borderColor: isOpening ? "#3b82f6" : isBusy ? "#f59e0b" : "#334155",
                    cursor: (openingName || actionBusy || isEditing) ? "default" : "pointer",
                  }}
                  onClick={() => {
                    if (!openingName && !actionBusy && !isEditing) handleOpen(p.name);
                  }}
                >
                  {/* icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, background: "#334155",
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
                      <div style={{ fontWeight: 600, fontSize: 15, color: "#e2e8f0" }}>{p.name}</div>
                    )}
                    <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                      Ultima modifica: {formatDate(p.last_modified_ms)}
                    </div>
                  </div>

                  {/* action buttons */}
                  {!isOpening && !isBusy && (
                    <div style={{ display: "flex", gap: 2, flexShrink: 0 }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        title="Rinomina"
                        style={{ ...ACT_BTN, color: isRenaming ? "#3b82f6" : "#94a3b8" }}
                        onClick={() => setEditing({ name: p.name, mode: "rename", value: p.name })}
                      >✎</button>
                      <button
                        title="Duplica"
                        style={{ ...ACT_BTN, color: isDuping ? "#a855f7" : "#94a3b8" }}
                        onClick={() => setEditing({ name: p.name, mode: "duplicate", value: p.name + " (copia)" })}
                      >⧉</button>
                      <button
                        title="Elimina"
                        style={{ ...ACT_BTN }}
                        onMouseEnter={(e) => (e.currentTarget.style.color = "#ef4444")}
                        onMouseLeave={(e) => (e.currentTarget.style.color = "#94a3b8")}
                        onClick={() => handleDelete(p.name)}
                      >✕</button>
                    </div>
                  )}

                  {/* status label */}
                  {isOpening && <div style={{ fontSize: 13, color: "#94a3b8", flexShrink: 0 }}>Apro…</div>}
                  {isBusy   && <div style={{ fontSize: 13, color: "#f59e0b", flexShrink: 0 }}>…</div>}
                  {!isOpening && !isBusy && (
                    <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 500, flexShrink: 0, marginLeft: 4 }}>Apri →</div>
                  )}
                </div>

                {/* duplicate name input — shown below card */}
                {isDuping && (
                  <div
                    style={{
                      display: "flex", gap: 8, alignItems: "center",
                      padding: "8px 12px", background: "#1e293b",
                      border: "1px solid #a855f7", borderTop: "none",
                      borderRadius: "0 0 8px 8px",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>Nome copia:</span>
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
          <div style={{ color: "#fca5a5", fontSize: 13, marginBottom: 14, textAlign: "center" }}>
            {error}
          </div>
        )}

        {/* new project button */}
        <div style={{ textAlign: "center" }}>
          <button
            style={{ ...BTN_PRIMARY, width: "100%", padding: "12px 0", fontSize: 15 }}
            onClick={() => setShowNew(true)}
            disabled={!!openingName}
          >
            + Nuovo progetto
          </button>
        </div>

        {/* runtime selector — small footer row */}
        <div style={{
          marginTop: 20, paddingTop: 14,
          borderTop: "1px solid #1e293b",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: 12, color: "#64748b",
        }}>
          {remoteRuntime ? (
            <>
              <span style={{ fontSize: 14 }}>📡</span>
              <span>Connesso a</span>
              <span style={{ color: "#3b82f6", fontFamily: "monospace" }}>{remoteRuntime}</span>
              <button
                style={{ background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: 11, textDecoration: "underline dotted" }}
                onClick={() => setShowRuntime(true)}
              >
                cambia
              </button>
            </>
          ) : (
            <>
              <span>Runtime locale</span>
              <button
                style={{ background: "transparent", border: "none", color: "#3b82f6", cursor: "pointer", fontSize: 12, textDecoration: "underline dotted" }}
                onClick={() => setShowRuntime(true)}
              >
                📡 Connetti a runtime remoto…
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
