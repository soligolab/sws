import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
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

// ── WelcomeScreen ─────────────────────────────────────────────────────────────

interface WelcomeScreenProps {
  /** Called once a project has been opened and the user must log in. */
  onProjectOpened: () => void;
}

export function WelcomeScreen({ onProjectOpened }: WelcomeScreenProps) {
  const [projects, setProjects]   = useState<ProjectListEntry[]>([]);
  const [loading, setLoading]     = useState(true);
  const [openingName, setOpening] = useState<string | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [showNew, setShowNew]     = useState(false);

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
      // open_project always invalidates sessions → must re-login
      onProjectOpened();
    } catch (e: any) {
      setError(`Errore apertura "${name}": ${e?.message ?? e}`);
    } finally {
      setOpening(null);
    }
  };

  const handleCreated = async (name: string) => {
    setShowNew(false);
    // Refresh list then open the newly-created project
    await loadProjects();
    await handleOpen(name);
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
          {!loading && projects.map((p) => (
            <div
              key={p.name}
              style={{
                ...CARD,
                marginBottom: 8,
                opacity: openingName && openingName !== p.name ? 0.5 : 1,
                borderColor: openingName === p.name ? "#3b82f6" : "#334155",
              }}
              onClick={() => { if (!openingName) handleOpen(p.name); }}
            >
              {/* icon */}
              <div style={{
                width: 40, height: 40, borderRadius: 8,
                background: "#334155",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 20, flexShrink: 0,
              }}>
                📁
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 15, color: "#e2e8f0" }}>{p.name}</div>
                <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                  Ultima modifica: {formatDate(p.last_modified_ms)}
                </div>
              </div>
              {openingName === p.name ? (
                <div style={{ fontSize: 13, color: "#94a3b8" }}>Apro…</div>
              ) : (
                <div style={{ fontSize: 13, color: "#3b82f6", fontWeight: 500 }}>Apri →</div>
              )}
            </div>
          ))}
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
      </div>
    </div>
  );
}
