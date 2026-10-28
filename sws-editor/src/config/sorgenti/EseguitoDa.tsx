/** Chi esegue una scoperta: questa macchina, o il pannello collegato.
 *
 *  Nasce il 28-10-2026 da un'ora persa. Il maintainer aveva aperto il progetto
 *  `CasaDomotica_WP630` **restando collegato al pannello di casa**, e ha chiesto
 *  allo «Sfoglia broker» di guardare un broker che sta in ufficio: la ricerca è
 *  partita dal TC620, che quell'indirizzo non lo vede, e ha risposto «0 topic».
 *  Tutto corretto, e completamente illeggibile — la finestra diceva **dove**
 *  cercare e mai **chi** cercava.
 *
 *  Le scoperte le fa il pannello (piano
 *  `docs/archive/2026-10-25-impianto-dal-dispositivo.md`), quindi il nome del
 *  pannello è metà della risposta: va scritto dove si legge il risultato. */
import { useTranslation } from "react-i18next";
import { usaPannelloCollegato } from "@/pannelloCollegato";

/** Il nome del pannello collegato, o `null` se le scoperte le fa l'IDE. */
export const usaChiEsegue = usaPannelloCollegato;

/** La riga «eseguito da …», da mettere accanto al titolo di una scoperta. */
export function EseguitoDa() {
  const { t } = useTranslation();
  const chi = usaChiEsegue();
  return (
    <span
      style={{ fontSize: 12, fontWeight: 400, color: "var(--brand-text-subtle, #64748b)", marginLeft: 8 }}
      title={t(chi ? "impianto.eseguitoDaSpiega" : "impianto.eseguitoQuiSpiega")}
    >
      {chi ? t("impianto.eseguitoDa", { dispositivo: chi }) : t("impianto.eseguitoQui")}
    </span>
  );
}
