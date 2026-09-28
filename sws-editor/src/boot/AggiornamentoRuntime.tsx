import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api, novitaNellaLingua, type NovitaVersione, type StatoAggiornamento } from "@/api/client";
import { FinestraAggiornamento } from "./FinestraAggiornamento";

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

  useEffect(() => {
    let vivo = true;
    api.remoteStatoAggiornamento()
      .then((s) => { if (vivo) { setStato(s); setErrore(null); } })
      .catch((e) => { if (vivo) { setStato(null); setErrore(e instanceof Error ? e.message : String(e)); } });
    return () => { vivo = false; };
  }, []);

  // Le conferme valgono uguali per «Aggiorna ora» e per «Programma» (Fase 2).
  const conferma = (): boolean => {
    if (!stato?.disponibile) return false;
    if (!window.confirm(t("aggiornamento.conferma", { da: stato.versione, a: stato.disponibile }))) return false;
    // Con avvisi di compatibilità si chiede una conferma in più (decisione
    // 43): quegli avvisi dicono che dopo l'aggiornamento qualcosa va rifatto,
    // e una sola conferma la si dà per abitudine.
    const avvisi = (stato.novita ?? [])
      .filter((n) => nl(n).compatibilita)
      .map((n) => `${n.versione}: ${nl(n).compatibilita}`);
    return !(avvisi.length > 0 && !window.confirm(t("aggiornamento.confermaCompat", { avvisi: avvisi.join("\n\n") })));
  };

  const aggiorna = async () => {
    if (!conferma()) return;
    setInCorso(true);
    try {
      await api.remoteAvviaAggiornamento();
      setAvviato(true);
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
    } finally {
      setInCorso(false);
    }
  };

  let riga: string;
  let tono = "var(--brand-text-subtle, #64748b)";
  if (errore) { riga = errore; tono = "var(--brand-danger, #ef4444)"; }
  else if (stato === undefined) riga = t("aggiornamento.carico");
  else if (stato === null) riga = t("aggiornamento.illeggibile");
  else if (avviato) { riga = t("aggiornamento.avviato", { a: stato.disponibile }); tono = "var(--brand-warning, #f59e0b)"; }
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
            {t(evento.esito === "riuscito" ? "esitoPannello.riuscito" : "esitoPannello.nonRiuscito", { da: evento.da, a: evento.a ?? "?" })}
            {evento.esito !== "riuscito" && <> — {t("aggiornamento.tornatoAlla", { da: evento.da })}</>}
          </span>
          <button type="button" onClick={() => { try { localStorage.setItem(chiaveEsito, String(evento.id)); } catch { /* */ } setEsitoChiusoOra(true); }}>
            {t("esitoPannello.chiudi")}
          </button>
        </div>
      )}
      {stato?.in_corso && !avviato && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--brand-warning, #f59e0b)" }}>{t("aggiornamento.inCorsoSulPannello")}</div>
      )}
      <span style={{ fontSize: 12, color: tono }}>{riga}</span>

      {/* Cosa cambia, prima di premere (decisione 42). Le versioni sono in
          ordine, dalla più vecchia alla più nuova: saltandone alcune si
          leggono anche quelle in mezzo, che è il punto. Gli avvisi di
          compatibilità stanno in cima a ogni versione e in rosso — sono
          l'unica parte per cui vale la pena fermarsi. */}
      {!avviato && !errore && (stato?.novita?.length ?? 0) > 0 && (
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

      {stato?.disponibile && !avviato && !errore && (
        <div style={{ marginTop: 8 }}>
          <button type="button" onClick={aggiorna} disabled={inCorso}>
            {inCorso ? t("aggiornamento.inCorso") : t("aggiornamento.pulsante", { a: stato.disponibile })}
          </button>
        </div>
      )}

      {/* La finestra (Fase 2): solo per chi segue un canale del registry. */}
      {stato && !avviato && !errore && (stato.canale === "stabile" || stato.canale === "prova") && (
        <FinestraAggiornamento stato={stato} conferma={conferma} />
      )}
    </section>
  );
}
