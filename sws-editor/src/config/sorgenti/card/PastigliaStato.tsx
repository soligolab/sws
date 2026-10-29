import { useTranslation } from "react-i18next";
import type { StatoCollegamento } from "@/types";
import { COLORI_STATO, coloreStato, useStatoSorgenti } from "@/config/sorgenti/statoSorgenti";

/** L'ora da cui una sorgente è in quello stato, scritta come la dice una
 *  persona: «14:09» se è oggi, «27/10 14:09» se no. Esportata per le prove. */
export function oraDello(daMs: number, adesso: number = Date.now(), lingua = "it-IT"): string {
  const d = new Date(daMs);
  const oggi = new Date(adesso);
  const ora = d.toLocaleTimeString(lingua, { hour: "2-digit", minute: "2-digit" });
  const stessoGiorno = d.getFullYear() === oggi.getFullYear() && d.getMonth() === oggi.getMonth() && d.getDate() === oggi.getDate();
  if (stessoGiorno) return ora;
  return `${d.toLocaleDateString(lingua, { day: "2-digit", month: "2-digit" })} ${ora}`;
}

/** Lo stato di una sorgente in una riga: il pallino e un testo breve
 *  (29-10-2026, piano `docs/plans/2026-10-29-card-delle-sorgenti.md`).
 *
 *  **Una fonte sola**: `stato_sorgenti`, la stessa del pallino dell'albero. Il
 *  tag `<sorgente>.disponibile` il runtime lo deriva proprio da lì
 *  (`source_supervisor.rs`, `disponibilita_da_scrivere`), quindi la testata,
 *  la sezione DISPONIBILITÀ e l'albero non possono dire tre cose diverse.
 *
 *  «Non risponde» porta **da quando**: l'osservazione da cui è nato tutto è un
 *  Zigbee2MQTT spento da trenta ore senza che niente lo dicesse, e «non
 *  risponde» senza ora non distingue trenta secondi da trenta ore. Il motivo
 *  preciso (`errore`: «"zigbee2mqtt/bridge/state" dice offline») sta nel
 *  suggerimento. */
export function PastigliaStato({
  id,
  stato: statoDato,
  testid,
}: {
  id: string;
  /** Uno stato già in mano (un dispositivo Modbus): altrimenti quello della sorgente. */
  stato?: StatoCollegamento;
  testid?: string;
}) {
  const { t, i18n } = useTranslation();
  const tutti = useStatoSorgenti();
  const stato = statoDato ?? tutti[id];
  const c = coloreStato(stato);
  const testo =
    c === "ok" ? t("sorgenti.stato.risponde")
    : c === "parziale" ? t("sorgenti.stato.parziale")
    : c === "errore" ? (stato?.da_ms ? t("sorgenti.stato.nonRispondeDalle", { ora: oraDello(stato.da_ms, Date.now(), i18n.language) }) : t("sorgenti.stato.nonRisponde"))
    : t("sorgenti.stato.nonAttiva");
  return (
    <span
      data-testid={testid ?? `stato-${id}`}
      data-stato={c}
      title={stato?.errore ? `${testo} — ${stato.errore}` : testo}
      style={{
        display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", fontSize: 12,
        color: c === "errore" ? "var(--brand-danger-soft, #fca5a5)" : "var(--brand-text-subtle, #94a3b8)",
        fontWeight: c === "errore" ? 600 : 400,
      }}
    >
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: COLORI_STATO[c], flexShrink: 0 }} />
      {testo}
    </span>
  );
}
