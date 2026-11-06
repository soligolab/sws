/** La Finestra di avviso (piano docs/plans/2026-11-04-finestra-di-avviso.md, F1):
 *  le cinque funzioni, i tasti, il velo, la coda, l'aiuto per i test. */
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, it, expect, afterEach, vi } from "vitest";
import "../src/i18n/index";
import { Cornice, FinestraAvviso } from "../src/finestraAvviso/FinestraAvviso";
import { avviso, chiedi, conferma, modulo, rispondi, scegli, svuotaCoda, type Richiesta } from "../src/finestraAvviso/finestraAvviso";

afterEach(async () => {
  // Una richiesta lasciata aperta da un test non deve restare in coda per il prossimo.
  await act(async () => { svuotaCoda(); });
  // Un Invio premuto da un test e mai rilasciato (in jsdom il keyup non arriva
  // da solo) farebbe credere alla prossima finestra di essere aperta da Invio.
  fireEvent.keyUp(window, { key: "Enter" });
  cleanup();
});

const ok = () => screen.getByTestId("finestra-avviso-ok");
const annulla = () => screen.getByTestId("finestra-avviso-annulla");
const finestra = () => screen.getByTestId("finestra-avviso");

/** Monta l'host e apre la richiesta. La Promise torna dentro un oggetto: un
 *  `async` che la restituisse nuda aspetterebbe la risposta, cioè per sempre. */
async function apri<T>(p: () => Promise<T>): Promise<{ esito: Promise<T> }> {
  render(<FinestraAvviso />);
  let esito!: Promise<T>;
  await act(async () => { esito = p(); });
  return { esito };
}

describe("conferma", () => {
  it("il bottone dell'azione dà true, Annulla false; Annulla a sinistra, l'azione a destra", async () => {
    const { esito: p } = await apri(() => conferma({ titolo: "Eliminare il backup?", testo: "Non si torna indietro.", si: "Elimina" }));
    expect(screen.getByText("Eliminare il backup?")).toBeTruthy();
    const bottoni = [...finestra().querySelectorAll("button")].map((b) => b.dataset.testid);
    expect(bottoni).toEqual(["finestra-avviso-annulla", "finestra-avviso-ok"]);
    expect(ok().textContent).toBe("Elimina");
    fireEvent.click(ok());
    await expect(p).resolves.toBe(true);
    expect(screen.queryByTestId("finestra-avviso")).toBeNull();
  });

  it("Esc annulla, e Invio sul predefinito conferma", async () => {
    const { esito: a } = await apri(() => conferma("Procedere?"));
    fireEvent.keyDown(finestra(), { key: "Escape" });
    await expect(a).resolves.toBe(false);
    let b!: Promise<boolean>;
    await act(async () => { b = conferma("E adesso?"); });
    expect(document.activeElement).toBe(ok());
    fireEvent.keyDown(finestra(), { key: "Enter" });
    await expect(b).resolves.toBe(true);
  });

  it("con pericolo il predefinito è Annulla: Invio non esegue l'azione", async () => {
    const { esito: p } = await apri(() => conferma({ testo: "Cancellare tutto?", pericolo: true }));
    expect(document.activeElement).toBe(annulla());
    expect(finestra().getAttribute("role")).toBe("alertdialog");
    fireEvent.keyDown(finestra(), { key: "Enter" });
    await expect(p).resolves.toBe(false);
  });

  it("il velo chiude una conferma normale, ma non una pericolosa", async () => {
    const { esito: p } = await apri(() => conferma("Normale?"));
    fireEvent.mouseDown(screen.getByTestId("finestra-avviso-velo"));
    await expect(p).resolves.toBe(false);
    let q!: Promise<boolean>;
    await act(async () => { q = conferma({ testo: "Pericolosa?", pericolo: true }); });
    fireEvent.mouseDown(screen.getByTestId("finestra-avviso-velo"));
    expect(screen.getByTestId("finestra-avviso")).toBeTruthy();
    fireEvent.click(annulla());
    await expect(q).resolves.toBe(false);
  });
});

