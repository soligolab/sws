// Thin wrapper around WebSocket that reconnects automatically with exponential
// back-off when the connection drops. Listeners survive reconnects: they are
// stored internally and re-registered on every new underlying socket.
//
// Back-off schedule: 1 s → 2 s → 4 s … cap at 30 s, with ±25 % jitter to
// spread reconnect storms after a server restart.

const INITIAL_DELAY_MS = 1_000;
const MAX_DELAY_MS = 30_000;

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
  private readonly stored = new Map<string, Set<Listener>>();

  constructor(private readonly buildUrl: () => string) {
    this.open();
  }

  private open(): void {
    if (this.destroyed) return;
    const ws = new WebSocket(this.buildUrl());
    this.ws = ws;

    ws.addEventListener("open", () => {
      this.delay = INITIAL_DELAY_MS; // reset on successful connect
    });

    ws.addEventListener("close", () => {
      if (!this.destroyed) this.schedule();
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
}
