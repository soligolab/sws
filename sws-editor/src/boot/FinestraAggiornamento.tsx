import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoAggiornamento, type VistaFinestra, type RichiestaFinestra } from "@/api/client";

/** La finestra dell'aggiornamento (piano 2026-09-27, Fase 2, decisioni 46-51).
 *
 *  - **Approvazione una tantum**: questa versione, quel giorno a quell'ora. Se
 *    prima della finestra nel canale esce una versione più nuova, il pannello non
 *    aggiorna e annulla: podman installerebbe quella, che nessuno ha letto.
 *  - **Pilota automatico**: a ogni finestra installa ciò che c'è di nuovo.
 *
 *  Tutte le ore sono **del pannello**. Il 28-09 il maintainer ha scelto «21:41»
 *  intendendo la sua ora mentre il pannello era in UTC (19:40): da allora i campi
 *  partono dall'orologio del pannello e dicono accanto di che fuso sono, e si
 *  riprogramma con «Modifica» invece di annullare e rifare (richieste 49-50). */

/** «2026-09-28 19:40» (orologio del pannello) → un'ora suggerita qualche minuto
 *  avanti, arrotondata ai 5, e se passa la mezzanotte il giorno diventa domani. */
export function oraSuggerita(locale: string, minutiAvanti = 10): { ora: string; giorno: "oggi" | "domani" } {
  const m = /(\d{2}):(\d{2})\s*$/.exec(locale);
  if (!m) return { ora: "03:00", giorno: "domani" };
  let tot = Number(m[1]) * 60 + Number(m[2]) + minutiAvanti;
  tot = Math.ceil(tot / 5) * 5;
  const giorno = tot >= 24 * 60 ? "domani" : "oggi";
  tot %= 24 * 60;
  const hh = String(Math.floor(tot / 60)).padStart(2, "0");
  const mm = String(tot % 60).padStart(2, "0");
  return { ora: `${hh}:${mm}`, giorno };
}

/** Il giorno della settimana (0 = domenica) di «2026-09-28 19:40». */
export function giornoDellaSettimana(locale: string): number {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(locale);
  if (!d) return 0;
  return new Date(Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3]))).getUTCDay();
}

const SETTIMANA = [1, 2, 3, 4, 5, 6, 0]; // da lunedì, come la si legge