describe("avviso, chiedi, scegli, modulo", () => {
  it("avviso: il testo va a capo come scritto, OK chiude", async () => {
    const { esito: p } = await apri(() => avviso({ titolo: "Fatto", testo: "riga uno\nriga due", livello: "errore" }));
    expect(screen.getByTestId("finestra-avviso-testo").textContent).toBe("riga uno\nriga due");
    expect(screen.getByTestId("finestra-avviso-testo").style.whiteSpace).toBe("pre-wrap");
    fireEvent.click(ok());
    await expect(p).resolves.toBeUndefined();
  });

  it("chiedi: Invio nel campo conferma, valida tiene aperta la finestra con l'errore", async () => {
    const { esito: p } = await apri(() => chiedi({ testo: "Nome", iniziale: "a", valida: (v) => (v.length < 3 ? "troppo corto" : null) }));
    const campo = screen.getByTestId("finestra-avviso-campo") as HTMLInputElement;
    expect(document.activeElement).toBe(campo);
    fireEvent.keyDown(campo, { key: "Enter" });
    expect(screen.getByTestId("finestra-avviso-errore").textContent).toBe("troppo corto");
    fireEvent.change(campo, { target: { value: "abcd" } });
    fireEvent.keyDown(campo, { key: "Enter" });
    await expect(p).resolves.toBe("abcd");
  });

  it("chiedi: il valore iniziale è già selezionato, come in prompt", async () => {
    const { esito: p } = await apri(() => chiedi({ testo: "Nome", iniziale: "progetto copia" }));
    const campo = screen.getByTestId("finestra-avviso-campo") as HTMLInputElement;
    expect([campo.selectionStart, campo.selectionEnd]).toEqual([0, "progetto copia".length]);
    fireEvent.click(annulla());
    await p;
  });

  it("chiedi: password nasconde il testo, Annulla dà null", async () => {
    const { esito: p } = await apri(() => chiedi({ testo: "Password", password: true }));
    expect((screen.getByTestId("finestra-avviso-campo") as HTMLInputElement).type).toBe("password");
    fireEvent.click(annulla());
    await expect(p).resolves.toBeNull();
  });

  it("scegli: ogni scelta il suo valore; Esc null", async () => {
    const { esito: p } = await apri(() => scegli({ testo: "Dove?", scelte: [{ valore: "qui", etichetta: "Qui" }, { valore: "ovunque", etichetta: "Ovunque" }] }));
    fireEvent.click(screen.getByTestId("finestra-avviso-scelta-1"));
    await expect(p).resolves.toBe("ovunque");
    let q!: Promise<string | null>;
    await act(async () => { q = scegli({ testo: "Ancora?", scelte: [{ valore: "a", etichetta: "A" }] }); });
    fireEvent.keyDown(finestra(), { key: "Escape" });
    await expect(q).resolves.toBeNull();
  });

  it("aperta da Invio: il fuoco va al predefinito solo quando il tasto si alza", async () => {
    // Collaudo F2.7 (06-11-2026): il campo testo conferma col blur su Invio, la
    // domanda nasce durante quel tasto, e il keypress che segue premeva Annulla.
    render(<FinestraAvviso />);
    fireEvent.keyDown(window, { key: "Enter" });
    let p!: Promise<string | null>;
    await act(async () => { p = scegli({ testo: "Dove?", scelte: [{ valore: "qui", etichetta: "Qui" }] }); });
    expect(document.activeElement).toBe(finestra());
    fireEvent.keyDown(finestra(), { key: "Enter", repeat: true });
    fireEvent.keyUp(window, { key: "Enter" });
    expect(document.activeElement).toBe(annulla());
    fireEvent.click(screen.getByTestId("finestra-avviso-scelta-0"));
    await expect(p).resolves.toBe("qui");
  });

  it("modulo: il corpo chiude con il suo valore; non chiudibile resiste a Esc", async () => {
    const { esito: p } = await apri(() => modulo<number>({
      titolo: "Impostazioni", chiudibile: false,
      corpo: (fine) => <button type="button" data-testid="fatto" onClick={() => fine(42)}>Fatto</button>,
    }));
    fireEvent.keyDown(finestra(), { key: "Escape" });
    expect(screen.getByTestId("finestra-avviso")).toBeTruthy();
    fireEvent.click(screen.getByTestId("fatto"));
    await expect(p).resolves.toBe(42);
  });
});

