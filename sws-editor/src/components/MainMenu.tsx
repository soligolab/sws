import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { canConfigureProject } from "@/auth/permissions";
import { DROP_ITEM, DROP_PANEL, DROP_SEP, HDR_BTN, useOutsideClose } from "@/components/headerStyles";
import { pickInitialPageId } from "@/pageLayout";
import { useAppStore } from "@/store";

/**
 * The ☰ menu: project-level commands plus everything that is set once and
 * then forgotten (log panel, runtime reboot). Its button doubles as the
 * save-status indicator (⟳ / ✓ / ⚠) — that is the *outcome of the last
 * action*, distinct from the persistent "unsaved" dot in the header.
 */
export function MainMenu({
  onLogout,
  onCloseProject,
  logOpen,
  onToggleLog,
  chatOpen,
  onToggleChat,
  onStaccaLog,
  chatStaccata,
  onStaccaChat,
}: {
  onLogout: () => void;
  onCloseProject: () => void;
  logOpen: boolean;
  onToggleLog: () => void;
  chatOpen: boolean;
  onToggleChat: () => void;
  /** Apre i log in una finestra propria. Gestisce il popup bloccato. */
  onStaccaLog: () => void;
  /** La chat vive in una finestra separata: il cassetto qui non si apre. */
  chatStaccata: boolean;
  /** Consegna la chat a una finestra propria. */
  onStaccaChat: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen]       = useState(false);
  const ref                   = useRef<HTMLDivElement>(null);
  const authRole              = useAppStore((s) => s.authRole);
  const saveStatus            = useAppStore((s) => s.saveStatus);
  const saveError             = useAppStore((s) => s.saveError);
  const saveAll               = useAppStore((s) => s.saveAll);
  const project                = useAppStore((s) => s.project);
  const setProject            = useAppStore((s) => s.setProject);
  const setPages              = useAppStore((s) => s.setPages);
  const fileInputRef          = useRef<HTMLInputElement>(null);
  const [ioBusy, setIoBusy]   = useState<"export" | "import" | null>(null);
  const [ioStatus, setIoStat] = useState<string | null>(null);
  const [rebooting, setRebooting] = useState(false);
  const [renaming, setRenaming] = useState(false);

  useOutsideClose(ref, open, () => setOpen(false));

  const handleExport = async () => {
    setIoBusy("export"); setIoStat(null);
    try {
      const res      = await api.exportProjectZip();
      const cd       = res.headers.get("content-disposition");
      const filename = (/filename="([^"]+)"/.exec(cd ?? "") ?? [])[1]
        ?? (() => { const d = new Date(); const p = (n: number) => String(n).padStart(2,"0"); return `sws-project-${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}.zip`; })();
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"), { href: url, download: filename });
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setIoStat(`✓ ${filename}`);
    } catch (e: any) { setIoStat(`${t("header.error")}: ${e?.message ?? e}`); }
    finally { setIoBusy(null); setTimeout(() => setIoStat(null), 5000); }
  };

  const handleImport = async (file: File) => {
    if (!confirm(t("menu.importConfirm"))) return;
    setIoBusy("import"); setIoStat(null);
    try {
      await api.importProjectZip(file);
      const project = await api.getProject();
      setProject(project);
      const names = await api.listSynoptics();
      if (names.length > 0) {
        const pages = await Promise.all(names.map((n) => api.getSynoptic(n)));
        setPages(pages, pickInitialPageId(pages, project.page_layout?.home_page_id));
      } else {
        setPages([], "");
      }
      const tagCount = project.tags?.length ?? 0;
      setIoStat(t("menu.imported", { file: file.name, count: tagCount }));
    } catch (e: any) { setIoStat(`${t("header.error")}: ${e?.message ?? e}`); }
    finally { setIoBusy(null); setTimeout(() => setIoStat(null), 6000); }
  };

  const handleRename = async () => {
    const currentName = project?.meta.name ?? "";
    const newName = window.prompt(t("menu.renamePrompt"), currentName)?.trim();
    if (!newName || newName === currentName) return;
    setRenaming(true); setIoStat(null);
    try {
      await api.renameProject(currentName, newName);
      // Q30 — si **rilegge** invece di correggere `meta.name` in memoria.
      //
      // Rinominare riscrive `project.yaml` sul server (`patch_project_name`
      // aggiorna `meta.name`, o il progetto rinominato mostrerebbe il nome
      // vecchio), ma la risposta è `{name}` e **non porta l'ETag**. Correggendo
      // il nome a mano restavamo con la versione di prima della rinomina, e da
      // lì ogni salvataggio di sezione prendeva un 409 «qualcun altro ha
      // modificato il progetto» — dove il qualcun altro eravamo noi. È lo
      // stesso difetto trovato su «⚠ Aggiorna progetto» il 2026-09-05, e qui
      // non si può chiudere prendendo l'ETag dalla risposta, perché non c'è.
      //
      // La rilettura risolve entrambe le cose in un colpo: `/api/project` porta
      // la versione, e il nome arriva da chi l'ha scritto invece che da una
      // nostra supposizione su cosa il server abbia fatto.
      setProject(await api.getProject());
    } catch (e: any) {
      setIoStat(`${t("header.error")}: ${e?.message ?? e}`);
      setTimeout(() => setIoStat(null), 5000);
    } finally {
      setRenaming(false);
    }
  };

  const handleReboot = async () => {
    if (!confirm(t("header.rebootConfirm"))) return;
    setRebooting(true);
    try { await api.systemReboot(); } catch { /* ignore */ }
    setTimeout(() => setRebooting(false), 3000);
  };

  const saveBtnLabel =
    saveStatus === "saving" ? t("header.saving") :
    saveStatus === "ok"     ? t("header.saved")   :
    saveStatus === "error"  ? t("header.saveErrorBtn") :
                              t("menu.saveAll");

  const saveBtnColor =
    saveStatus === "error" ? "var(--brand-danger-soft, #fca5a5)" :
    saveStatus === "ok"    ? "var(--brand-success-soft, #86efac)" :
    saveStatus === "saving"? "var(--brand-text-muted, #94a3b8)" :
                             "var(--brand-text-2, #cbd5e1)";

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        style={{
          ...HDR_BTN,
          background: saveStatus === "saving" ? "#374151" : saveStatus === "ok" ? "var(--brand-success-bg, #166534)" : saveStatus === "error" ? "var(--brand-danger-bg, #7f1d1d)" : "var(--brand-surface-2, #334155)",
          color: saveBtnColor,
          borderColor: saveStatus === "error" ? "#991b1b" : saveStatus === "ok" ? "#15803d" : "var(--brand-border, #475569)",
          minWidth: 90,
        }}
        onClick={() => setOpen((v) => !v)}
        title={saveStatus === "error" ? (saveError ?? t("header.error")) : t("header.menuTitle")}
      >
        ☰ {t("header.menu")} {saveStatus === "saving" ? "⟳" : saveStatus === "ok" ? "✓" : saveStatus === "error" ? "⚠" : ""}
      </button>
      {/* L'input file vive FUORI dal dropdown: cliccare "Importa progetto" chiude
          il menu (setOpen(false)); se l'input fosse dentro {open && …} verrebbe
          smontato mentre il file-dialog nativo è ancora aperto e l'onChange non
          scatterebbe più → l'import non partirebbe (GitHub issue #2). */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".zip,application/zip"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) handleImport(f); }}
      />
      {open && (
        <div style={DROP_PANEL}>
          {/* Available in both modes: saveAll() flushes the ConfigView tab
              drafts too, so it is no longer editor-only. */}
          <button
            style={{ ...DROP_ITEM, color: saveStatus === "error" ? "var(--brand-danger-soft, #fca5a5)" : saveStatus === "ok" ? "var(--brand-success-soft, #86efac)" : "var(--brand-text-2, #cbd5e1)" }}
            disabled={saveStatus === "saving"}
            onClick={() => { void saveAll(); setOpen(false); }}
          >
            {saveBtnLabel}
            <span style={{ float: "right", opacity: 0.55, fontSize: 11 }}>Ctrl+S</span>
          </button>
          {saveStatus === "error" && saveError && (
            <div style={{ padding: "2px 14px 6px", fontSize: 11, color: "var(--brand-danger-soft, #fca5a5)", wordBreak: "break-word" }}>
              {saveError}
            </div>
          )}
          {canConfigureProject(authRole) && (
            <button
              style={{ ...DROP_ITEM, opacity: renaming ? 0.6 : 1 }}
              disabled={renaming}
              onClick={() => { void handleRename(); setOpen(false); }}
            >
              {t("menu.renameProject")}
            </button>
          )}
          <div style={DROP_SEP} />
          {authRole === "Admin" && (
            <>
              <button
                style={{ ...DROP_ITEM, color: ioBusy === "export" ? "var(--brand-text-muted, #94a3b8)" : "var(--brand-text-2, #cbd5e1)" }}
                disabled={ioBusy !== null}
                onClick={() => { handleExport(); setOpen(false); }}
              >
                {ioBusy === "export" ? t("menu.exporting") : t("menu.saveCopyToPc")}
              </button>
              <button
                style={{ ...DROP_ITEM, color: ioBusy === "import" ? "var(--brand-text-muted, #94a3b8)" : "var(--brand-text-2, #cbd5e1)" }}
                disabled={ioBusy !== null}
                onClick={() => { fileInputRef.current?.click(); setOpen(false); }}
              >
                {ioBusy === "import" ? t("menu.importing") : t("menu.openFromPc")}
              </button>
              <div style={DROP_SEP} />
            </>
          )}
          <button
            style={DROP_ITEM}
            onClick={() => { onToggleLog(); setOpen(false); }}
          >
            {t("menu.logPanel")}
            <span style={{ float: "right", opacity: 0.7 }}>{logOpen ? "✓" : ""}</span>
          </button>
          <button
            style={DROP_ITEM}
            onClick={() => { onStaccaLog(); setOpen(false); }}
          >
            {t("logWindow.open")}
            <span style={{ float: "right", opacity: 0.7 }}>↗</span>
          </button>
          {canConfigureProject(authRole) && (
            <>
              {/* Con la chat staccata la voce resta visibile ma disabilitata,
                  col motivo nel titolo: farla sparire lascerebbe credere che la
                  funzione non esista. Si riabilita da sé quando quella finestra
                  si chiude — lo dice lei sul ponte. */}
              <button
                style={{ ...DROP_ITEM, opacity: chatStaccata ? 0.5 : 1 }}
                disabled={chatStaccata}
                title={chatStaccata ? t("menu.chatDetachedHint") : undefined}
                onClick={() => { onToggleChat(); setOpen(false); }}
              >
                {t("menu.chatPanel")}
                <span style={{ float: "right", opacity: 0.7 }}>{chatOpen && !chatStaccata ? "✓" : ""}</span>
              </button>
              <button
                style={{ ...DROP_ITEM, opacity: chatStaccata ? 0.5 : 1 }}
                disabled={chatStaccata}
                title={t("menu.chatDetachHint")}
                onClick={() => { onStaccaChat(); setOpen(false); }}
              >
                {t("menu.chatDetach")}
                <span style={{ float: "right", opacity: 0.7 }}>↗</span>
              </button>
            </>
          )}
          {canConfigureProject(authRole) && (
            <button
              style={{ ...DROP_ITEM, opacity: rebooting ? 0.6 : 1 }}
              disabled={rebooting}
              onClick={() => { handleReboot(); setOpen(false); }}
              title={t("header.rebootTitle")}
            >
              {t("header.reboot")}
            </button>
          )}
          <div style={DROP_SEP} />
          <button
            style={DROP_ITEM}
            onClick={() => { onCloseProject(); setOpen(false); }}
          >
            {t("menu.closeProject")}
          </button>
          <div style={DROP_SEP} />
          <button
            style={DROP_ITEM}
            onClick={() => { onLogout(); setOpen(false); }}
          >
            {t("menu.logout")}
          </button>
        </div>
      )}
      {/* Lo stato export/import vive FUORI dal dropdown: il menu si chiude al
          click di "Importa progetto", quindi un messaggio interno non verrebbe
          mai visto. Qui resta visibile come piccolo toast sotto il bottone. */}
      {ioStatus && (
        <div style={{
          position: "absolute", top: "100%", right: 0, marginTop: 4, zIndex: 9000,
          whiteSpace: "nowrap", padding: "4px 10px", borderRadius: 4,
          background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
          fontSize: 11, color: ioStatus.startsWith("✓") ? "var(--brand-success-soft, #86efac)" : "var(--brand-danger-soft, #fca5a5)",
        }}>
          {ioStatus}
        </div>
      )}
    </div>
  );
}
