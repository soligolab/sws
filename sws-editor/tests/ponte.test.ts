// Il ponte fra l'editor e la chat staccata, provato con l'oggetto vero.
//
// # Perché non ci sono finti
//
// jsdom non implementa `BroadcastChannel`, **ma vitest espone il globale di
// Node**, e due canali nello stesso processo si parlano davvero — chi manda non
// riceve sé stesso, come nel DOM. Quindi il ponte si prova con l'oggetto vero, e
// non con un doppio che potrebbe essere d'accordo con l'implementazione invece
// che col browser.
//
// Ogni prova qui sotto è scritta a partire dal **verso rotto**: cosa succede se
// la riga che difende manca. Sono i quattro modi in cui questo pezzo può far
// applicare una proposta nel posto sbagliato, o mentire sul suo esito.

import { afterEach, describe, expect, it, vi } from "vitest";

import { editorViaPonte, NESSUNA_CONFERMA } from "@/ai/editor";
import { Ponte } from "@/ai/ponte";
import type { AiProposta } from "@/store";

const PROPOSTA: AiProposta = {
  id: "p1", motivo: "prova",
  project: null, pages: null, impronta: "abc",
};

const ponti: Ponte[] = [];
const nuovoPonte = (id: string) => {
  const p = new Ponte(id);
  ponti.push(p);
  return p;
};

afterEach(() => {
  while (ponti.length) ponti.pop()!.chiudi();
  vi.useRealTimers();
});

/** Attende un giro di event loop: `BroadcastChannel` consegna in modo asincrono. */
const giro = () => new Promise((r) => setTimeout(r, 0));

describe("indirizzamento", () => {
  it("una richiesta per un editor non arriva all'altro", async () => {
    // Il verso rotto: senza il controllo su `a` in `Ponte.ascolta`, **due**
    // schede dell'IDE applicherebbero la stessa proposta. È il difetto peggiore
    // possibile di questo pezzo, perché è silenzioso e raddoppia una modifica.
    const editoreA = nuovoPonte("A");
    const editoreB = nuovoPonte("B");
    const chat     = nuovoPonte("C");

    const arrivateAdA: string[] = [];
    const arrivateAdB: string[] = [];
    editoreA.ascolta((m) => { if (m.t === "applica") arrivateAdA.push(m.rid); });
    editoreB.ascolta((m) => { if (m.t === "applica") arrivateAdB.push(m.rid); });

    chat.manda({ t: "applica", a: "A", rid: "r1", proposta: PROPOSTA });
    await giro();

    expect(arrivateAdA).toEqual(["r1"]);
    expect(arrivateAdB).toEqual([]);
  });

  it("un broadcast arriva a tutti, perché non ha destinatario", async () => {
    const editore = nuovoPonte("A");
    const chat1   = nuovoPonte("C1");
    const chat2   = nuovoPonte("C2");

    const viste: string[] = [];
    chat1.ascolta((m) => { if (m.t === "editore-pronto") viste.push("c1"); });
    chat2.ascolta((m) => { if (m.t === "editore-pronto") viste.push("c2"); });

    editore.manda({ t: "editore-pronto" });
    await giro();

    expect(viste.sort()).toEqual(["c1", "c2"]);
  });

  it("chi manda non riceve sé stesso", async () => {
    const p = nuovoPonte("solo");
    const viste: string[] = [];
    p.ascolta((m) => viste.push(m.t));
    p.manda({ t: "editore-pronto" });
    await giro();
    expect(viste).toEqual([]);
  });
});

describe("il diff che non si può calcolare", () => {
  it("rifiuta invece di restituire un elenco vuoto", async () => {
    // **Il difetto più pericoloso del pezzo.** Un `[]` sullo schermo diventa
    // «questa proposta non cambia niente», davanti a una proposta che cambia il
    // progetto. Quindi `diff-no` deve arrivare come *rifiuto*, non come lista
    // vuota, e chi chiama deve poterlo distinguere.
    const editore = nuovoPonte("E");
    const chat    = nuovoPonte("C");

    editore.ascolta((m) => {
      if (m.t === "diff") {
        editore.manda({ t: "diff-no", a: m.da, rid: m.rid, errore: "progetto non caricato" });
      }
    });

    const ai = editorViaPonte(chat, () => "E");
    await expect(ai.diff(PROPOSTA)).rejects.toThrow("progetto non caricato");
  });

  it("il diff buono passa così com'è", async () => {
    const editore = nuovoPonte("E");
    const chat    = nuovoPonte("C");
    editore.ascolta((m) => {
      if (m.t === "diff") {
        editore.manda({ t: "diff-ok", a: m.da, rid: m.rid,
                        diff: [{ verso: "+", testo: "tag `x`" }] });
      }
    });
    const ai = editorViaPonte(chat, () => "E");
    await expect(ai.diff(PROPOSTA)).resolves.toEqual([{ verso: "+", testo: "tag `x`" }]);
  });
});

describe("l'editor che non risponde", () => {
  it("«applica» scaduto non dichiara la proposta non applicata", async () => {
    // Il verso rotto: restituire `{ ok: false, motivo: "non applicata" }`. Un
    // timeout **non dimostra** la non-applicazione — la proposta può essere
    // passata e la conferma essersi persa — e dire il contrario manderebbe
    // l'utente a riapplicarla, cioè a duplicarla.
    const chat = nuovoPonte("C");           // nessun editor in ascolto
    const ai = editorViaPonte(chat, () => "E-che-non-esiste");

    vi.useFakeTimers();
    const p = ai.applica(PROPOSTA);
    await vi.advanceTimersByTimeAsync(9000);
    const esito = await p;

    expect(esito.ok).toBe(false);
    expect(esito.motivo).toBe(NESSUNA_CONFERMA);
    // La sentinella esiste proprio perché il pannello possa dire la frase
    // giusta: se diventasse un motivo qualunque, quella distinzione si perde.
    expect(esito.motivo).not.toMatch(/non applicat/i);
  });

  it("l'esito vero dell'editor passa intatto, compreso l'avviso", async () => {
    const editore = nuovoPonte("E");
    const chat    = nuovoPonte("C");
    editore.ascolta((m) => {
      if (m.t === "applica") {
        editore.manda({ t: "applicato", a: m.da, rid: m.rid,
                        ok: true, avviso: "c'erano modifiche non salvate" });
      }
    });
    const ai = editorViaPonte(chat, () => "E");
    await expect(ai.applica(PROPOSTA)).resolves.toEqual({
      ok: true, motivo: undefined, avviso: "c'erano modifiche non salvate",
    });
  });

  it("una risposta con un `rid` diverso non conclude l'attesa sbagliata", async () => {
    // Due proposte in volo: la risposta alla seconda non deve risolvere la
    // prima. Senza il confronto su `rid` la chat mostrerebbe l'esito di una
    // proposta sotto un'altra.
    const editore = nuovoPonte("E");
    const chat    = nuovoPonte("C");
    editore.ascolta((m) => {
      if (m.t === "applica") {
        // Risponde con un rid inventato: nessuna attesa deve concludersi.
        editore.manda({ t: "applicato", a: m.da, rid: "rid-di-un-altro", ok: true });
      }
    });
    const ai = editorViaPonte(chat, () => "E");

    vi.useFakeTimers();
    const p = ai.applica(PROPOSTA);
    await vi.advanceTimersByTimeAsync(9000);
    // Scade, invece di prendere per sé la risposta di un'altra proposta.
    expect((await p).motivo).toBe(NESSUNA_CONFERMA);
  });
});
