import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type StatoAggiornamento, type VistaFinestra, type RichiestaFinestra } from "@/api/client";

/** La finestra dell'aggiornamento (piano 2026-09-27, Fase 2, decisioni 46-48).
 *
 *  - **Approvazione una tantum**: questa versione, quel giorno a quell'ora. Se
 *    prima della finestra nel canale esce una versione più nuova, il pannello non
 *    aggiorna e annulla: podman installerebbe quella, che nessuno ha letto.
 *  - **Pilota automatico**: a ogni finestra installa ciò che c'è di nuovo.
 *
 *  L'ora è quella del pannello, e l'orologio del pannello si vede **in locale e in
 *  UTC** (decisione 47): chi programma da un altro fuso non può confondersi. */
export function FinestraAggiornamento({ stato, conferma }: {
  stato: StatoAggiornamento;
  /** Le conferme di «Aggiorna ora», compresa quella per gli avvisi di compatibilità. */
  conferma: () => boolean;
}) {
  const { t } = useTranslation();
  const [vista, setVista] = useState<VistaFinestra | null>(null);
  const [errore, setErrore] = useState<string | null>(null);
  const [giorno, setGiorno] = useState<string>("0");
  const [ora, setOra] = useState("03:00");
  const [pilotaGiorno, setPilotaGiorno] = useState<string>("0");
  const [pilotaOra, setPilotaOra] = useState("03:00");

  useEffect(() => {
    let vivo = true;
    api.remoteFinestra().then((v) => { if (vivo) setVista(v); }).catch((e) => { if (vivo) setErrore(String(e instanceof Error ? e.message : e)); });
    return () => { vivo = false; };
  }, []);

  if (errore) return <div style={{ fontSize: 12, marginTop: 8, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>;
  if (!vista) return null;
  const p = vista.programma;

  const scrivi = async (r: RichiestaFinestra) => {
    setErrore(null);
    try { setVista(await api.remoteScriviFinestra(r)); }
    catch (e) { setErrore(e instanceof Error ? e.message : String(e)); }
  };
  // Lo stato completo: ciò che non si tocca si rimanda com'è.
  const base = (): RichiestaFinestra => ({ approvazione: p.approvazione ?? null, pilota: p.pilota ?? null });
  const giornoValore = (g: string) => (g === "oggi" || g === "domani" ? g : Number(g));

  const programma = () => {
    if (!stato.disponibile || !conferma()) return;
    void scrivi({ ...base(), approvazione: { versione: stato.disponibile, giorno: giornoValore(giorno), ora } });
  };

  const giorni = (
    <>
      {[0, 1, 2, 3, 4, 5, 6].map((g) => <option key={g} value={String(g)}>{t(`finestra.giorni.${g}`)}</option>)}
    </>
  );
  const piccolo = { fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" } as const;

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={piccolo}>
        {t("finestra.orologio", { locale: vista.orologio.locale, scostamento: vista.orologio.scostamento, utc: vista.orologio.utc })}
      </div>

      {p.approvazione && vista.approvazione_alle ? (
        <div style={{ fontSize: 12 }}>
          {t("finestra.programmata", {
            versione: p.approvazione.versione,
            locale: vista.approvazione_alle.locale, utc: vista.approvazione_alle.utc,
          })}{" "}
          <button type="button" onClick={() => void scrivi({ ...base(), approvazione: null })}>{t("finestra.annulla")}</button>
        </div>
      ) : stato.disponibile && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", fontSize: 12 }}>
          <span>{t("finestra.programmaLa", { a: stato.disponibile })}</span>
          <select value={giorno} onChange={(e) => setGiorno(e.target.value)}>
            <option value="oggi">{t("finestra.oggi")}</option>
            <option value="domani">{t("finestra.domani")}</option>
            {giorni}
          </select>
          <input type="time" value={ora} onChange={(e) => setOra(e.target.value)} />
          <button type="button" onClick={programma}>{t("finestra.programma")}</button>
        </div>
      )}

      <div style={{ fontSize: 12, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {p.pilota ? (
          <>
            <span>{t("finestra.pilotaAcceso", {
              giorni: p.pilota.giorni.length === 0 ? t("finestra.ogniGiorno") : p.pilota.giorni.map((g) => t(`finestra.giorni.${g}`)).join(", "),
              ora: p.pilota.ora,
              prossimo: vista.pilota_alle ? `${vista.pilota_alle.locale} (${vista.pilota_alle.utc} UTC)` : "—",
            })}</span>
            <button type="button" onClick={() => void scrivi({ ...base(), pilota: null })}>{t("finestra.pilotaSpegni")}</button>
          </>
        ) : (
          <>
            <span>{t("finestra.pilota")}</span>
            <select value={pilotaGiorno} onChange={(e) => setPilotaGiorno(e.target.value)}>
              <option value="ogni">{t("finestra.ogniGiorno")}</option>
              {giorni}
            </select>
            <input type="time" value={pilotaOra} onChange={(e) => setPilotaOra(e.target.value)} />
            <button type="button" onClick={() => {
              if (!window.confirm(t("finestra.pilotaConferma"))) return;
              void scrivi({ ...base(), pilota: { giorni: pilotaGiorno === "ogni" ? [] : [Number(pilotaGiorno)], ora: pilotaOra } });
            }}>{t("finestra.pilotaAccendi")}</button>
          </>
        )}
      </div>

      {p.ultimo_esito && <div style={piccolo}>{t("finestra.ultimo", { esito: p.ultimo_esito })}</div>}
    </div>
  );
}
