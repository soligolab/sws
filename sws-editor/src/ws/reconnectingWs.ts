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
      // Il server ha risposto e ha rifiutato per un motivo che non cambia:
      // ritentare produrrebbe solo rumore.
      if (CHIUSURE_DEFINITIVE.has(ev.code)) {
        this.motivoResa = ev.reason || `collegamento rifiutato (codice ${ev.code})`;
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
          || `nessun collegamento stabile dopo ${TENTATIVI_MAX} tentativi`;
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

  /** Permanently close. Cancels any pending reconnect timer. */
  destroy(): void {
    this.destroyed = true;
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
