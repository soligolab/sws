import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, dimenticaVersioneProgetto, type SondaggioDispositivo } from "@/api/client";
import { ListaControlli } from "@/config/installazione/ListaControlli";
import { imageRefDaVariante, installazioneConsentita } from "@/config/installazione/sondaggio";
import type { BrowseDirEntry, ProjectListEntry, ProjectTargetKind, TemplateEntry } from "@/types";
import { containerDeployPayload } from "@/containerDeploy";
import { BarraIdentita } from "@/components/BarraIdentita";
import { ChangePasswordScreen } from "@/components/ChangePasswordScreen";

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
  onCreate: (riferimento: string, nome: string) => void;
  /** Tab to open on. "zip" is used by the "open from a ZIP on my PC" entry. */
  initialTab?: NewProjectTab;
}) {
  const { t, i18n } = useTranslation();
  const [tab, setTab]                 = useState<NewProjectTab>(initialTab);
  // Le aziende di chi e collegato. Il selettore compare SOLO a chi sta in piu
  // di una (decisione del maintainer, 07-10-2026): chi ne ha una sola non deve
  // incontrare un concetto che per lui non esiste.
  const [mieAziende, setMieAziende] = useState<{ id: number; nome: string; implicita: boolean }[]>([]);
  const [aziendaScelta, setAziendaScelta] = useState<number | null>(null);
  useEffect(() => {
    api.mieAziende()
      .then((v) => {
        setMieAziende(v);
        if (v.length === 1) setAziendaScelta(v[0].id);
      })
      .catch(() => { /* runtime senza identita: nessuna scelta da fare */ });
  }, []);
  const [name, setName]               = useState("");
  const [templates, setTemplates]     = useState<TemplateEntry[]>([]);
  const [selectedTpl, setSelectedTpl] = useState<string>("");
  const [zipFile, setZipFile]         = useState<File | null>(null);
  const [targetKind, setTargetKind]   = useState<ProjectTargetKind>("web");
  const [fbDevice, setFbDevice]       = useState("");
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
        onCreate(result.riferimento, result.name);
      } else {
        const trimmed = name.trim();
        if (!trimmed) { setError(t("welcome.errNoName")); setBusy(false); return; }
        // Il target si sceglie solo per progetti vuoti — un template porta
        // già con sé oggetti/pagine pensati per il web (vedi ADR 0002).
        const target = tab === "empty" && targetKind !== "web"
          ? { kind: targetKind, framebuffer_device: targetKind === "lvgl_framebuffer" ? (fbDevice.trim() || undefined) : undefined }
          : undefined;
        // La lingua dell'IDE diventa la lingua principale del progetto nuovo: un
        // progetto che nasce senza lingua non può ancora dire niente (18-09-2026).
        const creato = await api.createProject({ name: trimmed, template: tab === "template" ? selectedTpl : undefined, parent_path: trimmedParent, target, lang: i18n.language, azienda_id: aziendaScelta ?? undefined });
        // Il riferimento lo decide il SERVER: dipende dall'azienda scelta, e
        // ricostruirlo qui vorrebbe dire conoscere la cartella di ogni
        // azienda — un secondo posto che dice la stessa cosa.
        onCreate(creato.riferimento, creato.name);
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
                {t("welcome.projectNameLabel")} <span style={{ color: "var(--brand-text-subtle, #94a3b8)" }}>{t("welcome.projectNameZipOptional")}</span>
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

        {/* L'azienda, SOLO a chi sta in piu di una. Chi ne ha una sola non
            vede nulla e il progetto nasce dov'e sempre nato. */}
        {mieAziende.length > 1 && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
              {t("welcome.aziendaLabel")}
            </label>
            <select
              style={INPUT}
              value={aziendaScelta ?? ""}
              onChange={(e) => setAziendaScelta(e.target.value ? Number(e.target.value) : null)}
            >
              {mieAziende.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.implicita ? t("welcome.aziendaQuestaInstallazione") : a.nome}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* target: solo per progetti vuoti (vedi ADR 0002) */}
        {tab === "empty" && (
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
              {t("welcome.target")}
            </label>
            <select
              style={{ ...INPUT, cursor: "pointer" }}
              value={targetKind}
              onChange={(e) => setTargetKind(e.target.value as ProjectTargetKind)}
            >
              <option value="web">{t("welcome.targetWeb")}</option>
              <option value="lvgl_framebuffer">{t("welcome.targetLvglFramebuffer")}</option>
              <option value="lvgl_wayland">{t("welcome.targetLvglWayland")}</option>
            </select>
            {targetKind !== "web" && (
              <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
                {t("welcome.targetHint")}
              </div>
            )}
            {targetKind === "lvgl_framebuffer" && (
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 6 }}>
                  {t("welcome.framebufferDeviceLabel")}
                </label>
                <input
                  style={{ ...INPUT, fontFamily: "monospace", fontSize: 13 }}
                  value={fbDevice}
                  onChange={(e) => setFbDevice(e.target.value)}
                  placeholder={t("welcome.framebufferDevicePlaceholder")}
                />
              </div>
            )}
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

// ── InstallaRuntimeModal ──────────────────────────────────────────────────────
//
// ARCH-004: switch the SPA to a different runtime URL without rebuilding.
// Probes `/health` over the supplied origin (CORS allows it since the
// runtime ships a permissive CorsLayer). On success, persists the URL in
// localStorage and triggers a full window reload so the api client + WS
// helpers pick the new base, and so stale auth tokens / project state
// from the previous runtime are cleared cleanly.

// ── DeploySection ─────────────────────────────────────────────────────────────
//
// Q48 (2026-09-09). Fino a oggi questo modulo chiamava `/api/deploy/remote`, che
// scaricava un binario dalle release GitHub — un asset che NON esiste (404 per
// entrambe le architetture): il pulsante falliva sempre. Installava poi un
// binario nativo con `systemctl restart` di sistema, la postura opposta al
// container rootless di produzione, e salvava la password SSH in localStorage.
//
// Ora chiama lo stesso deploy container di Configurazione → Istanza → Device → Installazione: registry,
// architettura decisa dal dispositivo, niente password nel browser. È qui e non
// solo in ConfigView perché questo è il caso «macchina nuova, nessun progetto
// ancora»: ConfigView richiede un progetto aperto per convenzione del pannello.
function DeploySection() {
  const { t } = useTranslation();
  const [host, setHost]           = useState("");
  const [port, setPort]           = useState(22);
  const [user, setUser]           = useState("user");
  const [password, setPassword]   = useState("");
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs]           = useState<string[]>([]);
  // La chiave host del dispositivo non è quella memorizzata (factory reset):
  // stesso pulsante di ConfigView, stesso endpoint, stesso gesto umano.
  const [chiaveHostCambiata, setChiaveHostCambiata] = useState(false);
  const [dimenticandoChiave, setDimenticandoChiave] = useState(false);
  // Q52: «Verifica dispositivo» anche qui — una sessione ssh che dice che
  // macchina è e se è pronta, prima di installare. La variante immagine che
  // propone finisce nel deploy; senza verifica il riferimento resta vuoto e
  // l'architettura la decide il dispositivo, come prima.
  const [sondaggio, setSondaggio] = useState<SondaggioDispositivo | null>(null);
  const [sondando, setSondando]   = useState(false);
  const ultimaAzione              = useRef<"sondaggio" | "deploy">("deploy");
  const logsRef                   = useRef<HTMLDivElement>(null);

  // Un altro host, porta o utente: la lista di controlli non parla più di questo caso.
  useEffect(() => { setSondaggio(null); }, [host, port, user]);

  const eseguiSondaggio = async () => {
    if (!host || !user) return;
    ultimaAzione.current = "sondaggio";
    setSondando(true); setChiaveHostCambiata(false);
    try {
      const s = await api.deviceProbe({ host, port, user, password });
      setSondaggio(s);
      if (s.chiave_host_cambiata) setChiaveHostCambiata(true);
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setSondando(false);
    }
  };

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const handleDeploy = async () => {
    if (!host || !user) return;
    ultimaAzione.current = "deploy";
    setDeploying(true);
    setChiaveHostCambiata(false);
    // La variante la propone la verifica (os-release compreso); senza verifica il
    // riferimento resta vuoto e il dispositivo sceglie latest-<arch> da `uname -m`.
    const imageRef = imageRefDaVariante(sondaggio?.variante_immagine ?? null);
    setLogs([t("welcome.installStart", { user, host, port, ref: imageRef ? `, ${imageRef}` : "" })]);
    try {
      const res = await api.deployDeviceContainer(containerDeployPayload({
        source: "registry",
        imageTarball: "",
        imageRef,
        cleanInstall: false,
        host, port, user, password,
        remoteDir: "/tmp/sws-deploy",
        dataPath: "",
      }));
      if (!res.ok) {
        // Il corpo porta la frase del backend: mostrare solo lo stato la butterebbe via.
        const detail = await res.text().catch(() => "");
        setLogs((l) => [...l, `ERROR: HTTP ${res.status} ${res.statusText}${detail.trim() ? ` — ${detail.trim()}` : ""}`]);
        return;
      }
      const reader = res.body?.getReader();
      if (!reader) { setLogs((l) => [...l, t("welcome.streamingNonSupportato")]); return; }
      const dec = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        dec.decode(value).split("\n").filter((x) => x.trim()).forEach((line) => {
          if (line === "AZIONE: chiave-host-cambiata") { setChiaveHostCambiata(true); return; }
          setLogs((l) => [...l, line]);
        });
      }
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setDeploying(false);
    }
  };

  const handleDimenticaChiaveHost = async () => {
    setDimenticandoChiave(true);
    try {
      const r = await api.deviceHostKeyForget(host, port);
      setLogs((l) => [...l, `==> ${r.messaggio}`]);
      setChiaveHostCambiata(false);
      // Si riprende da dove ci si era fermati: verifica o installazione.
      if (ultimaAzione.current === "sondaggio") await eseguiSondaggio();
      else await handleDeploy();
    } catch (e: any) {
      setLogs((l) => [...l, `ERROR: ${e?.message ?? e}`]);
    } finally {
      setDimenticandoChiave(false);
    }
  };

  const done = logs.some((l) => l === "DONE");
  const hasError = logs.some((l) => l.startsWith("ERROR:"));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        {t("welcome.installIntro")}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshHost")}</label>
          <input style={INPUT} placeholder="wp630-xxxx.local" value={host} onChange={(e) => setHost(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.port")}</label>
          <input style={{ ...INPUT, width: 60 }} type="number" min={1} max={65535} value={port} onChange={(e) => setPort(Number(e.target.value))} />
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshUser")}</label>
          <input style={INPUT} placeholder="user" value={user} onChange={(e) => setUser(e.target.value)} />
        </div>
        <div>
          <label style={{ fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", display: "block", marginBottom: 3 }}>{t("welcome.sshPassword")}</label>
          {/* Non si salva da nessuna parte: resta nel modulo finché la finestra è aperta. */}
          <input style={INPUT} type="password" autoComplete="off" placeholder="••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
      </div>
      {/* 3 · Verifica, prima di installare. Spegne Installa solo se trova errori. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button
          style={{ ...BTN_PRIMARY, background: "var(--brand-surface, #1e293b)", opacity: (sondando || !host || !user) ? 0.5 : 1 }}
          disabled={sondando || !host || !user}
          onClick={() => void eseguiSondaggio()}>
          {sondando ? t("cfg.probeRunning") : t("cfg.probeRun")}
        </button>
        <span style={{ fontSize: 10, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("cfg.probeHint")}</span>
      </div>
      {sondaggio && <ListaControlli sondaggio={sondaggio} />}
      {logs.length > 0 && (
        <div
          ref={logsRef}
          style={{
            background: "#0a0f1a", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6,
            padding: "8px 10px", maxHeight: 160, overflowY: "auto",
            fontFamily: "monospace", fontSize: 11, lineHeight: 1.6,
          }}
        >
          {logs.map((line, i) => (
            <div key={i} style={{
              color: line.startsWith("ERROR:") ? "var(--brand-danger-soft, #fca5a5)"
                : line.startsWith("WARN:") ? "var(--brand-warning-soft, #fbbf24)"
                : line === "DONE" ? "var(--brand-success, #22c55e)"
                : "var(--brand-text-muted, #94a3b8)",
            }}>{line}</div>
          ))}
          {deploying && <div style={{ color: "#60a5fa" }}>…</div>}
        </div>
      )}
      {chiaveHostCambiata && (
        <div style={{
          border: "1px solid var(--brand-warning, #f59e0b)", borderRadius: 4,
          background: "var(--brand-warning-bg, #78350f)", padding: "8px 10px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          <div style={{ fontSize: 12, color: "var(--brand-warning-soft, #facc15)" }}>{t("cfg.hostKeyChanged", { host })}</div>
          <button
            style={{ ...BTN_PRIMARY, opacity: dimenticandoChiave ? 0.6 : 1, alignSelf: "flex-start" }}
            disabled={dimenticandoChiave}
            onClick={() => void handleDimenticaChiaveHost()}>
            {dimenticandoChiave ? t("cfg.hostKeyForgetting") : t("cfg.hostKeyForget")}
          </button>
        </div>
      )}
      {(() => {
        const bloccato = !installazioneConsentita(sondaggio);
        const spento = !host || !user || deploying || bloccato;
        return (
          <button
            style={{ ...BTN_PRIMARY, opacity: spento ? 0.5 : 1 }}
            disabled={spento}
            title={bloccato ? t("cfg.installBlockedByProbe") : undefined}
            onClick={handleDeploy}
          >
            {deploying ? t("welcome.deploying")
              : done ? t("welcome.deployDone")
              : hasError ? t("welcome.retryDeploy")
              : sondaggio?.sws.installato ? t("cfg.installUpdateBtn")
              : t("welcome.deploy")}
          </button>
        );
      })()}
    </div>
  );
}

/**
 * Installare il runtime su un dispositivo, dalla schermata iniziale.
 *
 * # Cosa c'era prima, e perché è stato tolto
 *
 * Questo modale aveva due schede. La seconda — questa — installa il binario via
 * SSH e funziona. La prima, «Connetti», scriveva `localStorage
 * sws.runtimeBaseUrl` e ricaricava la pagina per far puntare *tutta* la SPA a un
 * altro runtime: e **non funzionava**, perché `admin-main.tsx` chiama
 * `setForceLocalApi(true)` e quindi `getBaseUrl()` esce sempre con `""`.
 * Qualunque cosa si inserisse, il footer continuava a dire «runtime locale».
 *
 * Non era solo inerte, era un doppione: collegare un runtime remoto si fa in
 * Configurazione → Istanza → Device → Connessione → Connetti, che passa dal server (il token resta nel
 * processo locale, mai nel browser) e abilita deploy e relay dei dati vivi. Due
 * modi per la stessa cosa, di cui uno rotto, sono peggio di uno solo.
 *
 * # Perché la schermata iniziale ha comunque una sua installazione
 *
 * ConfigView richiede un progetto aperto. Qui non c'è nessun progetto: è il caso
 * «macchina nuova, niente ancora configurato». Da Q48 (2026-09-09) i due usano lo
 * STESSO endpoint (`/api/deploy/device-container`): la schermata è diversa,
 * l'operazione no — prima qui c'era `/api/deploy/remote`, che scaricava un
 * binario inesistente.
 */
/** Un comando da copiare, con il suo pulsante. */
function Comando({ testo }: { testo: string }) {
  const { t } = useTranslation();
  const [copiato, setCopiato] = useState(false);
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
      {/* Aspetto da terminale (richiesta del maintainer, 21-10-2026): fondo
          nero e testo verde, uguale in tema chiaro e scuro — un comando da
          incollare in una shell somiglia alla shell, non alla pagina. Il «$»
          è decorazione e non entra negli appunti: il pulsante copia la
          stringa, non quel che si vede. */}
      <pre style={{
        flex: 1, minWidth: 0, margin: 0, padding: "10px 12px", borderRadius: 4,
        background: "#000", border: "1px solid #2f3b2f",
        color: "#3bd16f", fontFamily: "Arial, Helvetica, sans-serif",
        fontSize: 12.5, lineHeight: 1.6,
        whiteSpace: "pre-wrap", wordBreak: "break-all",
      }}>
        <span style={{ color: "#6b7280", userSelect: "none" }} aria-hidden="true">$ </span>{testo}
      </pre>
      <button
        style={{ ...BTN_GHOST, flex: "0 0 auto" }}
        onClick={() => {
          // Se la scrittura negli appunti è negata (succede fuori da HTTPS e in
          // certi contesti incorporati) si seleziona il testo: copiare a mano
          // resta possibile, e un pulsante che non dice niente no.
          navigator.clipboard?.writeText(testo).then(
            () => { setCopiato(true); setTimeout(() => setCopiato(false), 1500); },
            () => { /* niente appunti: resta la selezione a mano */ },
          );
        }}
      >{copiato ? `✓ ${t("welcome.installCloudCopiato")}` : t("welcome.installCloudCopia")}</button>
    </div>
  );
}

/** La guida, quando l'IDE gira sul server.
 *
 *  Il modulo SSH qui non ha senso: il gateway dovrebbe entrare nel pannello del
 *  cliente, che sta dietro NAT e non ha una rotta in ingresso — ed è esattamente
 *  ciò che il tunnel esiste per evitare (richiesta del maintainer, 21-10-2026).
 *  I comandi sono quelli del HOWTO §25, nella forma dell'abbinamento col codice:
 *  niente `--tunnel-nome` né `--tunnel-token`, che servono alla strada del
 *  pannello dichiarato a mano. L'indirizzo del gateway viaggia nell'immagine.
 */
function GuidaInstallazione() {
  const { t } = useTranslation();
  const IMG = "ghcr.io/soligolab/sws-runtime:rc-arm64";
  const passi: [string, string][] = [
    // Il segnaposto segue la lingua come tutto il resto: cablato in italiano
    // stonava in mezzo a una guida in inglese (maintainer, 21-10-2026).
    [t("welcome.installCloudPasso1"), `ssh user@<${t("welcome.installCloudIndirizzo")}>`],
    [t("welcome.installCloudPasso2"), `podman pull ${IMG}`],
    [t("welcome.installCloudPasso3"), "mkdir -p ~/sws-install && cd ~/sws-install"],
    [t("welcome.installCloudPasso4"), `podman run --rm --entrypoint tar ${IMG} \\\n  -C /usr/share/sws/quadlet -cf - . | tar -xf -`],
    [t("welcome.installCloudPasso5"), `./install-container.sh --pull ${IMG}`],
  ];
  // I quattro passi dopo l'SSH, uniti in una riga sola (22-10-2026). Il
  // maintainer ha chiesto di **aggiungere** questa forma, non di sostituire
  // quella a passi: chi vuole vedere cosa sta facendo tiene i cinque riquadri,
  // chi ha gia' capito incolla una volta sola.
  //
  // `&&` e non `;`: se un passo fallisce i successivi non partono. Con `;` un
  // `podman pull` andato male lascerebbe proseguire l'estrazione dei quadlet,
  // che fallirebbe in un modo che non somiglia alla causa.
  const aggregato = passi.slice(1).map(([, cmd]) => cmd).join(" && \\\n  ");
  const [unaRiga, setUnaRiga] = useState(false);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <p style={{ margin: 0, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.6 }}>
        {t("welcome.installCloudIntro")}
      </p>
      <div style={{ display: "flex", gap: 6 }}>
        {([[false, t("welcome.installCloudAPassi")], [true, t("welcome.installCloudAggregato")]] as const).map(([v, etichetta]) => (
          <button key={String(v)} type="button" onClick={() => setUnaRiga(v)}
            style={{
              padding: "4px 10px", borderRadius: 4, fontSize: 12, cursor: "pointer",
              border: "1px solid var(--brand-surface-2, #334155)",
              background: unaRiga === v ? "var(--brand-primary, #3b82f6)" : "transparent",
              color: unaRiga === v ? "#fff" : "var(--brand-text-muted, #94a3b8)",
            }}>
            {etichetta}
          </button>
        ))}
      </div>
      {unaRiga ? (
        <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <li style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{passi[0][0]}</div>
            <Comando testo={passi[0][1]} />
          </li>
          <li style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{t("welcome.installCloudAggregatoPasso")}</div>
            <Comando testo={aggregato} />
          </li>
        </ol>
      ) : (
      <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 12 }}>
        {passi.map(([titolo, cmd]) => (
          <li key={titolo} style={{ fontSize: 13, color: "var(--brand-text, #e2e8f0)" }}>
            <div style={{ marginBottom: 6 }}>{titolo}</div>
            <Comando testo={cmd} />
          </li>
        ))}
      </ol>
      )}
      <p style={{ margin: 0, fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", lineHeight: 1.6 }}>
        {t("welcome.installCloudDopo")}
      </p>
    </div>
  );
}

function InstallaRuntimeModal({ onClose, gateway }: { onClose: () => void; gateway: boolean }) {
  const { t } = useTranslation();

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(0,0,0,0.6)", zIndex: 9000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 10, padding: 24,
        // 700 e non 520 (maintainer, 21-10-2026): il comando che estrae i
        // quadlet andava a capo dentro il riquadro, e in un terminale sta su
        // due righe sue. `maxWidth` tiene il dialogo dentro lo schermo di un
        // telefono.
        width: 700, maxWidth: "92vw",
      }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 12 }}>
          {t("welcome.installRuntimeTitle")}
        </div>

        {gateway ? <GuidaInstallazione /> : <DeploySection />}

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button style={BTN_GHOST} onClick={onClose}>{t("common.close")}</button>
        </div>
      </div>
    </div>
  );
}

