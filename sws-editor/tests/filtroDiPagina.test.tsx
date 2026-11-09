/** Il filtro di pagina che non si perde, dal viewer vero (piano «viewer
 *  leggero», 09-11-2026, passo 4).
 *
 *  Prima l'apertura del socket mandava sempre `["*"]`, e `RuntimeView` mandava
 *  la lista della pagina solo quando cambiava: col socket non ancora aperto il
 *  messaggio si perdeva, e il viewer riceveva tutti i tag. Lo sfondo da
 *  variabile della pagina-finestra mancava dalla lista e restava fermo. */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Il socket finto: `send` col socket non aperto non manda niente, come
// `ReconnectingWs`.
const finto = vi.hoisted(() => {
  type Ascoltatore = (ev: unknown) => void;
  const ascoltatori = new Map<string, Set<Ascoltatore>>();
  const stream = {
    readyState: 0, // WebSocket.CONNECTING
    mandati: [] as unknown[],
    on(tipo: string, h: Ascoltatore) {
      if (!ascoltatori.has(tipo)) ascoltatori.set(tipo, new Set());
      ascoltatori.get(tipo)!.add(h);
    },
    off(tipo: string, h: Ascoltatore) { ascoltatori.get(tipo)?.delete(h); },
    send(data: string) {
      if (stream.readyState !== 1) return false;
      stream.mandati.push(JSON.parse(data));
      return true;
    },
  };
  return {
    stream,
    apri() {
      stream.readyState = 1;
      for (const h of [...(ascoltatori.get("open") ?? [])]) h({});
    },
  };
});

vi.mock("@/ws/singletonWs", () => ({
  socketCondiviso: () => ({
    prendi: () => finto.stream,
    corrente: () => finto.stream,
    chiudi: () => {},
  }),
}));

// L'avviso di aggiornamento dentro `RuntimeView` chiede al runtime: qui non c'è.
vi.mock("@/api/client", async () => {
  const vero = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  const no = () => Promise.reject(new Error("nessun runtime nel test"));
  return { ...vero, api: { ...vero.api, getSystemStatus: no, statoAggiornamento: no } };
});

import "../src/i18n/index";
import { RuntimeView } from "@/runtime-view/RuntimeView";
import { useAppStore } from "@/store";
import { sendSubscribe } from "@/ws/tagStream";
import type { SynopticPage } from "@/types";

const PAGINE = [
  {
    id: "p1", name: "Pagina", width: 400, height: 200, background_tag: "pagina.sfondo",
    objects: [
      { id: "t", type: "text", x: 10, y: 10, width: 80, height: 20, tag: "pagina.valore" },
      { id: "b", type: "button", x: 10, y: 50, width: 80, height: 30, label: "Apri", button_action: { type: "open_popup", page: "w1" } },
    ],
  },
  {
    id: "w1", name: "Finestra", width: 200, height: 100, finestra: { modale: true }, background_tag: "finestra.sfondo",
    objects: [{ id: "v", type: "text", x: 10, y: 10, width: 80, height: 20, tag: "finestra.valore" }],
  },
  {
    // Un legame che sceglie il tag: `s.selettore` dice quale tag leggere.
    id: "p2", name: "Selettore", width: 400, height: 200,
    objects: [{ id: "s", type: "text", x: 10, y: 10, width: 80, height: 20, tag: "s.a", bindings: { tag: "s.selettore" } }],
  },
] as unknown as SynopticPage[];

const sottoscrizioni = () =>
  finto.stream.mandati.filter((m) => (m as { type: string }).type === "subscribe").map((m) => (m as { tags: string[] }).tags);

describe("il filtro di pagina del viewer", () => {
  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    finto.stream.readyState = 0;
    finto.stream.mandati = [];
    useAppStore.setState({
      authToken: "prova", remoteConnected: false, tagValues: {},
      project: { tags: [], types: [] } as never,
      pages: PAGINE, currentPageId: "p1",
    });
  });
  afterEach(() => {
    sendSubscribe(["*"]);
    vi.unstubAllGlobals();
  });

  it("col socket ancora in apertura, la prima sottoscrizione è quella della pagina", () => {
    render(<RuntimeView />);
    act(() => finto.apri());
    const prima = sottoscrizioni()[0];
    expect(prima).toEqual(expect.arrayContaining(["pagina.valore", "pagina.sfondo"]));
    expect(prima).not.toContain("*");
  });

  it("con la finestra aperta chiede anche i suoi tag e il suo sfondo da variabile", () => {
    render(<RuntimeView />);
    act(() => finto.apri());
    fireEvent.mouseDown(screen.getByText("Apri"));
    expect(screen.getByTestId("pagina-finestra")).toBeTruthy();
    expect(sottoscrizioni().at(-1)).toEqual(
      expect.arrayContaining(["pagina.valore", "pagina.sfondo", "finestra.valore", "finestra.sfondo"]),
    );
  });

  it("un legame che sceglie il tag fa chiedere tutto, fin dalla prima sottoscrizione", () => {
    // Il tag scelto non si sa prima: con la sola lista degli id scritti il
    // tag scelto arriverebbe col primo snapshot e poi resterebbe fermo.
    useAppStore.setState({ currentPageId: "p2" });
    render(<RuntimeView />);
    act(() => finto.apri());
    expect(sottoscrizioni()[0]).toEqual(["*"]);
  });

  it("smontato il viewer, si torna a ricevere tutto", () => {
    act(() => finto.apri());
    const { unmount } = render(<RuntimeView />);
    expect(sottoscrizioni().at(-1)).toContain("pagina.valore");
    unmount();
    expect(sottoscrizioni().at(-1)).toEqual(["*"]);
  });
});
