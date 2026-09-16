import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// `vi.mock` è issato in cima al file, prima delle costanti: la spia va creata
// dentro la fabbrica e recuperata dopo, o si legge una variabile non ancora
// inizializzata.
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<typeof import("@/api/client")>("@/api/client");
  return {
    ...actual,
    api: { ...actual.api, updateLanguages: vi.fn().mockResolvedValue(undefined) },
  };
});

import { api } from "@/api/client";
const aggiornaLingue = api.updateLanguages as unknown as ReturnType<typeof vi.fn>;

import { CampoTestoTradotto } from "../src/editor/CampoTestoTradotto";
import { useAppStore } from "../src/store";
import type { ProjectInfo } from "../src/types";

/** Il testo digitato nel pannello proprietà diventa una voce della tabella
 *  lingue, da solo (Fase 3, 15-09-2026).
 *
 *  Sono i punti in cui i pezzi si incontrano: la decisione pura sta in
 *  `chiaviAutomatiche.ts` ed è provata a parte, ma «la decisione è giusta» e
 *  «il campo scrive davvero nel progetto» sono due cose diverse — e in questo
 *  repo è sempre la seconda a rompersi.
 */

function progetto(entries: { key: string; values: Record<string, string> }[] = []): ProjectInfo {
  return {
    meta: { name: "prova", version: "1" },
    tags: [],
    languages: { default: "it", langs: ["it", "de"], entries },
  } as unknown as ProjectInfo;
}

beforeEach(() => {
  aggiornaLingue.mockClear();
  useAppStore.setState({ project: progetto(), pages: [] });
});

function digita(valore: string | undefined, testo: string) {
  const onChange = vi.fn();
  render(<CampoTestoTradotto valore={valore} onChange={onChange} />);
  const input = screen.getByRole("textbox");
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: testo } });
  fireEvent.blur(input);
  return onChange;
}

