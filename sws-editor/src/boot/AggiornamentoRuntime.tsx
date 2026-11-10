import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, novitaNellaLingua, type NovitaVersione, type StatoAggiornamento } from "@/api/client";
import { FinestraAggiornamento } from "./FinestraAggiornamento";
import { useAppStore } from "@/store";
import { conferma } from "@/finestraAvviso/finestraAvviso";
// Le due frasi sull'esito le scrive il runtime e le mostrano tre posti (qui,
// il viewer web, il pannello LVGL): stanno nella tabella del testo di sistema,
// una volta sola. Qui però la lingua è quella dell'**IDE** — questa è una
// scheda di configurazione, non lo schermo di un impianto.
import { testoSistema, testoSistemaCon } from "@/i18n/testiSistema";

const RILEGGI_IN_CORSO_MS = 15_000;

/** Quanto a lungo un pannello che non risponde è «si sta riavviando» e non
 *  «errore». Un aggiornamento vero dura un minuto (WP630, 10-11-2026: fermo
 *  dalle 11:13:58 alle 11:14:56), con l'istantanea dei dati qualche minuto in
 *  più; oltre dieci è un guasto, e va detto come tale. */
const RIAVVIO_ATTESA_MS = 10 * 60_000;
const CHIAVE_PARTITO = "sws.ide.aggiornamento.partito";

/** L'IDE ricorda che l'aggiornamento è partito (10-11-2026). Il componente
 *  rinasce a ogni apertura della scheda e il pannello, mentre si riavvia, non
 *  risponde: senza memoria il gateway rispondeva «503: il pannello non è
 *  collegato» e la scheda lo mostrava in rosso — formalmente vero, ma il
 *  cliente lo legge come un guasto. Il segno sta in `localStorage`, legato
 *  all'indirizzo del pannello collegato, e vale `RIAVVIO_ATTESA_MS`. */
type Partito = { ts: number; url: string | null };
function segnaPartito(): void {
  const url = useAppStore.getState().remoteUrl;
  try { localStorage.setItem(CHIAVE_PARTITO, JSON.stringify({ ts: Date.now(), url } satisfies Partito)); } catch { /* storage negato */ }
}
function dimenticaPartito(): void {
  try { localStorage.removeItem(CHIAVE_PARTITO); } catch { /* storage negato */ }
}
function partitoDiRecente(): boolean {
  try {
    const grezzo = localStorage.getItem(CHIAVE_PARTITO);
    if (!grezzo) return false;
    const p = JSON.parse(grezzo) as Partito;
    const url = useAppStore.getState().remoteUrl;
    if (p.url !== url) return false;
    return Date.now() - p.ts < RIAVVIO_ATTESA_MS;
  } catch { return false; }
}

/** L'aggiornamento del runtime collegato (piano 2026-09-27, Fase 1): che
 *  versione gira, su quale canale, e se nel canale ce n'è una più nuova. «Aggiorna
 *  ora» lo chiede al dispositivo, che avvia `podman-auto-update` via bus utente:
 *  il runtime si riavvia e la connessione cade per qualche secondo. Se la versione
 *  nuova non diventa sana, podman torna da solo alla precedente. */