// ── WelcomeScreen ─────────────────────────────────────────────────────────────

interface WelcomeScreenProps {
  /** Called once a project has been opened and the user must log in. */
  onProjectOpened: () => void;
}

/** `rif` e l'indirizzo (`<azienda>/<nome>`), `name` serve solo a mostrarlo e
 *  a precompilare il campo: due aziende possono avere lo stesso nome, quindi
 *  la riga in lavorazione si identifica col riferimento. */
type EditingState = { rif: string; name: string; mode: "rename" | "duplicate"; value: string };

/** I byte in GB, come li legge una persona. */
function gb(n: number): string {
  return `${(n / 1_073_741_824).toFixed(1)} GB`;
}

/** Dove il browser ricorda se l'elenco era a griglia o a lista. */
const VISTA_SALVATA = "sws.welcome.vista";

export type Gruppo = { titolo?: string; altra: boolean; elenco: ProjectListEntry[] };

/** Il titolo di un gruppo: «WEB · 1024×600», «LVGL», oppure niente. */
export function titoloGruppo(p: ProjectListEntry): string | undefined {
  const motore = p.motore ? p.motore.toUpperCase() : undefined;
  const pezzi = [motore, p.risoluzione || undefined].filter(Boolean);
  return pezzi.length ? pezzi.join(" · ") : undefined;
}