describe("la cornice", () => {
  it("una richiesta alla volta, nell'ordine in cui arrivano", async () => {
    render(<FinestraAvviso />);
    let a!: Promise<boolean>, b!: Promise<boolean>;
    await act(async () => { a = conferma("Prima"); b = conferma("Seconda"); });
    expect(screen.getByTestId("finestra-avviso-testo").textContent).toBe("Prima");
    fireEvent.click(ok());
    await expect(a).resolves.toBe(true);
    await act(async () => {});
    expect(screen.getByTestId("finestra-avviso-testo").textContent).toBe("Seconda");
    fireEvent.click(annulla());
    await expect(b).resolves.toBe(false);
  });

  it("i tasti non arrivano alle scorciatoie dell'editor, e Tab resta dentro", async () => {
    const scorciatoia = vi.fn();
    window.addEventListener("keydown", scorciatoia);
    const { esito: p } = await apri(() => conferma("Tasti?"));
    fireEvent.keyDown(finestra(), { key: "Delete" });
    fireEvent.keyDown(document.body, { key: "z", ctrlKey: true });
    expect(scorciatoia).not.toHaveBeenCalled();
    fireEvent.keyDown(ok(), { key: "Tab" });
    expect(document.activeElement).toBe(annulla());
    fireEvent.keyDown(annulla(), { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ok());
    window.removeEventListener("keydown", scorciatoia);
    fireEvent.click(ok());
    await p;
  });

  it("Ctrl+S con una finestra aperta non apre il «Salva pagina» del browser", async () => {
    const { esito: p } = await apri(() => conferma("Salvare?"));
    const ev = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
    ok().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(ok());
    await p;
  });

  it("il fuoco torna a chi aveva aperto la finestra", async () => {
    render(<><button type="button" data-testid="origine">apri</button><FinestraAvviso /></>);
    const origine = screen.getByTestId("origine");
    origine.focus();
    let p!: Promise<void>;
    await act(async () => { p = avviso("Ciao"); });
    expect(document.activeElement).toBe(ok());
    fireEvent.click(ok());
    await p;
    await act(async () => {});
    expect(document.activeElement).toBe(origine);
  });

  it("una conferma chiesta da dentro un modulo gli sta sopra, e il modulo resta montato", async () => {
    render(<FinestraAvviso />);
    let esito: boolean | null = null;
    let m!: Promise<string | null>;
    await act(async () => {
      m = modulo<string>({
        titolo: "Impostazioni",
        corpo: (fine) => (
          <button type="button" data-testid="chiedi-conferma"
            onClick={async () => { esito = await conferma("Sicuro?"); if (esito) fine("fatto"); }}>Cambia</button>
        ),
      });
    });
    await act(async () => { fireEvent.click(screen.getByTestId("chiedi-conferma")); });
    expect(finestra().getAttribute("data-tipo")).toBe("conferma");
    expect(screen.getByTestId("finestra-avviso-sotto").getAttribute("data-tipo")).toBe("modulo");
    await act(async () => { fireEvent.click(ok()); });
    expect(esito).toBe(true);
    await expect(m).resolves.toBe("fatto");
  });

  it("due host montati (StrictMode): la finestra compare una volta sola", async () => {
    render(<StrictMode><FinestraAvviso /><FinestraAvviso /></StrictMode>);
    let p!: Promise<void>;
    await act(async () => { p = avviso("Una"); });
    expect(screen.getAllByTestId("finestra-avviso")).toHaveLength(1);
    fireEvent.click(ok());
    await p;
  });
});

describe("rispondi, l'aiuto per i test", () => {
  it("risponde subito senza disegnare, e raccoglie le chiamate", async () => {
    const r = rispondi(true);
    render(<FinestraAvviso />);
    await expect(conferma({ testo: "Sicuro?" })).resolves.toBe(true);
    expect(screen.queryByTestId("finestra-avviso")).toBeNull();
    expect(r.chiamate).toHaveLength(1);
    expect(r.chiamate[0]).toMatchObject({ tipo: "conferma", testo: "Sicuro?" });
    r.ferma();
  });

  it("con una funzione decide richiesta per richiesta", async () => {
    const r = rispondi((q: Richiesta) => (q.tipo === "chiedi" ? "nome" : false));
    await expect(chiedi("Nome?")).resolves.toBe("nome");
    await expect(conferma("No?")).resolves.toBe(false);
    r.ferma();
  });
});

describe("Cornice, per le finestre che vivono in chi le apre (F3)", () => {
  it("Esc chiude, il velo solo se lo si chiede, e Tab resta dentro", () => {
    const chiudi = vi.fn();
    render(
      <Cornice titolo="Rinomina" onChiudi={chiudi} testid="c">
        <input data-testid="uno" /><button type="button" data-testid="due">ok</button>
      </Cornice>,
    );
    const c = screen.getByTestId("c");
    expect(screen.getByRole("dialog", { name: "Rinomina" })).toBe(c);
    expect(document.activeElement).toBe(screen.getByTestId("uno"));
    screen.getByTestId("due").focus();
    fireEvent.keyDown(screen.getByTestId("due"), { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByTestId("uno"));
    fireEvent.mouseDown(screen.getByTestId("c-velo"));
    expect(chiudi).not.toHaveBeenCalled();
    fireEvent.keyDown(c, { key: "Escape" });
    expect(chiudi).toHaveBeenCalledTimes(1);
  });

  it("non chiudibile resiste a Esc; sotto una conferma della coda, i tasti sono della conferma", async () => {
    const chiudi = vi.fn();
    render(<><FinestraAvviso /><Cornice onChiudi={chiudi} chiudibile={false} testid="c"><button type="button">x</button></Cornice></>);
    fireEvent.keyDown(screen.getByTestId("c"), { key: "Escape" });
    expect(chiudi).not.toHaveBeenCalled();
    let p!: Promise<boolean>;
    await act(async () => { p = conferma("Sopra?"); });
    expect(screen.getByTestId("c-velo").hasAttribute("inert")).toBe(true);
    fireEvent.keyDown(finestra(), { key: "Escape" });
    await expect(p).resolves.toBe(false);
  });

  it("due cornici: i tasti sono di quella aperta dopo, e il fuoco torna a chi le ha aperte", async () => {
    const chiudiA = vi.fn(), chiudiB = vi.fn();
    render(<><button type="button" data-testid="origine">apri</button></>);
    screen.getByTestId("origine").focus();
    const { rerender } = render(<Cornice onChiudi={chiudiA} testid="a"><input data-testid="campo-a" autoFocus /></Cornice>);
    rerender(<>
      <Cornice onChiudi={chiudiA} testid="a"><input data-testid="campo-a" autoFocus /></Cornice>
      <Cornice onChiudi={chiudiB} testid="b"><input data-testid="campo-b" autoFocus /></Cornice>
    </>);
    screen.getByTestId("campo-b").focus();
    fireEvent.keyDown(screen.getByTestId("campo-b"), { key: "x" });
    expect(document.activeElement).toBe(screen.getByTestId("campo-b"));
    fireEvent.keyDown(screen.getByTestId("b"), { key: "Escape" });
    expect(chiudiB).toHaveBeenCalledTimes(1);
    expect(chiudiA).not.toHaveBeenCalled();
    rerender(<></>);
    await act(async () => {});
    expect(document.activeElement).toBe(screen.getByTestId("origine"));
  });
});
