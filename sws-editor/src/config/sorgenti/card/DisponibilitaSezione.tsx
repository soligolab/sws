import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { SourceDef } from "@/types";
import { S } from "@/config/comuni";
import { useAppStore } from "@/store";
import { allarmeDisponibilita, tagDefDisponibilita, tagDisponibilita } from "@/config/sorgenti/disponibilita";
import { useStatoSorgenti } from "@/config/sorgenti/statoSorgenti";
import { PastigliaStato } from "@/config/sorgenti/card/PastigliaStato";
import { SezioneSorgente } from "@/config/sorgenti/card/SezioneSorgente";

const NESSUNO: never[] = [];

/** La sezione DISPONIBILITÀ di una card di Protocolli (29-10-2026, piano
 *  `docs/plans/2026-10-29-card-delle-sorgenti.md`).
 *
 *  Era una riga **sotto** la card, fuori dal suo bordo e dopo la tabella dei
 *  topic: con ventiquattro topic, il pulsante dell'allarme stava a fine
 *  pagina. Osservazione del maintainer al primo collaudo: «troppo nascosto».
 *  Ora è una sezione della card, prima della mappatura, con lo stato nel
 *  titolo.
 *
 *  I `children` sono i campi che dicono **chi** racconta la disponibilità —
 *  ce li ha solo MQTT (topic, campo, valore «vivo»). Per gli altri protocolli
 *  la disponibilità è il collegamento col dispositivo, e la sezione lo dice
 *  in una riga.
 *
 *  Il pulsante fa esattamente quello che faceva (ramo 2 del piano «chi sta
 *  dall'altra parte»): dichiara il tag in attesa e prepara l'allarme nella
 *  **bozza** della scheda Allarmi, senza scriverlo nel progetto da fuori. */
export function DisponibilitaSezione({ src, children }: { src: SourceDef; children?: ReactNode }) {
  const { t } = useTranslation();
  const tag = tagDisponibilita(src.id);
  const stato = useStatoSorgenti()[src.id];
  const allarmi = useAppStore((s) => s.project?.alarms ?? NESSUNO);
  const aggiungiTagInAttesa = useAppStore((s) => s.aggiungiTagInAttesa);
  const preparaAllarme = useAppStore((s) => s.preparaAllarme);
  const navigateToConfig = useAppStore((s) => s.navigateToConfig);
  const esistente = allarmi.find((a) => a.tag.trim() === tag);
  const motivo = stato?.stato === "non_risponde" ? stato.errore : undefined;

  return (
    <SezioneSorgente
      titolo={t("sorgenti.disponibilita.titolo")}
      destra={<PastigliaStato id={src.id} testid={`disponibilita-adesso-${src.id}`} />}
      testid={`disponibilita-${src.id}`}
    >
      {children}
      <div style={{
        display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        background: "var(--brand-bg, #0f172a)", border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 6, padding: "8px 10px", marginBottom: 4,
      }}>
        {!children && (
          <span style={{ fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)" }}>
            {t("sorgenti.disponibilita.daCollegamento")}
          </span>
        )}
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #94a3b8)" }}>{t("sorgenti.disponibilita.tag")}</span>
        <code style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{tag}</code>
        {/* Il motivo, quando non risponde: «"zigbee2mqtt/bridge/state" dice
            offline» dice cosa guardare, «non risponde» no. */}
        <span style={{ flex: 1, fontSize: 12, color: "var(--brand-text-subtle, #94a3b8)", minWidth: 0 }}>{motivo}</span>
        {esistente ? (
          <button style={S.btn("ghost")} onClick={() => navigateToConfig("alarms", esistente.id)}>
            {t("sorgenti.disponibilita.vaiAllarme")}
          </button>
        ) : (
          <button style={{ ...S.btn("primary"), fontWeight: 600 }} data-testid={`disponibilita-crea-${src.id}`}
            onClick={() => {
              aggiungiTagInAttesa(tagDefDisponibilita(src.id, t("sorgenti.disponibilita.descrizioneTag", { id: src.id })));
              preparaAllarme(allarmeDisponibilita(src.id, t("sorgenti.disponibilita.messaggio", { id: src.id })));
            }}>
            ⚠ {t("sorgenti.disponibilita.creaAllarme")}
          </button>
        )}
      </div>
    </SezioneSorgente>
  );
}
