import React, { useEffect, useRef } from "react";
import { useAppStore } from "@/store";
// Loads the translations: the tabs and their tests rely on this import.
import "@/i18n";
import { AzioniTestata } from "@/config/slotTestata";

// Segnaposto dei tag `<strong>`/`<em>`/`<code>` dentro i testi tradotti con `<Trans>`.
export const TRANS_COMP = { strong: <strong />, em: <em />, code: <code /> };

/** Avviso in linea quando il progetto cambia mentre stai modificando una
 *  sezione. Due pulsanti e nessun modale: un modale in mezzo al lavoro va
 *  chiuso per forza, questo si può ignorare — e finché lo si ignora vincono le
 *  modifiche locali, che è il verso giusto (un avviso che aspetta è
 *  recuperabile, una riga cancellata no). */
export function BarraConflittoSezione(
  { sync, t }: { sync: { conflitto: boolean; mantieni: () => void; ricarica: () => void };
                 t: (k: string) => string },
) {
  if (!sync.conflitto) return null;
  return (
    <div style={{
      margin: "8px 0", padding: "8px 10px", borderRadius: 6,
      background: "var(--brand-warning-bg, #422006)",
      border: "1px solid var(--brand-warning, #f59e0b)",
      display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 12, color: "var(--brand-warning-soft, #fcd34d)" }}>
        {t("cfg.sezioneConflitto")}{" "}
        <span style={{ opacity: 0.85 }}>{t("cfg.sezioneConflittoHint")}</span>
      </span>
      <span style={{ flex: 1 }} />
      <button style={S.btn("ghost")} onClick={sync.mantieni}>{t("cfg.sezioneMantieni")}</button>
      <button style={S.btn("ghost")} onClick={sync.ricarica}>{t("cfg.sezioneRicarica")}</button>
    </div>
  );
}

// ── Shared styles ─────────────────────────────────────────────────────────────

