// The fixed header of the Configuration forms (25-11-2026, plan
// `docs/plans/2026-11-25-save-nella-testata.md`; UI rule 4 in CLAUDE.md).
//
// The header does not scroll: title, help text, the actions of the tab and
// the Save. Only the content below scrolls. Before, `SaveBar` was a sticky
// strip inside the scrolling body: the rows of the Tags tab ran under it, and
// the «Saved» notice was 12 px of text next to the button — the maintainer saw
// the one of the Users page at the third attempt.
//
// The Save stays one (decision of 22-09-2026, confirmed on 25-11): it calls
// `saveAll()`, which writes every tab with changes. The header says which tabs
// those are, and a green bar confirms the save.

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { alberoCambiato, scriptCambiati, useAppStore } from "@/store";

type Stato = ReturnType<typeof useAppStore.getState>;
import { SCHEDE } from "@/config/schede";
import { S } from "@/config/comuni";
export { AzioniTestata, SlotTestata } from "@/config/slotTestata";

/** The label of a pending section: the tab that registers it, from `SCHEDE`.
 *  `ai:tags` (a proposal of the assistant) is the tab after the colon. */
export function etichettaSezione(key: string, t: TFunction | ((k: string) => string)): string {
  const tr = t as (k: string) => string;
  const candidates = key.includes(":") ? [key.split(":")[1], key.split(":")[0]] : [key];
  for (const c of candidates) {
    const scheda = SCHEDE.find((s) => "sezione" in s && s.sezione === c && !("ospite" in s))
      ?? SCHEDE.find((s) => s.id === c);
    if (scheda) return tr(`config.tabs.${scheda.id}`);
  }
  if (key === "function") return tr("leftPanel.att.logica");
  if (key.startsWith("planimetria:")) return tr("leftPanel.att.pagine");
  return key;
}

/** The parts of the project with unsaved changes, in words, without repeats:
 *  the pages, then the pending sections, then the scripts. */
export function sezioniModificate(s: Stato, t: TFunction | ((k: string) => string)): string[] {
  const tr = t as (k: string) => string;
  const out: string[] = [];
  const add = (x: string) => { if (!out.includes(x)) out.push(x); };
  if (s.pagesRev !== s.savedPagesRev) add(tr("leftPanel.att.pagine"));
  for (const key of Object.keys(s.pendingSections)) add(etichettaSezione(key, tr));
  if (alberoCambiato(s) || scriptCambiati(s)) add(tr("config.tabs.scripts"));
  return out;
}

/** The right side of the header: what is not saved, and the Save. */
export function StatoSalvataggio() {
  const { t } = useTranslation();
  const saveAll = useAppStore((s) => s.saveAll);
  const saving = useAppStore((s) => s.saveStatus === "saving");
  const modificate = useAppStore((s) => sezioniModificate(s, t).join(", "));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginLeft: "auto" }}>
      {modificate !== "" && (
        <span data-testid="testata-modificate" style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>
          {t("cfgUi.unsavedIn", { tabs: modificate })}
        </span>
      )}
      <button data-testid="testata-salva" style={S.btn("success")} onClick={() => void saveAll()}
        disabled={saving} title={t("cfgUi.saveProjectHint")}>
        {saving ? t("cfgUi.saving") : t("cfgUi.save")}
      </button>
    </div>
  );
}

/** How long the green bar stays, in milliseconds. */
export const BARRA_VERDE_MS = 3000;

/** The bar under the header: green for about 3 s after a save, red after a
 *  failed one until it is closed or the next save starts. */
export function BarraEsito() {
  const { t } = useTranslation();
  const saveStatus = useAppStore((s) => s.saveStatus);
  const saveError = useAppStore((s) => s.saveError);
  const tagCreati = useAppStore((s) => s.ultimiTagCreati);
  const [esito, setEsito] = useState<"ok" | "error" | null>(null);
  const prima = useRef(saveStatus);
  useEffect(() => {
    const before = prima.current;
    prima.current = saveStatus;
    if (saveStatus === "saving") { setEsito(null); return; }
    if (saveStatus === "error") { setEsito("error"); return; }
    if (saveStatus === "ok" && before !== "ok") {
      setEsito("ok");
      const timer = window.setTimeout(() => setEsito((e) => (e === "ok" ? null : e)), BARRA_VERDE_MS);
      return () => window.clearTimeout(timer);
    }
  }, [saveStatus]);
  if (esito === null) return null;
  const ok = esito === "ok";
  return (
    <div role="status" className="sws-save-result" data-testid={ok ? "barra-salvato" : "barra-errore"} style={{
      display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", borderRadius: 4, fontSize: 13,
      fontWeight: 600,
      background: ok ? "var(--brand-success-bg, #166534)" : "var(--brand-danger-bg, #7f1d1d)",
      color: ok ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #fca5a5)",
      border: `1px solid ${ok ? "var(--sws-success-border, #15803d)" : "var(--sws-danger-border, #991b1b)"}`,
    }}>
      <span style={{ flex: 1 }}>
        {ok
          ? `${t("cfgUi.savedChangesAppliedImmediately")}${tagCreati.length > 0 ? ` · ${t("cfgUi.tagCreati", { n: tagCreati.length, ids: tagCreati.join(", ") })}` : ""}`
          : saveError ?? t("cfgUi.saveFailed")}
      </span>
      {!ok && (
        <button type="button" aria-label={t("common.close")} onClick={() => setEsito(null)}
          style={{ ...S.btnXs, color: "inherit", borderColor: "currentColor" }}>✕</button>
      )}
    </div>
  );
}