describe("digitare un testo crea la voce e scrive il token", () => {
  it("il campo riceve {{t0001}} e la tabella riceve il testo", () => {
    const onChange = digita(undefined, "Avvio pompa");
    expect(onChange).toHaveBeenCalledWith("{{t0001}}");
    const t = useAppStore.getState().project!.languages!;
    expect(t.entries).toHaveLength(1);
    expect(t.entries[0]).toEqual({ key: "t0001", values: { it: "Avvio pompa" } });
    expect(aggiornaLingue).toHaveBeenCalledTimes(1);
  });

  it("niente si scrive finché non si conferma", () => {
    const onChange = vi.fn();
    render(<CampoTestoTradotto valore={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox");
    fireEvent.focus(input);
    // Tre battute: senza la conferma differita sarebbero tre voci in tabella,
    // «A», «Av», «Avv».
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.change(input, { target: { value: "Av" } });
    fireEvent.change(input, { target: { value: "Avv" } });
    expect(onChange).not.toHaveBeenCalled();
    expect(useAppStore.getState().project!.languages!.entries).toHaveLength(0);
  });

  it("un testo che non si traduce resta testo", () => {
    const onChange = digita(undefined, "42");
    expect(onChange).toHaveBeenCalledWith("42");
    expect(useAppStore.getState().project!.languages!.entries).toHaveLength(0);
  });
});

describe("il salvataggio si dichiara come nostro", () => {
  it("dopo aver scritto la tabella, markSaveOk viene chiamato", async () => {
    // Il watcher del progetto confronta un'impronta di project.yaml ogni tre
    // secondi e non sa chi l'ha cambiato. Senza questa dichiarazione, OGNI
    // etichetta digitata faceva comparire la barra «il progetto sul runtime è
    // cambiato» — e premere «Ricarica» lì butta via le pagine non salvate.
    // Il maintainer ci ha perso degli oggetti appena inseriti, il 15-09-2026.
    const segno = vi.fn();
    useAppStore.setState({ markSaveOk: segno });
    digita(undefined, "Avvio pompa");
    // `updateLanguages` è una promessa: il segno arriva dopo.
    await vi.waitFor(() => expect(segno).toHaveBeenCalled());
  });
});

describe("il campo mostra il testo, non la chiave", () => {
  it("un oggetto che porta gia un token si apre mostrando la frase", () => {
    useAppStore.setState({
      project: progetto([{ key: "t0001", values: { it: "Avvio pompa", de: "Pumpe Start" } }]),
    });
    render(<CampoTestoTradotto valore="{{t0001}}" onChange={vi.fn()} />);
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("Avvio pompa");
  });
});

describe("il riuso si propone", () => {
  it("accettando, il campo punta alla voce che c'era gia e non se ne crea una seconda", () => {
    useAppStore.setState({
      project: progetto([{ key: "t0001", values: { it: "Avvio pompa" } }]),
    });
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(true);
    const onChange = digita(undefined, "Avvio pompa");
    expect(conferma).toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("{{t0001}}");
    expect(useAppStore.getState().project!.languages!.entries).toHaveLength(1);
    conferma.mockRestore();
  });

  it("rifiutando, si crea una voce nuova con lo stesso testo", () => {
    // È il caso che rende il riuso una PROPOSTA e non una regola: due «Avvio»
    // identici in italiano possono divergere in tedesco.
    useAppStore.setState({
      project: progetto([{ key: "t0001", values: { it: "Avvio pompa" } }]),
    });
    const conferma = vi.spyOn(window, "confirm").mockReturnValue(false);
    const onChange = digita(undefined, "Avvio pompa");
    expect(onChange).toHaveBeenCalledWith("{{t0002}}");
    const t = useAppStore.getState().project!.languages!;
    expect(t.entries).toHaveLength(2);
    expect(t.entries[1].values.it).toBe("Avvio pompa");
    conferma.mockRestore();
  });
});

describe("il selettore di caratteri speciali (T-71)", () => {
  it("il bottone apre il selettore con il catalogo", () => {
    render(<CampoTestoTradotto valore={undefined} onChange={vi.fn()} />);
    // Un carattere del catalogo, per categoria "Energia", non è ancora
    // visibile finché il selettore non è aperto.
    expect(screen.queryByTitle("⚡")).toBeNull();
    fireEvent.click(screen.getByTitle("characterPicker.open"));
    expect(screen.queryByTitle("⚡")).not.toBeNull();
  });

  it("un carattere scelto si inserisce nel campo, e passa dalla stessa pipeline del testo digitato", () => {
    // Un'emoji da sola non è né vuota né un numero né un token: la stessa
    // regola di "traducibile" che vale per il testo digitato a mano la
    // promuove a voce della tabella lingue — comportamento pre-esistente di
    // chiaviAutomatiche.ts, non qualcosa che il selettore deve aggirare.
    const onChange = vi.fn();
    render(<CampoTestoTradotto valore={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.click(screen.getByTitle("characterPicker.open"));
    fireEvent.click(screen.getByTitle("⚡"));
    expect(input.value).toBe("⚡");
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith("{{t0001}}");
    const t = useAppStore.getState().project!.languages!;
    expect(t.entries[0].values.it).toBe("⚡");
  });

  it("il carattere si inserisce alla posizione del cursore, non in coda", () => {
    const onChange = vi.fn();
    render(<CampoTestoTradotto valore={undefined} onChange={onChange} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "Pompa avviata" } });
    // Cursore subito dopo "Pompa " (6 caratteri), non in fondo alla frase.
    input.setSelectionRange(6, 6);
    fireEvent.click(screen.getByTitle("characterPicker.open"));
    fireEvent.click(screen.getByTitle("⚡"));
    expect(input.value).toBe("Pompa ⚡avviata");
  });

  it("scegliendo un carattere il selettore si chiude da solo", () => {
    render(<CampoTestoTradotto valore={undefined} onChange={vi.fn()} />);
    fireEvent.click(screen.getByTitle("characterPicker.open"));
    fireEvent.click(screen.getByTitle("⚡"));
    expect(screen.queryByTitle("⚡")).toBeNull();
  });
});
