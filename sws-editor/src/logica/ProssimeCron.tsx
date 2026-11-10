// Sotto il campo del trigger cron: in che fuso si legge e quando partirà
// (10-11-2026). Fino alla 2.26.0-rc.11 il cron girava in UTC e l'IDE non lo
// diceva: «0 7 * * *» partiva alle 8 d'inverno e alle 9 d'estate. Ora gira
// nell'ora del pannello, e le prossime esecuzioni le calcola il runtime — lo
// stesso codice che poi le fa partire, non una copia in TypeScript.
//
// Con un dispositivo connesso la domanda va a lui (`/api/remote/cron/prossime`):
// è lì che lo script parte, e il fuso del PC di chi disegna non dice niente su
// quello del pannello. Senza, o con un runtime che la rotta non ce l'ha,
// risponde questa macchina, e se non è un pannello lo si dice.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type AnteprimaCron } from "@/api/client";
import { useAppStore } from "@/store";

/** Il tempo fra l'ultimo tasto e la domanda al runtime. */
export const ATTESA_MS = 350;

type Stato =
  | { tipo: "attesa" }
  | { tipo: "ok"; a: AnteprimaCron; remotoFallito: boolean }
  | { tipo: "errore"; messaggio: string };

/** Il testo di un 400: `request` lo mette dopo «— ». */
export function motivo(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const i = m.indexOf(" — ");
  return i >= 0 ? m.slice(i + 3) : m;
}

/** Un'espressione non valida dà 400 anche dal dispositivo: quella è la
 *  risposta, non un motivo per chiedere a questa macchina. */
const eRifiuto = (e: unknown) => e instanceof Error && / 400 /.test(e.message);

export function ProssimeCron({ espressione }: { espressione: string }) {
  const { t } = useTranslation();
  const remoteConnected = useAppStore((s) => s.remoteConnected);
  const [stato, setStato] = useState<Stato>({ tipo: "attesa" });

  useEffect(() => {
    let vivo = true;
    const timer = setTimeout(async () => {
      let remotoFallito = false;
      try {
        if (remoteConnected) {
          try {
            const a = await api.remoteCronProssime(espressione);
            if (vivo) setStato({ tipo: "ok", a, remotoFallito: false });
            return;
          } catch (e) {
            if (eRifiuto(e)) throw e;
            remotoFallito = true;
          }
        }
        const a = await api.cronProssime(espressione);
        if (vivo) setStato({ tipo: "ok", a, remotoFallito });
      } catch (e) {
        if (vivo) setStato({ tipo: "errore", messaggio: motivo(e) });
      }
    }, ATTESA_MS);
    return () => { vivo = false; clearTimeout(timer); };
  }, [espressione, remoteConnected]);

  if (stato.tipo === "attesa") return null;
  if (stato.tipo === "errore") {
    return (
      <div data-testid="cron-errore" style={{ ...TESTO, color: "var(--brand-danger-soft, #fca5a5)" }}>
        {stato.messaggio}
      </div>
    );
  }
  const { a, remotoFallito } = stato;
  const fuso = a.fuso ? `${a.fuso}, UTC${a.scostamento}` : `UTC${a.scostamento}`;
  return (
    <div data-testid="cron-prossime" style={TESTO}>
      <div data-testid="cron-fuso">
        {a.pannello ? t("logica.cronOraPannello", { fuso }) : t("logica.cronOraMacchina", { fuso })}
      </div>
      {remotoFallito && <div style={{ color: "var(--brand-warning-soft, #fbbf24)" }}>{t("logica.cronRemotoVecchio")}</div>}
      {a.prossime.length === 0
        ? <div>{t("logica.cronMai")}</div>
        : (
          <div>
            {t("logica.cronProssime")}{" "}
            {a.prossime.map((p, i) => (
              <span key={p.utc} data-testid="cron-prossima">
                {i > 0 && " · "}
                {p.locale.slice(5).replace(/^(\d\d)-(\d\d)/, "$2/$1")}
                {/* A cavallo del cambio d'ora lo scostamento non è quello di adesso. */}
                {p.scostamento !== a.scostamento && ` (UTC${p.scostamento})`}
              </span>
            ))}
          </div>
        )}
      {a.avvisi.map((v) => (
        <div key={v} style={{ color: "var(--brand-warning-soft, #fbbf24)" }}>{v}</div>
      ))}
    </div>
  );
}

const TESTO: React.CSSProperties = {
  fontSize: 11, color: "var(--brand-text-muted, #94a3b8)", marginTop: 4, lineHeight: 1.5,
};