export function FinestraAggiornamento({ stato, conferma }: {
  stato: StatoAggiornamento;
  /** Le conferme di «Aggiorna ora», compresa quella per gli avvisi di compatibilità. */
  conferma: () => boolean;
}) {
  const { t } = useTranslation();
  const [vista, setVista] = useState<VistaFinestra | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  // Modulo dell'approvazione (nuova o in modifica).
  const [apriApprovazione, setApriApprovazione] = useState(false);
  const [giorno, setGiorno] = useState<string>("oggi");
  const [ora, setOra] = useState("03:00");
  // Modulo del pilota (nuovo o in modifica).
  const [apriPilota, setApriPilota] = useState(false);
  const [pilotaGiorni, setPilotaGiorni] = useState<number[]>([]);
  const [pilotaOra, setPilotaOra] = useState("03:00");

  useEffect(() => {
    let vivo = true;
    api.remoteFinestra().then((v) => { if (vivo) setVista(v); }).catch((e) => { if (vivo) setErrore(String(e instanceof Error ? e.message : e)); });
    return () => { vivo = false; };
  }, []);

  if (errore && !vista) return <div style={{ fontSize: 12, marginTop: 8, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>;
  if (!vista) return null;
  const p = vista.programma;
  const fuso = `UTC${vista.orologio.scostamento}`;

  const scrivi = async (r: RichiestaFinestra) => {
    setErrore(null);
    try {
      setVista(await api.remoteScriviFinestra(r));
      setApriApprovazione(false);
      setApriPilota(false);
    } catch (e) { setErrore(e instanceof Error ? e.message : String(e)); }
  };
  // Lo stato completo: ciò che non si tocca si rimanda com'è.
  const base = (): RichiestaFinestra => ({ approvazione: p.approvazione ?? null, pilota: p.pilota ?? null });

  const apriModuloApprovazione = () => {
    if (vista.approvazione_alle) {
      // Modifica: si parte dall'ora già programmata.
      const g = giornoDellaSettimana(vista.approvazione_alle.locale);
      setGiorno(String(g));
      setOra(vista.approvazione_alle.locale.slice(11, 16));
    } else {
      const s = oraSuggerita(vista.orologio.locale);
      setGiorno(s.giorno);
      setOra(s.ora);
    }
    setApriApprovazione(true);
  };
  const apriModuloPilota = () => {
    if (p.pilota) {
      setPilotaGiorni(p.pilota.giorni);
      setPilotaOra(p.pilota.ora);
    } else {
      setPilotaGiorni([giornoDellaSettimana(vista.orologio.locale)]);
      setPilotaOra(oraSuggerita(vista.orologio.locale).ora);
    }
    setApriPilota(true);
  };

  const versioneDaProgrammare = p.approvazione?.versione ?? stato.disponibile;
  const salvaApprovazione = () => {
    if (!versioneDaProgrammare) return;
    // Una modifica della stessa versione non richiede di rileggere le novità.
    if (!p.approvazione && !conferma()) return;
    const g = giorno === "oggi" || giorno === "domani" ? giorno : Number(giorno);
    void scrivi({ ...base(), approvazione: { versione: versioneDaProgrammare, giorno: g, ora } });
  };
  const salvaPilota = () => {
    if (!p.pilota && !window.confirm(t("finestra.pilotaConferma"))) return;
    void scrivi({ ...base(), pilota: { giorni: pilotaGiorni, ora: pilotaOra } });
  };

  const titolo = { fontSize: 11, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)", textTransform: "uppercase", letterSpacing: 0.5 } as const;
  const piccolo = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" } as const;
  const riga = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 } as const;
  const campoOra = (valore: string, cambia: (v: string) => void) => (
    <label style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <input type="time" value={valore} onChange={(e) => cambia(e.target.value)} />
      <span style={piccolo}>{t("finestra.oraDelPannello", { fuso })}</span>
    </label>
  );

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={piccolo}>
        🕒 {t("finestra.orologio", { locale: vista.orologio.locale, scostamento: vista.orologio.scostamento, utc: vista.orologio.utc })}
        {vista.orologio.scostamento === "+00:00" && <> — {t("finestra.pannelloInUtc")}</>}
      </div>

      {/* Aggiornamento programmato (una tantum). */}
      {(p.approvazione || stato.disponibile) && (
        <div>
          <div style={titolo}>{t("finestra.titoloProgrammato")}</div>
          {p.approvazione && vista.approvazione_alle && !apriApprovazione && (
            <div style={riga}>
              <span>{t("finestra.programmata", {
                versione: p.approvazione.versione,
                locale: vista.approvazione_alle.locale, utc: vista.approvazione_alle.utc,
              })}</span>
              <button type="button" onClick={apriModuloApprovazione}>{t("finestra.modifica")}</button>
              <button type="button" onClick={() => void scrivi({ ...base(), approvazione: null })}>{t("finestra.annulla")}</button>
            </div>
          )}
          {!p.approvazione && !apriApprovazione && stato.disponibile && (
            <div style={riga}>
              <span>{t("finestra.programmaLa", { a: stato.disponibile })}</span>
              <button type="button" onClick={apriModuloApprovazione}>{t("finestra.programma")}</button>
            </div>
          )}
          {apriApprovazione && versioneDaProgrammare && (
            <div style={riga}>
              <span>{t("finestra.installaLa", { a: versioneDaProgrammare })}</span>
              <select value={giorno} onChange={(e) => setGiorno(e.target.value)}>
                <option value="oggi">{t("finestra.oggi")}</option>
                <option value="domani">{t("finestra.domani")}</option>
                {SETTIMANA.map((g) => <option key={g} value={String(g)}>{t(`finestra.giorni.${g}`)}</option>)}
              </select>
              {campoOra(ora, setOra)}
              <button type="button" onClick={salvaApprovazione}>{t("finestra.salva")}</button>
              <button type="button" onClick={() => setApriApprovazione(false)}>{t("finestra.chiudi")}</button>
            </div>
          )}
        </div>
      )}

      {/* Pilota automatico. */}
      <div>
        <div style={titolo}>{t("finestra.titoloPilota")}</div>
        {!apriPilota && (
          <div style={riga}>
            {p.pilota ? (
              <>
                <span>{t("finestra.pilotaAcceso", {
                  giorni: p.pilota.giorni.length === 0 ? t("finestra.ogniGiorno") : p.pilota.giorni.map((g) => t(`finestra.giorni.${g}`)).join(", "),
                  ora: p.pilota.ora, fuso,
                  prossimo: vista.pilota_alle ? `${vista.pilota_alle.locale} (${vista.pilota_alle.utc} UTC)` : "—",
                })}</span>
                <button type="button" onClick={apriModuloPilota}>{t("finestra.modifica")}</button>
                <button type="button" onClick={() => void scrivi({ ...base(), pilota: null })}>{t("finestra.pilotaSpegni")}</button>
              </>
            ) : (
              <>
                <span style={piccolo}>{t("finestra.pilotaSpento")}</span>
                <button type="button" onClick={apriModuloPilota}>{t("finestra.pilotaAccendi")}</button>
              </>
            )}
          </div>
        )}
        {apriPilota && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={riga}>
              {SETTIMANA.map((g) => (
                <label key={g} style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>
                  <input type="checkbox" checked={pilotaGiorni.includes(g)}
                    onChange={(e) => setPilotaGiorni(e.target.checked ? [...pilotaGiorni, g] : pilotaGiorni.filter((x) => x !== g))} />
                  {t(`finestra.giorniBrevi.${g}`)}
                </label>
              ))}
              <span style={piccolo}>{t("finestra.nessunGiornoOgni")}</span>
            </div>
            <div style={riga}>
              {campoOra(pilotaOra, setPilotaOra)}
              <button type="button" onClick={salvaPilota}>{t("finestra.salva")}</button>
              <button type="button" onClick={() => setApriPilota(false)}>{t("finestra.chiudi")}</button>
            </div>
          </div>
        )}
      </div>

      {errore && <div style={{ fontSize: 12, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>}
      {p.ultimo_esito && <div style={piccolo}>{t("finestra.ultimo", { esito: p.ultimo_esito })}</div>}
    </div>
  );
}