/**
 * Raggruppa i progetti per **tecnologia e risoluzione** (maintainer,
 * 12-10-2026): un progetto LVGL e uno web si somigliano nell'elenco e si
 * scoprono diversi solo dopo averli aperti.
 *
 * **Lo stacco delle aziende altrui resta**, e sta fuori dal raggruppamento.
 * Quello non e' un modo di ordinare: e' la riga che dice «da qui in giu' non e'
 * tuo» a chi amministra la piattaforma (scelta del maintainer, 07-10-2026).
 * Mescolare i progetti di un altro cliente fra i propri perche' hanno la stessa
 * risoluzione sarebbe proprio il guasto che quella riga evita.
 *
 * L'azienda, che prima era il titolo del gruppo, ora sta su ogni scheda: senza,
 * cambiando il criterio si sarebbe persa un'informazione invece di
 * aggiungerne due.
 *
 * Un progetto di cui non si sa niente (runtime piu' vecchio, `project.yaml`
 * illeggibile) finisce in un gruppo senza titolo, che va **in fondo**: e' il
 * posto giusto per «non classificato», e tiene la schermata identica a prima
 * su un'installazione che quei campi non li manda.
 */
export function raggruppa(progetti: ProjectListEntry[]): Gruppo[] {
  const gruppi = new Map<string, Gruppo>();
  for (const p of progetti) {
    const altra = p.altra_azienda === true;
    const titolo = titoloGruppo(p);
    const k = `${altra ? "1" : "0"}\u0000${titolo ?? ""}`;
    const g = gruppi.get(k);
    if (g) g.elenco.push(p);
    else gruppi.set(k, { titolo, altra, elenco: [p] });
  }
  return [...gruppi.values()].sort((a, b) => {
    if (a.altra !== b.altra) return a.altra ? 1 : -1;
    // Senza titolo in fondo: «non si sa» non e' una categoria da leggere per
    // prima.
    if (a.titolo === undefined) return 1;
    if (b.titolo === undefined) return -1;
    return a.titolo.localeCompare(b.titolo);
  });
}

