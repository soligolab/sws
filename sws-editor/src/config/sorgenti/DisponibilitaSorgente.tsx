/** La riga «Disponibilità» sotto la card di una sorgente (28-10-2026, ramo 2
 *  del piano `docs/plans/2026-10-28-chi-sta-dall-altra-parte.md`).
 *
 *  Dice in che tag il runtime scrive se la sorgente ha qualcuno dall'altra
 *  parte, com'è adesso, e prepara l'allarme che lo sorveglia. L'allarme non
 *  nasce da solo (decisione 3 del piano): il pulsante lo prepara nella scheda
 *  Allarmi, e lo si salva come ogni altro — con le sue notifiche. */
import { useTranslation } from "react-i18next";
import type { SourceDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { allarmeDisponibilita, tagDefDisponibilita, tagDisponibilita } from "@/config/sorgenti/disponibilita";

const NESSUNO: never[] = [];

export function DisponibilitaSorgente({ src }: { src: SourceDef }) {
  const { t } = useTranslation();
  const tag = tagDisponibilita(src.id);
  const valore = useAppStore((s) => s.tagValues[tag]);
  const allarmi = useAppStore((s) => s.project?.alarms ?? NESSUNO);
  const aggiungiTagInAttesa = useAppStore((s) => s.aggiungiTagInAttesa);
  const preparaAllarme = useAppStore((s) => s.preparaAllarme);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const esistente = allarmi.find((a) => a.tag.trim() === tag);
  const adesso = valore?.value === true ? "si" : valore?.value === false ? "no" : null;

  return (
    <div data-testid={`disponibilita-${src.id}`}
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "-6px 0 14px", padding: "6px 12px",
        fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", borderLeft: "2px solid var(--brand-surface-2, #334155)" }}>
      <span>{t("sorgenti.disponibilita.riga")}</span>
      <code style={{ fontSize: 11 }}>{tag}</code>
      {adesso && (
        <span data-testid={`disponibilita-adesso-${src.id}`}
          style={{ color: adesso === "si" ? "var(--brand-success, #22c55e)" : "var(--brand-danger, #ef4444)" }}>
          {t(`sorgenti.disponibilita.adesso_${adesso}`)}
        </span>
      )}
      {esistente ? (
        <button style={S.btnXs} onClick={() => navigateToConfig("alarms", esistente.id)}>
          {t("sorgenti.disponibilita.vaiAllarme")}
        </button>
      ) : (
        <button style={S.btnXs} data-testid={`disponibilita-crea-${src.id}`}
          onClick={() => {
            aggiungiTagInAttesa(tagDefDisponibilita(src.id, t("sorgenti.disponibilita.descrizioneTag", { id: src.id })));
            preparaAllarme(allarmeDisponibilita(src.id, t("sorgenti.disponibilita.messaggio", { id: src.id })));
          }}>
          {t("sorgenti.disponibilita.creaAllarme")}
        </button>
      )}
    </div>
  );
}
