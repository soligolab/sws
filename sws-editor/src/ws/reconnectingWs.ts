import i18n from "i18next";
// Thin wrapper around WebSocket that reconnects automatically with exponential
// back-off when the connection drops. Listeners survive reconnects: they are
// stored internally and re-registered on every new underlying socket.
//
// Back-off schedule: 1 s → 2 s → 4 s … cap at 30 s, with ±25 % jitter to
// spread reconnect storms after a server restart.

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

// Quanto deve reggere un collegamento perché conti come riuscito.
//
// Prima bastava l'evento `open` per azzerare l'attesa, e su un **relay** questo
// è un errore: `/ws/remote/tags` si apre sempre — è il runtime locale a
// rispondere — e muore un istante dopo, quando il collegamento verso il pannello
// fallisce. Risultato misurato il 2026-09-08: due tentativi al secondo per
// sempre, ottanta righe identiche nel registro in un minuto, con l'attesa
// crescente che non cresceva mai perché ogni giro la azzerava.
const STABILE_MS = 3_000;

// Codici di chiusura che dicono «non ritentare»: il server ha risposto e ha
// rifiutato per un motivo che il tempo non cambia (rotta assente, versione
// incompatibile). Sono nell'intervallo privato 4000-4999 di RFC 6455 e li manda
// `remote_relay.rs`. Un guasto di rete usa i codici normali e resta ritentabile.
const CHIUSURE_DEFINITIVE = new Set([4404, 4495]); // 4495 = certificato del dispositivo cambiato (Q49)

// Dopo quanti collegamenti consecutivi **mai stabili** si smette di provare.
//
// Il codice di chiusura è la via pulita, ma non ci si può contare: se il server
// chiude subito dopo aver messo in coda il frame, il browser riporta 1006
// («chiusa in modo anomalo») e il motivo si perde. Successo il 2026-09-08 sul
// WP630: il relay diceva «non ritento» e il client ritentava lo stesso, con
// l'attesa che cresceva ma senza fermarsi mai.
//
// Sei tentativi con l'attesa 1→2→4→8→16→30 s sono circa un minuto: abbastanza
// perché un runtime che sta ripartendo torni disponibile, poco perché un canale
// che non esiste generi rumore per ore. Una riconnessione esplicita
// dell'utente ricrea l'oggetto e riparte da capo.
const TENTATIVI_MAX = 6;

// Permissive function signature so callers can type their handlers as
// (ev: MessageEvent) without a cast. The internal WebSocket.addEventListener
// call is cast to EventListenerOrEventListenerObject as required by the DOM.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Listener = (ev: any) => void;

export class ReconnectingWs {
  private ws: WebSocket | null = null;
  private delay = INITIAL_DELAY_MS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  /** Chiuso da chi lo usa (`destroy()`), non per resa: non si riapre più. */
  private distrutto = false;
  private apertoIl = 0;
  private falliti = 0;
  /** Motivo per cui si è smesso di ritentare, se è successo. */
  private motivoResa: string | null = null;
  private readonly stored = new Map<string, Set<Listener>>();

  constructor(
    private readonly buildUrl: () => string,
    /** Chiamata una sola volta quando il server dice «non ritentare»: serve a
     *  mostrare in interfaccia cosa manca, invece di lasciare un pannello vuoto
     *  che sembra solo lento. */
    private readonly onResa?: (motivo: string) => void,
  ) {
    this.open();
  }

  private open(): void {
    if (this.destroyed) return;
    const ws = new WebSocket(this.buildUrl());
    this.ws = ws;
    this.apertoIl = 0;

    ws.addEventListener("open", () => {
      this.apertoIl = Date.now();
    });

    ws.addEventListener("close", (ev: CloseEvent) => {
      if (this.destroyed) return;
      // Un socket già sostituito da `riapri()` non deve far ripartire niente.
      if (this.ws !== ws) return;
      // Il server ha risposto e ha rifiutato per un motivo che non cambia:
      // ritentare produrrebbe solo rumore.
      if (CHIUSURE_DEFINITIVE.has(ev.code)) {
        this.motivoResa = ev.reason || i18n.t("ws.refused", { code: ev.code });
        this.destroyed = true;
        this.ws = null;
        this.onResa?.(this.motivoResa);
        return;
      }
      // L'attesa si azzera solo se il collegamento ha **retto**: un socket che
      // si apre e muore subito non è un successo, è un fallimento travestito.
      if (this.apertoIl && Date.now() - this.apertoIl >= STABILE_MS) {
        this.delay = INITIAL_DELAY_MS;
        this.falliti = 0;
        this.schedule();
        return;
      }
      this.falliti += 1;
      if (this.falliti >= TENTATIVI_MAX) {
        this.motivoResa = ev.reason
          || i18n.t("ws.unstable", { max: TENTATIVI_MAX });
        this.destroyed = true;
        this.ws = null;
        this.onResa?.(this.motivoResa);
        return;
      }
      this.schedule();
    });

    // Re-register all caller-registered listeners on the fresh socket.
    for (const [type, handlers] of this.stored) {
      for (const h of handlers) {
        ws.addEventListener(type, h as EventListenerOrEventListenerObject);
      }
    }
  }

