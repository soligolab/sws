import { useTranslation } from "react-i18next";
import { SezioneScorciatoie } from "@/scorciatoie/SezioneScorciatoie";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { DISPOSIZIONI_IDE, MISURE_ICONE, useAppStore, type DisposizioneIde } from "@/store";
import { IconaStrumento } from "@/editor/IconaStrumento";

// ── Preferenze IDE ───────────────────────────────────────────────────────────
//
// Impostazioni di *questo browser/editor*, non del progetto: mai salvate in
// project.yaml, sempre in localStorage (ThemeToggle/UiLangSelect già
// esistenti, prima sparse fra la tab "Stato" — sezione ASPETTO — e il menu
// utente 👤). Le altre impostazioni IDE-locali censite (URL runtime override,
// larghezze pannelli, stato cassetto log, righelli/guide canvas...) restano
// dove sono: la prima precede l'apertura di un progetto (va scelta prima di
// arrivare qui), le altre sono stato di layout effimero, non "preferenze" nel
// senso in cui si cercherebbero in un pannello di configurazione.


/** La misura delle icone di Strumenti (14-10-2026): sono vettoriali, quindi
 *  quattro gradini bastano per adattarle al monitor — richiesta del maintainer. */
function MisuraIconeSection() {
  const { t } = useTranslation();
  const misura = useAppStore((s) => s.misuraIcone);
  const setMisura = useAppStore((s) => s.setMisuraIcone);
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.iconSize")}</div>
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.iconSizeNote")}</div>
      </div>
      <div role="radiogroup" aria-label={t("cfgUi.iconSize")} style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {MISURE_ICONE.map((px) => (
          <button key={px} type="button" role="radio" aria-checked={misura === px} data-testid={`misura-icone-${px}`}
            title={`${px} px`} onClick={() => setMisura(px)}
            style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 2,
              width: 40, height: 52, padding: 4, borderRadius: 4, cursor: "pointer",
              background: misura === px ? "var(--brand-surface-2, #334155)" : "transparent",
              border: `1px solid ${misura === px ? "var(--brand-accent, #3b82f6)" : "var(--brand-surface-2, #334155)"}`,
              color: "var(--brand-text, #e2e8f0)",
            }}>
            <IconaStrumento tipo="gauge" px={px} />
            <span style={{ fontSize: 10 }}>{px}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** La disposizione dei pannelli (31-10-2026, piano
 *  docs/archive/2026-10-31-ide-stile-vscode.md): un elenco di scelte, ognuna con
 *  la sua frase, perché le disposizioni sono destinate a essere più di due. */
function DisposizioneSection() {
  const { t } = useTranslation();
  const scelta = useAppStore((s) => s.disposizioneIde);
  const scegli = useAppStore((s) => s.setDisposizioneIde);
  const etichette: Record<DisposizioneIde, [string, string]> = {
    classica: [t("cfgUi.disposizioneClassica"), t("cfgUi.disposizioneClassicaNota")],
    vscode: [t("cfgUi.disposizioneVscode"), t("cfgUi.disposizioneVscodeNota")],
  };
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.disposizione")}</div>
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.disposizioneNota")}</div>
      </div>
      <div role="radiogroup" aria-label={t("cfgUi.disposizione")} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {DISPOSIZIONI_IDE.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={scelta === d} data-testid={`disposizione-${d}`}
            onClick={() => scegli(d)}
            style={{
              textAlign: "left", padding: "6px 10px", borderRadius: 4, cursor: "pointer",
              background: scelta === d ? "var(--brand-surface-2, #334155)" : "transparent",
              border: `1px solid ${scelta === d ? "var(--brand-accent, #3b82f6)" : "var(--brand-surface-2, #334155)"}`,
              color: "var(--brand-text, #e2e8f0)",
            }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{etichette[d][0]}</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 1 }}>{etichette[d][1]}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export function IdePreferencesTab() {
  const { t } = useTranslation();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 480 }}>
      <div style={{ color: "var(--brand-text-muted, #94a3b8)", fontSize: 13, lineHeight: 1.5 }}>
        {t("cfgUi.settingsOfThisEditorThey")}
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.temaChiaroScuro")}</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.systemFollowsTheBrowserPreferences")}</div>
        </div>
        <ThemeToggle />
      </div>
      <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.linguaInterfaccia")}</div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.languageOfTheEditorS")}</div>
        </div>
        <UiLangSelect />
      </div>
      <DisposizioneSection />
      <MisuraIconeSection />
      <SezioneScorciatoie />
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        {t("cfgUi.notaPreferenze")}
      </div>
    </div>
  );
}
