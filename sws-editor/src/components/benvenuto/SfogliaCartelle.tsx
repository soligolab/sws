// Pezzo della schermata di scelta progetto, uscito da `WelcomeScreen.tsx` il
// 28-10-2026 (piano docs/plans/2026-10-26-aprire-sws-soligo-net.md, ramo B
// punto 6). Era un file di 1673 righe con sei componenti dentro: si leggeva
// solo cercando, e ogni modifica a un modale ricompilava la schermata intera
// nella testa di chi la faceva. Il codice e spostato, non riscritto.
//
// Il navigatore di cartelle del modale «Nuovo progetto»: lo usa solo lui.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconaUI } from "@/ui/IconaUI";
import { api } from "@/api/client";
import type { BrowseDirEntry } from "@/types";
import { pulsantePrimario, pulsanteSecondario } from "@/ui/base";

// I nomi corti della schermata da cui questo file viene (`WelcomeScreen`),
// tenuti apposta: lo spostamento resta leggibile riga per riga.
const BTN_PRIMARY = pulsantePrimario;
const BTN_GHOST = pulsanteSecondario;

export function DirectoryBrowser({
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
              <IconaUI nome="progetto" px={15} />
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
              <button style={BTN_GHOST} disabled={creating} onClick={handleCreateDir}
                title={t("common.conferma")}><IconaUI nome="conferma" titolo={t("common.conferma")} /></button>
              <button style={BTN_GHOST} onClick={() => { setNewName(null); setError(null); }}
                title={t("common.annulla")}><IconaUI nome="chiudi" titolo={t("common.annulla")} /></button>
            </div>
          )}
          {parent !== null && (
            <div
              style={{ ...ROW, color: "var(--brand-text-muted, #94a3b8)" }}
              onClick={() => load(parent)}
            >
              <IconaUI nome="cartellaSu" px={15} /> ..
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
              <IconaUI nome="progetto" px={15} /> {d.name}
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