export const S = {
  page: {
    display: "flex" as const,
    flexDirection: "column" as const,
    flex: 1,
    overflow: "hidden" as const,
    background: "var(--brand-bg, #0f172a)",
    color: "var(--brand-text, #e2e8f0)",
  },
  /** «Ramo › Scheda» in cima all'area: dal 24-09-2026 la barra delle schede
   *  non c'è più (le sceglie l'albero ⚙), e questo dice dove si è. */
  /** The fixed header (25-11-2026): `intestazione`, the actions of the tab
   *  and the green bar. It does not scroll. */
  testata: {
    display: "flex" as const,
    flexDirection: "column" as const,
    padding: "10px 24px",
    background: "var(--brand-surface, #1e293b)",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
    flexShrink: 0,
  },
  intestazione: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
    minHeight: 30,
    fontSize: 14,
  },
  /** Where a tab puts its help text and its buttons (`AzioniTestata`). The
   *  space above it comes from the class `sws-header-actions` and only when
   *  it has content (`ConfigView` writes the rule): empty, it takes no room. */
  azioniTestata: {
    display: "flex" as const,
    alignItems: "center" as const,
    gap: 8,
    flexWrap: "wrap" as const,
  },
  body: {
    flex: 1,
    overflow: "auto" as const,
    padding: 24,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "var(--brand-text-subtle, #64748b)",
    letterSpacing: 1,
    marginBottom: 12,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    fontSize: 13,
  },
  th: {
    textAlign: "left" as const,
    padding: "6px 10px",
    color: "var(--brand-text-subtle, #64748b)",
    fontWeight: 600,
    fontSize: 11,
    letterSpacing: 0.5,
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
  },
  td: {
    padding: "4px 6px",
    borderBottom: "1px solid var(--brand-surface, #1e293b)",
    verticalAlign: "middle" as const,
  },
  // Il campo su `--brand-bg` e col bordo di `--brand-border` (29-10-2026). Prima
  // aveva lo **stesso fondo della card** (contrasto 1,00) e un bordo che nel
  // tema chiaro faceva 1,10: si capiva dov'era un campo solo dalla scritta
  // dentro. Ora è come `ui/base.ts` `campo` e come i campi di S7, che lo
  // facevano già. Piano `docs/archive/2026-10-29-card-delle-sorgenti.md`.
  input: {
    background: "var(--brand-bg, #0f172a)",
    color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-border, #475569)",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 13,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  inputSm: {
    background: "var(--brand-bg, #0f172a)",
    color: "var(--brand-text, #e2e8f0)",
    border: "1px solid var(--brand-border, #475569)",
    borderRadius: 4,
    padding: "4px 6px",
    fontSize: 12,
    width: "100%",
    boxSizing: "border-box" as const,
  },
  btn: (variant: "primary" | "danger" | "ghost" | "success"): React.CSSProperties => {
    const map = {
      primary: { background: "var(--sws-accent, #1d4ed8)", color: "var(--sws-on-accent, #dbeafe)", border: "1px solid var(--sws-select-border, #1e40af)" },
      success: { background: "var(--brand-success-bg, #166534)", color: "var(--brand-success-soft, #4ade80)", border: "1px solid var(--sws-success-border, #15803d)" },
      danger:  { background: "var(--brand-danger-bg, #7f1d1d)", color: "var(--brand-danger-soft, #fca5a5)", border: "1px solid var(--sws-danger-border, #991b1b)" },
      ghost:   { background: "transparent", color: "var(--brand-text-subtle, #64748b)", border: "1px solid var(--brand-surface-2, #334155)" },
    };
    return {
      ...map[variant],
      borderRadius: 4,
      padding: "5px 12px",
      cursor: "pointer",
      fontSize: 13,
      whiteSpace: "nowrap" as const,
    };
  },
  // Bordo `--brand-border` e un'ombra (29-10-2026): nel tema chiaro una card
  // bianca su `#f8fafc` col bordo `--brand-surface-2` non si vedeva — fondo e
  // bordo facevano 1,05 contro lo sfondo. Osservazione del maintainer sul
  // mockup: «le varie card si confondono un po' troppo con lo sfondo».
  card: {
    background: "var(--brand-surface, #1e293b)",
    border: "1px solid var(--brand-border, #475569)",
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden" as const,
    boxShadow: "var(--brand-ombra-card, none)",
  },
  cardHead: {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    padding: "10px 16px",
    background: "var(--brand-surface, #1e293b)",
    cursor: "pointer",
    borderBottom: "1px solid var(--brand-surface-2, #334155)",
  },
  notice: {
    background: "var(--sws-select-bg, #172554)",
    border: "1px solid var(--sws-select-border, #1e40af)",
    borderRadius: 6,
    padding: "10px 14px",
    fontSize: 12,
    color: "var(--sws-select-text, #93c5fd)",
    marginBottom: 16,
  },
  // Compact field label used by the source-card grids.
  label: {
    fontSize: 11, color: "var(--brand-text-subtle, #64748b)", display: "block" as const, marginBottom: 3,
  } as React.CSSProperties,
  // Tiny icon-sized button for delete/close actions inside cards.
  btnXs: {
    background: "transparent",
    border: "1px solid var(--brand-surface-2, #334155)",
    borderRadius: 4,
    color: "var(--brand-text-subtle, #64748b)",
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 6px",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── QuickCreateTagModal ───────────────────────────────────────────────────────
// Minimal modal that lets the operator create a new tag without switching tab.

// Barra di salvataggio: dal 22-09-2026 c'è **un solo Salva**, quello del
// progetto (decisione del maintainer: «non ha senso distinguere i salvataggi
// della UI, delle variabili, delle sorgenti»). Ogni scheda registra la propria
// bozza in `pendingSections` con `section` + `dirty`, e il pulsante — uguale
// in ogni scheda, «Salva progetto» — chiama `saveAll()`: che svuota le bozze
// in serie (Q30), crea le variabili referenziate (Fase 0b) e scrive le
// pagine. Prima ogni scheda aveva il suo pulsante e il suo PUT, e tre di esse
// (Sorgenti, Script, Lingue) non partecipavano a Ctrl+S: le variabili in
// attesa della scheda Sorgenti si perdevano cambiando scheda.
//
// `saving`/`saved`/`label` restano nella firma per non toccare quaranta
// chiamate in un colpo: sono ignorati, lo stato viene dallo store.
/** Sentinella con cui il backend maschera i segreti già salvati (password SMTP,
 *  bot token Telegram). Rimandarla indietro invariata lascia il valore com'è.
 *  Vive in `CampoPassword`, che spegne l'occhio quando la vede (09-11-2026). */
export { MASCHERA_SERVER as MASKED } from "@/components/CampoPassword";

/** Registra la bozza di una sezione fra quelle pendenti, **senza** disegnare
 *  niente. È la metà di `SaveBar` che conta per il Salva unico: una
 *  sottoscheda ha la sua bozza da far arrivare a `saveAll()`, ma non una
 *  seconda barra da mostrare. */
export function SezionePendente({
  section, dirty, onSave,
}: { section: string; dirty: boolean; onSave: () => void | Promise<void> }) {
  const registerPendingSection = useAppStore((s) => s.registerPendingSection);
  // Stessa ragione della ref in SaveBar: `onSave` cambia identità a ogni
  // battuta di tasto, e ri-registrare a ogni tasto ri-renderizza.
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    registerPendingSection(section, dirty ? async () => { await onSaveRef.current(); } : null);
    return () => registerPendingSection(section, null);
  }, [section, dirty, registerPendingSection]);
  return null;
}

/** The draft of a tab, for the one Save of the header (25-11-2026, plan
 *  `docs/plans/2026-11-25-save-nella-testata.md`). It registers the draft
 *  among the pending sections, like `SezionePendente`, and draws no bar: the
 *  Save, the list of the tabs with changes and the green bar are in the fixed
 *  header (`config/testata.tsx`). A `notice` of the tab (the result of a
 *  rename, of a test) goes in the header too.
 *
 *  `saving`/`saved`/`label`/`savedNotice`/`disabled` stay in the signature so
 *  as not to touch eleven calls at once: they are ignored. */
export function SaveBar({
  onSave,
  notice,
  section,
  dirty,
}: {
  /** Come si scrive la bozza di QUESTA scheda: la chiama `saveAll()`, in
   *  serie con le altre, quando `dirty` è vero. Non è più il pulsante. */
  onSave: () => void | Promise<void>;
  saving?: boolean;
  saved?: boolean;
  savedNotice?: string;
  label?: string;
  disabled?: boolean;
  notice?: string | null;
  /** Chiave della sezione nel registro delle bozze pendenti. */
  section: string;
  /** True se la bozza locale differisce da quanto salvato — per intenzione
   *  dell'utente, non per confronto strutturale (incidente del 2026-07-28). */
  dirty: boolean;
}) {
  const noticeIsError = !!notice && (/^(errore|error|✗|✕)/i).test(notice.trim());
  return (
    <>
      <SezionePendente section={section} dirty={dirty} onSave={onSave} />
      {notice != null && (
        <AzioniTestata>
          <span data-testid="testata-avviso" style={{ fontSize: 12, color: noticeIsError ? "var(--brand-danger, #ef4444)" : "var(--brand-success, #22c55e)" }}>
            {notice}
          </span>
        </AzioniTestata>
      )}
    </>
  );
}
