// Pezzo della schermata di scelta progetto, uscito da `WelcomeScreen.tsx` il
// 28-10-2026 (piano docs/plans/2026-10-26-aprire-sws-soligo-net.md, ramo B
// punto 6). Era un file di 1673 righe con sei componenti dentro: si leggeva
// solo cercando, e ogni modifica a un modale ricompilava la schermata intera
// nella testa di chi la faceva. Il codice e spostato, non riscritto.
//
// Il modale «Nuovo progetto», con il suo anteprima del nome.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import type { ProjectTargetKind, TemplateEntry } from "@/types";
import { campoAmpio, pulsantePrimario, pulsanteSecondario } from "@/ui/base";
import { DirectoryBrowser } from "@/components/benvenuto/SfogliaCartelle";

// I nomi corti della schermata da cui questo file viene (`WelcomeScreen`),
// tenuti apposta: lo spostamento resta leggibile riga per riga.
const BTN_PRIMARY = pulsantePrimario;
const BTN_GHOST = pulsanteSecondario;
const INPUT = campoAmpio;

/** Le tre schede del modale. Esportato: `WelcomeScreen` sceglie quale aprire. */
export type NewProjectTab = "empty" | "template" | "zip";

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

export function NewProjectModal({
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