export function AggiornamentoRuntime() {
  const { t, i18n } = useTranslation();
  const nl = (n: NovitaVersione) => novitaNellaLingua(n, i18n.language);
  const [stato, setStato] = useState<StatoAggiornamento | null | undefined>(undefined);
  const [errore, setErrore] = useState<string | null>(null);
  const [avviato, setAvviato] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [esitoChiusoOra, setEsitoChiusoOra] = useState(false);
  // Il pannello non risponde, ma l'aggiornamento era partito da poco: si sta
  // riavviando. `tentativi` cresce a ogni lettura fallita e fa ripartire l'attesa.
  const [riavvio, setRiavvio] = useState(false);
  const [tentativi, setTentativi] = useState(0);

  const letturaFallita = (e: unknown) => {
    if (partitoDiRecente()) { setRiavvio(true); setErrore(null); setTentativi((n) => n + 1); return; }
    setRiavvio(false);
    setStato(null);
    setErrore(e instanceof Error ? e.message : String(e));
  };
  const letturaRiuscita = (s: StatoAggiornamento) => {
    // Visto partire da qui o da un'altra scheda: lo si ricorda per quando il
    // pannello sparirà. Tornato a rispondere dopo il riavvio: il segno ha finito.
    if (s.in_corso) segnaPartito();
    else if (riavvio) dimenticaPartito();
    setRiavvio(false);
    setStato(s);
    setErrore(null);
  };

  useEffect(() => {
    let vivo = true;
    api.remoteStatoAggiornamento()
      .then((s) => { if (vivo) letturaRiuscita(s); })
      .catch((e) => { if (vivo) letturaFallita(e); });
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montaggio
  }, []);

  // Con un aggiornamento già in corso, o col pannello che si riavvia, si rilegge
  // finché non arriva l'esito, come fa il viewer.
  const giaPartito = !!stato?.in_corso && !avviato;
  useEffect(() => {
    if (!giaPartito && !riavvio) return;
    let vivo = true;
    const id = window.setTimeout(() => {
      api.remoteStatoAggiornamento()
        .then((s) => { if (vivo) letturaRiuscita(s); })
        .catch((e) => { if (vivo) letturaFallita(e); });
    }, RILEGGI_IN_CORSO_MS);
    return () => { vivo = false; window.clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rilegge a ogni stato nuovo o tentativo fallito
  }, [giaPartito, riavvio, stato, tentativi]);

  // Le conferme valgono uguali per «Aggiorna ora» e per «Programma» (Fase 2).
  const confermaAggiornamento = async (): Promise<boolean> => {
    if (!stato?.disponibile) return false;
    if (!(await conferma({ testo: t("aggiornamento.conferma", { da: stato.versione, a: stato.disponibile }) }))) return false;
    // Con avvisi di compatibilità si chiede una conferma in più (decisione
    // 43): quegli avvisi dicono che dopo l'aggiornamento qualcosa va rifatto,
    // e una sola conferma la si dà per abitudine.
    const avvisi = (stato.novita ?? [])
      .filter((n) => nl(n).compatibilita)
      .map((n) => `${n.versione}: ${nl(n).compatibilita}`);
    return avvisi.length === 0
      || conferma({ testo: t("aggiornamento.confermaCompat", { avvisi: avvisi.join("\n\n") }), pericolo: true });
  };

  const aggiorna = async () => {
    if (!(await confermaAggiornamento())) return;
    setInCorso(true);
    try {
      await api.remoteAvviaAggiornamento();
      segnaPartito();
      setAvviato(true);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  const manuale = !errore && !avviato && !!stato
    && (stato.canale === "archivio" || stato.canale === "fissata" || stato.canale === "sconosciuto");
  if (errore) { riga = errore; tono = "var(--brand-danger, #ef4444)"; }
  // Il pannello non risponde perché si sta riavviando per l'aggiornamento
  // (10-11-2026): giallo, non rosso, e si continua a rileggere.
  else if (riavvio) { riga = t("aggiornamento.riavvioInCorso"); tono = "var(--brand-warning, #f59e0b)"; }
  else if (stato === undefined) riga = t("aggiornamento.carico");
  else if (stato === null) riga = t("aggiornamento.illeggibile");
  else if (avviato) { riga = t("aggiornamento.avviato", { a: stato.disponibile }); tono = "var(--brand-warning, #f59e0b)"; }
  // Già chiesto, da qui o da un'altra scheda: niente «disponibile» né pulsante,
  // che un secondo clic farebbe partire un'altra copia dei dati (10-11-2026).
  else if (giaPartito) { riga = t("aggiornamento.inCorsoSulPannello"); tono = "var(--brand-warning, #f59e0b)"; }
  else {
    const canale = t(`aggiornamento.canale.${stato.canale}`);
    if (stato.canale === "archivio" || stato.canale === "fissata" || stato.canale === "sconosciuto") {
      riga = t("aggiornamento.manuale", { versione: stato.versione, canale });
    } else if (stato.errore) {
      riga = t("aggiornamento.registryErrore", { versione: stato.versione, canale, msg: stato.errore });
    } else if (stato.disponibile) {
      riga = t("aggiornamento.disponibile", { versione: stato.versione, canale, a: stato.disponibile });
      tono = "var(--brand-warning, #f59e0b)";
    } else {
      riga = t("aggiornamento.aggiornato", { versione: stato.versione, canale });
      tono = "var(--brand-success-soft, #4ade80)";
    }
  }

  // L'esito dell'ultimo aggiornamento (Fase 3): chiuso una volta, non ricompare.
  const evento = stato?.evento ?? null;
  const chiaveEsito = "sws.ide.aggiornamento.esitoChiuso";
  let esitoGiaChiuso = false;
  try { esitoGiaChiuso = evento !== null && localStorage.getItem(chiaveEsito) === String(evento.id); } catch { /* storage negato */ }

  return (
    <section>
      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--brand-text-muted, #94a3b8)", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
        {t("aggiornamento.titolo")}
      </div>
      {evento && !esitoGiaChiuso && !esitoChiusoOra && (
        <div style={{
          marginBottom: 8, fontSize: 12, padding: "6px 8px", borderRadius: 4,
          border: `1px solid ${evento.esito === "riuscito" ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger, #ef4444)"}`,
          color: evento.esito === "riuscito" ? "var(--brand-success-soft, #4ade80)" : "var(--brand-danger-soft, #fca5a5)",
          display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between",
        }}>
          <span>
            {evento.esito === "riuscito" ? "✅ " : "⚠ "}
            {testoSistema(evento.esito === "riuscito" ? "esito_titolo_ok" : "esito_titolo_ko", i18n.language)}
            {" — "}
            {testoSistemaCon("esito_versioni", i18n.language, { da: evento.da, a: evento.a ?? "?" })}
            {evento.esito !== "riuscito" && <> — {t("aggiornamento.tornatoAlla", { da: evento.da })}</>}
          </span>
          <button type="button" onClick={() => { try { localStorage.setItem(chiaveEsito, String(evento.id)); } catch { /* */ } setEsitoChiusoOra(true); }}>
            {testoSistema("esito_chiudi", i18n.language)}
          </button>
        </div>
      )}
      {/* Il pannello risponde dopo aver copiato i dati (l'istantanea per il
          ritorno): con uno storico grande sono minuti, e senza questa riga il
          bottone fermo su «in corso» sembrava un IDE bloccato (07-11-2026). */}
      {inCorso && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>{t("aggiornamento.istantaneaInCorso")}</div>
      )}
      <span style={{ fontSize: 12, color: tono }}>{riga}</span>
      {/* Il percorso scritto non bastava (02-11-2026): nelle due disposizioni
          dell'IDE i menù si chiamano in modo diverso. Un bottone porta lì. */}
      {manuale && (
        <button type="button" data-testid="apri-installazione" style={{ marginLeft: 8 }}
          onClick={() => useAppStore.getState().setConfigTab("install")}>
          {t("aggiornamento.apriInstallazione")}
        </button>
      )}

      {/* Cosa cambia, prima di premere (decisione 42). Le versioni sono in
          ordine, dalla più vecchia alla più nuova: saltandone alcune si
          leggono anche quelle in mezzo, che è il punto. Gli avvisi di
          compatibilità stanno in cima a ogni versione e in rosso — sono
          l'unica parte per cui vale la pena fermarsi. */}
      {!avviato && !giaPartito && !errore && (stato?.novita?.length ?? 0) > 0 && (
        <div style={{ marginTop: 8, borderLeft: "2px solid var(--brand-surface-2, #334155)", paddingLeft: 8 }}>
          {stato!.novita!.map((n) => (
            <div key={n.versione} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>
                {n.versione}
              </div>
              {nl(n).compatibilita && (
                <div style={{
                  fontSize: 11, color: "var(--brand-danger-soft, #f87171)",
                  whiteSpace: "pre-wrap", margin: "2px 0 4px",
                }}>
                  ⚠ {nl(n).compatibilita}
                </div>
              )}
              <div style={{
                fontSize: 11, color: "var(--brand-text-muted, #94a3b8)",
                whiteSpace: "pre-wrap", maxHeight: 180, overflowY: "auto",
              }}>
                {nl(n).testo}
              </div>
            </div>
          ))}
        </div>
      )}

      {stato?.disponibile && !avviato && !giaPartito && !errore && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={aggiorna} disabled={inCorso}>
            {inCorso ? t("aggiornamento.inCorso") : t("aggiornamento.pulsante", { a: stato.disponibile })}
          </button>
        </div>
      )}

      {/* La finestra (Fase 2): solo per chi segue un canale del registry. */}
      {stato && !avviato && !giaPartito && !errore && (stato.canale === "stabile" || stato.canale === "prova") && (
        <FinestraAggiornamento stato={stato} conferma={confermaAggiornamento} />
      )}
    </section>
  );
}
