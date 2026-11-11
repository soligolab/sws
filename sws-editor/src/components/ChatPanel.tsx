import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import i18n from "i18next";
import { editorLocale, NESSUNA_CONFERMA, type EditorAi } from "@/ai/editor";
import { useAppStore } from "@/store";
import { approvaSfondo, ascolta, chiedi, mandaFoto, nuovaConversazione, suConversazioneNuova } from "@/ws/aiStream";
import { blobInBase64 } from "@/ai/fotoDalBrowser";
import type { MsgIn, Riga } from "@/types/ai";

/**
 * La chat dell'assistente di progettazione (T-50).
 *
 * Ricalca `LogPanel`: aperta/chiusa da App, ricordata in localStorage, voce nel
 * menu ☰. È però un cassetto **laterale** e non in basso — una conversazione è
 * alta, non larga.
 *
 * Tre cose sono deliberate e vale la pena dirle:
 *
 *  * **le chiamate a strumento si vedono mentre accadono.** Metà della fiducia
 *    in un assistente è sapere cosa sta guardando; l'altra metà è il diff.
 *  * **il diff non è YAML.** Sono tre elenchi — tag, sorgenti, oggetti in
 *    pagina — perché una proposta che nessuno rilegge davvero passa lo stesso,
 *    ed è il rischio vero di tutta questa funzione.
 *  * **Applica non salva.** Applica allo store: da lì c'è Ctrl+Z, e il disco
 *    aspetta che qualcuno prema Salva.
 *
 * # Lo stesso componente in due posti
 *
 * Questo pannello è il cassetto dell'IDE **e** il contenuto della finestra
 * staccata. La sola differenza è chi calcola il diff e chi applica, e arriva
 * dalla prop `editor`: `editorLocale` (default) parla allo store di questa
 * finestra, `editorViaPonte` chiede alla finestra dell'editor. Nel cassetto
 * dell'IDE non cambia niente.
 */
/** 1234 → "1.2k": la riga risorse deve restare una riga. */
/** Le tracce della chat in console (`console.debug`, livello «Dettagliato»):
 *  il clic, l'invio, la risposta. Nate dagli sfondi del 05-11-2026, quando «Usa
 *  come base» sembrava non rispondere e non si sapeva dove si fosse fermato. */
function traccia(...a: unknown[]): void {
  console.debug("[chat]", ...a);
}

function kTok(n: number): string {
  return n >= 10000 ? `${Math.round(n / 1000)}k`
       : n >= 1000  ? `${(n / 1000).toFixed(1)}k`
       : String(n);
}

