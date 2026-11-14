import { useTranslation } from "react-i18next";
import { SezioneScorciatoie } from "@/scorciatoie/SezioneScorciatoie";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UiLangSelect } from "@/components/UiLangSelect";
import { DISPOSIZIONI_IDE, MISURE_ICONE, useAppStore, type DisposizioneIde } from "@/store";
import { IconaStrumento } from "@/editor/IconaStrumento";
import { DEFAULT_SOBER, IDE_STYLES, resolveMode, soberContrasts, type IdeStyle, type SoberColors } from "@/theme";

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
 *  quattro gradini bastano per adattarle al monitor — richiesta del maintainer.
 *  Dal 05-11-2026 la seguono anche le due barre dello stile VS Code. */
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

/** The IDE style (14-11-2026, plan docs/plans/2026-11-14-stile-sobrio.md):
 *  colourful as always, or sober. With the sober one, the three colours of the
 *  variant on screen, each contrast next to them, and the way back to the
 *  defaults. */
function IdeStyleSection() {
  const { t } = useTranslation();
  const style = useAppStore((s) => s.ideStyle);
  const setStyle = useAppStore((s) => s.setIdeStyle);
  const colors = useAppStore((s) => s.soberColors);
  const setColors = useAppStore((s) => s.setSoberColors);
  const themeMode = useAppStore((s) => s.themeMode);
  const variant = resolveMode(themeMode);
  const current = colors[variant];
  const labels: Record<IdeStyle, [string, string]> = {
    colorful: [t("cfgUi.styleColorful"), t("cfgUi.styleColorfulNote")],
    sober: [t("cfgUi.styleSober"), t("cfgUi.styleSoberNote")],
  };
  const change = (field: keyof SoberColors, value: string) =>
    setColors({ ...colors, [variant]: { ...current, [field]: value } });
  const c = soberContrasts(current, variant);
  const ratio = (label: string, value: number, min: number, testid: string) => (
    <span data-testid={testid} style={{ whiteSpace: "nowrap" }}>
      {label}{" "}
      <b style={{ color: value >= min ? "var(--brand-success-soft, #86efac)" : "var(--brand-danger-soft, #fca5a5)" }}>
        {value.toFixed(1)}:1
      </b>
    </span>
  );
  return (
    <div style={{ background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface, #1e293b)", borderRadius: 6, padding: "10px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>{t("cfgUi.ideStyle")}</div>
        <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 2 }}>{t("cfgUi.ideStyleNote")}</div>
      </div>
      <div role="radiogroup" aria-label={t("cfgUi.ideStyle")} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {IDE_STYLES.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={style === d} data-testid={`ide-style-${d}`}
            onClick={() => setStyle(d)}
            style={{
              textAlign: "left", padding: "6px 10px", borderRadius: 4, cursor: "pointer",
              background: style === d ? "var(--brand-surface-2, #334155)" : "transparent",
              border: `1px solid ${style === d ? "var(--brand-primary, #3b82f6)" : "var(--brand-surface-2, #334155)"}`,
              color: "var(--brand-text, #e2e8f0)",
            }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{labels[d][0]}</div>
            <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", marginTop: 1 }}>{labels[d][1]}</div>
          </button>
        ))}
      </div>
      {style === "sober" && (
        <div data-testid="sober-colors" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)" }}>
            {t(variant === "dark" ? "cfgUi.soberColorsDark" : "cfgUi.soberColorsLight")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px" }}>
            {(["background", "ink", "accent", "icons"] as const).map((f) => (
              <label key={f} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--brand-text-2, #cbd5e1)" }}>
                <input type="color" value={current[f]} data-testid={`sober-${f}`}
                  onChange={(e) => change(f, e.target.value)}
                  style={{ width: 32, height: 22, padding: 0, border: "1px solid var(--brand-border, #475569)", borderRadius: 4, background: "none" }} />
                {t(`cfgUi.sober_${f}`)}
              </label>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 14px", fontSize: 11, color: "var(--brand-text-muted, #94a3b8)" }}>
            {ratio(t("cfgUi.contrastText"), c.text, 4.5, "contrast-text")}
            {ratio(t("cfgUi.contrastMuted"), c.muted, 4.5, "contrast-muted")}
            {ratio(t("cfgUi.contrastAccent"), c.accent, 3, "contrast-accent")}
            {ratio(t("cfgUi.contrastOnAccent"), c.onAccent, 4.5, "contrast-on-accent")}
            {ratio(t("cfgUi.contrastIcons"), c.icons, 3, "contrast-icons")}
          </div>
          <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>{t("cfgUi.soberHelp")}</div>
          <div>
            <button type="button" data-testid="sober-reset" onClick={() => setColors({ ...colors, [variant]: DEFAULT_SOBER[variant] })}
              style={{ background: "var(--brand-surface-2, #334155)", color: "var(--brand-text, #e2e8f0)", border: "1px solid var(--brand-border, #475569)", borderRadius: 4, padding: "4px 10px", fontSize: 12, cursor: "pointer" }}>
              {t("cfgUi.soberReset")}
            </button>
          </div>
        </div>
      )}
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
      <IdeStyleSection />
      <DisposizioneSection />
      <MisuraIconeSection />
      <SezioneScorciatoie />
      <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)", lineHeight: 1.5 }}>
        {t("cfgUi.notaPreferenze")}
      </div>
    </div>
  );
}
