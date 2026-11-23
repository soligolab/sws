// The symbol editor in a window of its own (plan
// docs/plans/2026-11-22-rc29-collaudo-utente-editor-simboli.md, block E).
// The page asks the IDE that opened it for the symbol and the project
// (`ponteSimboli.ts`), then is the editor; closing the editor closes it.
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { SymbolEditorHost } from "./SymbolEditor";
import { collegaFinestra } from "./ponteSimboli";

export function FinestraSimboli() {
  const { t, i18n } = useTranslation();
  const [stato, setStato] = useState<"collego" | "pronto" | "senza-ide">("collego");
  useEffect(() => {
    let alive = true;
    void collegaFinestra(window.location.hash).then((ok) => { if (alive) setStato(ok ? "pronto" : "senza-ide"); });
    return () => { alive = false; };
  }, []);
  // The editor closed (saved, or «Close»): so does the window.
  useEffect(() => {
    if (stato !== "pronto") return;
    return useAppStore.subscribe((s, prima) => {
      if (prima.symbolEditor && !s.symbolEditor) window.close();
    });
  }, [stato]);
  // The window's own title, so it stands apart from the IDE in the taskbar
  // (the branding sets the product name at start-up).
  const nome = useAppStore((s) => {
    const d = s.symbolEditor?.draft;
    return d ? (i18n.language.startsWith("en") ? d.en : d.it) || d.slug : "";
  });
  useEffect(() => {
    if (stato === "pronto" && nome) document.title = t("symbolEditor.window.docTitle", { name: nome });
  }, [stato, nome, t]);
  if (stato !== "pronto") {
    return (
      <div style={{ padding: 24, color: "var(--brand-text-muted, #94a3b8)", fontSize: 14 }} data-testid="symbol-window-status">
        {t(stato === "collego" ? "symbolEditor.window.connecting" : "symbolEditor.window.noIde")}
      </div>
    );
  }
  return <SymbolEditorHost />;
}
