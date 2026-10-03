/** L'avviso di versione nuova **sullo schermo del pannello** (decisioni 41 e
 *  44 del piano dell'aggiornamento, 28-09-2026).
 *
 *  ## Quando compare
 *
 *  Solo se il progetto **non ha utenti**. Senza utenti chiunque stia davanti
 *  al pannello è già Admin, quindi il pulsante non dà un potere che non
 *  avrebbe già; con utenti definiti l'aggiornamento resta il percorso
 *  dell'Admin dall'IDE, e sullo schermo non compare niente.
 *
 *  Il controllo si fa **all'avvio**, una volta (scelta del maintainer): un
 *  pannello acceso da mesi lo scopre al riavvio, e chi vuole sapere subito
 *  guarda dall'IDE, che interroga il registry quando si apre la scheda.
 *
 *  ## Le due vie d'uscita, che non sono la stessa cosa
 *
 *  «Più tardi» nasconde l'avviso fino al prossimo avvio: la versione resta
 *  nuova e lo si rivedrà. «Ignora questa versione» lo nasconde **finché non
 *  ne esce una più nuova ancora**, e quella scelta sopravvive al riavvio —
 *  altrimenti non sarebbe un ignorare, sarebbe un rimandare.
 */
import { useEffect, useState } from "react";
import { api, novitaNellaLingua, type NovitaVersione, type SceltaConferma, type StatoAggiornamento, type StatoConferma, type StatoQuadlet } from "@/api/client";
import { useLinguaContenuti } from "@/i18n/linguaContenuti";
import { testoSistema, testoSistemaCon } from "@/i18n/testiSistema";

const IGNORATA = "sws.aggiornamento.ignorata";
/** L'esito chiuso: «chiuso una volta non ricompare per quell'aggiornamento»
 *  (decisione 54). Si ricorda l'id dell'evento. */
const ESITO_CHIUSO = "sws.aggiornamento.esitoChiuso";

function esitoChiuso(): number | null {
  try { const v = localStorage.getItem(ESITO_CHIUSO); return v === null ? null : Number(v); } catch { return null; }
}

function chiudiEsito(id: number): void {
  try { localStorage.setItem(ESITO_CHIUSO, String(id)); } catch { /* storage negato */ }
}

function versioneIgnorata(): string | null {
  try { return localStorage.getItem(IGNORATA); } catch { return null; }
}

function ignora(versione: string): void {
  try { localStorage.setItem(IGNORATA, versione); } catch { /* storage negato */ }
}

/** Ogni quanto il viewer guarda se il runtime è ripartito: `/api/system` è
 *  locale e leggero, e un riavvio si riconosce dall'`uptime_s` che torna
 *  indietro. */
export const CONTROLLO_RIAVVIO_MS = 60_000;
/** Ogni quanto si richiede lo stato mentre un aggiornamento è in corso. */
export const RICHIESTA_ESITO_MS = 30_000;

/** Il runtime è ripartito se il suo `uptime_s` è sceso. */
export function ripartito(prima: number | null, adesso: number): boolean {
  return prima !== null && adesso < prima;
}