  private schedule(): void {
    if (this.timer !== null) return;
    // ±25 % jitter keeps multiple clients from all reconnecting at once.
    const jitter = 1 + (Math.random() - 0.5) * 0.5;
    const delay = Math.min(this.delay * jitter, MAX_DELAY_MS);
    this.delay = Math.min(this.delay * 2, MAX_DELAY_MS);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.open();
    }, delay);
  }

  /** Register a listener. Survives reconnects. */
  on(type: string, handler: Listener): void {
    if (!this.stored.has(type)) this.stored.set(type, new Set());
    this.stored.get(type)!.add(handler);
    this.ws?.addEventListener(type, handler as EventListenerOrEventListenerObject);
  }

  /** Deregister a listener. */
  off(type: string, handler: Listener): void {
    this.stored.get(type)?.delete(handler);
    this.ws?.removeEventListener(type, handler as EventListenerOrEventListenerObject);
  }

  /** Send a frame. Returns false if the socket is not yet open. */
  send(data: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(data);
      return true;
    } catch {
      return false;
    }
  }

  /** Chiude il socket di adesso e ne apre subito uno nuovo, **con gli stessi
   *  ascoltatori** (04-11-2026). Serve quando il server legge la configurazione
   *  all'apertura — la chat dell'assistente dopo un cambio di chiave o di
   *  modello: `destroy()` lasciava chi ascoltava attaccato a un'istanza morta.
   *
   *  Riapre anche un socket che si era arreso (10-11-2026): la chat aperta
   *  prima dell'accesso fallisce sei volte senza token e smette; all'accesso
   *  va riaperta lo stesso, col token nuovo. Uno chiuso con `destroy()` resta
   *  chiuso. */
  riapri(): void {
    if (this.distrutto) return;
    this.destroyed = false;
    this.motivoResa = null;
    this.falliti = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const vecchio = this.ws;
    this.ws = null;
    try { vecchio?.close(); } catch { /* ignore */ }
    this.delay = INITIAL_DELAY_MS;
    this.open();
  }

  /** Il runtime è di nuovo raggiungibile (10-11-2026): si riprova **adesso**,
   *  senza aspettare il prossimo giro dell'attesa crescente, e anche se ci si
   *  era arresi.
   *
   *  Il caso che l'ha chiesto: sul WP630 il runtime è stato fermato 15 s. Il
   *  socket ha fallito a 1, 3, 7 e 15 s, e il giro dopo era a 31 s: per un
   *  quarto di minuto, con il runtime già in piedi, la pagina è rimasta con la
   *  fascia «Dati in ritardo». E un fermo oltre il minuto (un aggiornamento)
   *  faceva arrendere il socket: la pagina restava ferma per sempre.
   *
   *  Chi lo chiama sa che il runtime risponde (il sorvegliante del progetto ha
   *  appena avuto una risposta); un socket aperto o in apertura non si tocca, e
   *  uno chiuso con `destroy()` resta chiuso. */
  riprovaSubito(): void {
    if (this.distrutto) return;
    const stato = this.ws?.readyState;
    if (stato === WebSocket.OPEN || stato === WebSocket.CONNECTING) return;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.destroyed = false;
    this.motivoResa = null;
    this.falliti = 0;
    this.delay = INITIAL_DELAY_MS;
    this.open();
  }

  /** Permanently close. Cancels any pending reconnect timer. */
  destroy(): void {
    this.destroyed = true;
    this.distrutto = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try { this.ws?.close(); } catch { /* ignore */ }
    this.ws = null;
  }

  get readyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }

  /** Perché si è smesso di ritentare, se è successo. `null` = si sta ancora
   *  provando (o va tutto bene). */
  get resa(): string | null {
    return this.motivoResa;
  }
}