export function ChatPanel({ open, onClose, editor = editorLocale, avviso, bloccaInvio, variant = "drawer" }: {
  open: boolean;
  onClose: () => void;
  /** Chi calcola il diff e chi applica. Default: lo store di questa finestra. */
  editor?: EditorAi;
  /** Riga di avviso extra in testa alla lista (la usa la finestra staccata per
   *  dire che l'editor non risponde). Disabilita anche «Applica», perché in
   *  quello stato non può riuscire. */
  avviso?: string | null;
  /** Disabilita anche il **compositore**, e non solo «Applica».
   *
   *  Sono due stati diversi e vanno tenuti tali: con l'editor assente conviene
   *  poter ancora chiedere qualcosa (una spiegazione non ha bisogno dell'editor)
   *  e solo l'applicazione è impossibile; **senza un progetto aperto** invece gli
   *  strumenti leggerebbero il vuoto, e spendere token per quello è peggio di un
   *  rifiuto. */
  bloccaInvio?: boolean;
  /** `drawer` = cassetto laterale dell'IDE, 380 px fissi. `window` = riempie la
   *  finestra staccata, che la dimensiona il sistema operativo. Stessa scelta di
   *  `LogPanel`, e per la stessa ragione. */
  variant?: "drawer" | "window";
}) {
  const { t } = useTranslation();
  // Lo store restituisce chiavi `storeErr.*`, non frasi: si traducono qui, nella lingua di adesso.
  const traduciEsito = (m?: string) => (m && m.startsWith("storeErr.") ? t(m) : m);
  const remoteConnected = useAppStore((s) => s.remoteConnected);

  const [righe, setRighe]     = useState<Riga[]>([]);
  const [bozza, setBozza]     = useState("");
  const [attesa, setAttesa]   = useState(false);
  // Da quando si aspetta, e da quando il modello ragiona (11-11-2026): fra uno
  // strumento e l'altro la chat mostrava «…» immobili, e sembrava morta. Il
  // ragionamento non si mostra (vedi `pensiero`), ma che ci sia sì.
  const attesaDa = useRef<number | null>(null);
  const pensaDa = useRef<number | null>(null);
  const [, battito] = useState(0);
  useEffect(() => {
    if (!attesa) { attesaDa.current = null; pensaDa.current = null; return; }
    attesaDa.current ??= Date.now();
    const timer = setInterval(() => battito((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [attesa]);
  const [stato, setStato]     = useState<{ attivo: boolean; modello: string; motivo?: string | null } | null>(null);
  // Q41 — token della conversazione e saldo dell'account, con la preferenza
  // «nascondi» per-utente nel browser (è una preferenza di chi guarda, non
  // una decisione del progetto — scheda, domanda 5).
  const [risorse, setRisorse] = useState({ input: 0, output: 0, cache: 0 });
  // La spesa della conversazione la somma il server (è lui che fa scattare il
  // tetto): qui si mostra l'ultimo valore che ha mandato.
  const [spesa, setSpesa] = useState<{ speso: number; tetto: number; stimata: boolean } | null>(null);
  const [saldo, setSaldo]     = useState<number | null>(null);
  const [mostraRisorse, setMostraRisorse] = useState(() => {
    try { return localStorage.getItem("sws.chat.risorse") !== "no"; } catch { return true; }
  });
  const toggleRisorse = () => setMostraRisorse((m) => {
    try { localStorage.setItem("sws.chat.risorse", m ? "no" : "si"); } catch { /* per-sessione */ }
    return !m;
  });
  const fondo = useRef<HTMLDivElement | null>(null);
  // La base scelta mentre il modello sta ancora lavorando: parte a fine turno.
  // Prima il bottone era spento per tutto il turno, senza dirlo, e il clic
  // sembrava perso (collaudo degli sfondi, 05-11-2026).
  const [baseInCoda, setBaseInCoda] = useState<string | null>(null);
  const baseInCodaRef = useRef<string | null>(null);

  /** Approva la base e chiede le varianti: due messaggi, nell'ordine. */
  function mandaBase(id: string) {
    const okApprova = approvaSfondo(id);
    traccia("approva_sfondo", id, okApprova);
    if (!okApprova) {
      setRighe((x) => [...x, { tipo: "errore", testo: t("chat.noConnection") }]);
      return;
    }
    const testo = t("chat.sfondoScelto", { id });
    if (chiedi(testo)) {
      setRighe((x) => [...x, { tipo: "utente", testo }]);
      setAttesa(true);
    }
  }

  // Uscita o utente diverso (10-11-2026): conversazione nuova, e quello che
  // era sullo schermo non resta a chi entra dopo. Anche a cassetto chiuso.
  useEffect(() => suConversazioneNuova(() => {
    setRighe([]);
    setAttesa(false);
    baseInCodaRef.current = null;
    setBaseInCoda(null);
    setRisorse({ input: 0, output: 0, cache: 0 });
    setSpesa(null);
  }), []);

  useEffect(() => {
    if (!open) return;
    return ascolta((m: MsgIn) => {
      switch (m.t) {
        case "pronto":
          setStato({ attivo: m.attivo, modello: m.modello, motivo: m.motivo });
          // Una riconnessione con lo stesso id ritrova la conversazione sul
          // server (10-11-2026): i contatori restano, e la spesa è quella che
          // il tetto sta già contando. Socket nuovo e conversazione nuova:
          // ripartono da zero.
          if (m.ripresa) {
            if (m.speso !== undefined && m.tetto != null) {
              setSpesa((s) => ({ speso: m.speso!, tetto: m.tetto!, stimata: s?.stimata ?? false }));
            }
          } else {
            setRisorse({ input: 0, output: 0, cache: 0 });
            setSpesa(null);
          }
          break;
        case "risorse":
          setRisorse((r) => ({
            input: r.input + m.input,
            output: r.output + m.output,
            cache: r.cache + m.cache_lettura + m.cache_scrittura,
          }));
          if (m.speso !== undefined && m.tetto !== undefined) {
            setSpesa({ speso: m.speso, tetto: m.tetto, stimata: m.prezzi_noti === false });
          }
          break;
        case "tetto":
          setSpesa({ speso: m.speso, tetto: m.tetto, stimata: false });
          break;
        case "saldo":
          setSaldo(m.disponibile);
          break;
        case "testo":
          pensaDa.current = null;
          setRighe((r) => appendiTesto(r, m.delta));
          break;
        case "pensiero":
          // Il ragionamento non si mostra: è rumore per chi sta disegnando, e
          // mostrarlo invita a leggerlo invece del diff. Si mostra **che** c'è.
          pensaDa.current ??= Date.now();
          break;
        case "strumento":
          pensaDa.current = null;
          setRighe((r) => aggiornaStrumento(r, m.nome, m.stato, m.messaggio, m.byte, m.secondi));
          break;
        case "proposta": {
          // Il diff si chiede **adesso**, contro lo stato di adesso, e resta
          // quello. Ricalcolandolo a ogni render, dopo l'applicazione
          // confronterebbe la proposta con sé stessa e direbbe «non cambia
          // niente» — cioè cancellerebbe dallo schermo la cosa che l'utente ha
          // appena approvato.
          //
          // È asincrono perché nella finestra staccata lo calcola l'editor. La
          // riga nasce con `diff: null` («sto calcolando») e diventa un elenco
          // oppure un errore: mai `[]` per un calcolo mancato.
          setRighe((r) => [...r, { tipo: "proposta", msg: m, diff: null }]);
          void editor
            .diff({ id: m.id, motivo: m.motivo, project: m.project, faceplates: m.faceplates,
                    pages: m.pages, impronta: m.impronta, sfondi: m.sfondi })
            .then((diff) => {
              setRighe((r) => r.map((x) =>
                x.tipo === "proposta" && x.msg.id === m.id ? { ...x, diff } : x));
            })
            .catch((e) => {
              setRighe((r) => r.map((x) =>
                x.tipo === "proposta" && x.msg.id === m.id
                  ? { ...x, diff: null, diffErrore: String(e?.message ?? e) }
                  : x));
            });
          break;
        }
        case "errore":
          setRighe((r) => [...r, { tipo: "errore", testo: m.messaggio }]);
          break;
        case "simbolo":
          // Ridisegnato con lo stesso slug: la miniatura nuova prende il posto
          // della vecchia, così la chat non diventa un album di prove.
          setRighe((r) => [...r.filter((x) => !(x.tipo === "simbolo" && x.slug === m.slug)),
            { tipo: "simbolo", slug: m.slug, nome: (i18n.language ?? "it").startsWith("it") ? m.it : m.en, svg: m.svg }]);
          break;
        case "immagine":
          setRighe((r) => [...r, { tipo: "immagine", png: m.png, testo: m.testo }]);
          break;
        case "fotografa":
          // La foto di una pagina web (10-11-2026): la fa il browser, col
          // canvas dell'editor. Nella finestra staccata la chiede all'editor.
          traccia("fotografa", m.id);
          void editor.fotografa(m)
            .then(async (f) => mandaFoto(m.id, { png: await blobInBase64(f.png), avvisi: f.avvisi }))
            .catch((e: unknown) => mandaFoto(m.id, { errore: String((e as Error)?.message ?? e) }));
          break;
        case "sfondo":
          // Una variante rifatta con la stessa luce prende il posto della vecchia.
          setRighe((r) => [...r.filter((x) => !(x.tipo === "sfondo" && x.id === m.id)),
            { tipo: "sfondo", id: m.id, base: m.base, luce: m.luce, approvata: m.approvata, jpg: m.jpg }]);
          break;
        case "sfondo_approvato":
          traccia("sfondo_approvato", m.id, m.ok);
          if (m.ok) setRighe((r) => r.map((x) => x.tipo === "sfondo" && x.id === m.id ? { ...x, approvata: true } : x));
          break;
        case "risorse_extra":
          setSpesa((s) => s ? { ...s, speso: m.speso } : s);
          break;
        case "fine": {
          traccia("fine", baseInCodaRef.current ?? "");
          setAttesa(false);
          const id = baseInCodaRef.current;
          if (id) {
            baseInCodaRef.current = null;
            setBaseInCoda(null);
            mandaBase(id);
          }
          break;
        }
      }
    });
  }, [open, editor]);

  useEffect(() => {
    fondo.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [righe.length, open]);

  if (!open) return null;

  const invia = () => {
    const testo = bozza.trim();
    if (!testo || attesa) return;
    if (!chiedi(testo)) {
      setRighe((r) => [...r, { tipo: "errore", testo: t("chat.noConnection") }]);
      return;
    }
    setRighe((r) => [...r, { tipo: "utente", testo }]);
    setBozza("");
    setAttesa(true);
  };

  /** `comunque`: senza il controllo dell'impronta, dopo un «il progetto è
   *  cambiato». Rifare la domanda costa minuti e denaro, e a volte il cambio su
   *  disco non tocca niente della proposta (immagini copiate, un salvataggio
   *  da un'altra scheda): lo decide la persona. */
  const applica = async (indice: number, comunque = false) => {
    const riga = righe[indice];
    if (riga?.tipo !== "proposta") return;
    const esito = await editor.applica({
      id: riga.msg.id,
      motivo: riga.msg.motivo,
      project: riga.msg.project,
      pages: riga.msg.pages,
      impronta: comunque ? null : riga.msg.impronta,
      sfondi: riga.msg.sfondi,
      faceplates: riga.msg.faceplates,
    });
    setRighe((r) => r.map((x, i) => i !== indice || x.tipo !== "proposta" ? x : {
      ...x,
      esito: esito.ok ? "applicata" : "rifiutata",
      motivoRifiuto: esito.ok ? undefined : esito.motivo,
      // La sentinella del ponte scaduto diventa la frase che dice la verità:
      // un timeout non dimostra che la proposta non sia stata applicata.
      nota: esito.ok ? traduciEsito(esito.avviso)
          : esito.motivo === NESSUNA_CONFERMA ? t("chat.noConfirm")
          : traduciEsito(esito.motivo),
    }));
  };

  const scarta = (indice: number) => {
    setRighe((r) => r.map((x, i) =>
      i !== indice || x.tipo !== "proposta" ? x : { ...x, esito: "scartata" }));
  };

  return (
    <aside style={variant === "window"
                  ? { ...PANNELLO, width: "100%", borderLeft: "none" }
                  : PANNELLO}>
      <div style={INTESTAZIONE}>
        <strong style={{ fontSize: 12, letterSpacing: 0.5, color: "var(--brand-text, #e2e8f0)" }}>
          {t("chat.title")}
        </strong>
        <span style={{ fontSize: 11, color: "var(--brand-text-subtle, #64748b)" }}>
          {stato?.modello ?? "…"}
        </span>
        <div style={{ flex: 1 }} />
        <button style={BTN} onClick={toggleRisorse}
                title={mostraRisorse ? t("chat.risorseHide") : t("chat.risorseShow")}>◔</button>
        <button style={BTN} onClick={() => { setRighe([]); setAttesa(false); nuovaConversazione(); }} title={t("chat.clear")}>⌫</button>
        <button style={BTN} onClick={onClose} title={t("chat.close")}>✕</button>
      </div>

      {/* Q41 — la riga risorse: token della conversazione (sommati dai frame
          `risorse`, zero chiamate extra) e, dove il fornitore lo espone, il
          saldo dell'account. Presente di default, nascondibile col ◔ in alto:
          il credito è un dato dell'ACCOUNT, non del progetto, e chi allestisce
          un pannello può non volerlo in vista (scheda Q41). */}
      {mostraRisorse && (
        <div style={{ display: "flex", gap: 10, alignItems: "baseline",
                      padding: "3px 10px", fontSize: 11,
                      color: "var(--brand-text-subtle, #64748b)",
                      borderBottom: "1px solid var(--brand-surface-2, #1e293b)" }}>
          <span title={t("chat.conversationTokens")}>
            ◔ {kTok(risorse.input)} {t("chat.risorseIn")} · {kTok(risorse.output)} {t("chat.risorseOut")}
            {risorse.cache > 0 && <> · {kTok(risorse.cache)} {t("chat.risorseCache")}</>}
          </span>
          {spesa && (
            <span title={t("chat.risorseSpesaTitolo")}
                  style={spesa.speso >= spesa.tetto ? { color: "var(--brand-danger, #ef4444)" } : undefined}>
              {spesa.stimata ? "≈ " : ""}{spesa.speso.toFixed(2)} $ / {spesa.tetto.toFixed(0)} $
            </span>
          )}
          <div style={{ flex: 1 }} />
          {saldo !== null && (
            <span title={t("chat.accountBalanceWithTheProvider")}>
              {t("chat.risorseSaldo")} {saldo.toFixed(2)}
            </span>
          )}
        </div>
      )}

      {stato && !stato.attivo && (
        <div style={AVVISO}>{stato.motivo ?? t("chat.inactive")}</div>
      )}

      {/* Lo dice la finestra staccata quando l'editor non risponde o non ha un
          progetto aperto. Rosso e in cima, perché in quello stato «Applica» non
          può funzionare e leggere la conversazione senza saperlo è peggio. */}
      {avviso && (
        <div style={{ ...AVVISO, background: "rgba(239,68,68,0.12)",
                      color: "var(--brand-danger, #ef4444)" }}>
          {avviso}
        </div>
      )}

      {/* Con un runtime remoto collegato è naturale credere che l'assistente
          guardi il dispositivo. Non è così, ed è giusto così: il progetto che si
          sta modificando è quello locale — il deploy ne manda una copia al
          device — quindi l'assistente legge e propone sul locale. Dirlo costa
          una riga; non dirlo lascia credere che stia leggendo l'impianto. */}
      {remoteConnected && (
        <div style={{ ...AVVISO, background: "var(--brand-surface, #131c2e)",
                      color: "var(--brand-text-subtle, #94a3b8)" }}>
          {t("chat.localProject")}
        </div>
      )}

      <div style={LISTA}>
        {righe.length === 0 && (
          <div style={{ color: "var(--brand-text-subtle, #64748b)", fontSize: 12, padding: "12px 10px", lineHeight: 1.6 }}>
            {t("chat.empty")}
            <div style={{ marginTop: 10, fontStyle: "italic", opacity: 0.85 }}>
              {t("chat.example")}
            </div>
          </div>
        )}

        {righe.map((r, i) => {
          if (r.tipo === "utente") {
            return <div key={i} style={BOLLA_UTENTE}>{r.testo}</div>;
          }
          if (r.tipo === "assistente") {
            return <div key={i} style={BOLLA_ASSISTENTE}>{r.testo}</div>;
          }
          if (r.tipo === "errore") {
            return <div key={i} style={BOLLA_ERRORE}>{r.testo}</div>;
          }
          if (r.tipo === "simbolo") {
            return (
              <div key={i} style={CARTA_SIMBOLO} title={`prj:${r.slug}`}>
                <img src={svgComeImmagine(r.svg)} alt="" style={{ width: 72, height: 60, objectFit: "contain" }} />
                <div>
                  <div style={{ fontSize: 12, color: "var(--brand-text, #e2e8f0)" }}>{r.nome}</div>
                  <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)" }}>
                    {t("chat.bozzaSimbolo")} · prj:{r.slug}
                  </div>
                </div>
              </div>
            );
          }
          if (r.tipo === "sfondo") {
            // Uno sfondo generato. Sotto una base c'è «Usa come base»: è la
            // persona che sceglie, e senza la sua scelta le varianti di luce non
            // partono (regola dei due passi, 04-11-2026).
            const src = `data:image/jpeg;base64,${r.jpg}`;
            const usa = () => {
              if (attesa) {
                traccia("approva_sfondo:coda", r.id);
                baseInCodaRef.current = r.id;
                setBaseInCoda(r.id);
                return;
              }
              mandaBase(r.id);
            };
            return (
              <div key={i} style={{ margin: "4px 10px" }} data-testid={`sfondo-${r.id}`}>
                <a href={src} target="_blank" rel="noreferrer">
                  <img src={src} alt={r.id}
                       style={{ width: "100%", borderRadius: 4, border: "1px solid var(--brand-surface-2, #1e293b)" }} />
                </a>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11,
                              color: "var(--brand-text-subtle, #64748b)" }}>
                  <span>{r.base ? t("chat.sfondoBase", { id: r.id }) : t("chat.sfondoVariante", { id: r.id, luce: r.luce ?? "" })}</span>
                  {r.base && (r.approvata
                    ? <span style={{ color: "var(--brand-success, #22c55e)" }}>✓ {t("chat.sfondoApprovato")}</span>
                    : baseInCoda === r.id
                      ? <span data-testid={`base-in-coda-${r.id}`}>⏳ {t("chat.sfondoInCoda")}</span>
                      : <button style={BOTTONE_PICCOLO} onClick={usa}
                                data-testid={`usa-base-${r.id}`}>{t("chat.usaComeBase")}</button>)}
                </div>
              </div>
            );
          }
          if (r.tipo === "immagine") {
            // L'istantanea che il modello sta guardando: un clic la apre a
            // grandezza piena.
            const src = `data:image/png;base64,${r.png}`;
            return (
              <a key={i} href={src} target="_blank" rel="noreferrer" title={r.testo ?? ""}
                 style={{ display: "block", margin: "4px 10px" }}>
                <img src={src} alt={t("chat.istantanea")}
                     style={{ width: "100%", borderRadius: 4, border: "1px solid var(--brand-surface-2, #1e293b)" }} />
              </a>
            );
          }
          if (r.tipo === "strumento") {
            const icona = r.stato === "errore" ? "✗" : r.stato === "fatto" ? "✓"
              : <span style={PUNTINO_VIVO}>●</span>;
            return (
              <div key={i} style={{ ...RIGA_STRUMENTO,
                    color: r.stato === "errore" ? "var(--brand-danger, #ef4444)"
                                                : "var(--brand-text-subtle, #64748b)" }}>
                {icona} {r.nome}{r.messaggio ? ` — ${r.messaggio}` : ""}
                {r.stato === "scrivo" && r.byte != null
                  ? ` — ${t("chat.toolWriting", avanzamento(r.byte, r.secondi ?? 0))}` : ""}
              </div>
            );
          }
          return (
            <Proposta key={i} riga={r} bloccato={!!avviso}
                      onApplica={() => applica(i)} onApplicaComunque={() => applica(i, true)}
                      onScarta={() => scarta(i)} />
          );
        })}
        {attesa && (() => {
          const ora = Date.now();
          const secondi = (da: number | null) => Math.floor((ora - (da ?? ora)) / 1000);
          const tempo = (da: number | null) => avanzamento(0, secondi(da)).tempo;
          return (
            <div style={RIGA_STRUMENTO} data-testid="chat-attesa">
              <span style={PUNTINO_VIVO}>●</span>{" "}
              {pensaDa.current != null
                ? t("chat.thinking", { tempo: tempo(pensaDa.current) })
                : t("chat.waitingModel", { tempo: tempo(attesaDa.current) })}
            </div>
          );
        })()}
        <style>{`@keyframes sws-pulsa { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }`}</style>
        <div ref={fondo} />
      </div>

      <div style={COMPOSITORE}>
        <textarea
          value={bozza}
          onChange={(e) => setBozza(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); invia(); }
          }}
          placeholder={t("chat.placeholder")}
          rows={3}
          style={TESTO_INPUT}
          disabled={bloccaInvio || (stato != null && !stato.attivo)}
        />
        <button style={{ ...BTN_PRIMARIO, opacity: attesa || bloccaInvio || !bozza.trim() ? 0.5 : 1 }}
                disabled={attesa || bloccaInvio || !bozza.trim()} onClick={invia}>
          {attesa ? t("chat.working") : t("chat.send")}
        </button>
      </div>
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// La proposta e il suo diff
// ─────────────────────────────────────────────────────────────────────────────

function Proposta({ riga, bloccato, onApplica, onApplicaComunque, onScarta }: {
  riga: Extract<Riga, { tipo: "proposta" }>;
  /** L'editor non è raggiungibile: si legge, ma non si applica. */
  bloccato?: boolean;
  onApplica: () => void;
  onApplicaComunque: () => void;
  onScarta: () => void;
}) {
  const { t } = useTranslation();
  const diff = riga.diff;
  const nuovi = (riga.msg.giudizio?.rilievi ?? []).filter((x) => !x.preesistente);

  return (
    <div style={CARTA}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--brand-text, #e2e8f0)", marginBottom: 6 }}>
        {riga.msg.motivo}
      </div>

      {/* I simboli disegnati che entrano nel progetto: si giudicano guardandoli. */}
      {(riga.msg.simboli?.length ?? 0) > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
          {riga.msg.simboli!.map((s) => (
            <div key={s.slug} title={`prj:${s.slug}`} style={{ textAlign: "center", width: 76 }}>
              <img src={svgComeImmagine(s.svg)} alt="" style={{ width: 72, height: 56, objectFit: "contain" }} />
              <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", overflow: "hidden",
                            textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.it}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tre casi, e tenerli distinti è il punto: `null` senza errore = si sta
          calcolando; `null` con errore = **non lo sappiamo**; `[]` = nessuna
          modifica. Collassare i primi due sul terzo direbbe «questa proposta non
          cambia niente» davanti a una proposta che cambia il progetto. */}
      {diff === null ? (
        <div style={{ fontSize: 12, color: riga.diffErrore ? "var(--brand-danger, #ef4444)"
                                                           : "var(--brand-text-subtle, #64748b)" }}>
          {riga.diffErrore ? t("chat.diffUnavailable", { err: riga.diffErrore }) : t("chat.diffWorking")}
        </div>
      ) : diff.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--brand-text-subtle, #64748b)" }}>{t("chat.noChanges")}</div>
      ) : (
        <ul style={{ margin: "0 0 8px", paddingLeft: 16, fontSize: 12, lineHeight: 1.6,
                     color: "var(--brand-text-muted, #94a3b8)" }}>
          {diff.map((d, i) => (
            <li key={i}>
              <span style={{ color: d.verso === "+" ? "var(--brand-success, #22c55e)"
                                   : d.verso === "-" ? "var(--brand-danger, #ef4444)"
                                                     : "var(--brand-warning, #f59e0b)" }}>
                {d.verso}
              </span>{" "}
              {d.testo}
              {/* Il diff riga per riga, che c'è solo per le voci di codice.
                  «funzione modificata» non dice se è stata aggiunta una riga o
                  riscritta da capo, e chi approva non ha modo di accorgersi che
                  metà del corpo è sparita. */}
              {d.righe && d.righe.length > 0 && (
                <pre style={CODICE}>
                  {d.righe.map((r, k) => (
                    <div key={k} style={{
                      color: r.verso === "+" ? "var(--brand-success, #22c55e)"
                           : r.verso === "-" ? "var(--brand-danger, #ef4444)"
                                             : "var(--brand-text-subtle, #64748b)",
                      background: r.verso === "+" ? "rgba(34,197,94,0.10)"
                                : r.verso === "-" ? "rgba(239,68,68,0.10)" : "transparent",
                      whiteSpace: "pre-wrap", wordBreak: "break-word",
                    }}>
                      {r.verso}{r.testo || " "}
                    </div>
                  ))}
                </pre>
              )}
              {d.righeNota && (
                <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)",
                              marginTop: 2 }}>
                  {d.righeNota}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {nuovi.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {nuovi.map((x, i) => (
            <div key={i} style={{ fontSize: 11, lineHeight: 1.5,
                  color: x.severity === "error" ? "var(--brand-danger, #ef4444)"
                                                : "var(--brand-warning, #f59e0b)" }}>
              {x.severity === "error" ? "✗" : "!"} {x.path} — {x.message}
            </div>
          ))}
        </div>
      )}

      {riga.esito ? (
        <div style={{ fontSize: 11, color: riga.esito === "applicata"
                          ? "var(--brand-success, #22c55e)" : "var(--brand-text-subtle, #64748b)" }}>
          {t(`chat.outcome.${riga.esito}`)}
          {riga.nota ? <div style={{ marginTop: 4, color: "var(--brand-warning, #f59e0b)" }}>{riga.nota}</div> : null}
          {riga.motivoRifiuto === "storeErr.projectChanged" && (
            <div style={{ marginTop: 6 }}>
              <button style={{ ...BTN, opacity: bloccato ? 0.5 : 1 }} disabled={bloccato}
                      onClick={onApplicaComunque}>{t("chat.applyAnyway")}</button>
              <div style={{ marginTop: 4, color: "var(--brand-text-subtle, #64748b)" }}>
                {t("chat.applyAnywayHint")}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {/* Disabilitato col **motivo** nel titolo, non nascosto: un pulsante
              che spariesce lascia credere che la proposta sia già stata gestita. */}
          <button style={{ ...BTN_PRIMARIO, opacity: bloccato ? 0.5 : 1 }}
                  disabled={bloccato}
                  title={bloccato ? t("chat.applyBlocked") : undefined}
                  onClick={onApplica}>{t("chat.apply")}</button>
          <button style={BTN} onClick={onScarta}>{t("chat.discard")}</button>
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--brand-text-subtle, #64748b)", marginTop: 6 }}>
        {t("chat.applyNote")}
      </div>
    </div>
  );
}

// `riassumi` vive in `@/ai/riassunto`: da quando la chat può stare in una
// finestra separata, quel calcolo lo fa la finestra dell'editor e non deve
// passare per un componente React. Vedi `@/ai/editor`.

// ─────────────────────────────────────────────────────────────────────────────

/** Un SVG compilato dal runtime come `src` di un'immagine: dentro un `<img>`
 *  non esegue niente, e i gradienti e i `<use>` funzionano. */
function svgComeImmagine(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const CARTA_SIMBOLO: CSSProperties = {
  display: "flex", gap: 10, alignItems: "center", margin: "4px 10px", padding: "6px 8px",
  borderRadius: 6, background: "var(--brand-surface-2, #1e293b)",
};

function appendiTesto(righe: Riga[], delta: string): Riga[] {
  const ultima = righe[righe.length - 1];
  if (ultima?.tipo === "assistente") {
    return [...righe.slice(0, -1), { tipo: "assistente", testo: ultima.testo + delta }];
  }
  return [...righe, { tipo: "assistente", testo: delta }];
}

/** Uno strumento che passa da «eseguo» a «fatto» aggiorna la sua riga invece
 *  di aggiungerne una: altrimenti una conversazione di dieci strumenti diventa
 *  venti righe di rumore. */
export function aggiornaStrumento(righe: Riga[], nome: string, stato: string, messaggio?: string,
                                  byte?: number, secondi?: number): Riga[] {
  const nuova: Riga = { tipo: "strumento", nome, stato, messaggio, byte, secondi };
  for (let i = righe.length - 1; i >= 0; i--) {
    const r = righe[i];
    if (r.tipo !== "strumento") break;
    if (r.nome === nome && r.stato !== "fatto" && r.stato !== "errore") {
      const copia = [...righe];
      copia[i] = nuova;
      return copia;
    }
  }
  return [...righe, nuova];
}

/** «38 kB · 2:14»: quanto ha scritto il modello e da quanto. Serve a dire che
 *  sta lavorando: una proposta su sei pagine sono minuti di silenzio, e la chat
 *  ferma su «… valida» sembrava morta (11-11-2026). */
export function avanzamento(byte: number, secondi: number): { kb: string; tempo: string } {
  const m = Math.floor(secondi / 60);
  const s = String(secondi % 60).padStart(2, "0");
  return { kb: String(Math.max(1, Math.round(byte / 1024))), tempo: `${m}:${s}` };
}

// ── Stili, sulla falsariga di LogPanel ───────────────────────────────────────

const PANNELLO: React.CSSProperties = {
  width: 380,
  flexShrink: 0,
  background: "var(--brand-bg, #0b1220)",
  borderLeft: "1px solid var(--brand-surface-2, #334155)",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
};

const INTESTAZIONE: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 6, padding: "6px 8px",
  background: "var(--brand-bg, #0f172a)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)", flexShrink: 0,
};

const LISTA: React.CSSProperties = {
  flex: 1, overflowY: "auto", padding: "8px 10px",
  display: "flex", flexDirection: "column", gap: 8,
};

const COMPOSITORE: React.CSSProperties = {
  borderTop: "1px solid var(--brand-surface-2, #334155)", padding: 8,
  display: "flex", flexDirection: "column", gap: 6, flexShrink: 0,
};

const TESTO_INPUT: React.CSSProperties = {
  background: "var(--brand-bg, #0f172a)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  padding: "6px 8px", fontSize: 12, fontFamily: "inherit", resize: "vertical",
};

const BTN: React.CSSProperties = {
  background: "var(--brand-surface, #1e293b)", color: "var(--brand-text, #e2e8f0)",
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 4,
  padding: "4px 10px", fontSize: 12, cursor: "pointer",
};

const BTN_PRIMARIO: React.CSSProperties = { ...BTN, background: "#1d4ed8", color: "#fff" };
const BOTTONE_PICCOLO: React.CSSProperties = { ...BTN_PRIMARIO, padding: "2px 8px", fontSize: 11, marginLeft: "auto" };

const BOLLA_UTENTE: React.CSSProperties = {
  alignSelf: "flex-end", maxWidth: "88%", background: "var(--brand-surface, #1e293b)",
  borderRadius: 8, padding: "6px 10px", fontSize: 12, lineHeight: 1.5,
  color: "var(--brand-text, #e2e8f0)", whiteSpace: "pre-wrap",
};

const BOLLA_ASSISTENTE: React.CSSProperties = {
  maxWidth: "95%", fontSize: 12, lineHeight: 1.6,
  color: "var(--brand-text-muted, #94a3b8)", whiteSpace: "pre-wrap",
};

const BOLLA_ERRORE: React.CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: "var(--brand-danger, #ef4444)",
  border: "1px solid var(--brand-danger, #ef4444)", borderRadius: 6, padding: "6px 8px",
};

/** Il puntino che pulsa: la chat è viva anche quando i kB crescono piano. */
const PUNTINO_VIVO: React.CSSProperties = {
  color: "var(--brand-accent, #38bdf8)", animation: "sws-pulsa 1.2s ease-in-out infinite",
};

const RIGA_STRUMENTO: React.CSSProperties = {
  fontSize: 11, fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  color: "var(--brand-text-subtle, #64748b)",
};

const AVVISO: React.CSSProperties = {
  fontSize: 11, lineHeight: 1.5, padding: "6px 10px",
  background: "rgba(245,158,11,0.12)", color: "var(--brand-warning, #f59e0b)",
  borderBottom: "1px solid var(--brand-surface-2, #334155)",
};

const CARTA: React.CSSProperties = {
  border: "1px solid var(--brand-surface-2, #334155)", borderRadius: 6,
  padding: "8px 10px", background: "var(--brand-surface, #1e293b)",
};

const CODICE: React.CSSProperties = {
  margin: "4px 0 2px",
  padding: "4px 6px",
  maxHeight: 240,
  overflow: "auto",
  fontSize: 11,
  lineHeight: 1.45,
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  background: "var(--brand-bg, #0f172a)",
  border: "1px solid var(--brand-surface-2, #334155)",
  borderRadius: 4,
};