export function AvvisoAggiornamento() {
  // Dal 29-09-2026 le parole vengono dalla tabella del testo di sistema
  // (`@/i18n/testiSistema`) e non da `t()`, e la lingua è quella dei
  // **contenuti**: è la stessa scelta già fatta per le intestazioni di tabella
  // del viewer, e qui pesa di più — su LVGL, dove questo avviso ha il suo
  // gemello, una lingua dell'IDE non esiste proprio. Prima erano due lingue,
  // ora cinque.
  const { lang } = useLinguaContenuti();
  const nl = (n: NovitaVersione) => novitaNellaLingua(n, lang);
  // Se il progetto ha utenti lo dice il runtime (`auth_required` di
  // `/api/system`), chiesto **da qui**. Il 28-09 l'avviso leggeva un valore
  // dello store che imposta solo l'IDE: nel viewer del pannello restava
  // sconosciuto e l'avviso non compariva mai — e i test non se ne accorgevano,
  // perché quel valore lo impostavano loro a mano.
  const [senzaUtenti, setSenzaUtenti] = useState(false);
  const [stato, setStato] = useState<StatoAggiornamento | null>(null);
  const [chiuso, setChiuso] = useState(false);
  const [esitoVisto, setEsitoVisto] = useState(false);
  const [novitaAperte, setNovitaAperte] = useState(false);
  const [inCorso, setInCorso] = useState(false);
  const [errore, setErrore] = useState<string | null>(null);
  // Il quadlet che viaggia (02-10-2026): la configurazione del servizio più
  // vecchia di quella della versione che gira. «Più tardi» vale fino al
  // prossimo avvio del runtime, come per la versione nuova.
  const [quadlet, setQuadlet] = useState<StatoQuadlet | null>(null);
  const [quadletRimandato, setQuadletRimandato] = useState(false);
  // Dopo un aggiornamento (03-10-2026): confermare, rimandare o tornare
  // indietro. La domanda la tiene il runtime; qui si risponde.
  const [conferma, setConferma] = useState<StatoConferma | null>(null);
  const [confermaChiusa, setConfermaChiusa] = useState(false);
  const [ritornoChiesto, setRitornoChiesto] = useState(false);

  // All'avvio del viewer, e di nuovo ogni volta che il runtime riparte: un
  // pannello acceso da mesi non ricarica la pagina quando il runtime si
  // riavvia (la ricarica scatta solo per un'interfaccia nuova), e senza questo
  // l'avviso lo vedrebbe solo chi spegne e riaccende. Con utenti definiti non
  // si chiede niente al registry: l'avviso non si mostrerebbe comunque.
  useEffect(() => {
    let vivo = true;
    let ultimoUptime: number | null = null;
    const controlla = async (primaVolta: boolean) => {
      let sys;
      try { sys = await api.getSystemStatus(); } catch { return; }
      if (!vivo) return;
      const riavvio = ripartito(ultimoUptime, sys.uptime_s ?? 0);
      ultimoUptime = sys.uptime_s ?? 0;
      setQuadlet(sys.quadlet ?? null);
      setConferma(sys.conferma_aggiornamento ?? null);
      if (riavvio) { setQuadletRimandato(false); setConfermaChiusa(false); setRitornoChiesto(false); }
      if (!primaVolta && !riavvio) return;
      const libero = sys.auth_required === false;
      setSenzaUtenti(libero);
      if (!libero) return;
      // «Più tardi» vale fino al prossimo avvio (decisione 44): è questo.
      if (riavvio) setChiuso(false);
      await leggiStato();
    };
    // Dopo un aggiornamento la pagina si ricarica subito, ma l'esito «riuscito»
    // si scrive solo dopo un paio di minuti di vita della versione nuova:
    // finché il runtime dice «in corso», si richiede ogni 30 secondi.
    let richiesta: number | undefined;
    const leggiStato = async () => {
      try {
        const s = await api.statoAggiornamento();
        if (!vivo) return;
        setStato(s);
        if (s.in_corso) richiesta = window.setTimeout(() => void leggiStato(), RICHIESTA_ESITO_MS);
      } catch { /* registry irraggiungibile: nessun avviso, e nessun allarme */ }
    };
    void controlla(true);
    const id = window.setInterval(() => void controlla(false), CONTROLLO_RIAVVIO_MS);
    return () => { vivo = false; window.clearInterval(id); window.clearTimeout(richiesta); };
  }, []);

  // Prima l'esito dell'ultimo aggiornamento (Fase 3, decisioni 52-54): con il
  // pilota automatico è l'unico modo, davanti al pannello, di sapere che è
  // cambiato qualcosa.
  const evento = stato?.evento ?? null;
  if (senzaUtenti && evento && !esitoVisto && esitoChiuso() !== evento.id) {
    const ok = evento.esito === "riuscito";
    const inst = stato?.novita_installata ? nl(stato.novita_installata) : null;
    return (
      <div role="dialog" aria-modal="true" aria-label={testoSistema(ok ? "esito_titolo_ok" : "esito_titolo_ko", lang)}
        style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2, 6, 23, 0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{
          background: "var(--brand-surface, #1e293b)",
          border: `1px solid ${ok ? "var(--brand-surface-2, #334155)" : "var(--brand-danger, #ef4444)"}`,
          borderRadius: 8, padding: 20, maxWidth: 520, width: "100%", maxHeight: "80vh", overflowY: "auto",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: ok ? "var(--brand-text, #e2e8f0)" : "var(--brand-danger-soft, #fca5a5)", marginBottom: 6 }}>
            {ok ? "✅ " : "⚠ "}{testoSistema(ok ? "esito_titolo_ok" : "esito_titolo_ko", lang)}
          </div>
          {/* Il titolo dice cosa è successo, questa riga con quali versioni:
              insieme, come erano fino al 30-09-2026, si leggevano come
              l'annuncio di un aggiornamento da fare. */}
          <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>
            {ok
              ? testoSistemaCon("esito_versioni", lang, { da: evento.da, a: evento.a ?? "?" })
              : testoSistemaCon("esito_spiega", lang, { da: evento.da, a: evento.a ?? "?" })}
          </div>
          {ok && inst?.compatibilita && (
            <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 4, background: "var(--brand-danger-bg, #450a0a)", border: "1px solid var(--brand-danger, #ef4444)", fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)", whiteSpace: "pre-wrap" }}>
              ⚠ {inst.compatibilita}
            </div>
          )}
          {ok && inst?.testo && (
            <div style={{ marginTop: 12 }}>
              <button type="button" onClick={() => setNovitaAperte(!novitaAperte)}
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: "var(--brand-primary, #3b82f6)" }}>
                {novitaAperte ? "▼" : "▶"} {testoSistema("agg_novita", lang)}
              </button>
              {novitaAperte && (
                <div style={{ marginTop: 6, maxHeight: "32vh", overflowY: "auto", fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "pre-wrap" }}>{inst.testo}</div>
              )}
            </div>
          )}
          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => { chiudiEsito(evento.id); setEsitoVisto(true); setNovitaAperte(false); }}>
              {testoSistema("esito_chiudi", lang)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Poi la configurazione del servizio da aggiornare: dopo un aggiornamento che
  // porta quadlet nuovi è il passo che resta, e davanti al pannello non c'è un IDE.
  if (senzaUtenti && quadlet?.da_aggiornare && quadlet.si_puo_aggiornare && !quadletRimandato) {
    const daA = { da: String(quadlet.installata ?? "?"), a: String(quadlet.attesa ?? "?") };
    const aggiornaQuadlet = async () => {
      setInCorso(true);
      setErrore(null);
      try {
        await api.aggiornaQuadlet();
        // Il pannello si riavvia e questa pagina cade: niente da mostrare dopo.
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
        setInCorso(false);
      }
    };
    return (
      <div role="dialog" aria-modal="true" aria-label={testoSistema("quadlet_titolo", lang)}
        style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2, 6, 23, 0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
          borderRadius: 8, padding: 20, maxWidth: 520, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
            ⚙ {testoSistema("quadlet_titolo", lang)}
          </div>
          <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>
            {testoSistemaCon("quadlet_spiega", lang, daA)}
          </div>
          {errore && <div style={{ marginTop: 10, fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</div>}
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setQuadletRimandato(true)} disabled={inCorso}>
              {testoSistema("agg_piu_tardi", lang)}
            </button>
            <button type="button" onClick={() => void aggiornaQuadlet()} disabled={inCorso}
              style={{ fontWeight: 600, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", borderRadius: 5, padding: "6px 14px", cursor: "pointer" }}>
              {inCorso ? testoSistema("agg_in_corso", lang) : testoSistema("agg_aggiorna", lang)}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Poi la domanda dopo un aggiornamento: finché non si conferma, la versione
  // di prima resta sul pannello (e i suoi dati nell'istantanea).
  const domanda = conferma?.domanda ?? null;
  if (senzaUtenti && domanda && !confermaChiusa) {
    const daA = { da: domanda.da, a: domanda.a };
    const rispondi = async (scelta: SceltaConferma) => {
      setInCorso(true);
      setErrore(null);
      try {
        await api.confermaAggiornamento(scelta);
        // «Ritorna» riavvia il pannello e questa pagina cade; per le altre la
        // domanda è chiusa.
        if (scelta !== "ritorna") { setConfermaChiusa(true); setInCorso(false); }
      } catch (e) {
        setErrore(e instanceof Error ? e.message : String(e));
        setInCorso(false);
      }
    };
    return (
      <div role="dialog" aria-modal="true" aria-label={testoSistema("conf_titolo", lang)}
        style={{ position: "fixed", inset: 0, zIndex: 9000, background: "rgba(2, 6, 23, 0.72)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div style={{
          background: "var(--brand-surface, #1e293b)", border: "1px solid var(--brand-surface-2, #334155)",
          borderRadius: 8, padding: 20, maxWidth: 560, width: "100%", boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
            {testoSistema("conf_titolo", lang)}
          </div>
          <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>
            {testoSistemaCon("conf_spiega", lang, daA)}
          </div>
          {domanda.istantanea && (
            <div style={{ marginTop: 8, fontSize: 12, color: "var(--brand-text-muted, #94a3b8)" }}>
              {testoSistema("conf_dati", lang)}
            </div>
          )}
          {ritornoChiesto && (
            <div style={{ marginTop: 12, padding: "8px 10px", borderRadius: 4, background: "var(--brand-danger-bg, #450a0a)", border: "1px solid var(--brand-danger, #ef4444)", fontSize: 13, color: "var(--brand-danger-soft, #fca5a5)" }}>
              {testoSistemaCon("conf_ritorna_sicuro", lang, daA)}
            </div>
          )}
          {errore && <div style={{ marginTop: 10, fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</div>}
          <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {ritornoChiesto ? (
              <>
                <button type="button" onClick={() => setRitornoChiesto(false)} disabled={inCorso}>
                  {testoSistema("conf_annulla", lang)}
                </button>
                <button type="button" onClick={() => void rispondi("ritorna")} disabled={inCorso}
                  style={{ fontWeight: 600, background: "var(--brand-danger, #b91c1c)", color: "#fff", border: "none", borderRadius: 5, padding: "6px 14px", cursor: "pointer" }}>
                  {inCorso ? testoSistema("agg_in_corso", lang) : testoSistemaCon("conf_ritorna", lang, daA)}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setRitornoChiesto(true)} disabled={inCorso}>
                  {testoSistemaCon("conf_ritorna", lang, daA)}
                </button>
                <button type="button" onClick={() => void rispondi("piu_tardi")} disabled={inCorso}>
                  {testoSistema("agg_piu_tardi", lang)}
                </button>
                <button type="button" onClick={() => void rispondi("dopo_riavvio")} disabled={inCorso}>
                  {testoSistema("conf_dopo_riavvio", lang)}
                </button>
                <button type="button" onClick={() => void rispondi("pulisci")} disabled={inCorso}
                  style={{ fontWeight: 600, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", borderRadius: 5, padding: "6px 14px", cursor: "pointer" }}>
                  {inCorso ? testoSistema("agg_in_corso", lang) : testoSistema("conf_pulisci", lang)}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  const nuova = stato?.disponibile ?? null;
  if (chiuso || !nuova || !senzaUtenti) return null;
  if (versioneIgnorata() === nuova) return null;

  const avvisi = (stato?.novita ?? []).filter((n) => nl(n).compatibilita);

  const aggiorna = async () => {
    setInCorso(true);
    setErrore(null);
    try {
      await api.avviaAggiornamento();
      // Da qui il runtime si riavvia e questa pagina cade: non c'è niente da
      // mostrare dopo, e un messaggio di successo mentirebbe sul fatto che
      // l'aggiornamento è finito.
    } catch (e) {
      setErrore(e instanceof Error ? e.message : String(e));
      setInCorso(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={testoSistemaCon("agg_titolo", lang, { a: nuova })}
      style={{
        position: "fixed", inset: 0, zIndex: 9000,
        background: "rgba(2, 6, 23, 0.72)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div style={{
        background: "var(--brand-surface, #1e293b)",
        border: "1px solid var(--brand-surface-2, #334155)",
        borderRadius: 8, padding: 20, maxWidth: 520, width: "100%",
        maxHeight: "80vh", overflowY: "auto",
        boxShadow: "0 10px 40px rgba(0,0,0,0.5)",
      }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
          {testoSistemaCon("agg_titolo", lang, { a: nuova })}
        </div>
        <div style={{ fontSize: 13, color: "var(--brand-text-muted, #94a3b8)" }}>
          {testoSistemaCon("agg_da", lang, { da: stato?.versione ?? "?" })}
        </div>

        {/* Gli avvisi di compatibilità stanno in cima e non si nascondono:
            sono l'unica parte per cui vale la pena fermarsi. */}
        {avvisi.length > 0 && (
          <div style={{
            marginTop: 12, padding: "8px 10px", borderRadius: 4,
            background: "var(--brand-danger-bg, #450a0a)",
            border: "1px solid var(--brand-danger, #ef4444)",
          }}>
            {avvisi.map((n) => (
              <div key={n.versione} style={{ fontSize: 12, color: "var(--brand-danger-soft, #fca5a5)", whiteSpace: "pre-wrap" }}>
                ⚠ {nl(n).compatibilita}
              </div>
            ))}
          </div>
        )}

        {(stato?.novita?.length ?? 0) > 0 && (
          <div style={{ marginTop: 12 }}>
            <button
              type="button"
              onClick={() => setNovitaAperte(!novitaAperte)}
              style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13, color: "var(--brand-primary, #3b82f6)" }}
            >
              {novitaAperte ? "▼" : "▶"} {testoSistema("agg_novita", lang)}
            </button>
            {novitaAperte && (
              <div style={{ marginTop: 6, maxHeight: "32vh", overflowY: "auto" }}>
                {stato!.novita!.map((n) => (
                  <div key={n.versione} style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--brand-text-2, #cbd5e1)" }}>{n.versione}</div>
                    <div style={{ fontSize: 12, color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "pre-wrap" }}>{nl(n).testo}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {errore && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--brand-danger-soft, #f87171)" }}>{errore}</div>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <button type="button" onClick={() => { ignora(nuova); setChiuso(true); }} disabled={inCorso}>
            {testoSistema("agg_ignora", lang)}
          </button>
          <button type="button" onClick={() => setChiuso(true)} disabled={inCorso}>
            {testoSistema("agg_piu_tardi", lang)}
          </button>
          <button
            type="button"
            onClick={() => void aggiorna()}
            disabled={inCorso}
            style={{ fontWeight: 600, background: "#1d4ed8", color: "#fff", border: "1px solid var(--brand-primary-hover, #2563eb)", borderRadius: 5, padding: "6px 14px", cursor: "pointer" }}
          >
            {inCorso ? testoSistema("agg_in_corso", lang) : testoSistema("agg_aggiorna", lang)}
          </button>
        </div>
      </div>
    </div>
  );
}
