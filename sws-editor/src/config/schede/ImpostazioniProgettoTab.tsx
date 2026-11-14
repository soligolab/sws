// Configurazione → Progetto → Impostazioni (piano dell'impostazione iniziale,
// sessione I2, 08-11-2026): il secondo ingresso alla finestra «Impostazioni
// progetto», dopo la riga di riepilogo nel pannello della pagina. Qui non si
// scrive niente: la scheda dice cosa vale per tutte le pagine e apre la
// finestra, che resta l'unico posto che lo cambia (regola UI n. 2).

import { useTranslation } from "react-i18next";
import { useAppStore } from "@/store";
import { useNomePagina } from "@/i18n/nomePagina";
import { eCornice, idCornice } from "@/cornici/modello";
import type { IdScheda } from "@/config/schede";

export function ImpostazioniProgettoTab(_: { scheda: IdScheda }) {
  const { t } = useTranslation();
  const nomePagina = useNomePagina();
  const project = useAppStore((s) => s.project);
  const pages = useAppStore((s) => s.pages);
  const admin = useAppStore((s) => s.authRole === "Admin");
  const l = project?.page_layout;
  const motore = project?.target?.kind ?? "web";
  const misura = l?.default_width && l?.default_height ? `${l.default_width}×${l.default_height}` : t("shell.notSet");
  const cornice = l?.cornice_predefinita ? pages.find((p) => eCornice(p) && idCornice(p) === l.cornice_predefinita) : undefined;
  const home = l?.home_page_id ? pages.find((p) => p.id === l.home_page_id) : undefined;
  const righe: [string, string][] = [
    [t("props.targetKind"), t(motore === "web" ? "props.targetWeb" : motore === "lvgl_wayland" ? "props.targetLvglWayland" : "props.targetLvglFramebuffer")],
    [t("shell.projectFormat"), l?.dispositivo ? `${l.dispositivo} · ${misura}` : misura],
    [t("props.backgroundLight"), l?.default_background ?? t("shell.notSet")],
    [t("props.backgroundDark"), l?.default_background_dark ?? t("shell.notSet")],
    [t("cornici.campoTitolo"), cornice ? nomePagina(cornice.name) : t("cornici.nessunaPredefinita")],
    [t("shell.sizingMode"), t(l?.size_mode === "ratio" ? "shell.sizingRatio" : l?.size_mode === "fluid" ? "shell.sizingFluid" : "shell.sizingFixed")],
    [t("shell.homePage"), home ? nomePagina(home.name) : t("shell.firstPageInTheList")],
  ];
  return (
    <div data-testid="scheda-impostazioni-progetto" style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: "var(--brand-text-2, #cbd5e1)", margin: 0 }}>{t("impostazioniTab.testo")}</p>
      <dl style={{ display: "grid", gridTemplateColumns: "max-content 1fr", gap: "6px 16px", margin: 0, fontSize: 13 }}>
        {righe.map(([k, v]) => (
          <div key={k} style={{ display: "contents" }}>
            <dt style={{ color: "var(--brand-text-muted, #94a3b8)" }}>{k}</dt>
            <dd style={{ margin: 0, color: "var(--brand-text, #e2e8f0)" }}>{v}</dd>
          </div>
        ))}
      </dl>
      <div>
        <button type="button" data-testid="scheda-apri-impostazioni" disabled={!admin}
          onClick={() => { void import("@/editor/EditorShell").then((m) => m.apriImpostazioniProgetto(t("shell.projectSettingsTitle"))); }}
          style={{ background: "var(--brand-primary, #3b82f6)", color: "var(--brand-on-primary, #fff)", border: "none", borderRadius: 5,
            padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: admin ? "pointer" : "default", opacity: admin ? 1 : 0.6 }}>
          {t("shell.apriImpostazioniProgetto")}
        </button>
        {!admin && <div style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)", marginTop: 4 }}>{t("shell.soloAdminProgetto")}</div>}
      </div>
    </div>
  );
}
