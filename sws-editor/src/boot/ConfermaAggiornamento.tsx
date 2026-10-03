import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, type SceltaConferma, type StatoConferma } from "@/api/client";

const mb = (b: number) => Math.round(b / 1_000_000);

/** Dopo un aggiornamento del pannello collegato (03-10-2026): confermarlo
 *  (togliendo le immagini vecchie e l'istantanea dei dati), rimandare la
 *  conferma al prossimo riavvio, chiederlo più tardi, o tornare alla versione
 *  di prima — immagine e, se c'è l'istantanea, dati. La domanda la tiene il
 *  runtime; la stessa compare sullo schermo del pannello senza utenti. */
export function ConfermaAggiornamento() {
  const { t } = useTranslation();
  const [stato, setStato] = useState<StatoConferma | null | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);
  const [inviando, setInviando] = useState(false);

  useEffect(() => {
    let vivo = true;
    const leggi = () => api.remoteGetSystemStatus()
      .then((s) => { if (vivo) setStato(s.conferma_aggiornamento ?? null); })
      .catch(() => { if (vivo) setStato(null); });
    leggi();
    const id = window.setInterval(leggi, 15000);
    return () => { vivo = false; window.clearInterval(id); };
  }, []);

  if (stato === null) return null; // runtime vecchio o non un dispositivo: niente da dire
  const d = stato?.domanda ?? null;

  const rispondi = async (scelta: SceltaConferma) => {
    if (!d) return;
    if (scelta === "ritorna" && !window.confirm(t("confermaAggiornamento.confermaRitorno", {
      da: d.da, a: d.a,
      cosa: t(d.istantanea ? "confermaAggiornamento.cosaDati" : "confermaAggiornamento.cosaImmagine"),
    }))) return;
    setInviando(true);
    setErrore(null);
    try {
      await api.remoteConfermaAggiornamento(scelta);
      setStato((s) => s ? { ...s, domanda: null, in_corso: scelta === "pulisci" || scelta === "ritorna" ? scelta : s.in_corso, pulizia_al_prossimo_avvio: scelta === "dopo_riavvio" || s.pulizia_al_prossimo_avvio } : s);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInviando(false);
    }
  };

  const sotto = { fontSize: 12, color: "var(--brand-text-subtle, #64748b)", marginTop: 4 } as const;
  const p = stato?.ultima_pulizia;
  const r = stato?.ultimo_ritorno;

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("confermaAggiornamento.titolo")}
      </div>
      {stato === undefined && <div style={sotto}>{t("confermaAggiornamento.carico")}</div>}
      {stato && !d && !stato.in_corso && !stato.pulizia_al_prossimo_avvio && <div style={sotto}>{t("confermaAggiornamento.nessuna")}</div>}
      {stato?.in_corso && (
        <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>{t(`confermaAggiornamento.inCorso.${stato.in_corso}`)}</div>
      )}
      {stato?.pulizia_al_prossimo_avvio && <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>{t("confermaAggiornamento.prenotata")}</div>}
      {d && (
        <>
          <div style={{ fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>{t("confermaAggiornamento.domanda", { da: d.da, a: d.a })}</div>
          <div style={sotto}>{t(d.istantanea ? "confermaAggiornamento.conDati" : "confermaAggiornamento.senzaDati")}</div>
          {d.recuperabili_byte > 0 && <div style={sotto}>{t("confermaAggiornamento.recuperabili", { mb: mb(d.recuperabili_byte) })}</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" disabled={inviando} onClick={() => void rispondi("pulisci")}>{t("confermaAggiornamento.pulisci")}</button>
            <button type="button" disabled={inviando} onClick={() => void rispondi("dopo_riavvio")}>{t("confermaAggiornamento.dopoRiavvio")}</button>
            <button type="button" disabled={inviando} onClick={() => void rispondi("piu_tardi")}>{t("confermaAggiornamento.piuTardi")}</button>
            <button type="button" disabled={inviando} onClick={() => void rispondi("ritorna")}
              style={{ color: "var(--brand-danger-soft, #fca5a5)" }}>
              {t("confermaAggiornamento.ritorna", { da: d.da })}
            </button>
          </div>
        </>
      )}
      {errore && <div style={{ ...sotto, color: "var(--brand-danger, #ef4444)" }}>{errore}</div>}
      {p && <div style={sotto}>{t("confermaAggiornamento.ultimaPulizia", { n: p.tolte.length, mb: mb(p.liberati_byte) })}</div>}
      {r && (
        <div style={{ ...sotto, color: r.esito === "riuscito" ? sotto.color : "var(--brand-danger, #ef4444)" }}>
          {r.esito === "riuscito"
            ? t("confermaAggiornamento.ultimoRitorno", {
              v: r.scartata,
              dati: t(r.dati ? "confermaAggiornamento.ritornoDati" : "confermaAggiornamento.ritornoSoloImmagine"),
            })
            : t("confermaAggiornamento.ritornoFallito", { motivo: r.motivo ?? "?" })}
        </div>
      )}
    </section>
  );
}