export function WelcomeScreen({ onProjectOpened }: WelcomeScreenProps) {
  const { t } = useTranslation();
  const [projects, setProjects]   = useState<ProjectListEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openingName, setOpening] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);
  const [newTab, setNewTab]       = useState<NewProjectTab>("empty");
  const [showInstalla, setShowInstalla] = useState(false);
  const [editing, setEditing]     = useState<EditingState | null>(null);
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  // Il cambio password volontario, chiesto dal menu della barra. Riusa la
  // schermata del cambio OBBLIGATO invece di una seconda copia del modulo:
  // due punti che scrivono la stessa password sono due punti che divergono.
  const [cambioPassword, setCambioPassword] = useState(false);
  // L'avviso di spazio, in cima all'elenco (decisione del maintainer,
  // 08-10-2026: avvisa prima, rifiuta al limite). Qui, perche e la schermata
  // da cui si crea un progetto — cioe il gesto che verrebbe rifiutato.
  const [spazio, setSpazio] = useState<
    { nome: string | null; usato_byte: number; max_byte: number; vicina: boolean; piena: boolean }[]
  >([]);
  useEffect(() => {
    api.spazioMio().then(setSpazio).catch(() => setSpazio([]));
  }, []);
  // Griglia o lista. La griglia e la predefinita (richiesta del maintainer del
  // 07-10-2026: «l'elenco dei progetti potrebbe essere fatto ad icone stile
  // file browser?»), la lista resta perche con i percorsi lunghi e piu
  // leggibile. La scelta e una comodita del singolo browser, non un dato: vive
  // in `localStorage`, e se `localStorage` non c'e si riparte dalla griglia.
  const [vista, setVista] = useState<"griglia" | "lista">(() => {
    try {
      return localStorage.getItem(VISTA_SALVATA) === "lista" ? "lista" : "griglia";
    } catch {
      return "griglia";
    }
  });
  const [sorvolato, setSorvolato] = useState<string | null>(null);
  const cambiaVista = (v: "griglia" | "lista") => {
    setVista(v);
    try { localStorage.setItem(VISTA_SALVATA, v); } catch { /* finestra privata */ }
  };

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

  // Nel cloud ogni progetto ha il suo container: aprirlo vuol dire **andarci**,
  // non cambiare il progetto attivo di questo processo — che nel gateway non
  // esiste nemmeno, perché il gateway non apre progetti, li smista.
  const [gateway, setGateway] = useState(false);
  useEffect(() => {
    let vivo = true;
    api.identitaStato()
      .then((st) => { if (vivo) setGateway(!!st.gateway); })
      .catch(() => { /* runtime vecchio: si continua col modello a istanza singola */ });
    return () => { vivo = false; };
  }, []);

  // Si apre per **riferimento**: `nome` resta solo per i messaggi.
  const handleOpen = async (rif: string, nome: string) => {
    setOpening(rif); setError(null);
    const name = nome;
    if (gateway) {
      // Con la barra finale: è la radice del progetto, e tutto quello che la
      // pagina costruisce da `location.pathname` (il watcher della build, le
      // chiamate con prefisso) deve partire da dentro, non dal livello sopra.
      window.location.assign(`/p/${rif}/`);
      return;
    }
    try {
      await api.openProject(rif);
      // Q30: la versione vista è quella del progetto di **prima**. Tenerla
      // farebbe rifiutare il primo salvataggio su quello nuovo con un 409 che
      // non ha nessuna corsa dietro — un conflitto inventato insegna a
      // ignorare i conflitti veri.
      dimenticaVersioneProgetto();
      onProjectOpened();
    } catch (e: any) {
      setError(t("welcome.errOpen", { name, err: e?.message ?? e }));
    } finally {
      setOpening(null);
    }
  };

  const handleCreated = async (rif: string, nome: string) => {
    setShowNew(false);
    await loadProjects();
    await handleOpen(rif, nome);
  };

  const handleDelete = async (p: ProjectListEntry) => {
    const confirmMsg = p.external
      ? t("welcome.confirmRemoveExternal", { name: p.name })
      : t("welcome.confirmDelete", { name: p.name });
    if (!window.confirm(confirmMsg)) return;
    setActionBusy(p.riferimento); setError(null);
    try {
      await api.deleteProject(p.riferimento);
      await loadProjects();
    } catch (e: any) {
      setError(t(p.external ? "welcome.errRemove" : "welcome.errDelete", { name: p.name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  // L'archivio (18-10-2026): il progetto resta al suo posto, nascosto e non
  // apribile, e continua a contare nella quota di spazio.
  const [archiviAperti, setArchiviAperti] = useState(false);
  const archiviati = projects.filter((p) => p.archiviato);
  const handleArchivia = async (p: ProjectListEntry, archivia: boolean) => {
    if (archivia && !window.confirm(t("welcome.confermaArchivia", { name: p.name }))) return;
    setActionBusy(p.riferimento); setError(null);
    try {
      await (archivia ? api.archiveProject(p.riferimento) : api.unarchiveProject(p.riferimento));
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errArchivia", { name: p.name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitRename = async () => {
    if (!editing || editing.mode !== "rename") return;
    const { rif, name, value } = editing;
    const newName = value.trim();
    if (!newName || newName === name) { setEditing(null); return; }
    setActionBusy(rif); setEditing(null); setError(null);
    try {
      await api.renameProject(rif, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errRename", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  const commitDuplicate = async () => {
    if (!editing || editing.mode !== "duplicate") return;
    const { rif, name, value } = editing;
    const newName = value.trim();
    if (!newName) { setEditing(null); return; }
    setActionBusy(rif); setEditing(null); setError(null);
    try {
      await api.duplicateProject(rif, newName);
      await loadProjects();
    } catch (e: any) {
      setError(t("welcome.errDuplicate", { name, err: e?.message ?? e }));
    } finally {
      setActionBusy(null);
    }
  };

  // Il cambio password volontario prende tutta la schermata, come quello
  // obbligato: e lo stesso modulo, e mostrarlo in due vesti diverse a seconda
  // di come ci si arriva sarebbe la stessa cosa detta due volte.
  if (cambioPassword) {
    return <ChangePasswordScreen onAnnulla={() => setCambioPassword(false)} />;
  }

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      // `minHeight` e non `height`, `overflowY` e il centraggio affidato al
      // `margin: auto` del figlio invece che a `justify-content: center`.
      //
      // Prima era `height: 100vh` + `justifyContent: center` senza overflow:
      // con pochi progetti si vedeva bene, con qualche decina il contenuto
      // sforava e il centraggio lo spingeva fuori da TUTTI E DUE i lati —
      // quindi i primi progetti diventavano irraggiungibili e non c'era
      // barra di scorrimento. Alzare il solo `overflow` non basta: con
      // `justify-content: center` la parte sopra resta inarrivabile anche in
      // un contenitore scorrevole, mentre un `margin: auto` cede quando lo
      // spazio finisce. Segnalato dal maintainer il 06-10-2026.
      // `height` e non `minHeight`: il documento NON scorre — `index-admin.html`
      // mette `overflow: hidden` su html e body di proposito, perche «viewer e
      // IDE gestiscono lo scorrimento nei propri contenitori». Con `minHeight`
      // questo div cresceva oltre la finestra e il corpo lo tagliava: nessuna
      // barra, contenuto perduto. Primo tentativo del 06-10-2026, sbagliato.
      height: "100vh", overflowY: "auto", padding: "32px 0", boxSizing: "border-box",
      background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
      fontFamily: "system-ui, sans-serif, 'SWS Emoji'",
    }}>
      {showNew && (
        <NewProjectModal
          onClose={() => setShowNew(false)}
          onCreate={handleCreated}
          initialTab={newTab}
        />
      )}
      {showInstalla && <InstallaRuntimeModal gateway={gateway} onClose={() => setShowInstalla(false)} />}

      <BarraIdentita onCambiaPassword={() => setCambioPassword(true)} />

      {/* Solo chi e vicino o oltre: un avviso che c'e sempre non e un
          avviso. */}
      {spazio.filter((a) => a.vicina).map((a) => (
        <div
          key={a.nome ?? ""}
          style={{
            alignSelf: "stretch", margin: "0 0 18px", padding: "10px 20px",
            fontSize: 13, lineHeight: 1.5,
            color: a.piena ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-warning-soft, #fbbf24)",
            background: a.piena ? "#7f1d1d33" : "#78350f33",
            borderBottom: "1px solid var(--brand-surface-2, #334155)",
          }}
        >
          {a.piena ? "✕ " : "⚠ "}
          {t(a.piena ? "welcome.spazioEsaurito" : "welcome.spazioQuasiEsaurito", {
            azienda: a.nome ?? t("welcome.aziendaQuestaInstallazione"),
            usato: gb(a.usato_byte),
            massimo: gb(a.max_byte),
          })}
        </div>
      ))}

      {/* La griglia vuole spazio: con 480px starebbero tre piastrelle per
          riga e il resto della finestra resterebbe vuoto. La lista no — i
          percorsi lunghi si leggono meglio in una colonna stretta. */}
      <div style={{ width: vista === "griglia" ? 1080 : 480, maxWidth: "92vw", margin: "auto" }}>
        {/* logo / title */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: 2, color: "var(--brand-text, #e2e8f0)" }}>SWS</div>
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 14, marginTop: 4 }}>
            {t("welcome.selectOrCreate")}
          </div>
        </div>

        {/* Griglia o lista. Due icone e basta: e una comodita, non
            un'impostazione, e non merita ne una pagina ne un menu. */}
        {!loading && projects.length > 0 && (
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginBottom: 10 }}>
            {(["griglia", "lista"] as const).map((quale) => (
              <button
                key={quale}
                onClick={() => cambiaVista(quale)}
                title={t(quale === "griglia" ? "welcome.vistaGriglia" : "welcome.vistaLista")}
                aria-pressed={vista === quale}
                style={{
                  background: vista === quale ? "var(--brand-surface-2, #334155)" : "transparent",
                  color: vista === quale ? "var(--brand-text, #e2e8f0)" : "var(--brand-text-subtle, #64748b)",
                  border: "1px solid var(--brand-surface-2, #334155)",
                  borderRadius: 4, padding: "3px 9px", cursor: "pointer", fontSize: 13, lineHeight: 1.4,
                }}
              >
                {quale === "griglia" ? "▦" : "☰"}
              </button>
            ))}
          </div>
        )}

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
          {/* Raggruppati per azienda (scelta del maintainer, 07-10-2026).
              I progetti senza azienda — quella implicita — vengono per primi e
              SENZA titolo: chi ha un'installazione sola non deve incontrare un
              concetto che per lui non esiste. Il titolo compare solo dove c'e
              davvero un'azienda da nominare. */}
          {!loading && raggruppa(projects.filter((p) => !p.archiviato)).map((g, i, tutti) => (
            <div key={`${g.altra ? "1" : "0"}-${g.titolo ?? ""}`}>
              {/* Lo stacco prima della PRIMA azienda altrui: tutto quello che
                  sta sotto non e tuo, e va detto una volta sola invece che
                  ripetuto su ogni riga (scelta del maintainer, 07-10-2026). */}
              {g.altra && !tutti[i - 1]?.altra && (
                <div style={{
                  display: "flex", alignItems: "center", gap: 8,
                  margin: "26px 0 2px", paddingTop: 14,
                  borderTop: "1px solid var(--brand-surface-2, #334155)",
                  fontSize: 11, letterSpacing: 0.4,
                  color: "var(--brand-text-subtle, #64748b)",
                }}>
                  <span>⚑</span>
                  <span>{t("welcome.altreAziende")}</span>
                </div>
              )}
              <div style={{
                fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6,
                color: "var(--brand-text-subtle, #64748b)",
                margin: "18px 0 6px", paddingLeft: 2,
              }}>
                {g.titolo ?? t("welcome.senzaFormato")}
              </div>
              <div style={vista === "griglia"
                ? { display: "flex", flexWrap: "wrap", gap: 12, marginTop: 4 }
                : {}}
              >
              {g.elenco.map((p) => {
            const isOpening  = openingName === p.riferimento;
            const isBusy     = actionBusy  === p.riferimento;
            const isEditing  = editing?.rif === p.riferimento;
            const isRenaming = isEditing && editing?.mode === "rename";
            const isDuping   = isEditing && editing?.mode === "duplicate";
            const dimmed     = (openingName || actionBusy) && !isOpening && !isBusy;

            const ACT_BTN: React.CSSProperties = {
              background: "none", border: "none", cursor: "pointer",
              color: "var(--brand-text-muted, #94a3b8)", fontSize: 15, padding: "2px 5px",
              borderRadius: 4, lineHeight: 1,
            };

            // ── I pezzi interattivi, definiti UNA volta ──────────────────
            //
            // Griglia e lista sono due disposizioni della stessa cosa, non due
            // schermate: se la rinomina esistesse in due copie di JSX, alla
            // prima correzione ne resterebbe corretta una sola. Qui si
            // definiscono i pezzi, sotto si compongono.
            const campoNome = (
              <input
                autoFocus
                style={{ ...INPUT, padding: "3px 8px", fontSize: 14, width: "100%" }}
                value={editing?.value ?? ""}
                onChange={(e) => setEditing({ ...editing!, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Enter")  { e.preventDefault(); commitRename(); }
                  if (e.key === "Escape") setEditing(null);
                }}
                onBlur={commitRename}
                onClick={(e) => e.stopPropagation()}
              />
            );

            const distintivoEsterno = p.external ? (
              <span style={{
                fontSize: 10, fontWeight: 500, color: "var(--brand-text-subtle, #64748b)",
                border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "1px 5px",
              }}>
                {t("welcome.externalBadge")}
              </span>
            ) : null;

            // L'azienda era il titolo del gruppo; adesso che i gruppi dicono
            // altro, sta qui — o cambiando criterio si sarebbe persa.
            const distintivoAzienda = p.azienda ? (
              <span style={{
                fontSize: 10, fontWeight: 500, color: "var(--brand-text-subtle, #64748b)",
                border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4, padding: "1px 5px",
              }}>
                {p.azienda}
              </span>
            ) : null;

            const quando = p.last_opened_ms
              ? t("welcome.lastOpened", { date: formatDate(p.last_opened_ms) })
              : t("welcome.lastModified", { date: formatDate(p.last_modified_ms) });

            const azioni = (
              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  title={t("editor.rename")}
                  style={{ ...ACT_BTN, color: isRenaming ? "var(--brand-primary, #3b82f6)" : "var(--brand-text-muted, #94a3b8)" }}
                  onClick={() => setEditing({ rif: p.riferimento, name: p.name, mode: "rename", value: p.name })}
                >✎</button>
                <button
                  title={t("editor.duplicate")}
                  style={{ ...ACT_BTN, color: isDuping ? "#a855f7" : "var(--brand-text-muted, #94a3b8)" }}
                  onClick={() => setEditing({ rif: p.riferimento, name: p.name, mode: "duplicate", value: `${p.name} ${t("common.copiaSuffisso")}` })}
                >⧉</button>
                {!p.external && (
                  <button
                    title={t("welcome.archivia")}
                    data-testid={`archive-${p.riferimento}`}
                    style={{ ...ACT_BTN }}
                    onClick={() => handleArchivia(p, true)}
                  >🗄</button>
                )}
                <button
                  title={p.external ? t("welcome.removeFromList") : t("editor.delete")}
                  style={{ ...ACT_BTN }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = "var(--brand-danger, #ef4444)")}
                  onMouseLeave={(e) => (e.currentTarget.style.color = "var(--brand-text-muted, #94a3b8)")}
                  onClick={() => handleDelete(p)}
                >✕</button>
              </div>
            );

            const pannelloDuplica = (
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
                  style={{ ...INPUT, padding: "4px 8px", fontSize: 13, flex: 1, minWidth: 0 }}
                  value={editing?.value ?? ""}
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
            );

            const apriSePossibile = () => {
              if (!openingName && !actionBusy && !isEditing) handleOpen(p.riferimento, p.name);
            };

            // ── La piastrella ────────────────────────────────────────────
            if (vista === "griglia") {
              const mostraAzioni = sorvolato === p.name || isEditing;
              return (
                <div
                  key={p.name}
                  onMouseEnter={() => setSorvolato(p.name)}
                  onMouseLeave={() => setSorvolato((v) => (v === p.name ? null : v))}
                  onClick={apriSePossibile}
                  title={p.path}
                  style={{
                    position: "relative", width: 158, boxSizing: "border-box",
                    padding: "14px 10px 12px", borderRadius: 8, textAlign: "center",
                    background: "var(--brand-surface, #1e293b)",
                    border: `1px solid ${isOpening ? "var(--brand-primary, #3b82f6)" : isBusy ? "var(--brand-warning, #f59e0b)" : "var(--brand-surface-2, #334155)"}`,
                    opacity: dimmed ? 0.45 : 1,
                    cursor: (openingName || actionBusy || isEditing) ? "default" : "pointer",
                  }}
                >
                  {/* Le azioni appaiono al passaggio del mouse. Restano visibili
                      mentre si rinomina o si duplica: sparire sotto il cursore
                      che le ha appena usate e il modo piu rapido di perdere il
                      filo di cosa si stava facendo. */}
                  <div style={{
                    position: "absolute", top: 4, right: 4,
                    opacity: mostraAzioni ? 1 : 0,
                    transition: "opacity .12s",
                    pointerEvents: mostraAzioni ? "auto" : "none",
                  }}>
                    {!isOpening && !isBusy && azioni}
                  </div>

                  <div style={{ fontSize: 40, lineHeight: 1, marginBottom: 8 }}>📁</div>

                  {isRenaming ? campoNome : (
                    <div style={{
                      fontWeight: 600, fontSize: 13, color: "var(--brand-text, #e2e8f0)",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {p.name}
                    </div>
                  )}

                  <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 3 }}>
                    {isOpening ? t("welcome.opening") : isBusy ? "…" : quando}
                  </div>

                  {(distintivoEsterno || distintivoAzienda) && (
                    <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {distintivoAzienda}{distintivoEsterno}
                    </div>
                  )}

                  {isDuping && <div style={{ marginTop: 8, textAlign: "left" }}>{pannelloDuplica}</div>}
                </div>
              );
            }

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
                  onClick={apriSePossibile}
                >
                  {/* icon */}
                  <div style={{
                    width: 40, height: 40, borderRadius: 8, background: "var(--brand-surface-2, #334155)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20, flexShrink: 0,
                  }}>📁</div>

                  {/* name + date */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {isRenaming ? campoNome : (
                      <div style={{ fontWeight: 600, fontSize: 15, color: "var(--brand-text, #e2e8f0)", display: "flex", alignItems: "center", gap: 6 }}>
                        {p.name}
                        {distintivoAzienda}
                        {distintivoEsterno}
                      </div>
                    )}
                    <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>
                      {quando}
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
                  {!isOpening && !isBusy && azioni}

                  {/* status label */}
                  {isOpening && <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)", flexShrink: 0 }}>{t("welcome.opening")}</div>}
                  {isBusy   && <div style={{ fontSize: 13, color: "var(--brand-warning, #f59e0b)", flexShrink: 0 }}>…</div>}
                  {!isOpening && !isBusy && (
                    <div style={{ fontSize: 13, color: "var(--brand-primary, #3b82f6)", fontWeight: 500, flexShrink: 0, marginLeft: 4 }}>{t("welcome.open")}</div>
                  )}
                </div>

                {isDuping && pannelloDuplica}
              </div>
            );
          })}
              </div>
            </div>
          ))}
          {/* Gli archiviati: in fondo e chiusi, per riprenderli o cancellarli. */}
          {!loading && archiviati.length > 0 && (
            <div style={{ marginTop: 22, paddingTop: 12, borderTop: "1px solid var(--brand-surface-2, #334155)" }}>
              <button type="button" data-testid="archiviati-toggle" onClick={() => setArchiviAperti((v) => !v)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: 0,
                  color: "var(--brand-text-subtle, #64748b)", textTransform: "uppercase", letterSpacing: 0.6 }}>
                {archiviAperti ? "▾" : "▸"} {t("welcome.archiviati", { n: archiviati.length })}
              </button>
              {archiviAperti && archiviati.map((p) => (
                <div key={p.riferimento} data-testid={`archiviato-${p.riferimento}`} style={{
                  display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", marginTop: 6,
                  border: "1px dashed var(--brand-surface-2, #334155)", borderRadius: 8, opacity: 0.85,
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14 }}>{p.name}{p.azienda ? ` · ${p.azienda}` : ""}</div>
                    <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
                      {t("welcome.archiviatoIl", { date: formatDate(p.archiviato?.quando_ms ?? null), da: p.archiviato?.da || "?" })}
                    </div>
                  </div>
                  <button type="button" data-testid={`unarchive-${p.riferimento}`} disabled={actionBusy === p.riferimento}
                    onClick={() => handleArchivia(p, false)}>{t("welcome.ripristina")}</button>
                  <button type="button" title={t("editor.delete")} disabled={actionBusy === p.riferimento}
                    onClick={() => handleDelete(p)}>✕</button>
                </div>
              ))}
            </div>
          )}
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

        {/* Riga in fondo: l'unica via al modale di installazione.
            Prima diceva a quale runtime puntava la SPA («runtime locale» /
            «connesso a X»), ma quel dato non poteva cambiare — vedi il commento
            di `InstallaRuntimeModal`. Ora dice l'unica cosa che qui si può
            davvero fare. Collegare un runtime remoto vive in Configurazione →
            Runtime, dove funziona. */}
        <div style={{
          marginTop: 20, paddingTop: 14,
          borderTop: "1px solid var(--brand-surface, #1e293b)",
          display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
          fontSize: 12, color: "var(--brand-text-subtle, #64748b)",
        }}>
          <span style={{ fontSize: 14 }}>📦</span>
          <button
            style={{ background: "transparent", border: "none", color: "var(--brand-primary, #3b82f6)", cursor: "pointer", fontSize: 12, textDecoration: "underline dotted" }}
            onClick={() => setShowInstalla(true)}
          >
            {t("welcome.installRuntime")}
          </button>
        </div>
      </div>
    </div>
  );
}
